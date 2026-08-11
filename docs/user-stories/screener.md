# Theme: Screener

Factor-based asset discovery and staged trade simulation. The screener lets a
trader find assets by their factor characteristics (beta, momentum, carry,
volatility) and stage trades directly from the results — previewing portfolio
impact before committing.

The `ScreenerPanel` component already exists and handles symbol search and
add-to-portfolio. This theme covers adding factor columns to the screener and
wiring the staging and simulation flow into the main portfolio view.

See `SPEC.md: Core Workflow > Screen, Stage, Simulate` for the full vision.

---

## SC-01: Factor columns in the screener

**As a** trader **I want** to see beta, funding rate, and volatility for each
asset in the screener **So that** I can identify assets matching my factor
targets without opening each one individually

### Acceptance criteria

- [ ] The screener table shows a `Beta` column (beta to BTC) for each listed
      asset.
- [ ] The screener table shows a `Vol` column (30-day realized annualized
      volatility) for each listed asset.
- [ ] The existing `Rate (ann.)` funding rate column is preserved.
- [ ] All columns are sortable by clicking the header (ascending/descending
      toggle).
- [ ] Values show a loading skeleton on first load.
- [ ] Assets with missing data show `--` in the relevant column.

### Context

Current state: `ScreenerPanel.tsx` renders a two-column table: `Perp` (symbol)
and `Rate (ann.)` (annualized funding rate). Funding rates come from
`fundingRatesByBaseSymbol` props, fetched in `usePortfolioState.ts`.

The backend already computes per-asset beta (used for portfolio-weighted beta in
`POST /beta`). A new endpoint is needed to return factor data for the full asset
universe — suggest `GET /screener` returning
`Array<{ symbol: string, beta_to_btc: f64 | null, vol_30d: f64 | null,
funding_rate: f64 | null }>`.

Volatility: 30-day realized annualized volatility =
`std(daily_returns) *
sqrt(252)` over the last 30 days. This is computable from
existing OHLCV data in Polars — see `src/factors.rs` for the pattern.

Frontend changes:

- Create `useScreenerData` hook fetching from `GET /screener` with a reasonable
  refetch interval (e.g., 60 seconds).
- Refactor `ScreenerPanel` to accept factor columns as props alongside the
  existing `symbols` and `fundingRatesByBaseSymbol`.
- Add sortable column headers. Use a
  `createSignal<{ col: string, dir:
  "asc" | "desc" }>` for sort state.

The `ScreenerPanel` is instantiated in `frontend/src/pages/Portfolio/index.tsx`.

### Tasks

- [ ] Implement 30-day realized volatility computation in the backend.
- [ ] Define and implement `GET /screener` endpoint.
- [ ] Create `useScreenerData` hook.
- [ ] Extend `ScreenerPanel` props with factor data.
- [ ] Add Beta and Vol columns to the screener table.
- [ ] Add sortable column headers.

### Status

`backlog`

---

## SC-02: Stage a trade from the screener with impact preview

**As a** trader **I want** to see how adding a screened asset would change my
portfolio's factor exposures and risk metrics before committing **So that** I
can make an informed decision about whether the trade aligns with my target
portfolio

### Acceptance criteria

- [ ] When I click an asset in the screener, a staging panel opens showing the
      proposed new position (defaulting to a configurable weight, e.g., 5%).
- [ ] The staging panel shows: estimated change in portfolio BTC beta, estimated
      change in portfolio volatility, and the specific trade (size, side,
      notional) required.
- [ ] I can adjust the proposed weight before staging.
- [ ] Confirming adds the asset to the portfolio at the chosen weight,
      rebalancing other weights proportionally.
- [ ] Canceling closes the panel without changing the portfolio.

### Context

Current state: clicking an asset in `ScreenerPanel` calls `props.onAddSymbol`,
which adds the asset to `portfolio.activeTokens` immediately with a default
weight. There is no preview step.

The impact estimates can be computed client-side:

- New portfolio weights = current weights after inserting the new position at
  the proposed weight and re-normalizing.
- New BTC beta = dot product of new weights with per-asset betas (already
  fetched from `GET /screener` if SC-01 is done).
- New portfolio volatility ≈ `sqrt(w^T * Sigma * w)` where `Sigma` is the
  covariance matrix. This requires per-asset volatilities and correlations. If
  RA-01 (correlation matrix) is not yet done, show only the beta change.

The staging panel can be a modal or a side drawer — confirm with the human owner
before choosing. The `Dialog` component from
`frontend/src/components/ui/
dialog.tsx` is available.

This story depends on SC-01 for factor data. It can proceed without RA-01 by
limiting the preview to beta impact only.

### Tasks

- [ ] Confirm staging panel UX (modal vs. drawer) with the human owner.
- [ ] Implement
      `computeStagedImpact(currentWeights, newSymbol, proposedWeight,
      perAssetBetas)`
      utility and test it.
- [ ] Build the staging panel component.
- [ ] Wire screener click to open the staging panel instead of immediately
      adding the asset.
- [ ] Wire confirm/cancel actions.

### Status

`backlog`

---

## SC-03: Compare staged portfolio against current

**As a** trader **I want** to see my staged portfolio side-by-side with my
current portfolio across key metrics (beta, VaR, concentration) **So that** I
can evaluate the full effect of a set of staged changes before executing the
rebalance

### Acceptance criteria

- [ ] When staged changes exist, the Risk panel shows two columns: Current and
      Staged.
- [ ] Compared metrics include: BTC beta, VaR 95%, effective number of
      positions, and top-3 weight concentration.
- [ ] Metrics that improve show green, metrics that worsen show red, unchanged
      metrics show neutral.
- [ ] The comparison disappears when there are no staged changes (no staged
      changes = current portfolio = staged portfolio).

### Context

Current state: the `StagedChangesPanel`
(`frontend/src/pages/Portfolio/
components/StagedChangesPanel.tsx`) shows
per-trade details (side, symbol, weight delta, notional) but no portfolio-level
metric comparison.

"Staged portfolio" means the portfolio the user would have after executing the
listed staged trades. The weights are already tracked in `usePortfolioState`.

The comparison metrics can be computed client-side from the staged weights using
the same utilities developed in PB-03 (concentration) and the beta hooks. VaR
comparison requires RA-02.

This story is the integration point for the Screener, Risk Analytics, and
Portfolio Beta themes. Plan it after SC-02, PB-03, and RA-02 are complete.

### Status

`backlog`
