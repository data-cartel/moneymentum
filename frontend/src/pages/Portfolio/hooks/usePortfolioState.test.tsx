import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"

import { MIN_USD, usePortfolioState } from "./usePortfolioState"
import {
  useHyperliquidAccountSummary,
  useHyperliquidLeverageLimits,
  useHyperliquidPositions,
  useRebalanceHyperliquidPositions,
} from "@/hooks/useTrading"

vi.mock("@/hooks/useTrading", () => ({
  useHyperliquidAccountSummary: vi.fn(),
  useHyperliquidPositions: vi.fn(),
  useHyperliquidLeverageLimits: vi.fn(),
  useRebalanceHyperliquidPositions: vi.fn(),
}))

vi.mock("@/hooks/useWallet", () => ({
  useWallet: vi.fn(() => ({
    networkMode: () => "testnet",
    isConnected: () => true,
  })),
}))

const readonlyPortfolioActions = vi.hoisted(() => ({
  addAddress: vi.fn(),
  removeAddress: vi.fn(),
  setIncludeInBeta: vi.fn(),
  clearAddresses: vi.fn(),
}))

vi.mock("./useReadonlyPortfolioState", () => ({
  useReadonlyPortfolioState: vi.fn(() => ({
    rows: [],
    betaPositions: [],
    isLoading: false,
    error: null,
    validationError: null,
    addAddress: readonlyPortfolioActions.addAddress,
    removeAddress: readonlyPortfolioActions.removeAddress,
    setIncludeInBeta: readonlyPortfolioActions.setIncludeInBeta,
    clearAddresses: readonlyPortfolioActions.clearAddresses,
  })),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}

describe("usePortfolioState", () => {
  const mutate = vi.fn()
  const refetchPositions = vi.fn()
  const refetchAccountSummary = vi.fn()
  let settledOrders: Array<{
    symbol: string
    side: "buy" | "sell"
    status: "filled" | "timed_out" | "failed"
    message?: string
  }>

  const exchangePositions = {
    positions: [
      {
        symbol: "BTC/USDC:USDC",
        side: "buy" as const,
        leverage: 2,
        notional: 600,
        percentage: 60,
      },
      {
        symbol: "ETH/USDC:USDC",
        side: "buy" as const,
        leverage: 3,
        notional: 400,
        percentage: 40,
      },
    ],
    totalNotional: 1000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    settledOrders = [
      { symbol: "BTC/USDC:USDC", side: "buy", status: "filled" },
      { symbol: "ETH/USDC:USDC", side: "buy", status: "filled" },
    ]
    refetchPositions.mockResolvedValue({ data: exchangePositions })
    refetchAccountSummary.mockResolvedValue({
      data: {
        accountValue: 1000,
        totalNotionalPosition: 1000,
        withdrawable: 500,
        crossAccountLeverage: 1,
      },
    })
    mutate.mockImplementation((_payload, options) => {
      options?.onSettled?.(settledOrders, null)
    })

    vi.mocked(useHyperliquidAccountSummary).mockReturnValue({
      data: {
        accountValue: 1000,
        totalNotionalPosition: 1000,
        withdrawable: 500,
        crossAccountLeverage: 1,
      },
      isLoading: false,
      refetch: refetchAccountSummary,
    } as ReturnType<typeof useHyperliquidAccountSummary>)

    vi.mocked(useHyperliquidPositions).mockReturnValue({
      data: exchangePositions,
      isLoading: false,
      refetch: refetchPositions,
    } as ReturnType<typeof useHyperliquidPositions>)

    vi.mocked(useHyperliquidLeverageLimits).mockReturnValue({
      data: [
        { symbol: "BTC/USDC:USDC", maxLeverage: 5 },
        { symbol: "ETH/USDC:USDC", maxLeverage: 7 },
        { symbol: "SOL/USDC:USDC", maxLeverage: 10 },
      ],
      isLoading: false,
    } as ReturnType<typeof useHyperliquidLeverageLimits>)

    vi.mocked(useRebalanceHyperliquidPositions).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRebalanceHyperliquidPositions>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("exports MIN_USD", () => {
    expect(MIN_USD).toBe(11)
  })

  it("loads current and target portfolios from exchange positions", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.currentPortfolio)).toHaveLength(2)
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    expect(result.currentPortfolio["BTC/USDC:USDC"]?.notional).toBe(600)
    expect(result.targetPortfolio["ETH/USDC:USDC"]?.notional).toBe(400)
    expect(result.currentTotalNotional).toBe(1000)
    expect(result.targetTotalNotional).toBe(1000)
  })

  it("adds and removes token in target portfolio", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    result.handleAddToken("SOL/USDC:USDC")
    expect(result.targetPortfolio["SOL/USDC:USDC"]?.notional).toBe(MIN_USD)

    result.handleRemoveToken("SOL/USDC:USDC")
    expect(result.targetPortfolio["SOL/USDC:USDC"]).toBeUndefined()
  })

  it("clamps per-symbol leverage to max from leverage limits", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toContain("BTC/USDC:USDC")
    })

    result.handleLeverageChange("BTC/USDC:USDC", 999)
    expect(result.targetPortfolio["BTC/USDC:USDC"]?.leverage).toBe(5)
  })

  it("builds staged trades from diff after target changes", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    result.handleNotionalChange("BTC/USDC:USDC", 700)

    await waitFor(() => {
      expect(result.stagedTrades.length).toBeGreaterThan(0)
    })

    expect(result.stagedTrades[0]?.underlying).toBe("BTC/USDC:USDC")
  })

  it("blocks submit in non-precise mode when delta is below minimum", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toContain("BTC/USDC:USDC")
    })

    result.handleNotionalChange("BTC/USDC:USDC", 605)
    await waitFor(() => {
      expect(result.symbolsDeltaBelowMinimum).toContain("BTC/USDC:USDC")
    })

    expect(result.canSubmit).toBe(false)
  })

  it("allows submit in precise mode for small deltas", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toContain("BTC/USDC:USDC")
    })

    result.setIsPrecise(true)

    result.handleNotionalChange("BTC/USDC:USDC", 605)
    await waitFor(() => {
      expect(result.symbolsDeltaBelowMinimum).toContain("BTC/USDC:USDC")
    })

    expect(result.canSubmit).toBe(true)
  })

  it("allows submitting a full close to cash", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    result.setManualWeightEntry(true)
    result.handleWeightChange("BTC/USDC:USDC", 0)
    result.handleWeightChange("ETH/USDC:USDC", 0)

    expect(result.targetAllocationPercent).toBe(0)
    expect(result.symbolsBelowMinimum).toEqual([])
    expect(result.symbolsDeltaBelowMinimum).toEqual([])
    expect(result.canSubmit).toBe(true)

    result.handleRebalancePositions()

    expect(mutate).toHaveBeenCalledWith(
      {
        actions: [
          { kind: "close", symbol: "BTC/USDC:USDC", side: "buy" },
          { kind: "close", symbol: "ETH/USDC:USDC", side: "buy" },
        ],
      },
      expect.objectContaining({
        onSettled: expect.any(Function),
      }),
    )

    await waitFor(() => {
      expect(refetchPositions).toHaveBeenCalled()
      expect(result.isRebalancing).toBe(false)
    })
  })

  it("allows full close when every target position is dust", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    result.handleNotionalChange("BTC/USDC:USDC", 0.006)
    result.handleNotionalChange("ETH/USDC:USDC", 0.006)

    expect(result.symbolsBelowMinimum).toEqual([])
    expect(result.symbolsDeltaBelowMinimum).toEqual([])
    expect(result.canSubmit).toBe(true)
  })

  it("redistributes other positions when weight redistribution is enabled", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    const beforeEth = result.targetPortfolio["ETH/USDC:USDC"]?.notional ?? 0
    result.handleWeightChange("BTC/USDC:USDC", 80)
    const afterEth = result.targetPortfolio["ETH/USDC:USDC"]?.notional ?? 0

    expect(afterEth).toBeLessThan(beforeEth)
    expect(result.targetPortfolio["BTC/USDC:USDC"]?.notional).toBeCloseTo(
      800,
      3,
    )
  })

  it("clears readonly btc addresses when resetting for network change", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    result.resetPortfolioStateForNetworkChange()

    expect(readonlyPortfolioActions.clearAddresses).toHaveBeenCalledOnce()
  })

  it("clears readonly btc addresses when disconnecting", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    result.handleDisconnect()

    expect(readonlyPortfolioActions.clearAddresses).toHaveBeenCalledOnce()
  })

  it("submits rebalance payload with actions; precise toggle shapes diff not the API body", async () => {
    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toContain("BTC/USDC:USDC")
    })

    result.setIsPrecise(true)
    result.setManualWeightEntry(true)

    result.handleNotionalChange("BTC/USDC:USDC", 700)
    result.handleRebalancePositions()

    expect(mutate).toHaveBeenCalledWith(
      {
        actions: [
          expect.objectContaining({
            kind: "rebalance",
            symbol: "BTC/USDC:USDC",
            signedNotionalDelta: 100,
            leverage: 2,
            leverageChanged: false,
          }),
        ],
      },
      expect.objectContaining({
        onSettled: expect.any(Function),
      }),
    )

    await waitFor(() => {
      expect(refetchPositions).toHaveBeenCalled()
      expect(result.isRebalancing).toBe(false)
    })
  })

  it("populates errorsBySymbol and stagedTrades.orderError on non-filled and timed_out rebalance orders", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    // Generate rebalance actions (not close) for both symbols.
    result.handleNotionalChange("BTC/USDC:USDC", 700)
    result.handleNotionalChange("ETH/USDC:USDC", 300)

    await waitFor(() => {
      expect(result.stagedTrades.length).toBeGreaterThan(0)
    })

    settledOrders = [
      {
        symbol: "BTC/USDC:USDC",
        side: "buy",
        status: "timed_out",
      },
      {
        symbol: "ETH/USDC:USDC",
        side: "sell",
        status: "failed",
        message: "Order rejected: below minimum notional",
      },
    ]

    result.handleRebalancePositions()

    await waitFor(() => {
      expect(refetchPositions).toHaveBeenCalled()
      expect(result.isRebalancing).toBe(false)
    })

    expect(result.errorsBySymbol["BTC/USDC:USDC"]).toBe(
      "Order did not confirm in time — portfolio was refreshed from the exchange",
    )
    expect(result.errorsBySymbol["ETH/USDC:USDC"]).toBe(
      "Order rejected: below minimum notional",
    )

    const btcTrade = result.stagedTrades.find(
      trade => trade.underlying === "BTC/USDC:USDC",
    )
    const ethTrade = result.stagedTrades.find(
      trade => trade.underlying === "ETH/USDC:USDC",
    )

    expect(btcTrade).toBeDefined()
    expect(ethTrade).toBeDefined()

    expect(btcTrade?.orderError).toBe(
      "Order did not confirm in time — portfolio was refreshed from the exchange",
    )
    expect(ethTrade?.orderError).toBe("Order rejected: below minimum notional")

    expect(consoleWarn).toHaveBeenCalledWith(
      "rebalance order watch timed out; portfolio refreshed from exchange",
    )
  })

  it("clears an existing symbol rebalance error when handlers change side, leverage, notional, or weight", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => usePortfolioState(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(Object.keys(result.targetPortfolio)).toHaveLength(2)
    })

    // Generate a rebalance action for BTC.
    result.handleNotionalChange("BTC/USDC:USDC", 700)

    await waitFor(() => {
      expect(
        result.stagedTrades.some(t => t.underlying === "BTC/USDC:USDC"),
      ).toBe(true)
    })

    const repopulateBtcError = async () => {
      settledOrders = [
        {
          symbol: "BTC/USDC:USDC",
          side: "buy",
          status: "failed",
        },
      ]
      result.handleRebalancePositions()

      await waitFor(() => {
        expect(result.errorsBySymbol["BTC/USDC:USDC"]).toBe(
          "Order was not filled",
        )
        const btcTrade = result.stagedTrades.find(
          trade => trade.underlying === "BTC/USDC:USDC",
        )
        expect(btcTrade).toBeDefined()
        expect(btcTrade?.orderError).toBe("Order was not filled")
        expect(result.isRebalancing).toBe(false)
      })
    }

    await repopulateBtcError()

    result.handleSideChange("BTC/USDC:USDC", "sell")
    await waitFor(() => {
      expect(result.errorsBySymbol["BTC/USDC:USDC"]).toBeUndefined()
      const btcTrade = result.stagedTrades.find(
        trade => trade.underlying === "BTC/USDC:USDC",
      )
      expect(btcTrade).toBeDefined()
      expect(btcTrade?.orderError).toBeUndefined()
    })

    await repopulateBtcError()

    result.handleLeverageChange("BTC/USDC:USDC", 4)
    await waitFor(() => {
      expect(result.errorsBySymbol["BTC/USDC:USDC"]).toBeUndefined()
      const btcTrade = result.stagedTrades.find(
        trade => trade.underlying === "BTC/USDC:USDC",
      )
      expect(btcTrade).toBeDefined()
      expect(btcTrade?.orderError).toBeUndefined()
    })

    await repopulateBtcError()

    result.handleNotionalChange("BTC/USDC:USDC", 710)
    await waitFor(() => {
      expect(result.errorsBySymbol["BTC/USDC:USDC"]).toBeUndefined()
      const btcTrade = result.stagedTrades.find(
        trade => trade.underlying === "BTC/USDC:USDC",
      )
      expect(btcTrade).toBeDefined()
      expect(btcTrade?.orderError).toBeUndefined()
    })

    await repopulateBtcError()

    result.handleWeightChange("BTC/USDC:USDC", 80)
    await waitFor(() => {
      expect(result.errorsBySymbol["BTC/USDC:USDC"]).toBeUndefined()
      const btcTrade = result.stagedTrades.find(
        trade => trade.underlying === "BTC/USDC:USDC",
      )
      expect(btcTrade).toBeDefined()
      expect(btcTrade?.orderError).toBeUndefined()
    })

    expect(consoleWarn).not.toHaveBeenCalled()
  })
})
