import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { useListSelection } from "./hooks/useListSelection"
import { computeProjectedExposures } from "./utils/portfolio"
import type { PositionsByUnderlying } from "./hooks/usePrototypeData"

describe("keyboard-only workflows", () => {
  const mockOnAddTrade = vi.fn()
  const mockOnAdjustWeight = vi.fn()

  const defaultConfig = {
    screenerItems: () => [
      { symbol: "BTC" },
      { symbol: "ETH" },
      { symbol: "SOL" },
    ],
    positionItems: () => [
      {
        underlying: "BTC",
        instruments: [{ symbol: "BTC/USDC:USDC" }, { symbol: "BTC-SPOT" }],
      },
      {
        underlying: "ETH",
        instruments: [{ symbol: "ETH/USDC:USDC" }],
      },
    ],
    onAddTrade: mockOnAddTrade,
    onAdjustWeight: mockOnAdjustWeight,
  }

  describe("screener navigation workflow", () => {
    it("can navigate to screener with number key 1", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      expect(result.focusedPanel()).toBe("screener")
      expect(result.getSelectedIndex("screener")).toBe(0)
    })

    it("can navigate screener items with j/k", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(1)

      result.moveSelection("down")
      expect(result.getSelectedIndex("screener")).toBe(2)

      result.moveSelection("up")
      expect(result.getSelectedIndex("screener")).toBe(1)
    })

    it("can get selected symbol for modal", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.moveSelection("down")
      result.moveSelection("down")

      expect(result.getSelectedIndex("screener")).toBe(2)
    })
  })

  describe("positions navigation workflow", () => {
    it("can navigate to positions with number key 2", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.focusedPanel()).toBe("positions")
      expect(result.getSelectedIndex("positions")).toBe(0)
    })

    it("can navigate position underlyings with j/k", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.toggleExpand() // Collapse BTC

      result.moveSelection("down")
      expect(result.getSelectedIndex("positions")).toBe(1)

      result.moveSelection("up")
      expect(result.getSelectedIndex("positions")).toBe(0)
    })

    it("can expand underlying with o and navigate to instruments", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.getSelectedSymbol()).toBe("BTC")
      expect(result.isExpanded("BTC")).toBe(true)

      result.toggleExpand()
      expect(result.isExpanded("BTC")).toBe(false)

      result.toggleExpand()
      expect(result.isExpanded("BTC")).toBe(true)

      result.moveSelection("down")

      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.moveSelection("down")

      expect(result.getSelectedInstrument()).toBe("BTC-SPOT")
    })

    it("can trigger weight edit on selected instrument", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")

      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.adjustWeight(0.05)

      expect(mockOnAdjustWeight).toHaveBeenCalledWith("BTC/USDC:USDC", 0.05)
    })
  })

  describe("panel switching workflow", () => {
    it("can switch between panels with h/l", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      expect(result.focusedPanel()).toBe("screener")

      result.focusPanel("positions")
      expect(result.focusedPanel()).toBe("positions")

      result.focusPanel("screener")
      expect(result.focusedPanel()).toBe("screener")
    })

    it("preserves selection when switching panels", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.moveSelection("down")

      result.moveSelection("down")

      expect(result.getSelectedIndex("screener")).toBe(2)

      result.focusPanel("positions")

      result.focusPanel("screener")
      expect(result.getSelectedIndex("screener")).toBe(2)
    })
  })

  describe("escape key workflow", () => {
    it("clears selection first, then focus on second escape", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")
      expect(result.focusedPanel()).toBe("screener")
      expect(result.getSelectedIndex("screener")).toBe(0)

      result.handleEscape()
      expect(result.focusedPanel()).toBe("screener")
      expect(result.getSelectedIndex("screener")).toBeNull()

      result.handleEscape()
      expect(result.focusedPanel()).toBeNull()
    })

    it("works correctly after navigating to instrument", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      result.moveSelection("down")

      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.handleEscape()
      expect(result.focusedPanel()).toBe("positions")

      result.handleEscape()
      expect(result.focusedPanel()).toBeNull()
    })
  })

  describe("trade staging workflow", () => {
    it("can stage buy trade with + key after navigating", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.moveSelection("down")

      expect(result.getSelectedIndex("screener")).toBe(1)

      result.triggerTrade("buy")

      expect(mockOnAddTrade).toHaveBeenCalledWith("ETH", "buy")
    })

    it("can stage sell trade with - key", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("screener")

      result.triggerTrade("sell")

      expect(mockOnAddTrade).toHaveBeenCalledWith("BTC", "sell")
    })
  })

  describe("complete keyboard workflows", () => {
    it("full flow: focus screener -> navigate -> stage trade -> switch panel -> navigate -> adjust weight", () => {
      const onAdjustWeight = vi.fn()
      const onAddTrade = vi.fn()
      const { result } = renderHook(() =>
        useListSelection({
          ...defaultConfig,
          onAddTrade,
          onAdjustWeight,
        }),
      )

      result.focusPanel("screener")
      expect(result.focusedPanel()).toBe("screener")
      expect(result.getSelectedIndex("screener")).toBe(0)

      result.moveSelection("down")
      expect(result.getSelectedSymbol()).toBe("ETH")

      result.triggerTrade("buy")
      expect(onAddTrade).toHaveBeenCalledWith("ETH", "buy")

      result.focusPanel("positions")
      expect(result.focusedPanel()).toBe("positions")
      expect(result.getSelectedSymbol()).toBe("BTC")

      expect(result.isExpanded("BTC")).toBe(true)
      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.adjustWeight(0.05)
      expect(onAdjustWeight).toHaveBeenCalledWith("BTC/USDC:USDC", 0.05)
    })

    it("navigates through all instruments then to next underlying", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.isExpanded("BTC")).toBe(true)

      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC-SPOT")

      result.moveSelection("down")
      expect(result.getSelectedSymbol()).toBe("ETH")
      expect(result.getSelectedInstrument()).toBeNull()
    })

    it("preserves expansion state when navigating between underlyings", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.isExpanded("BTC")).toBe(true)

      result.moveSelection("down") // BTC inst 0
      result.moveSelection("down") // BTC inst 1
      result.moveSelection("down") // ETH underlying
      expect(result.getSelectedSymbol()).toBe("ETH")

      expect(result.isExpanded("ETH")).toBe(false)
      result.toggleExpand()
      expect(result.isExpanded("ETH")).toBe(true)

      expect(result.isExpanded("BTC")).toBe(true)
    })

    it("collapses expanded underlying with o key", () => {
      const { result } = renderHook(() => useListSelection(defaultConfig))

      result.focusPanel("positions")

      expect(result.isExpanded("BTC")).toBe(true)

      result.moveSelection("down")
      expect(result.getSelectedInstrument()).toBe("BTC/USDC:USDC")

      result.moveSelection("up")
      expect(result.getSelectedInstrument()).toBeNull()
      expect(result.getSelectedSymbol()).toBe("BTC")

      result.toggleExpand()
      expect(result.isExpanded("BTC")).toBe(false)
    })
  })
})

