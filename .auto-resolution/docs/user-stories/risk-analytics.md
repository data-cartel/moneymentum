# Theme: Risk Analytics

Portfolio risk metrics beyond beta. The `RiskPanel` component in the frontend is
fully scaffolded with the correct layout, sections, and placeholder values.
Every metric in it is currently mocked or marked TODO. This theme covers wiring
real data to each section.

See `frontend/src/pages/Portfolio/components/RiskPanel.tsx` for the current
state. See `SPEC.md: Analytics Capabilities > Risk Engine` for the vision.

---

## RA-01: Real correlation matrix

**As a** trader **I want** to see the actual pairwise correlation matrix for my
portfolio's holdings **So that** I can identify which positions move together
and where my diversification is illusory

### Acceptance criteria

- [ ] The correlation matrix in the Risk panel shows real computed values for
      every pair of assets currently in the portfolio.
- [ ] The matrix dimensions match the current portfolio — if the portfolio
      changes, the matrix updates.
- [ ] Color coding is preserved: high positive correlation green, high negative
      red, near-zero neutral (the existing `getCorrelationColor` logic is
      correct).
- [ ] The backend computes correlations from 90-day daily OHLCV returns.
- [ ] A loading state is shown while data is fetching.

### Context

Current state: `RiskPanel.tsx` renders a hardcoded 4×4 correlation matrix
(`correlationAssets = ["BTC", "ETH", "SPX", "GLD"]`) using `correlationValues`,
a static `Record<string, number>`. All values are hardcoded.

The backend already has daily OHLCV data for Hyperliquid assets (ingested via
the existing ingestion pipeline). A new endpoint is needed — suggest
`POST /correlations` accepting `{ assets: string[], window_days: number }` and
returning `{ matrix: Record<string, Record<string, f64>> }`.

Frontend changes:

- Create `useCorrelations` hook analogous to `useBeta` — fetches from the new
  endpoint whenever portfolio assets change.
- Pass matrix data into `RiskPanel` via props (currently `RiskPanel` takes no
  props).
- Render the dynamic matrix instead of the hardcoded one. The number of rows and
  columns should match the live asset list.

Backend starting points: `src/factors.rs` (rolling window covariance/variance
pattern to adapt), `src/dataframe.rs` (Polars DataFrame operations).

### Tasks

- [ ] Define `POST /correlations` endpoint in the backend (request/response
      types first, then implementation).
- [ ] Implement correlation computation in Polars: align returns by date,
      compute pairwise Pearson correlation over the window.
- [ ] Add endpoint to Axum router.
- [ ] Create `useCorrelations` hook in the frontend.
- [ ] Refactor `RiskPanel` to accept correlation data as props.
- [ ] Render the dynamic matrix, replacing the hardcoded one.

### Status

`backlog`

---

## RA-02: VaR and CVaR

**As a** trader **I want** to see Value at Risk (VaR) and Conditional VaR (CVaR)
for my portfolio at the 95% and 99% confidence levels **So that** I know my
expected worst-case loss under normal and tail conditions

### Acceptance criteria

- [ ] The Risk panel shows VaR 95%, VaR 99%, CVaR 95%, and CVaR 99% as dollar
      amounts based on current portfolio NAV.
- [ ] Values use a 1-day horizon computed from historical daily returns.
- [ ] Values update when portfolio weights change.
- [ ] A loading state is shown while fetching.
- [ ] The display is consistent with the existing VaR rows in `RiskPanel`
      (`var95`, `var99`). CVaR rows should be added adjacent to them.

### Context

Current state: `RiskPanel.tsx` has placeholder rows for `var95` and `var99`
displaying the string `"TODO"`.

Methodology: historical simulation VaR. Steps:

1. Collect N days of daily returns for each asset (use existing OHLCV data).
2. Compute daily portfolio return for each historical day using current weights.
3. Sort the return distribution.
4. VaR at confidence level `c` = negative of the `(1-c)` quantile (e.g., for
   95%, take the 5th percentile and negate it).
5. CVaR = mean of all returns below the VaR threshold.

Suggest `POST /risk-metrics` accepting
`{ weights: Record<string, f64>,
nav: f64, window_days: number }` and returning
`{ var95: f64, var99: f64,
cvar95: f64, cvar99: f64 }` expressed as dollar
losses.

Frontend: NAV is available via `useWallet` / `portfolio.displayNotional`.
Weights come from `portfolio.activeTokens` (same source as `useBeta`).

