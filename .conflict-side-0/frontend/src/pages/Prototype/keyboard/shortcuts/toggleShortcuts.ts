import type { ShortcutDefinition } from "../shortcutRegistry"

export const TOGGLE_SHORTCUTS: Omit<ShortcutDefinition, "when">[] = [
  {
    id: "toggle-metric-selector",
    key: "m",
    category: "configuration",
    context: "global",
    description: "Open metric selector",
  },
  {
    id: "toggle-factor-config",
    key: "f",
    category: "configuration",
    context: "global",
    description: "Toggle factor config panel",
  },
  {
    id: "toggle-column-config",
    key: "c",
    category: "configuration",
    context: "global",
    description: "Toggle screener column config",
  },
  {
    id: "toggle-help-question",
    key: "?",
    category: "general",
    context: "global",
    description: "Toggle this help",
  },
  {
    id: "toggle-help-f1",
    key: "F1",
    category: "general",
    context: "global",
    description: "Toggle help (Bloomberg)",
  },
]
