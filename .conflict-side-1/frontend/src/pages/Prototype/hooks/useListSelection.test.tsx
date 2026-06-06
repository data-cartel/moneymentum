import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { useListSelection } from "./useListSelection"

describe("useListSelection", () => {
  const mockOnAddTrade = vi.fn()
  const mockOnAdjustWeight = vi.fn()

  const defaultConfig = {
    screenerItems: () => [
      { symbol: "BTC" },
      { symbol: "ETH" },
      { symbol: "SOL" },
      { symbol: "DOGE" },
    ],
    positionItems: () => [
      {
        underlying: "BTC",
        instruments: [{ symbol: "BTC/USDC:USDC" }, { symbol: "BTC-SPOT" }],
      },
      {
        underlying: "ETH",
        instruments: [
          { symbol: "ETH/USDC:USDC" },
          { symbol: "ETH-SPOT" },
          { symbol: "ETH-PUT-2800" },
        ],
      },
      {
        underlying: "SOL",
        instruments: [{ symbol: "SOL/USDC:USDC" }],
      },
    ],
    onAddTrade: mockOnAddTrade,
    onAdjustWeight: mockOnAdjustWeight,
  }

  beforeEach(() => {
    mockOnAddTrade.mockClear()
    mockOnAdjustWeight.mockClear()
  })

  describe("panel focus", () => {
    it("starts with no focused panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))
      expect(result.focusedPanel()).toBeNull()
    })

    it("focuses screener panel with 1 key", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      expect(result.focusedPanel()).toBe("screener")
    })

    it("focuses positions panel with 2 key", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.focusedPanel()).toBe("positions")
    })

    it("switches between panels with h/l keys", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      expect(result.focusedPanel()).toBe("screener")

      result.focusPanel("positions")
      expect(result.focusedPanel()).toBe("positions")

      result.focusPanel("screener")
      expect(result.focusedPanel()).toBe("screener")
    })
  })

  describe("row selection", () => {
    it("starts with no selected row in either panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      expect(result.getSelectedIndex("screener")).toBeNull()
      expect(result.getSelectedIndex("positions")).toBeNull()
    })

    it("selects first row when focusing panel with no prior selection", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      expect(result.getSelectedIndex("screener")).toBe(0)
    })

    it("clamps selection when list shrinks", () => {
      const [screenerItems, setScreenerItems] = createSignal([
        { symbol: "BTC" },
        { symbol: "ETH" },
        { symbol: "SOL" },
        { symbol: "DOGE" },
      ])

      const { result } = renderHook(() =>
        useListSelection({ ...defaultConfig, screenerItems }),
      )

      result.focusPanel("screener")
      result.moveSelection("down")
      result.moveSelection("down")
      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(3)

      setScreenerItems([{ symbol: "BTC" }, { symbol: "ETH" }])

      expect(result.getSelectedIndex("screener")).toBe(1)
    })

    it("handles empty list gracefully", () => {
      const { result } = renderHook(() =>
        useListSelection({ ...defaultConfig, screenerItems: () => [] }),
      )

      result.focusPanel("screener")

      expect(result.getSelectedIndex("screener")).toBeNull()
      expect(result.focusedPanel()).toBe("screener")
    })

    it("preserves selection when switching panels", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")
      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(2)

      result.focusPanel("positions")
      expect(result.getSelectedIndex("positions")).toBe(0)

      result.focusPanel("screener")
      expect(result.getSelectedIndex("screener")).toBe(2)
    })
  })

  describe("j/k navigation", () => {
    it("moves selection down with j (moveSelection down)", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      expect(result.getSelectedIndex("screener")).toBe(0)

      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(1)

      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(2)
    })

    it("moves selection up with k (moveSelection up)", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")
      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(2)

      result.moveSelection("up")
      expect(result.getSelectedIndex("screener")).toBe(1)

      result.moveSelection("up")
      expect(result.getSelectedIndex("screener")).toBe(0)
    })

    it("stops at bottom boundary", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      for (let i = 0; i < 10; i++) {
        result.moveSelection("down")
      }

      expect(result.getSelectedIndex("screener")).toBe(3)
    })

    it("stops at top boundary", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.moveSelection("up")

      expect(result.getSelectedIndex("screener")).toBe(0)
    })

    it("does nothing when no panel is focused", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.moveSelection("down")

      expect(result.getSelectedIndex("screener")).toBeNull()
      expect(result.getSelectedIndex("positions")).toBeNull()
    })
  })

  describe("trading actions (+/-)", () => {
    it("calls onAddTrade with buy when + is pressed on screener", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")

      result.triggerTrade("buy")

      expect(mockOnAddTrade).toHaveBeenCalledWith("ETH", "buy")
    })

    it("calls onAddTrade with sell when - is pressed on screener", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")
      result.moveSelection("down")

      result.triggerTrade("sell")

      expect(mockOnAddTrade).toHaveBeenCalledWith("SOL", "sell")
    })

    it("calls onAddTrade with underlying when on positions panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")
      result.moveSelection("down") // BTC first instrument
      result.moveSelection("down") // BTC second instrument
      result.moveSelection("down") // ETH underlying

      result.triggerTrade("buy")

      expect(mockOnAddTrade).toHaveBeenCalledWith("ETH", "buy")
    })

    it("does nothing when no panel is focused", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.triggerTrade("buy")

      expect(mockOnAddTrade).not.toHaveBeenCalled()
    })

    it("does nothing when no row is selected", () => {
      const { result } = renderHook(() =>
        useListSelection({
          ...defaultConfig,
          screenerItems: () => [],
        }),
      )

      result.focusPanel("screener")

      result.triggerTrade("buy")

      expect(mockOnAddTrade).not.toHaveBeenCalled()
    })
  })

  describe("escape behavior", () => {
    it("first escape clears selection", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(1)

      result.handleEscape()

      expect(result.getSelectedIndex("screener")).toBeNull()
      expect(result.focusedPanel()).toBe("screener")
    })

    it("second escape unfocuses panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")

      result.handleEscape()
      expect(result.focusedPanel()).toBe("screener")

      result.handleEscape()
      expect(result.focusedPanel()).toBeNull()
    })

    it("escape unfocuses immediately when no selection", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.handleEscape()
      expect(result.getSelectedIndex("screener")).toBeNull()
      expect(result.focusedPanel()).toBe("screener")

      result.handleEscape()
      expect(result.focusedPanel()).toBeNull()
    })
  })

  describe("getSelectedSymbol helper", () => {
    it("returns symbol for screener panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      result.moveSelection("down")

      expect(result.getSelectedSymbol()).toBe("ETH")
    })

    it("returns underlying for positions panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")
      result.toggleExpand() // Collapse BTC
      result.moveSelection("down") // ETH
      result.toggleExpand() // Collapse ETH
      result.moveSelection("down") // SOL

      expect(result.getSelectedSymbol()).toBe("SOL")
    })

    it("returns null when no panel focused", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      expect(result.getSelectedSymbol()).toBeNull()
    })

    it("returns null when no selection", () => {
      const { result } = renderHook(() =>
        useListSelection({
          ...defaultConfig,
          screenerItems: () => [],
        }),
      )

      result.focusPanel("screener")

      expect(result.getSelectedSymbol()).toBeNull()
    })
  })

  describe("nested selection (expand/collapse)", () => {
    it("starts with all underlyings collapsed", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.isExpanded("BTC")).toBe(true)
      expect(result.isExpanded("ETH")).toBe(true)
      expect(result.isExpanded("SOL")).toBe(false)
    })

    it("collapses expanded underlying on toggleExpand", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.isExpanded("BTC")).toBe(true)

      result.toggleExpand()

      expect(result.isExpanded("BTC")).toBe(false)
    })

    it("expands collapsed underlying on toggleExpand", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.toggleExpand()
      expect(result.isExpanded("BTC")).toBe(false)

      result.toggleExpand()
      expect(result.isExpanded("BTC")).toBe(true)
    })

    it("navigates to instruments within expanded group with j/k", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")

      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")
    })

    it("moves through all instruments in expanded group", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC-SPOT")

      result.moveSelection("down")
      expect(result.getSelectedSymbol()).toBe("ETH")
      expect(result.getSelectedInstrument()).toBeNull()
    })

    it("returns to underlying when navigating up from first instrument", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.moveSelection("up")
      expect(result.getSelectedSymbol()).toBe("BTC")
      expect(result.getSelectedInstrument()).toBeNull()
    })
  })

  describe("weight adjustment with +/-", () => {
    it("calls onAdjustWeight with positive delta on +", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")

      result.adjustWeight(0.01)

      expect(mockOnAdjustWeight).toHaveBeenCalledWith("BTC/USDC:USDC", 0.01)
    })

    it("calls onAdjustWeight with negative delta on -", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")

      result.adjustWeight(-0.01)

      expect(mockOnAdjustWeight).toHaveBeenCalledWith("BTC/USDC:USDC", -0.01)
    })

    it("does nothing when no instrument is selected", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.adjustWeight(0.01)

      expect(mockOnAdjustWeight).not.toHaveBeenCalled()
    })

    it("does nothing when on screener panel", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.adjustWeight(0.01)

      expect(mockOnAdjustWeight).not.toHaveBeenCalled()
    })
  })
})
