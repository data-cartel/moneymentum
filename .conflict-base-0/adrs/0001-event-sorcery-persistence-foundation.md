# ADR 0001: event-sorcery as the persistence foundation

- Status: Proposed (under review)
- Date: 2026-06-18
- Tracking issue: [#184](https://github.com/data-cartel/moneymentum/issues/184)
  (refactor: switch event sourcing from cqrs-es to event-sorcery)
- Supersedes the stale story `0x023.switch-event-sourcing-wrapper`

## Context

The backend has **no event sourcing today**. It once modeled ingestion as a
cqrs-es singleton aggregate, but issue
[#339](https://github.com/data-cartel/moneymentum/issues/339) deliberately
deleted all `cqrs-es`/`sqlite-es` usage and replaced it with a plain
`ingestion_runs` ledger -- specifically because the singleton aggregate got
stuck reporting `Running` forever after a crash, forcing unsafe database resets.

Consequences of that history that shape this decision:

- The `events`, `snapshots`, and `ingestion_view` migrations are **orphaned** --
  no code writes them and the tables are empty. The orphaned `snapshots` table
  is even missing the `snapshot_version` column the current schema needs.
- Issue #184's story assumed an `Ingestion` aggregate "plus any others" still
  exist. They do not. The story is stale.
- Persisted state today: `ingestion_runs` (raw sqlx), the apalis `Jobs` table
  (apalis-sql 0.7), and file-based parquet/CSV (`markets.csv` holds the
  operator-edited `disable` flag; Open-High-Low-Close-Volume (OHLCV) and funding
  are parquet). **Portfolio state is not persisted** -- target/current weights
  arrive in request bodies; `/beta`, `/risk`, `/portfolio/compare`,
  `/portfolio/simulate`, `/portfolio/exposure` are stateless analytics.

**The goal (from the maintainer):** make
[`event-sorcery`](https://github.com/ST0X-Technology/event-sorcery) (the
maintainer's own library; v0.2.0-rc1) the persistence foundation, with
**portfolio management as the centerpiece** -- persisted target portfolios
(needed later for auto-rebalancing), historic performance, performance
predictions, enabled/disabled markets, and ingestion lifecycle -- and the model
must be **extensible to multiple instruments and venues** (the SPEC's
dual-abstraction principle: abstract both data sources and execution venues).

**event-sorcery in one paragraph.** A Rust event-sourcing library wrapping
cqrs-es 0.5 plus a SQLite event store. Consumers implement `EventSourced` on a
domain type (associated `Id`/`Event`/`Command`/`Error`/`Jobs`/`Materialized`;
pure `originate`/`evolve`/`initialize`/`transition` methods). `StoreBuilder`
wires exactly one `Store` per aggregate at startup and auto-wires a `Projection`
for `Materialized = Table` aggregates. Side effects go through durable apalis
`Job`s enqueued in the same transaction as the events. `CompactionPolicy` is
`Retain` (keep every event forever) or `CompactAfterSnapshot` (reclaim
pre-snapshot events). The schema registry is itself an event-sourced aggregate
(no extra table) and clears stale snapshots on a `SCHEMA_VERSION` bump.

## Decision

Adopt event-sorcery as the persistence foundation, with these load-bearing
choices:

1. **Decompose the domain by event permanence.** This maps one-to-one onto
   event-sorcery's compaction model and is the spine of the design:
   - **Audit aggregates** (`Retain`) own intentional acts whose replay _is_ the
     history: `Portfolio` (+ its persisted target), `MarketEnablement`,
     `IngestionRun`, `RebalanceExecution`.
   - **Observational aggregates** (`CompactAfterSnapshot`) cache external state
     the system does not author: `MarketCatalog`, `VenuePositions`,
     `PerformancePrediction`. The lone exception is `NavSnapshot`, which stays
     `Retain` because it is the replayable input to historic performance.

2. **Portfolio is the first-class centerpiece and the first domain aggregate.**
   A pure, I/O-free struct entity that owns durable manager intent: identity,
   lifecycle, and the **persisted target** as an immutable `TargetRevised`
   stream of signed weights + a leverage multiplier (SPEC: "portfolios as
   proportions, not positions"), validated abs-sum-to-1 at the command boundary.
   This is the server-side source of truth the future auto-rebalancer reads.

3. **Instruments and venues are value objects, never aggregate keys or bare
   strings.** Every event that names an asset carries an `InstrumentRef`
   (`Perp{venue,symbol}` | `Spot{venue,symbol}` | `NativeAsset{chain,symbol}`)
   and every venue is a `VenueRef`. Adding Jupiter spot, Derive options, or a
   read-only chain is **one variant + one adapter** with zero change to the
   portfolio command/event surface. This is how the dual abstraction is enforced
   structurally rather than by convention.

4. **Net Asset Value (NAV) and historic performance are projection-backed read
   models, never event-writing aggregates.** NAV is derived, not decided.
   Historic performance rebuilds deterministically by folding the retained
   `TargetRevised`, `RebalanceSettled`, and `NavComputed` streams.

5. **Ingestion is re-event-sourced without the #339 regression.** Per-run
   identity (never a singleton), a monotone terminal state machine, the "one
   running" invariant enforced by a **same-transaction DB UNIQUE constraint** on
   the command path (not a racy projection read), and an **unconditional bounded
   startup reconciler** that abandons every still-running stream _before_
   `/ingest` is accepted.

6. **The semver-major dependency upgrade lands first, as a dependency-only
   change**, before any aggregate, so the first domain PR is reviewable for
   correctness rather than fused with a runtime-wide migration and a live worker
   swap.

## Domain model

| Aggregate               | Kind          | Materialized | Compaction           | Id keys on                               | Purpose                                                                                     |
| ----------------------- | ------------- | ------------ | -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Portfolio`             | audit         | Table        | Retain               | `PortfolioId(Uuid)`                      | Identity, lifecycle, and the persisted target (signed weights + leverage). The centerpiece. |
| `MarketEnablement`      | audit         | Table        | Retain               | `(VenueRef, Symbol)`                     | Operator enable/disable decisions (the `markets.csv` disable flag).                         |
| `MarketCatalog`         | observational | Table        | CompactAfterSnapshot | `VenueRef`                               | Exchange-listed universe + per-market metadata, refreshed each ingestion.                   |
| `IngestionRun`          | audit         | Table        | Retain               | `IngestionRunId`                         | Per-run ingestion lifecycle (replaces the raw `ingestion_runs` ledger).                     |
| `VenuePositions`        | observational | Table        | CompactAfterSnapshot | `(PortfolioId, VenueRef)`                | Current on-venue positions per portfolio per venue.                                         |
| `NavSnapshot`           | observational | Table        | **Retain**           | `PortfolioId`                            | Time-stamped cross-venue NAV with gross/net + prices. Feeds historic performance.           |
| `RebalanceExecution`    | audit         | Table        | Retain               | `RebalanceId(Uuid)` under `PortfolioId`  | The audit record of an executed rebalance: routed plan + per-leg fills.                     |
| `PerformancePrediction` | observational | Table        | CompactAfterSnapshot | `PredictionId(Uuid)` under `PortfolioId` | Forward projections over a target revision, scored against realized performance.            |

Plus two **projection-backed read models** (not aggregates): `target_revision`
history (a projection over `Portfolio`'s `TargetRevised` stream) and
`performance_history` (folds `TargetRevised` + `RebalanceSettled` +
`NavComputed`).

### Key events per aggregate

- **Portfolio**: `PortfolioOpened{name, base_currency}`,
  `TargetRevised{weights: Vec<(InstrumentRef, SignedWeight)>, leverage,
  rationale}`,
  `PortfolioRenamed`, `CustodyBound{custody}` (deferred), `PortfolioArchived`.
  Lifecycle is a `status` **field** (not separate Live variants) so
  `$.Live.status` generated columns work on the view.
- **MarketEnablement**: `MarketDisabledByOperator{reason}`,
  `MarketEnabledByOperator`.
- **MarketCatalog**: `VenueUniverseObserved{markets, observed_at}`,
  `MarketDelisted{symbol, observed_at}` (adapter-derived diff).
- **IngestionRun**: `IngestionRunStarted`, `IngestionRunCompleted`,
  `IngestionRunFailed`, `IngestionRunAbandoned` (emitted only by the startup
  reconciler).
- **VenuePositions**:
  `PositionsObserved{positions: Vec<ObservedPosition>,
  observation_id, observed_at}`
  (money fields decimal-encoded; `observation_id` minted by the job before the
  read for idempotent at-least-once redelivery).
- **NavSnapshot**:
  `NavComputed{total_nav_usd, gross_long/short/net,
  per_venue, priced_from, computation_id, oldest_input_observed_at,
  computed_at}`.
- **RebalanceExecution**:
  `RebalanceInitiated{target_revision_seq,
  planned_legs}`, `LegFilled`,
  `LegRejected`, `RebalanceSettled{outcome}`.
- **PerformancePrediction**: `PredictionIssued{model, horizon, projection}`,
  `PredictionRealized{realized_value, error, scored_at}`.

### Cross-cutting design

- **Instruments (data-source half of the dual abstraction).** `InstrumentRef` is
  embedded in payloads, never an aggregate key. Today only `Perp{Hyperliquid,_}`
  and `NativeAsset{Bitcoin,_}` (the read-only BTC of `readonly_portfolio.rs`)
  exist; both are justified by shipped code. The `Option{...}` variant is
  **deliberately deferred** out of the permanent event model until an options
  venue and its conventions (American/European, settlement, multiplier) are real
  -- committing strike/expiry/kind into immutable history now is an unmigratable
  bet (You Aren't Gonna Need It, or YAGNI, applied to event types).
- **Venues (execution half).** Each venue contributes in exactly two pluggable
  places, both keyed on `VenueRef`: an **ingest adapter** (venue state ->
  `Record*` command, via a job) and an **execute adapter** (`ExecuteLegJob`
  dispatches a routed leg). Neither the event vocabulary nor the NAV/risk
  projections branch on which venue it is. Read-only venues (a BTC address)
  register only an ingest adapter and surface as `tradability = ReadOnly`.
- **Target portfolio.** Persisted as `Portfolio`'s `TargetRevised` stream. This
  moves target weights off the request body (where `/risk`, `/simulate`,
  `/compare` read them today) into durable server-side state -- the prerequisite
  the maintainer named for auto-rebalancing. A coexistence period keeps the
  request-body inputs working for ad-hoc staged scenarios during cutover.
- **Enabled markets.** Two cleanly separated streams: `MarketEnablement` (audit)
  for operator decisions, `MarketCatalog` (observational) for the exchange
  universe. The tradable set = catalog listings MINUS operator disables, joined
  over two projections -- replacing `build_markets_frame`'s left-join with a
  structural guarantee that a refresh never clobbers an operator disable. (Note:
  the real consumer is the _ingestion universe selection_ in `refresh_markets`;
  the screener applies no disable filter today.)
- **NAV / historic performance / predictions.** NAV is an observational-but-
  `Retain` aggregate folded from the latest `VenuePositions`, carrying an
  `oldest_input_observed_at` staleness signal so a dead adapter yields
  explicitly-stale NAV rather than a confident wrong number. Historic
  performance is a rebuildable projection over retained streams. Predictions
  persist model forecasts over a referenced target revision and close the loop
  against realized performance.

## Integration mechanics

**Dependency.** event-sorcery's crates carry package version `0.1.0` but are
released under git tag `0.2.0-rc1`, so a crates.io version dep is impossible --
git+tag is mandatory. Depend on `event-sorcery` only (it re-exports what it
needs from `sqlite-es`/`cqrs-es`); keep all event-sourcing surface behind its
API.

```toml
event-sorcery = { git = "https://github.com/ST0X-Technology/event-sorcery", tag = "0.2.0-rc1" }
```

**Forced upgrades** (event-sorcery pins these; they are semver-incompatible with
ours, so they are unavoidable, not optional):

| Dep                   | From   | To                          | Why                                                                                          |
| --------------------- | ------ | --------------------------- | -------------------------------------------------------------------------------------------- |
| `sqlx`                | 0.8.6  | 0.9.0                       | `StoreBuilder::new(pool)` takes a sqlx 0.9 `SqlitePool`; our single shared pool must be 0.9. |
| `apalis`              | 0.7.4  | `=1.0.0-rc.9`               | event-sorcery's jobs ride apalis 1.0-rc on the 0.9 pool.                                     |
| `apalis-sql` (sqlite) | 0.7.4  | `apalis-sqlite =1.0.0-rc.8` | The SQLite backend split into `apalis-sqlite` in 1.0-rc.                                     |
| `cqrs-es`             | (none) | `0.5.0`                     | Add **only** if a cqrs-es type leaks into app/test code; pin to match.                       |

**apalis consolidation.** apalis-sql 0.7 stores the job payload as `job TEXT`;
apalis-sqlite 1.0-rc stores it as `job BLOB`. One `Jobs` table cannot satisfy
both, and two sqlx majors cannot share a pool. So the existing `IngestionJob`
worker **consolidates onto event-sorcery's single apalis 1.0-rc stack** -- there
is exactly one apalis in the tree afterward. In-flight 0.7 jobs are not migrated
(ingestion jobs are short-lived, re-triggerable via `POST /ingest`, and the
startup reconciler fails any orphaned run); the migration creates the 1.0-rc
`Jobs` table fresh.

**Migration reconciliation** (forward-only; all affected tables are empty):

1. `DROP TABLE IF EXISTS ingestion_view` (dead since #339).
2. Reconcile the event store to event-sorcery's canonical schema -- `events`
   already matches; recreate `snapshots` with the missing
   `snapshot_version BIGINT NOT NULL DEFAULT 0`. Net effect equals
   event-sorcery's `init` migration.
3. Create the apalis-sqlite 1.0-rc `Jobs` table (BLOB) as consumer-owned Data
   Definition Language (DDL), replacing the runtime `SqliteStorage::setup` probe
   and the `set_ignore_missing` ordering hack (no second migrator competes for
   `_sqlx_migrations` anymore).

**Startup wiring** (`rocket()` in `src/lib.rs`): one sqlx 0.9 pool -> plain
forward-only `sqlx::migrate!` -> build exactly one `Store` per aggregate via
`StoreBuilder` (schema reconcile + stale-snapshot clearing happen inside
`build()`) -> `.manage` each `Store`/`Projection` for Rocket -> spawn the single
apalis 1.0-rc `Monitor`. Production reads go through
`Projection::load/
load_all/filter`, never raw SQL on the event/view tables.

## Consequences

- The sqlx + apalis upgrade is semver-breaking and touches the live ingestion
  worker; isolating it as a dependency-only first epic keeps later PRs
  reviewable, but the whole foundation blocks on it landing green.
- Money in event payloads (positions, NAV, fills) is a decimal-encoded type from
  the first event version, because events are permanent and issue #220 mandates
  moving off `f64`. Deferring would make the decimal switch a historical-event
  rewrite.
- The `Option` instrument variant is excluded from the permanent event model
  until an options venue is real.
- Composite keys (`MarketId`, `(PortfolioId, VenueRef)`) get an explicit,
  collision-free `Display`/`FromStr` encoding gated by a property test before
  any stream is written -- a delimiter collision corrupts an append-only log
  irreversibly.
- The "one running ingestion" invariant stays as strong as today (409 Conflict)
  via a same-transaction DB UNIQUE constraint; the startup reconciler is an
  unconditional bounded pass that completes before `/ingest` is accepted, so a
  crash-and-fast-restart cannot wedge a run -- structurally precluding the #339
  regression.
- `NavSnapshot` is `Retain` (not compacted) because reactors and `rebuild_all`
  replay events, not snapshots; historic performance can always be rebuilt.
- Server-side venue position reads are **net-new** work (positions arrive in the
  `/portfolio/exposure` request body today; only the UBTC price is fetched
  server-side), so the positions/NAV epic builds adapters and runs a coexistence
  period -- it is not a refactor.
- Struct entities with a `status` field (`Portfolio`, `IngestionRun`) get
  `$.Live.status` generated columns; enum/nested-collection entities
  (`VenuePositions`, `MarketCatalog`) filter via `Projection::load` + Rust-side
  filter. This shape decision is committed per aggregate up front to avoid a
  later `SCHEMA_VERSION` bump that clears snapshots.

## Rejected alternatives

- **MarketCatalog/MarketEnablement as the first beachhead.** Its only write
  trigger is the ingestion refresh flow, so it is not the self-contained slice
  it appears to be, and the "screener depends on the tradable filter"
  justification is false (`tradable_from_frame` is consumed only inside
  `refresh_markets`).
- **IngestionRun as the first beachhead.** It is the single highest-risk
  aggregate (the #339 history) and forces the hardest correctness design at the
  moment we are least familiar with the framework. It lands after Portfolio on a
  proven foundation.
- **Concurrency guards via reading an eventually-consistent projection.**
  Unsound -- pure handlers cannot read projections and the view lags the stream,
  so two concurrent commands can both pass. Strictly weaker than the DB UNIQUE
  constraint that ships today.
- **Compacting the NAV stream** with the performance projection as the only
  history backstop -- strands irreplaceable history in a non-authoritative
  table.
- **NAV or historic performance as event-writing aggregates** -- they are
  derived rollups, not decisions; an anti-pattern.
- **Keeping apalis 0.7 alongside event-sorcery's apalis 1.0-rc** by co-managing
  one `Jobs` table -- impossible (TEXT vs BLOB job column; two sqlx majors
  cannot share a pool).

## Delivery plan (epics, in priority order)

Epic-based, not numbered phases. The first epic is literally the next thing to
build. Each epic ships as a stack of small PRs, each tracked by a problem-only
GitHub issue and a ROADMAP.md checkbox.

1. **Event-store foundation: sqlx/apalis upgrade + migration reconciliation**
   (no dependencies). Dependency-only change, verified green: add event-sorcery
   via git+tag; bump sqlx to 0.9 and apalis to 1.0-rc / apalis-sqlite; fix the
   flagged call sites; rewrite the `IngestionJob` enqueue + worker `Monitor` to
   the 1.0-rc API; the three forward-only migrations; existing ingestion/route
   tests green on one resolved sqlx/apalis.
2. **Portfolio centerpiece: persisted target as an immutable revision stream**
   (depends on 1). `PortfolioId`, `InstrumentRef` (no `Option`), `Leverage`,
   decimal `SignedWeight`; `EventSourced for Portfolio`; `portfolio_view` with
   generated columns; `/portfolio` create/revise-target/get reading through
   `Projection`; `TestHarness` + `replay` tests with `logs_contain_at`.
3. **Ingestion lifecycle re-event-sourced without the #339 regression** (depends
   on 1). Per-run `IngestionRun`, monotone terminal state machine,
   same-transaction DB UNIQUE "one running" guard, unconditional startup
   reconciler; port the existing ledger tests + an e2e mid-run-crash test.
4. **Event-sourced market universe: enablement vs catalog** (depends on 3).
   `MarketEnablement` + `MarketCatalog`; ingestion refresh adapter diffs
   listed/delisted; tradable set derived by joining the two projections.
5. **Positions and NAV: server-side cross-venue valuation** (depends on 2, 4).
   `VenuePositions` + `NavSnapshot`; net-new Hyperliquid position-read adapter +
   polling jobs; `/portfolio/exposure` onto the persisted path with coexistence.
6. **Historic performance and rebalance execution** (depends on 5).
   `performance_history` read model; `RebalanceExecution` audit aggregate with
   venue-routed legs.
7. **Performance predictions and model scoring** (depends on 6).
   `PerformancePrediction`; scoring loop against realized performance.

## Open questions for review

1. **Scope of this first effort.** Approve epic 1 (the upgrade) + epic 2
   (Portfolio beachhead) as the initial deliverable, with epics 3-7 sequenced as
   above? Or a different first slice?
2. **markets.csv timing.** Keep the file-based disable flag working until epic
   4, or migrate it sooner?
3. **`cqrs-es` direct dep.** Acceptable to keep everything behind
   event-sorcery's re-exports and add `cqrs-es = "0.5.0"` only if a type leaks?
4. **apalis-sqlite `Jobs` DDL.** The exact 1.0-rc.8 table schema (full column
   list/indexes) must be copied from apalis-sqlite / event-sorcery's reference,
   not guessed -- I will pin it down before writing the migration.
5. **One house portfolio vs multi-account now.** `PortfolioId(Uuid)` supports
   many portfolios; the beachhead ships a single "house" portfolio. Confirm that
   is the right initial surface (vs binding identity to a Solana pubkey now).
