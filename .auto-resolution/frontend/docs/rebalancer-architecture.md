# Frontend Architecture: Portfolio Rebalancer

This document describes the current frontend architecture as one primary
rebalancing page (`Portfolio`) and its key execution flow. Below is factual
information about the code.

## 1) Main State Model

The core lives in `frontend/src/pages/Portfolio/hooks/usePortfolioState.ts`.

The entire rebalance is built on comparing two snapshots:

- `currentPortfolio` - the current positions state loaded from the exchange.
- `targetPortfolio` - the desired positions state that the user edits in the UI.

All computations (validations, staged trades, submit availability, preview in
the panel) are built on the difference between these two structures.

## 2) What Actually Happens When the UI Changes

Base operations on `targetPortfolio`:

- add token (`handleAddToken`);
- remove token (`handleRemoveToken`);
- undo removed token (`handleUndoRemoveToken`);
- change side, leverage, notional, weight.

`currentPortfolio` is initialized from the exchange and then used as the
reference point against which all subsequent changes are compared.

## 3) Minimum Size Checks

The code uses `MIN_USD = 11`.

Checks:

- a position in `targetPortfolio` must not be smaller than `11`;
- in non-precise mode, the per-symbol delta between target/current must not be
  less than `11` (except for zero delta).

This affects `canSubmit` and blocks rebalancing when the constraints are
violated.

## 4) Redistribution of Weights (Exact Behavior)

The logic in `redistributeWeights(...)` (in `usePortfolioState.ts`):

1. Take the changed symbol and its new percentage (clamped to `0..100`).
2. Compute the total percentage of all other symbols relative to
   `totalNotional`.
3. For the changed symbol, set the new `notional`:
   `newTargetNotional = (newPercent / 100) * totalNotional`.
4. Redistribute the remainder `100 - newPercent` among the others:
   - if the others' total percentage is `0`, split it evenly;
   - otherwise, redistribute proportionally to their current weights.

Important: in the current code there is **no separate step to "carry the
remainder into the last position"**. Instead, it uses a direct proportional
recalculation of each position.

## 5) Rebalance Architecture: From State to Exchange

Key idea: between the UI state and the real orders there is a dedicated
intermediate layer called `actions`.

`actions` is a normalized "execution plan" that does not depend on specific UI
components. It answers the question: "what is the minimal set of actions needed
to transform current into target?"

Pipeline:

1. `currentPortfolio` + `targetPortfolio`.
2. `diffPortfolios(...)` compares them symbol-by-symbol.
3. An array of `actions` is produced.
4. This array is used twice:
   - for the UI preview (`stagedTrades` -> `StagedChangesPanel`);
   - for actual execution (payload -> mutation -> client).

There are three `action` kinds:

- `close` - the symbol exists in current but not in target. The position must be
  fully closed.
- `rebalance` - the symbol remains in the portfolio, but the exposure changed
  (signed notional delta) and/or leverage needs to be updated. The position must
  be bought/sold and leverage updated if necessary.
- `preciseRebalance` - used only in **precise mode** when the signed delta is
  real but smaller than `MIN_USD` and the position **stays on the same side**
  (see below).

Nearly all target portfolio change scenarios decompose like this:

- deleting a position -> `close`;
- adding a new position -> `rebalance` (from zero to the target size);
- changing weight/side -> `rebalance` with the signed delta;
- changing leverage without changing notional -> `rebalance` with
  `leverageChanged`;
- tiny same-side tweak (precise mode, below `MIN_USD`) -> `preciseRebalance`.

### Precise mode (action-planning input)

`precise` is an input to action planning, not a field sent to the execution API.
It is consumed by `buildApiPayload(...)`, which calls
`diffPortfolios(..., precise: true/false)` to decide which actions to produce.

When the user enables precise rebalancing, `diffPortfolios(..., precise: true)`
can emit `preciseRebalance` instead of dropping sub-minimum deltas.
`useRebalanceHyperliquidPositions` submits only `{ actions }`, and
`HyperliquidClient.rebalancePositions(...)` receives that resulting actions
array. So if precise planning emits `preciseRebalance`, it is present as an
action in the submitted array, not as a separate `precise` property in the
payload.

Trigger (all must hold):

- `|delta|` is above a small epsilon (`NOTIONAL_EPSILON`) so there is a real
  change;