describe("factor exposure projections", () => {
  const basePositions: PositionsByUnderlying[] = [
    {
      underlying: "BTC",
      positions: [
        {
          symbol: "BTC/USDC:USDC",
          side: "long",
          weight: 0.3,
          notional: 30000,
          percentage: 30,
        },
      ],
    },
    {
      underlying: "ETH",
      positions: [
        {
          symbol: "ETH/USDC:USDC",
          side: "long",
          weight: 0.2,
          notional: 20000,
          percentage: 20,
        },
      ],
    },
  ]

  const assetFactors = [
    {
      ticker: "BTC",
      beta: 1.0,
      momentum: 0.12,
      volatility: 0.65,
      spyBeta: 0.45,
    },
    {
      ticker: "ETH",
      beta: 1.25,
      momentum: 0.08,
      volatility: 0.78,
      spyBeta: 0.42,
    },
    {
      ticker: "SOL",
      beta: 1.8,
      momentum: 0.15,
      volatility: 0.92,
      spyBeta: 0.38,
    },
  ]

  it("shows all factor changes in staged trades impact", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        { id: "1", symbol: "SOL", side: "buy", notional: 10000, leverage: 1 },
      ],
      nav: 100000,
      leverage: 1.0,
      assetFactors,
    })

    expect(result.factorChanges.btcBeta).toBeDefined()
    expect(result.factorChanges.spyBeta).toBeDefined()
    expect(result.factorChanges.momentum).toBeDefined()
    expect(result.factorChanges.volatility).toBeDefined()
    expect(result.factorChanges.carry).toBeDefined()

    expect(result.factorChanges.btcBeta.delta).toBeGreaterThan(0)
    expect(result.factorChanges.momentum.delta).toBeGreaterThan(0)
    expect(result.factorChanges.volatility.delta).toBeGreaterThan(0)
  })

  it("computes correct weighted average for projected factors", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [],
      nav: 100000,
      leverage: 1.0,
      assetFactors,
    })

    expect(result.factorChanges.btcBeta.current).toBeCloseTo(1.1)
    expect(result.factorChanges.btcBeta.delta).toBe(0)
  })

  it("shows factor decrease when selling high-factor asset", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        { id: "1", symbol: "ETH", side: "sell", notional: 10000, leverage: 1 },
      ],
      nav: 100000,
      leverage: 1.0,
      assetFactors,
    })

    expect(result.factorChanges.btcBeta.delta).toBeLessThan(0)
  })
})

describe("leverage keyboard controls", () => {
  it("leverage state is passed through hooks correctly", () => {
    const leverage = 1.5
    const nav = 100000
    const positions: PositionsByUnderlying[] = [
      {
        underlying: "BTC",
        positions: [
          {
            symbol: "BTC/USDC:USDC",
            side: "long",
            weight: 0.5,
            notional: 50000,
            percentage: 50,
          },
        ],
      },
    ]

    const result = computeProjectedExposures({
      positions,
      stagedTrades: [],
      nav,
      leverage,
      assetFactors: [{ ticker: "BTC", beta: 1.0 }],
    })

    expect(result.currentEffectiveLeverage).toBeCloseTo(0.75)
  })

  it("leverage changes scale effective exposure proportionally", () => {
    const nav = 100000
    const positions: PositionsByUnderlying[] = [
      {
        underlying: "BTC",
        positions: [
          {
            symbol: "BTC/USDC:USDC",
            side: "long",
            weight: 0.5,
            notional: 50000,
            percentage: 50,
          },
        ],
      },
    ]

    const at1x = computeProjectedExposures({
      positions,
      stagedTrades: [],
      nav,
      leverage: 1.0,
      assetFactors: [{ ticker: "BTC", beta: 1.0 }],
    })

    const at2x = computeProjectedExposures({
      positions,
      stagedTrades: [],
      nav,
      leverage: 2.0,
      assetFactors: [{ ticker: "BTC", beta: 1.0 }],
    })

    expect(at2x.currentEffectiveLeverage).toBeCloseTo(
      at1x.currentEffectiveLeverage * 2,
    )
  })
})
