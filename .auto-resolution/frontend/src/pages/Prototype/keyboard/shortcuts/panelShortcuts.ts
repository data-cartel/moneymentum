import type { ShortcutDefinition } from "../shortcutRegistry"

export const PANEL_SHORTCUTS: Omit<ShortcutDefinition, "when">[] = [
  {
    id: "focus-screener",
    key: "1",
    category: "panel",
    context: "global",
    description: "Focus Screener",
  },
  {
    id: "focus-positions",
    key: "2",
    category: "panel",
    context: "global",
    description: "Focus Positions",
  },
  {
    id: "focus-performance",
    key: "3",
    category: "panel",
    context: "global",
    description: "Focus Performance",
  },
  {
    id: "focus-staged",
    key: "4",
    category: "panel",
    context: "global",
    description: "Focus Staged Changes",
  },
]
