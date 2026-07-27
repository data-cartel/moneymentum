import { describe, expect, it, vi } from "vitest"

import { hotkeyHintsForPanel, panelIdForDigitKey } from "./hotkeyHints"
import { modifierKeyLabel } from "./modifierLabel"

describe("hotkeyHints", () => {
  it("maps digits to fixed panel ids", () => {
    expect(panelIdForDigitKey("1")).toBe("portfolio")
    expect(panelIdForDigitKey("2")).toBe("allSymbols")
    expect(panelIdForDigitKey("3")).toBe("staged")
    expect(panelIdForDigitKey("9")).toBeUndefined()
  })

  it("returns portfolio hints including edit keys", () => {
    const hints = hotkeyHintsForPanel("portfolio")
    const keys = hints.map(hint => hint.keys)
    expect(keys).toContain("j/k")
    expect(keys).toContain("w")
    expect(keys).toContain("n")
    expect(keys).toContain("t")
    expect(keys).toContain("l")
    expect(keys).toContain("d")
    expect(keys).toContain("Shift+[ ]")
  })

  it("returns staged hints with platform modifier", () => {
    const mod = modifierKeyLabel()
    const hints = hotkeyHintsForPanel("staged")
    expect(hints.some(hint => hint.keys.includes(`${mod}+Enter`))).toBe(true)
    expect(
      hints.some(hint => hint.keys.includes(`${mod}+Shift+Backspace`)),
    ).toBe(true)
  })
})

describe("modifierKeyLabel", () => {
  it("returns Cmd glyph on Mac-like platforms", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    })
    expect(modifierKeyLabel()).toBe("⌘")
    vi.unstubAllGlobals()
  })

  it("returns Ctrl on non-Mac platforms", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    expect(modifierKeyLabel()).toBe("Ctrl")
    vi.unstubAllGlobals()
  })
})
