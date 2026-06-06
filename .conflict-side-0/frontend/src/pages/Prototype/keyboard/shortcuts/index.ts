import { PANEL_SHORTCUTS } from "./panelShortcuts"
import { NAVIGATION_SHORTCUTS } from "./navigationShortcuts"
import { TOGGLE_SHORTCUTS } from "./toggleShortcuts"
import { TRADE_SHORTCUTS } from "./tradeShortcuts"
import type { ShortcutDefinition } from "../shortcutRegistry"

export { PANEL_SHORTCUTS } from "./panelShortcuts"
export { NAVIGATION_SHORTCUTS } from "./navigationShortcuts"
export { TOGGLE_SHORTCUTS } from "./toggleShortcuts"
export { TRADE_SHORTCUTS } from "./tradeShortcuts"

export const ALL_SHORTCUTS: Omit<ShortcutDefinition, "when">[] = [
  ...PANEL_SHORTCUTS,
  ...NAVIGATION_SHORTCUTS,
  ...TOGGLE_SHORTCUTS,
  ...TRADE_SHORTCUTS,
]

export interface ShortcutGroup {
  title: string
  shortcuts: Array<{ key: string; description: string }>
}

export const getShortcutGroups = (): ShortcutGroup[] => [
  {
    title: "Panel Navigation",
    shortcuts: [
      { key: "1", description: "Focus Screener" },
      { key: "2", description: "Focus Positions" },
      { key: "3", description: "Focus Performance" },
      { key: "4", description: "Focus Staged Changes" },
      { key: "h/\u2190", description: "Switch to Screener" },
      { key: "l/\u2192", description: "Switch to Positions" },
      { key: "Esc", description: "Clear selection / Unfocus" },
    ],
  },
  {
    title: "List Navigation",
    shortcuts: [
      { key: "j/\u2193", description: "Select next item" },
      { key: "k/\u2191", description: "Select previous item" },
      { key: "o/\u23ce/\u2423", description: "Expand/collapse underlying" },
    ],
  },
  {
    title: "Instrument Weights",
    shortcuts: [
      { key: "\u21e7+", description: "Increase selected weight +5%" },
      { key: "\u21e7-", description: "Decrease selected weight -5%" },
    ],
  },
  {
    title: "Leverage (when focused)",
    shortcuts: [
      { key: "h/\u2190/[", description: "Decrease leverage" },
      { key: "l/\u2192/]", description: "Increase leverage" },
      { key: "\u21e7", description: "Hold for \u00b10.5x step" },
    ],
  },
  {
    title: "Trading",
    shortcuts: [
      { key: "+", description: "Stage buy for selected" },
      { key: "-", description: "Stage sell for selected" },
      { key: "x", description: "Execute staged trades" },
    ],
  },
  {
    title: "Configuration",
    shortcuts: [
      { key: "m", description: "Open metric selector" },
      { key: "f", description: "Toggle factor config panel" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { key: "?", description: "Toggle this help" },
      { key: "F1", description: "Toggle help (Bloomberg)" },
    ],
  },
]