- `|delta| < MIN_USD` (11 USD);
- current and target **same side** (no flip).

`preciseRebalanceLegs(positionSide, deltaSigned)` splits the move into two USD
legs, each at least `MIN_USD`, so both legs clear the exchange minimum:

- Long (`buy`): if `deltaSigned > 0` (increase long), `closeNotional = MIN_USD`,
  `openNotional = MIN_USD + deltaSigned`. Otherwise (reduce long),
  `closeNotional = MIN_USD + |deltaSigned|`, `openNotional = MIN_USD`.
- Short (`sell`): if `deltaSigned > 0`, `closeNotional = MIN_USD + deltaSigned`,
  `openNotional = MIN_USD`. Otherwise, `closeNotional = MIN_USD`,
  `openNotional = MIN_USD + |deltaSigned|`.

The action carries `closeNotional`, `openNotional`, and `side` (target side for
the **open** leg after the reduce-only close).

Benefit of this layer: the UI can change however it wants, while the execution
contract remains stable and predictable (`actions` as the single source of truth
for preview and execute).

## 6) How `actions` are Executed in `HyperliquidClient`

Key file: `frontend/src/services/hyperliquid-client.ts`.

`rebalancePositions(...)` does the following:

1. Loads markets (`loadMarkets`).
2. Iterates over `actions` and **sets leverage first** for entries where
   `leverageChanged = true` (`setLeverage`).
3. In parallel, fetches tickers and current positions (`fetchTickers`,
   `fetchPositions`).
4. Builds two order lists in `splitRebalanceActionsIntoPhases`:
   - **Reduction phase** (`reduceOnly: true` where applicable): shrink or close
     exposure first (frees margin, avoids stacking risk before unwinds).
   - **Expansion phase** (`reduceOnly` unset): add exposure after reductions
     complete.

5. Sends at most **two** websocket batches, in order:
   - `createOrdersWs(reduction)` if non-empty;
   - then `createOrdersWs(expansion)` if non-empty.

6. Concatenates mapped responses into a single `OrderResult[]` for the UI
   (reduction results first, then expansion).

### How each `action` maps to a phase

- **`close`**: full close using current `contracts`, side is the **closing**
  side (opposite of the stored position side), always in the **reduction** batch
  with `reduceOnly: true`.
- **`rebalance`**: side from signed delta (buy if `signedNotionalDelta > 0`,
  sell if `< 0`), size `abs(signedNotionalDelta) / price`. Classified with
  `rebalanceIsReduction`: long positions reduce on negative delta, short
  positions reduce on positive delta. Reductions go to phase 1, increases to
  phase 2.
- **`preciseRebalance`**: always **two** conceptual legs:
  - **Close leg** (phase 1): reduce-only order sized in USD notional, converted
    to contracts at the ticker `last` price. If the close notional would leave
    dust (approximately full position: within `$0.02` of size or `>= 99.9%` of
    estimated position USD), the client sends a **full** close for the whole
    `contracts` amount instead of a partial USD slice.
  - **Open leg** (phase 2): market order in the target `side`, notional
    `openNotional`, not reduce-only.

All market orders share one slippage constant (`SLIPPAGE`) when deriving the
limit price from `last`. Vault trading passes `vaultAddress` in params where
configured.

So the architectural decisions are: **leverage first**, then **two-phase
execution** (reduction batch, then expansion batch), at most **two**
`createOrdersWs` round-trips.

## 7) Why staged changes match real execution

`StagedChangesPanel` shows `stagedTrades`, which are directly derived from
`actions`, while `actions` are derived from the diff `currentPortfolio` vs
`targetPortfolio`.

This same set of `actions` goes into `buildApiPayload` and then into
`HyperliquidClient.rebalancePositions`.

In other words, the panel preview and the executable action rely on the same
diff source.

## 8) Observed Limitations of the Current Implementation

- If a symbol has **no usable ticker `last`** when building orders, that action
  is skipped silently (no order, no synthetic `OrderResult` in the current
  code).
- **Diff layer:** `diffPortfolios` / `preciseRebalanceLegs` use `MIN_USD` (and
  `NOTIONAL_EPSILON`) for precise vs `rebalance` branching and leg sizing;
  `usePortfolioState` still applies submit-time gates (minimum notionals, delta
  checks, etc.).
