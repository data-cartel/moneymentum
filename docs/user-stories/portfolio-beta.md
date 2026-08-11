# Theme: Portfolio Beta

Factor exposures derived from beta calculations. The backend's `POST /beta`
endpoint already computes portfolio-weighted beta against a configurable
benchmark. This theme covers surfacing that data in the UI and expanding factor
coverage beyond BTC.

---

## PB-01: Show live BTC beta in the factors panel

**As a** trader **I want** to see my portfolio's BTC beta update live as I
adjust position weights **So that** I can understand my real market exposure
rather than raw notional while I'm making rebalancing decisions

### Acceptance criteria

- [x] The Factors panel displays `B to BTC` with a numeric value fetched from
      `POST /beta`.
- [x] The value updates automatically when position weights change, without
      requiring a page reload.
- [x] A loading skeleton is shown while the request is in flight.
- [x] A `--` placeholder is shown when the portfolio has no positions or the
      request fails.
- [x] Positive beta is styled green, negative beta red.

### Context

Fully implemented. See:

- `frontend/src/pages/Portfolio/hooks/useBeta.ts` — fetches from `api/beta`,
  normalizes weights, reactive via `@tanstack/solid-query`.
- `frontend/src/pages/Portfolio/components/FactorsPanel.tsx` — renders
  `B to
  BTC` row with loading and null states.
- `frontend/src/pages/Portfolio/index.tsx` — wires `useBeta` to `FactorsPanel`,
  passes `portfolio.activeTokens`.

Backend endpoint: `POST /beta` accepts
`{ weights: Record<string, f64>,
benchmark: string }` and returns
`{ beta: f64 | null }`.

### Status

`done`

---

## PB-02: SPY beta exposure

**As a** trader **I want** to see my portfolio's beta to SPY alongside BTC beta
**So that** I can understand my macro equity exposure independently of my crypto
market exposure

### Acceptance criteria

- [ ] The Factors panel displays `B to SPY` with a live numeric value.
- [ ] `B to SPY` uses the same loading and error states as `B to BTC` (skeleton
      while loading, `--` on failure).
- [ ] Both beta values update when position weights change.
- [ ] The backend correctly computes SPY beta using ingested SPY OHLCV data.

### Context

The frontend `useBeta.ts` is parameterized by benchmark — `BETA_BENCHMARK` is
currently hardcoded to `"BTC"`. Adding SPY requires:

1. Backend: ingest SPY OHLCV (daily candles). SPY is a TradFi equity; the
   current ingestion pipeline fetches from Hyperliquid. A new data source
   adapter is needed, or SPY can be sourced from a public API (e.g., Yahoo
   Finance via the `yahoo_finance_api` crate). Confirm data source with the
   human owner before implementing.
2. Backend: verify `POST /beta` works when `benchmark = "SPY"` and SPY data is
   present.
3. Frontend: call `useBeta` a second time with `benchmark = "SPY"`, or extend
   `useBeta` to fetch multiple benchmarks in one call if the endpoint supports
   it.
4. Frontend: render the `B to SPY` row in `FactorsPanel` with the real value
   instead of the `--` placeholder currently in `defaultExposures`.

The `FactorsPanel` component already has a placeholder row for `B to SPY` in
`defaultExposures`. The display plumbing is done; data is missing.

### Tasks

- [ ] Confirm SPY data source with human owner.
- [ ] Implement SPY OHLCV ingestion in the backend.
- [ ] Verify `POST /beta` with `benchmark = "SPY"`.
- [ ] Extend frontend to fetch and display SPY beta.
- [ ] Update `FactorsPanel` to replace the `B to SPY` placeholder with the live
      value.

### Status

`backlog`

---

## PB-03: Concentration metrics

**As a** trader **I want** to see concentration metrics (Herfindahl index,
effective number of positions, top-N weight totals) in the Factors panel **So
that** I can spot hidden concentration risk that raw position counts conceal

### Acceptance criteria

- [ ] The Factors panel displays: top position weight (%), top-3 weight total
      (%), top-5 weight total (%), Herfindahl-Hirschman Index (HHI), and
      effective number of positions.
- [ ] All values are computed from the current portfolio weights without a
      backend call (these are client-computable from the weights the frontend
      already holds).
- [ ] Values update as weights change.
- [ ] HHI is displayed as a decimal in `[0, 1]`. Effective positions is
      displayed as a whole number.

### Context

`FactorsPanel.tsx` already has a "Concentration" section rendering a
`defaultConcentration` array of placeholders. The task is replacing those
placeholders with computed values.

All required inputs (per-asset weights) are available in
`portfolio.activeTokens` (`TokenAllocation[]`), which `index.tsx` already passes
down the component tree. No backend call is needed.

Formulas:

- **HHI**: `sum(w_i^2)` over all positions where `w_i` is the absolute weight.
  Ranges from `1/n` (perfectly diversified) to `1` (fully concentrated).
- **Effective positions**: `1 / HHI`.
- **Top-N**: sum of the N largest absolute weights, expressed as a percentage.

These can be pure functions in a new module alongside `useBeta.ts`, e.g.,
`frontend/src/pages/Portfolio/hooks/useConcentration.ts`.

### Tasks

- [ ] Implement `computeConcentration(tokens: TokenAllocation[])` returning HHI,
      effective positions, and top-N totals. Write property tests first.
- [ ] Create `useConcentration` hook wrapping the computation reactively.
- [ ] Wire `useConcentration` output into `FactorsPanel` props.
- [ ] Replace placeholder values in the Concentration section.

### Status

`backlog`