### Tasks

- [ ] Define `POST /risk-metrics` endpoint types.
- [ ] Implement historical simulation VaR/CVaR in Polars. Write unit tests with
      a known return distribution where VaR is analytically computable.
- [ ] Add endpoint to Axum router.
- [ ] Create `useRiskMetrics` hook in the frontend.
- [ ] Refactor `RiskPanel` to accept VaR/CVaR as props.
- [ ] Add CVaR rows to the Risk panel layout.
- [ ] Remove `"TODO"` placeholders.

### Status

`backlog`

---

## RA-03: Monte Carlo return distribution

**As a** trader **I want** to see a Monte Carlo simulation of my portfolio's
1-year return distribution **So that** I can understand the range of outcomes
and not just point estimates

### Acceptance criteria

- [ ] The Risk panel shows a histogram of simulated 1-year portfolio returns.
- [ ] The simulation uses at least 1,000 paths.
- [ ] The histogram bucket coloring matches current behavior: green for positive
      return buckets, red for negative.
- [ ] The simulation uses returns and covariance estimated from recent
      historical data (90-day window).
- [ ] A loading state is shown while the simulation runs.
- [ ] The histogram is labeled with approximate return ranges, not just bucket
      indices.

### Context

Current state: `RiskPanel.tsx` has a Monte Carlo section rendering mock data
from `mockMonteCarlo` — a hardcoded array of `{ bucket, frequency }` pairs. The
section is labeled "Monte Carlo (1 Year) TODO".

Methodology: parametric Monte Carlo with Cholesky decomposition.

1. Estimate mean daily returns and covariance matrix from N days of historical
   data.
2. Cholesky-decompose the covariance matrix to get correlated random returns.
3. Simulate 252 trading days × M paths.
4. Aggregate into a return histogram.

The backend already has the returns data. The computation is CPU-bound and
appropriate for the Rust backend. Suggest a dedicated endpoint
`POST /monte-carlo` accepting
`{ weights: Record<string, f64>, paths: u32,
window_days: number }` and
returning `{ buckets: Array<{ min: f64, max: f64,
count: u32 }> }`.

The `linfa` crate (already in `SPEC.md`'s technology table) can assist with
statistical operations if needed.

### Tasks

- [ ] Implement Cholesky-based Monte Carlo simulation in the backend.
- [ ] Define and implement `POST /monte-carlo` endpoint.
- [ ] Create `useMonteCarloSimulation` hook in the frontend.
- [ ] Refactor `RiskPanel` to accept histogram data as props.
- [ ] Replace `mockMonteCarlo` with live data.
- [ ] Add axis labels to the histogram.

### Status

`backlog`

---

## RA-04: Stress test scenarios

**As a** trader **I want** to see how my portfolio performs in predefined stress
scenarios (e.g., "BTC -20%", "SPX -10%") **So that** I can understand my tail
risk exposure to specific market events

### Acceptance criteria

- [ ] The Risk panel shows portfolio P&L impact for at least three predefined
      stress scenarios: BTC -20%, SPX -10%, and one more agreed with the human
      owner before implementation.
- [ ] Impact is shown in dollar terms and as a percentage of NAV.
- [ ] Scenarios are computed from current portfolio weights without a backend
      call — they are a linear approximation using beta sensitivities already
      available from `useBeta`.
- [ ] If beta data is not yet loaded, stress test rows show a loading skeleton.

### Context

Current state: `RiskPanel.tsx` has a "Stress Tests" section rendering
`mockStressTests` — hardcoded rows with `"TODO"` impact values.

These can be computed client-side using portfolio beta:

- `BTC -20%` impact ≈ `btc_beta × -0.20 × NAV`
- `SPX -10%` impact ≈ `spy_beta × -0.10 × NAV`

This story depends on PB-01 (BTC beta, already done) and PB-02 (SPY beta). If
SPY beta is not yet available, implement BTC stress tests first and leave SPY
with a `--` placeholder until PB-02 lands.

NAV is available via `portfolio.displayNotional`. Both beta values will be
available from the hooks introduced in the PB theme.

### Tasks

- [ ] Confirm the third stress scenario with the human owner.
- [ ] Compute stress test impacts from portfolio beta and NAV (pure function, no
      backend call).
- [ ] Create a `computeStressTests(btcBeta, spyBeta, nav)` utility and test it.
- [ ] Wire into `RiskPanel` as props.
- [ ] Replace `mockStressTests` with computed values.

### Status

`backlog`
