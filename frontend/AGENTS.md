# Frontend Design Principles

Guidelines for the professional trading dashboard prototype.

## 1. Efficient Space Usage

Every pixel matters for institutional traders who need dense information
displays.

- **No verbose badges** - Use single characters or symbols (e.g., "L" not
  "LONG")
- **No wrapping or misalignment** - Instrument rows must align with parent rows
- **Dropdown menus over inline buttons/chips** - Options belong in dropdowns,
  not sprawled across the UI
- **Collapse features behind icons/dropdowns** - Don't display everything at
  once

## 2. Flexibility

The dashboard must adapt to different trading strategies and benchmarks.

- **Factor exposures are user-configurable** - Never hardcode benchmarks
- **Users define their own benchmarks** - BTC, SPY, custom indices
- **Support custom factor definitions** - Beyond pre-set options

## 3. Risk Scaling (Global Leverage)

Global leverage is a core risk management feature.

- **Global leverage slider scales ALL positions proportionally**
- **Weights stay constant, notionals scale with leverage**
- **Formula: notional = NAV x weight x leverage**
- **Allows traders to reduce/increase risk without changing portfolio
  composition**

This feature must never be removed.

## 4. Visual Consistency

Same information should have the same format everywhere.

- **Child rows inherit parent styling patterns**
- **Badges must be compact and aligned in their column**
- **Numbers use consistent formatting** - Same decimal places for same metric
  types

## 5. Instrument Display

### Position Direction Badges

Use `LONG` and `SHORT` consistently for all instrument types.

For Options, add a human-readable hint explaining the portfolio effect:

- Long CALL: "Profits if underlying rises"
- Short CALL: "Profits if underlying falls or stays flat"
- Long PUT: "Profits if underlying falls"
- Short PUT: "Profits if underlying rises or stays flat"

### Badge Placement

Badges go in the Side column, with option hints inline.

Target layout:

```
Asset     Side                                    Notional   %      Delta
BTC       [LONG]                                  $56.3k     25.1%  0.85
  PERP    LONG                                    $43.8k     19.5%  0.66
  SPOT    LONG                                    $12.5k     5.6%   0.19
ETH       [LONG]                                  $40.0k     ...
  PERP    LONG                                    ...
  PUT     LONG  Profits if underlying falls       ...
```

## 6. Code Organization

### Package by Feature, Not by Layer

Structure code around features and domain concepts, not technical layers.

- **No `types.ts` files or `types/` directories** - Types belong with the code
  that uses them
- **Colocate related code** - A feature's types, hooks, components, and
  utilities live together
- **Export types from the primary file** - If `MetricDefinition` is used by
  metrics code, export it from `metrics/registry.ts`

This keeps related code discoverable and reduces import complexity.

## 7. Effect for Error Handling

All async operations use Effect for typed error channels. Raw `throw`,
`Promise.reject`, and untyped `catch` blocks are not allowed in production code.

### HTTP layer (`src/lib/http.ts`)

Tagged error types:

- `NetworkError` -- fetch itself failed (offline, DNS, CORS)
- `HttpStatusError` -- response not ok (carries `status` and optional `detail`)
- `JsonParseError` -- response body not valid JSON
- `JsonSerializeError` -- `JSON.stringify` failed (e.g. circular references)

Programs:

- `fetchJson<A>(url, init?)` -- GET/generic request returning parsed JSON
- `postJson<A>(url, body, init?)` -- POST with JSON body
- `postEmpty(url, init?)` -- POST expecting no response body
- `fetchStreamChecked(url, init?)` -- fetch with status check, returns raw
  `Response` for streaming

### Bridge to TanStack Query

`Effect.runPromise(program)` inside `queryFn`. When the Effect fails,
`runPromise` rejects with a `FiberFailure` that wraps the typed error in its
`Cause` -- so `query.error` is the `FiberFailure`, not the tagged error itself.

```ts
queryFn: (({ signal }) => Effect.runPromise(fetchJson<T>(url, { signal })));
```

Always forward the `signal` from TanStack Query's context into the HTTP helpers.

### Displaying errors in the UI

Never render `error.message` directly -- the `FiberFailure` message is generic
("An error has occurred"). Pass `query.error` through `getErrorMessage`
(`src/lib/error-message.ts`), which unwraps the `FiberFailure` to the tagged
error and maps each `_tag` to display text:

```tsx
<Show when={query.error}>
  <p>{getErrorMessage(query.error)}</p>
</Show>;
```

Add a `case` to `getErrorMessage` whenever you introduce a new tagged error so
every failure surfaces a user-facing message instead of falling back to the raw
string.

### Hyperliquid service (`src/services/hyperliquid.ts`)

Wraps `HyperliquidClient` methods in Effect programs with typed errors:

- `WalletNotConnected` -- no client available
- `ExchangeRequestError` -- exchange API call failed

Each function takes `client: HyperliquidClient | null` and returns an Effect.
The null check is handled by `requireClient` which fails with
`WalletNotConnected`.

### Rules

- **Import from submodules**: `import * as Effect from "effect/Effect"`, never
  from the barrel `"effect"` (enforced by `@effect/eslint-plugin`)
- **No raw fetch**: All HTTP calls go through `src/lib/http.ts`
- **No throw/Promise.reject**: Use `Effect.fail` with a tagged error
- **No try/catch**: Use `Effect.tryPromise` or `Effect.try`

### Zero exceptions policy

No new `throw`, `Promise.reject`, or `try/catch` in any code. Every failure must
flow through Effect's typed error channel. The only permitted exceptions are:

- **SolidJS context hooks** (`useWallet`, `useNetwork`, `useTheme`) -- the
  framework requires a synchronous throw when a hook is called outside its
  Provider. These are programmer errors, not runtime failures.
- **App bootstrap** (`main.tsx`) -- throwing when the root DOM element is
  missing is a fatal startup error.
- **Imperative DOM library callbacks** (e.g. lightweight-charts in
  `ChartComponent`) -- third-party libraries that don't support Effect. Catch at
  the boundary and log; do not propagate.

`HyperliquidClient` internals still use `throw` and `try/catch`, but these are
fully contained by `wrapExchange` in the Effect service layer. New code inside
`HyperliquidClient` must follow the same pattern -- any throw will be caught by
`Effect.tryPromise` and surfaced as `ExchangeRequestError`.
