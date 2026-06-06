# Roadmap

> **Purpose**: Practical path from where we are today to the north star in
> [SPEC](./SPEC.md).

Each `##` section is a theme -- a goal-oriented group of related stories. Themes
are ordered by priority (highest first).

Stories link to their per-feature acceptance criteria in
[stories/](./stories/README.md). Engineering work (refactors, migrations,
internal foundations) lives in the same folder under a "Dev" sub-heading when a
written contract is warranted, otherwise as a standalone GitHub issue -- see
[contributions.md](./contributions.md) for the split.

Numeric story IDs (`001`, `018`, etc.) reflect creation order, not
implementation priority. Priority is defined by this roadmap's theme order and
the order within each theme.

---

## Dev: event-sourced persistence foundation

Give the toolkit durable, auditable state via
[event-sorcery](https://github.com/ST0X-Technology/event-sorcery): portfolios
(target streams that enable auto-rebalancing), the ingestion lifecycle, and the
tradable market universe. Each domain is an event-sourced aggregate so history
is a first-class artifact for later performance attribution and prediction, and
the design stays forward-compatible with multiple instruments and venues.
Design: [adrs/0001](./adrs/0001-event-sorcery-persistence-foundation.md).

- [ ] Adopt the event-sorcery event-store stack (sqlx 0.9, apalis 1.0-rc) --
      [#363](https://github.com/data-cartel/moneymentum/issues/363) /
      [#361](https://github.com/data-cartel/moneymentum/pull/361)
- [ ] Event-source portfolios, ingestion runs, and the market universe --
      [#364](https://github.com/data-cartel/moneymentum/issues/364) /
      [#362](https://github.com/data-cartel/moneymentum/pull/362)
- [ ] Serve per-market max leverage limits from the catalog --
      [#379](https://github.com/dataclique/moneymentum/issues/379) /
      [#380](https://github.com/dataclique/moneymentum/pull/380)

---

## Dev: finish the Python -> Rust analytics migration

Port the deleted Python quant analytics to Rust as the factor and risk engine
that powers the "Screener and staged simulation" and "Risk analytics" themes
below. The autonomous trader's auto-pick/execute loop is out of scope --
execution stays in the frontend. Delivered as a stack of small PRs; the
user-facing endpoints tick their story items under those themes. This is an
engineering track that runs in parallel to the product themes below, not ahead
of them.

- [x] Point user stories at the factors module --
      [#304](https://github.com/dataclique/moneymentum/issues/304) /
      [#250](https://github.com/dataclique/moneymentum/pull/250)
- [x] Consolidate beta into a factors module --
      [#249](https://github.com/dataclique/moneymentum/issues/249) /
      [#252](https://github.com/dataclique/moneymentum/pull/252)
- [x] Add TimeframeConfig (lookback + annualization) --
      [#251](https://github.com/dataclique/moneymentum/issues/251) /
      [#254](https://github.com/dataclique/moneymentum/pull/254)
- [x] Split the factor engine into returns/beta/scores submodules --
      [#257](https://github.com/dataclique/moneymentum/issues/257) /
      [#258](https://github.com/dataclique/moneymentum/pull/258)
- [x] Factor: returns shared primitive --
      [`src/factors/returns.rs`](./src/factors/returns.rs)
- [x] Factor: cum_return --
      [#253](https://github.com/dataclique/moneymentum/issues/253) /
      [#254](https://github.com/dataclique/moneymentum/pull/254)
- [x] Factor: volatility --
      [#251](https://github.com/dataclique/moneymentum/issues/251) /
      [#254](https://github.com/dataclique/moneymentum/pull/254)
- [x] Factor: SMA --
      [#255](https://github.com/dataclique/moneymentum/issues/255) /
      [#256](https://github.com/dataclique/moneymentum/pull/256)
- [x] Factor: mean return --
      [#255](https://github.com/dataclique/moneymentum/issues/255) /
      [#256](https://github.com/dataclique/moneymentum/pull/256)
- [x] Factor: price z-score --
      [#255](https://github.com/dataclique/moneymentum/issues/255) /
      [#256](https://github.com/dataclique/moneymentum/pull/256)
- [x] Factor: Sharpe --
      [#259](https://github.com/dataclique/moneymentum/issues/259) /
      [#260](https://github.com/dataclique/moneymentum/pull/260)
- [x] Factor: Sortino (adds MAR -- Minimum Acceptable Return -- to
      TimeframeConfig) --
      [#261](https://github.com/dataclique/moneymentum/issues/261) /
      [#262](https://github.com/dataclique/moneymentum/pull/262)
- [x] Factor: autocorrelation --
      [#263](https://github.com/dataclique/moneymentum/issues/263) /
      [#264](https://github.com/dataclique/moneymentum/pull/264)
- [x] Factor: information discreteness --
      [#265](https://github.com/dataclique/moneymentum/issues/265) /
      [#266](https://github.com/dataclique/moneymentum/pull/266)
- [x] Factor: carry (signed funding) --
      [#267](https://github.com/dataclique/moneymentum/issues/267) /
      [#268](https://github.com/dataclique/moneymentum/pull/268)
- [x] Factor: beta (per-asset, to benchmark) --
      [#269](https://github.com/dataclique/moneymentum/issues/269) /
      [#270](https://github.com/dataclique/moneymentum/pull/270)
- [x] Factor: 24h volume (screener tie-break) --
      [#271](https://github.com/dataclique/moneymentum/issues/271) /
      [#272](https://github.com/dataclique/moneymentum/pull/272)
- [x] Markets metadata + persisted disable flag --
      [#275](https://github.com/dataclique/moneymentum/issues/275) /
      [#276](https://github.com/dataclique/moneymentum/pull/276)
- [x] Tradable filter wired into ingestion --
      [#277](https://github.com/dataclique/moneymentum/issues/277) /
      [#278](https://github.com/dataclique/moneymentum/pull/278)

---

## Usable production deployment

Users need to reach the app before any portfolio feature matters. Deployment is
the next user-facing priority; it runs in parallel to the Dev track above.

- [ ] [Keep The App Deployed And Reachable](./stories/0x008.keep-app-deployed-and-reachable.md)
- [ ] [Verify Deployed Hyperliquid Long-Short Rebalancing](./stories/0x00a.verify-deployed-hyperliquid-long-short-rebalancing.md)
- [ ] [Serve The App From A Domain](./stories/0x009.serve-app-from-domain.md)

---

## Full Bitcoin beta accounting

Display portfolio-weighted Bitcoin beta for the active portfolio and surface
read-only Bitcoin holdings so the risk view reflects the user's actual exposure.
See [SPEC.md](./SPEC.md) for the beta methodology and the `POST /beta` contract.

- [x] [Show Bitcoin Beta For The Active Portfolio](./stories/0x00b.show-bitcoin-beta-for-active-portfolio.md)
- [x] [Add Read-Only Bitcoin Addresses](./stories/0x00c.add-read-only-bitcoin-addresses.md)
- [ ] [Include Read-Only Bitcoin Holdings In Beta](./stories/0x00d.include-read-only-bitcoin-holdings-in-beta.md)
- [ ] [Target Ending Bitcoin Beta While Hedging](./stories/0x00e.target-ending-bitcoin-beta-while-hedging.md)

---

## Portfolio identity and sharing

Read-only portfolios need stable identity. Solana public keys are the natural
identifier because the north star already assumes Solana deposits.

- [ ] [Authenticate Portfolio Ownership By Solana Pubkey](./stories/0x00f.authenticate-portfolio-ownership-by-solana-pubkey.md)
- [ ] [View Portfolios By Public Key URL](./stories/0x010.view-portfolios-by-public-key-url.md)
- [ ] [Hide Portfolio Details For A Fee](./stories/0x011.hide-portfolio-details-for-fee.md)

---

## Vault

Non-custodial managed vault on Solana for users who prefer strategy allocation
over hands-on rebalancing. Anchor program with two-phase withdrawal and a
share-based accounting model.

- [ ] [Deposit Into Vault](./stories/0x017.deposit-into-vault.md)
- [ ] [Withdraw From Vault](./stories/0x018.withdraw-from-vault.md)

---

## Crash protection and simulation

Users who are long-term bullish Bitcoin still need protection against short- and
mid-term crashes. Start with manually entered protective puts and simple
historical crash simulations, then add stressed correlations and rolling.

- [ ] [Enter Protective Put Positions](./stories/0x013.enter-protective-put-positions.md)
- [ ] [Use Derive Options For Protective Puts](./stories/0x019.use-derive-options-for-protective-puts.md)
- [ ] [Simulate Historical Bitcoin Crashes](./stories/0x014.simulate-historical-bitcoin-crashes.md)
- [ ] [Simulate Stressed Crash Correlations](./stories/0x015.simulate-stressed-crash-correlations.md)
- [ ] [Roll Protective Puts Before Final Month](./stories/0x016.roll-protective-puts-before-final-month.md)

---

## Screener and staged simulation

> See SPEC.md: Core Workflow > Screen, Stage, Simulate

Find assets by factor characteristics, stage portfolio changes, and simulate the
result before sending trades.

- [ ] [Compare Target vs Current Portfolio](./stories/0x01a.compare-target-vs-current-portfolio.md)
- [ ] [Screen Perps By Factor](./stories/0x01c.screen-perps-by-factor.md) --
      backend rank API shipped
      ([#273](https://github.com/dataclique/moneymentum/issues/273) /
      [#274](https://github.com/dataclique/moneymentum/pull/274)); frontend
      filter integration pending
- [ ] [Simulate Staged Portfolio Metrics](./stories/0x01d.simulate-staged-portfolio-metrics.md)

---

## Risk analytics

> See SPEC.md: Analytics Capabilities > Risk Engine

Portfolio risk assessment beyond beta and crash-specific simulations.

- [ ] [Show Risk Analytics For Active Portfolio](./stories/0x01b.show-risk-analytics-for-active-portfolio.md)

---

## Spot trading

> See SPEC.md: Domain Architecture > Spot Trading

Unified perp + spot portfolio management.

- [ ] [Trade Hyperliquid Spot Positions](./stories/0x01e.trade-hyperliquid-spot-positions.md)
- [ ] [Add Read-Only Wallets On Other Chains](./stories/0x012.add-read-only-wallets-on-other-chains.md)

---

## Backlog

These are directions we know matter but haven't designed:

- Tokenized equities (st0x) for TradFi factor exposure
- Yield products (Pendle)
- Multi-account support

---

## Completed: Frontend rewrite in SolidJS

SolidJS compiles away the runtime, has cleaner reactivity, and shadcn-solid
provides the component library. Converted page by page -- same logic, different
primitives.

- [x] Project setup: Vite + solid-js, TypeScript config, dev server
- [x] Routing: migrate from react-router to @solidjs/router
- [x] State & data fetching: migrate from @tanstack/react-query to
      @tanstack/solid-query
- [x] UI components: replace shadcn/ui with Kobalte + shadcn-solid equivalents
- [x] Layout & shared components: Header, WalletHeader, navigation
- [x] Portfolio page: PositionsPanel, TokenCard, portfolio table
- [x] Prototype page: RiskTab and all prototype-only components
- [x] Rebalancer integration: connect rebalancer logic to SolidJS signals/stores
- [x] Tests & CI: migrate Vitest tests to SolidJS testing utilities, verify CI
      passes

---

## Completed: Backend foundation and portfolio beta

Rust backend with Rocket, Polars, and SQLite-backed ingestion runs/job queue.
Ingestion pipeline fetches OHLCV and funding rates from Hyperliquid, stores as
CSV. Beta calculation computes rolling covariance/variance against BTC. Deployed
to DigitalOcean via NixOS + deploy-rs.

- [x] Cargo workspace + Nix flake + CI/CD
- [x] Rocket HTTP server with health check
- [x] Ingestion run ledger + Apalis job queue (SQLite)
- [x] Hyperliquid OHLCV ingestion (15m, 1h, 1d candles)
- [x] Funding rate ingestion
- [x] Rolling beta calculation (`POST /beta`)
- [x] Candle API (`GET /candles/<timeframe>`)
- [x] Ingestion status API (`GET /ingestion/status`)

---

## Completed: GitButler CLI for stacked PRs

- [x] Package the GitButler CLI via Nix --
      [#243](https://github.com/dataclique/moneymentum/issues/243) /
      [#238](https://github.com/dataclique/moneymentum/pull/238)
- [x] Add a GitButler skill for coding agents --
      [#244](https://github.com/dataclique/moneymentum/issues/244) /
      [#240](https://github.com/dataclique/moneymentum/pull/240)

## Completed: Finish Python/Spark removal

- [x] Remove dead Python linter tooling --
      [#245](https://github.com/dataclique/moneymentum/issues/245) /
      [#241](https://github.com/dataclique/moneymentum/pull/241)
- [x] Strip unused JVM/Spark deps from the dev shell --
      [#246](https://github.com/dataclique/moneymentum/issues/246) /
      [#242](https://github.com/dataclique/moneymentum/pull/242)

## Completed: Per-PR issue and roadmap tracking

- [x] Document and automate the issue-and-roadmap-per-PR rule --
      [#247](https://github.com/dataclique/moneymentum/issues/247) /
      [#248](https://github.com/dataclique/moneymentum/pull/248)
