import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"

import type { PortfolioInterface } from "./usePortfolioState"
import {
  useBeta,
  type BetaBenchmark,
  type ReadonlyBetaEntry,
} from "./useBeta"

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

  it("sends exchange positions and readonly btc as separate beta sources", async () => {
    const readonlyEntries = (): ReadonlyBetaEntry[] => [
      {
        address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
        includeInBeta: true,
      },
    ]

    const { result } = renderHook(
      () =>
        useBeta(targetPortfolio, readonlyEntries, () => bitcoinBetaBenchmark),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(1.23)
    })

    const callBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))
    expect(callBody).toEqual({
      positions: [
        {
          symbol: "BTC/USDC:USDC",
          side: "buy",
          notionalUsd: "60",
        },
        {
          symbol: "ETH/USDC:USDC",
          side: "buy",
          notionalUsd: "40",
        },
      ],
      readOnlyBtc: [
        {
          address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
          includeInBeta: true,
        },
      ],
      benchmark: "BTC",
    })
  })

  it("preserves excluded readonly btc entries for backend diagnostics", async () => {
    const readonlyEntries = (): ReadonlyBetaEntry[] => [
      {
        address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
        includeInBeta: false,
      },
    ]

    const { result } = renderHook(
      () =>
        useBeta(targetPortfolio, readonlyEntries, () => bitcoinBetaBenchmark),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(1.23)
    })

    const callBody = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)) as {
      readOnlyBtc: ReadonlyBetaEntry[]
    }
    expect(callBody.readOnlyBtc).toEqual(readonlyEntries())
  })

  it.each([
    "missing_bitcoin_balance",
    "btc_price_unavailable",
  ] as const)("surfaces the %s degraded reason", async degradedReason => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: degradedReason }),
    })

    const { result } = renderHook(
      () => useBeta(targetPortfolio, () => [], () => bitcoinBetaBenchmark),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.degradedReason).toBe(degradedReason)
    })
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
      () => useBeta(targetPortfolio, () => [], () => bitcoinBetaBenchmark),
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
      () => useBeta(targetPortfolio, () => [], () => selectedBenchmark),
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
      () => useBeta(targetPortfolio, () => [], () => bitcoinBetaBenchmark),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.beta).toBe(0.75)
    })

    expect(result.dataAgeHours).toBe(24)
    expect(result.isDataStale).toBe(false)
  })
})
