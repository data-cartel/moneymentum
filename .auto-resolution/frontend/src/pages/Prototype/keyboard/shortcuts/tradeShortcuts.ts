import type { ShortcutDefinition } from "../shortcutRegistry"

export const TRADE_SHORTCUTS: Omit<ShortcutDefinition, "when">[] = [
  // Staging trades
  {
    id: "stage-buy-plus",
    key: "+",
    category: "trading",
    context: "global",
    description: "Stage buy for selected",
  },
  {
    id: "stage-buy-equals",
    key: "=",
    category: "trading",
    context: "global",
    description: "Stage buy for selected",
  },
  {
    id: "stage-sell",
    key: "-",
    category: "trading",
    context: "global",
    description: "Stage sell for selected",
  },
  // Weight adjustment (with shift)
  {
    id: "increase-weight",
    key: "+",
    category: "trading",
    context: "global",
    description: "Increase selected weight +5%",
    modifiers: { shift: true },
  },
  {
    id: "decrease-weight",
    key: "-",
    category: "trading",
    context: "global",
    description: "Decrease selected weight -5%",
    modifiers: { shift: true },
  },
  // Leverage control
  {
    id: "decrease-leverage",
    key: "[",
    category: "trading",
    context: "global",
    description: "Decrease leverage",
  },
  {
    id: "increase-leverage",
    key: "]",
    category: "trading",
    context: "global",
    description: "Increase leverage",
  },
  // Execute
  {
    id: "execute-trades",
    key: "x",
    category: "trading",
    context: "global",
    description: "Execute staged trades",
  },
]
