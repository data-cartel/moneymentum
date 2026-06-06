# ADR 0002: venue integrations as per-venue crates behind a shared trait

- Status: Accepted -- implementing in the PR #158 worktree per the maintainer;
  reviewed via the resulting PR rather than a separate ADR sign-off
- Date: 2026-06-28
- Tracking issue: TBD (to be filed)
- Relates to: PR #158 (adds `src/derive.rs`), ADR 0001 (event-sorcery; cites the
  SPEC's dual-abstraction principle -- abstract both data sources and execution
  venues)

## Context

The backend is a **single `moneymentum` crate**. Two venue integrations live in
it today, at very different levels of maturity:

- `src/hyperliquid.rs` (702 lines) is **already trait-abstracted**: a
  `pub(crate) trait Hyperliquid: Send + Sync` (`list_markets`, `fetch_candles`,
  `fetch_funding_rates`), a real `HyperliquidClient` implementing it over
  `hyperliquid_rust_sdk`, generic ingesters (`CandleIngester<H>`,
  `FundingRateIngester<H>`), and a `MockHyperliquid` already used in tests
  (currently behind `#[cfg(test)]`).
- `src/derive.rs` (1036 lines, new in PR #158) is a **monolith**: it mixes wire
  DTOs, `DeriveConfig`, in-memory state (`OptionsCatalogue`, `DeriveState`), a
  Axum CORS middleware, the websocket hub (`run_websocket_hub`,
  subscribe/unsubscribe batching), parsing helpers, options-domain math
  (`build_greeks`, `aggregate_risk`, `scenario_pnl`), **and** the Axum HTTP
  routes/SSE stream. There is no client trait, no mock seam, and financial
  values flow as raw `f64`.

The maintainer wants: hyperliquid integration as its own crate, derive
integration as its own crate, a trait interface for both, and Cargo feature
flags toggling real vs mock implementations. This is consistent with the
existing SPEC principle quoted in ADR 0001.

This is a large, cross-cutting refactor (it touches `lib.rs`'s ingestion/cqrs/
apalis wiring, `bin/derive_cli.rs`, and the Axum route surface), so it is
recorded here for review before any code moves.

## Decision

1. **Cargo workspace, one crate per venue.** Convert the repo to a workspace:
   - `crates/hyperliquid` -- the venue client + its capability trait +
     ingesters.
   - `crates/derive` -- the venue client + its capability trait + options
     domain.
   - the existing app (server/bin, Axum routes, cqrs/apalis wiring) becomes the
     top-level crate that depends on both venue crates. A shared `crates/venue`
     holds only the cross-venue trait surface (below).

2. **Per-venue capability traits, NOT one unified trait.** Hyperliquid exposes
   perp **market data** (markets, candles, funding); Derive exposes an **options
   catalogue + live quotes/greeks/risk** over a websocket. These capability sets
   do not overlap, so a single `trait Venue { ... }` covering both would be a
   leaky abstraction -- every consumer would get methods that are meaningless
   for the other venue. Keep `trait Hyperliquid` and a new `trait Derive`, and
   unify them only under a **minimal shared supertrait** for what is genuinely
   common (e.g. `trait Venue: Send + Sync { fn name(&self) -> VenueName; }`,
   plus a connect/health hook if a real shared lifecycle emerges). This honors
   "decouple what varies independently" -- the abstraction models distinct venue
   capabilities, not a forced union.

3. **`mock`/`real` as additive Cargo features, default = real.** Each venue
   crate ships its mock implementation behind a `mock` feature (promoting the
   existing `#[cfg(test)] MockHyperliquid` out of test-only cfg so integration
   tests and local runs can select it) and the real client as the default. No
   hidden defaults (project rule): features are additive, the real client is the
   default, and selecting `mock` is an explicit opt-in. Document the semantics
   in each crate's README.

4. **Decompose `derive.rs` first; only the venue client moves into the crate.**
   Split the monolith into: (a) the **Derive venue client** (websocket hub +
   catalogue + quote state) behind `trait Derive` -> `crates/derive`; (b) the
   **options domain** (greeks/risk/scenario, pure functions) -> a module in the
   derive crate; (c) the **Axum routes/SSE + CORS middleware** -> stay in the
   app crate as the web adapter. The HTTP layer is not part of the venue
   integration and must not live in the venue crate.

5. **Replace `f64` money/quantity at the venue boundary with `rust_decimal` /
   domain newtypes** as part of the extraction (`rust_decimal` is already a
   dependency). Parse external strings into typed domain values at the boundary
   (parse-don't-validate), rather than threading `f64` through the system.

## Consequences

- Clear seam for testing both venues without network via the `mock` feature; the
  app can run against mock venues end-to-end.
- Workspace build/CI changes; `lib.rs` wiring, `derive_cli`, and the Axum routes
  must be re-pointed at the new crates.
- Larger blast radius than a review fix -- this is its own effort, not a
  surgical change.

## Alternatives considered

- **One unified `Venue` trait.** Rejected (choice 2): the venues' capabilities
  don't overlap; a union trait leaks.
- **`cfg(test)`-only mocks (status quo).** Rejected: mocks aren't reusable by
  integration tests or local runs; a `mock` feature makes the seam first-class.
- **Keep one crate, split into modules only.** Viable and lower-cost, but does
  not give the independent dependency/feature boundaries the maintainer asked
  for (e.g. building the derive integration without pulling hyperliquid's SDK).

## Decisions taken (maintainer, 2026-06-28)

- **Scope/sequencing:** implement directly in the **PR #158 worktree** (on top
  of PR 158's code) and open a PR for review -- not a separate post-approval
  stack.
- **Review mechanism:** the maintainer reviews the resulting PR rather than
  gating on this ADR. The design choices below are the default I proceed with;
  they are open to change in PR review.

## Open questions (to validate in PR review)

- **Trait granularity:** proceeding with per-venue traits + a minimal shared
  `Venue` supertrait (recommended over a single unified trait, which would
  leak).
- **Hyperliquid boundary:** "hyperliquid as a crate" = the **Rust backend
  market-data client** (`src/hyperliquid.rs`). The separate **TypeScript
  frontend** Hyperliquid client (browser-side order execution, credentials in
  the browser per the SPEC) is a different component and stays in the frontend.
