import type { ShortcutDefinition } from "../shortcutRegistry"

export const NAVIGATION_SHORTCUTS: Omit<ShortcutDefinition, "when">[] = [
  // Vim keys
  {
    id: "nav-left",
    key: "h",
    category: "navigation",
    context: "global",
    description: "Switch to Screener",
  },
  {
    id: "nav-right",
    key: "l",
    category: "navigation",
    context: "global",
    description: "Switch to Positions",
  },
  {
    id: "nav-down",
    key: "j",
    category: "navigation",
    context: "global",
    description: "Select next item",
  },
  {
    id: "nav-up",
    key: "k",
    category: "navigation",
    context: "global",
    description: "Select previous item",
  },
  // Arrow keys
  {
    id: "arrow-left",
    key: "ArrowLeft",
    category: "navigation",
    context: "global",
    description: "Switch to Screener",
  },
  {
    id: "arrow-right",
    key: "ArrowRight",
    category: "navigation",
    context: "global",
    description: "Switch to Positions",
  },
  {
    id: "arrow-down",
    key: "ArrowDown",
    category: "navigation",
    context: "global",
    description: "Select next item",
  },
  {
    id: "arrow-up",
    key: "ArrowUp",
    category: "navigation",
    context: "global",
    description: "Select previous item",
  },
  // Toggle expand
  {
    id: "toggle-expand-o",
    key: "o",
    category: "navigation",
    context: "global",
    description: "Expand/collapse underlying",
  },
  {
    id: "toggle-expand-space",
    key: " ",
    category: "navigation",
    context: "positions",
    description: "Expand/collapse underlying",
  },
  {
    id: "toggle-expand-enter",
    key: "Enter",
    category: "navigation",
    context: "positions",
    description: "Expand/collapse underlying",
  },
]
