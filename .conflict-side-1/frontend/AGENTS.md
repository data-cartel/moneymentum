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
