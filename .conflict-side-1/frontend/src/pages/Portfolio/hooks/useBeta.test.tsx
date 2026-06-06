import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"

import type { PortfolioInterface } from "./usePortfolioState"
import { useBeta, type BetaBenchmark } from "./useBeta"
import type { ReadonlyBetaPosition } from "./useReadonlyPortfolioState"

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}

const targetPortfolio = (): Record<string, PortfolioInterface | undefined> => ({
  "BTC/USDC:USDC": {
    symbol: "BTC/USDC:USDC",
    side: "buy",
    leverage: 1,
    notional: 60,
  },
  "ETH/USDC:USDC": {
    symbol: "ETH/USDC:USDC",
    side: "buy",
    leverage: 1,
    notional: 40,
  },
})
const targetTotalNotional = () => 100

const bitcoinBetaBenchmark: BetaBenchmark = {
  symbol: "BTC",
  label: "BTC perpetual on Hyperliquid",
  interval: "daily log returns",
  lookback: "365 calendar days",
}

describe("useBeta", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        beta: 1.23,
        excluded_symbols: [],
        effective_weights: { BTC: 0.6, ETH: 0.4 },
        data_age_hours: 2,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("includes readonly btc notional in beta weights when includeInBeta is true", async () => {
    const readonlyPositions = (): ReadonlyBetaPosition[] => [
      {
        symbol: "BTC",
        side: "buy",
        notionalUsd: 100,
        includeInBeta: true,
      },
    ]

    const { result } = renderHook(
      () =>
        useBeta(
          targetPortfolio,
          targetTotalNotional,
          readonlyPositions,
          () => bitcoinBetaBenchmark,
        ),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(1.23)
    })

    const callBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)) as {
      weights: Record<string, number>
    }
    expect(callBody.weights.BTC).toBeCloseTo(0.8, 6)
    expect(callBody.weights.ETH).toBeCloseTo(0.2, 6)
  })

  it("excludes readonly btc notional from beta weights when includeInBeta is false", async () => {
    const readonlyPositions = (): ReadonlyBetaPosition[] => [
      {
        symbol: "BTC",
        side: "buy",
        notionalUsd: 100,
        includeInBeta: false,
      },
    ]

    const { result } = renderHook(
      () =>
        useBeta(
          targetPortfolio,
          targetTotalNotional,
          readonlyPositions,
          () => bitcoinBetaBenchmark,
        ),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(1.23)
    })

    const callBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)) as {
      weights: Record<string, number>
    }
    expect(callBody.weights.BTC).toBeCloseTo(0.6, 6)
    expect(callBody.weights.ETH).toBeCloseTo(0.4, 6)
  })

  it("surfaces excluded symbols from the beta report", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        beta: 0.75,
        excluded_symbols: ["NEWCOIN"],
        effective_weights: { BTC: 1 },
        data_age_hours: 26,
      }),
    })

    const { result } = renderHook(
      () =>
        useBeta(
          targetPortfolio,
          targetTotalNotional,
          () => [],
          () => bitcoinBetaBenchmark,
        ),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(0.75)
    })

    expect(result.excludedSymbols).toEqual(["NEWCOIN"])
    expect(result.effectiveWeights).toEqual({ BTC: 1 })
    expect(result.dataAgeHours).toBe(26)
    expect(result.isDataStale).toBe(true)
  })

  it("uses the selected benchmark for the request and methodology labels", async () => {
    const selectedBenchmark: BetaBenchmark = {
      symbol: "SPY",
      label: "SPY ETF",
      interval: "weekly log returns",
      lookback: "52 calendar weeks",
    }

    const { result } = renderHook(
      () =>
        useBeta(
          targetPortfolio,
          targetTotalNotional,
          () => [],
          () => selectedBenchmark,
        ),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(1.23)
    })

    const callBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)) as {
      benchmark: string
    }

    expect(callBody.benchmark).toBe("SPY")
    expect(result.methodology).toEqual({
      exposureLabel: "B to SPY",
      benchmark: "SPY ETF",
      interval: "weekly log returns",
      lookback: "52 calendar weeks",
    })
  })

  it("does not mark beta data stale at the 24 hour boundary", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        beta: 0.75,
        excluded_symbols: [],
        effective_weights: { BTC: 1 },
        data_age_hours: 24,
      }),
    })

    const { result } = renderHook(
      () =>
        useBeta(
          targetPortfolio,
          targetTotalNotional,
          () => [],
          () => bitcoinBetaBenchmark,
        ),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(0.75)
    })

    expect(result.dataAgeHours).toBe(24)
    expect(result.isDataStale).toBe(false)
  })

  it("uses the selected benchmark for the request and methodology labels", async () => {
    const selectedBenchmark: BetaBenchmark = {
      symbol: "SPY",
      label: "SPY ETF",
      interval: "weekly log returns",
      lookback: "52 calendar weeks",
    }

    const { result } = renderHook(
      () =>
        useBeta(
          targetPortfolio,
          targetTotalNotional,
          () => [],
          () => selectedBenchmark,
        ),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(1.23)
    })

    const callBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)) as {
      benchmark: string
    }

    expect(callBody.benchmark).toBe("SPY")
    expect(result.methodology).toEqual({
      exposureLabel: "B to SPY",
      benchmark: "SPY ETF",
      interval: "weekly log returns",
      lookback: "52 calendar weeks",
    })
  })
})
