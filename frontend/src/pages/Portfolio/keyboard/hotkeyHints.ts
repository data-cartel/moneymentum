import { modifierKeyLabel } from "./modifierLabel"

export type KeyboardPanelId = "portfolio" | "hyperliquid" | "derive" | "staged"

export interface HotkeyHint {
  keys: string
  description: string
}

export const PANEL_DIGIT_BY_ID: Record<KeyboardPanelId, string> = {
  portfolio: "1",
  hyperliquid: "2",
  derive: "3",
  staged: "4",
}

export const panelIdForDigitKey = (
  key: string,
): KeyboardPanelId | undefined => {
  switch (key) {
    case "1":
      return "portfolio"
    case "2":
      return "hyperliquid"
    case "3":
      return "derive"
    case "4":
      return "staged"
    default:
      return undefined
  }
}

export const hotkeyHintsForPanel = (panelId: KeyboardPanelId): HotkeyHint[] => {
  const mod = modifierKeyLabel()

  switch (panelId) {
    case "portfolio":
      return [
        { keys: "j/k", description: "move" },
        { keys: "w", description: "weight" },
        { keys: "n", description: "notional" },
        { keys: "t", description: "side" },
        { keys: "l", description: "leverage" },
        { keys: "d", description: "delete" },
        { keys: "[ ]", description: "step lev" },
        { keys: "Shift+[ ]", description: "acct lev" },
      ]
    case "hyperliquid":
      return [
        { keys: "j/k", description: "move" },
        { keys: "Enter", description: "add/remove" },
        { keys: "s", description: "search" },
      ]
    case "derive":
      return []
    case "staged":
      return [
        { keys: `${mod}+Enter`, description: "rebalance" },
        {
          keys: `${mod}+Shift+Backspace`,
          description: "clear all",
        },
      ]
  }
}
