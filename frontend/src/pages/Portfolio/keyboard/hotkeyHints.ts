import { modifierKeyLabel } from "./modifierLabel"

export type KeyboardPanelId = "portfolio" | "allSymbols" | "staged"

export interface HotkeyHint {
  keys: string
  description: string
}

export const PANEL_DIGIT_BY_ID: Record<KeyboardPanelId, string> = {
  portfolio: "1",
  allSymbols: "2",
  staged: "3",
}

export const panelIdForDigitKey = (
  key: string,
): KeyboardPanelId | undefined => {
  switch (key) {
    case "1":
      return "portfolio"
    case "2":
      return "allSymbols"
    case "3":
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
    case "allSymbols":
      return [
        { keys: "j/k", description: "move" },
        { keys: "Enter", description: "add/remove" },
        { keys: "s", description: "search" },
      ]
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
