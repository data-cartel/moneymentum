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

/** True when `panelId` is a keyboard-navigable portfolio panel. */
export const isKeyboardPanelId = (
  panelId: string,
): panelId is KeyboardPanelId =>
  panelId === "portfolio" ||
  panelId === "hyperliquid" ||
  panelId === "derive" ||
  panelId === "staged"

/** Digit badge for a panel id, or undefined when the panel has no binding. */
export const panelDigitForId = (panelId: string): string | undefined => {
  if (!isKeyboardPanelId(panelId)) {
    return undefined
  }
  return PANEL_DIGIT_BY_ID[panelId]
}

export const panelIdForDigitKey = (
  key: string,
): KeyboardPanelId | undefined => {
  const entry = (
    Object.entries(PANEL_DIGIT_BY_ID) as [KeyboardPanelId, string][]
  ).find(([, digit]) => digit === key)
  return entry?.[0]
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
