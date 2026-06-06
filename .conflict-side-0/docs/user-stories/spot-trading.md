# Theme: Spot Trading

Unified perp + spot portfolio management. Currently the rebalancer only handles
Hyperliquid perpetual futures. Spot positions on Hyperliquid exist in a separate
account and are invisible to the tool. This theme covers surfacing spot
positions, including them in analytics, and executing rebalances across both
instrument types in a single operation.

See `SPEC.md: Domain Architecture > Spot Trading` and
`SPEC.md: Domain Architecture > Crate mapping` for architectural context.

---

## ST-01: Hyperliquid spot positions in the portfolio view

**As a** trader **I want** to see my Hyperliquid spot holdings alongside my perp
positions in the portfolio view **So that** I have a unified picture of my total
exposure rather than having to mentally combine two separate views

### Acceptance criteria

- [ ] Spot positions fetched from the Hyperliquid API appear in the Positions
      panel alongside perp positions.
- [ ] Each position is labeled with its instrument type (`perp` or `spot`) so
      they are distinguishable.
- [ ] NAV, weights, and portfolio beta are computed from the combined perp +
      spot portfolio.
- [ ] Loading and error states match the existing perp position behavior.
- [ ] The screener continues to show perps only (spot asset discovery is a
      separate story).

### Context

The Hyperliquid API exposes spot balances via the `spotClearinghouseState`
endpoint. The frontend `hyperliquid-client.ts`
(`frontend/src/services/hyperliquid-client.ts`) currently fetches perp
positions. Extending it to also fetch spot balances requires a second API call.

Spot positions are holdings (e.g., 0.5 BTC), not leveraged contracts. To
represent them as weights in the proportion-based portfolio model:

- Spot notional = `quantity × current_price`.
- Weight = `spot_notional / total_portfolio_notional`.
- Side is always `buy` (spot = long only).

The `TokenAllocation` type in `usePortfolioState.ts` will need an optional
`instrument` field: `"perp" | "spot"`. Downstream calculations (`useBeta`,
weight normalization, rebalancer) must handle the combined list. Audit each for
assumptions that currently only hold for perps (e.g., signed weights for
long/short) before adding spot positions.

The backend `spot` crate (see `SPEC.md: Domain Architecture > Crate mapping`)
has a `SpotVenue` trait with a `hyperliquid` implementation. Check whether the
backend exposes spot balances via any existing API endpoint before building new
ones.

### Tasks

- [ ] Audit `TokenAllocation`, `useBeta`, and weight normalization for perp-only
      assumptions. Document required changes.
- [ ] Extend `hyperliquid-client.ts` to fetch spot balances.
- [ ] Add `instrument: "perp" | "spot"` to `TokenAllocation`.
- [ ] Update `usePortfolioState` to merge spot and perp position lists.
- [ ] Update NAV and weight computations to include spot notional.
- [ ] Render instrument type label in `PositionsPanel` rows.
- [ ] Verify that `useBeta` correctly handles the combined position list.

### Status

`backlog`

---

## ST-02: Single rebalance across spot and perps

**As a** trader **I want** to execute a rebalance that adjusts both my spot
holdings and my perp positions in one operation **So that** I don't have to
manually coordinate trades across instrument types and risk the portfolio being
in an inconsistent state between the two

### Acceptance criteria

- [ ] The staged changes panel shows the required trades across both spot and
      perps to reach the target portfolio.
- [ ] Executing a rebalance submits spot trades to the Hyperliquid spot venue
      and perp trades to the Hyperliquid perps venue.
- [ ] Spot trades and perp trades execute concurrently where possible, not
      sequentially.
- [ ] If a spot trade fails, the perp trades that were submitted are shown as
      succeeded and the spot failure is surfaced clearly — the operation does
      not silently partially complete.
- [ ] The rebalancer does not allow a target portfolio that requires selling
      spot assets the user does not hold.

### Context

Current state: `useTrading.ts` / `usePortfolioState.ts` submits rebalance orders
to the Hyperliquid perps API only. Spot execution requires a separate API path
on Hyperliquid.

This story depends on ST-01 (unified portfolio view) being complete. Without it,
the rebalancer does not know the current spot state and cannot compute the
required spot trades.

Architecture note from `SPEC.md`: the frontend holds credentials and executes
trades directly; the backend generates execution plans but does not execute. For
spot trades, the frontend will call the Hyperliquid spot order API directly,
analogous to how perp orders are currently submitted.

The `rebalancer` domain in the backend (see crate mapping) generates the
execution plan. Confirm with the human owner whether plan generation should
extend to include spot legs, or whether spot leg computation is client-side.
This is an architectural decision that must be resolved before implementation.

### Tasks

- [ ] Confirm execution plan architecture (backend vs. client-side spot legs)
      with the human owner.
- [ ] Implement spot order submission in `hyperliquid-client.ts`.
- [ ] Extend rebalance logic to compute required spot trades from target
      weights.
- [ ] Update `StagedChangesPanel` to show spot trades alongside perp trades.
- [ ] Submit spot and perp trades concurrently at execution time.
- [ ] Handle partial failure: surface which trades succeeded and which failed.

### Status

`backlog`
