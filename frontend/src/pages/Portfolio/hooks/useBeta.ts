import * as Effect from "effect/Effect"
import { useQuery } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import { postJson } from "@/lib/http"
import { isPerpPosition, type PortfolioInterface } from "./usePortfolioState"
import type { ReadonlyBetaPosition } from "./useReadonlyPortfolioState"

export interface BetaBenchmark {
  symbol: string
  label: string
  interval: string
  lookback: string
}
const STALE_BETA_DATA_THRESHOLD_HOURS = 24

const symbolToTicker = (symbol: string): string =>
  symbol.includes("/") ? (symbol.split("/")[0] ?? symbol) : symbol

const weightsFromPortfolio = (
  portfolio: Record<string, PortfolioInterface | undefined>,
  readonlyPositions: ReadonlyBetaPosition[],
): Record<string, number> => {
  // Options and Derive perps are excluded from beta until we map underlyings.
  const exchangePositions = Object.values(portfolio).filter(
    (position): position is PortfolioInterface =>
      position !== undefined &&
      isPerpPosition(position) &&
      position.venue === "hyperliquid",
  )
  const includedReadonlyPositions = readonlyPositions.filter(
    position =>
      position.includeInBeta &&
      Number.isFinite(position.notionalUsd) &&
      position.notionalUsd > 0,
  )

  const readonlyTotalNotional = includedReadonlyPositions.reduce(
    (notionalSum, position) => notionalSum + position.notionalUsd,
    0,
  )
  const perpTotalNotional = exchangePositions.reduce(
    (sum, position) => sum + position.notional,
    0,
  )
  const totalNotional = perpTotalNotional + readonlyTotalNotional

  if (totalNotional <= 0) return {}

  const signedWeights: Record<string, number> = {}

  for (const position of exchangePositions) {
    const ticker = symbolToTicker(position.symbol)
    const signedWeight =
      (position.notional / totalNotional) * (position.side === "buy" ? 1 : -1)
    signedWeights[ticker] = (signedWeights[ticker] ?? 0) + signedWeight
  }

  for (const position of includedReadonlyPositions) {
    const signedWeight =
      (position.notionalUsd / totalNotional) *
      (position.side === "buy" ? 1 : -1)
    signedWeights[position.symbol] =
      (signedWeights[position.symbol] ?? 0) + signedWeight
  }

  return signedWeights
}

const queryKeyFromWeights = (weights: Record<string, number>): string =>
  Object.entries(weights)
    .sort(([leftTicker], [rightTicker]) =>
      leftTicker.localeCompare(rightTicker),
    )
    .map(([ticker, weight]) => `${ticker}:${weight}`)
    .join("|")

interface BetaResponse {
  beta: number | null
  excluded_symbols: string[]
  effective_weights: Record<string, number>
  data_age_hours: number
}

const fetchBeta = (
  weights: Record<string, number>,
  benchmark: string,
  signal?: AbortSignal,
) =>
  postJson<BetaResponse>(
    `${import.meta.env.BASE_URL}api/beta`,
    { weights, benchmark },
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    },
  )

export const useBeta = (
  portfolio: () => Record<string, PortfolioInterface | undefined>,
  readonlyPositions: () => ReadonlyBetaPosition[],
  selectedBenchmark: () => BetaBenchmark,
) => {
  const weights = createMemo(() =>
    weightsFromPortfolio(portfolio(), readonlyPositions()),
  )
  const weightsKey = createMemo(() => queryKeyFromWeights(weights()))
  const methodology = createMemo(() => {
    const benchmark = selectedBenchmark()

    return {
      exposureLabel: `B to ${benchmark.symbol}`,
      benchmark: benchmark.label,
      interval: benchmark.interval,
      lookback: benchmark.lookback,
    }
  })

  const query = useQuery(() => {
    const currentWeights = weights()
    const currentWeightsKey = weightsKey()
    const currentBenchmark = selectedBenchmark()
    const hasData = Object.keys(currentWeights).length > 0

    return {
      queryKey: ["beta", currentBenchmark.symbol, currentWeightsKey] as const,
      queryFn: (ctx: { signal: AbortSignal }) =>
        Effect.runPromise(
          fetchBeta(currentWeights, currentBenchmark.symbol, ctx.signal),
        ),
      enabled: hasData,
      retry: 2,
    }
  })

  return {
    get beta() {
      return query.data?.beta ?? null
    },
    get isLoading() {
      return query.isLoading
    },
    get error() {
      return query.error
    },
    get excludedSymbols() {
      return query.data?.excluded_symbols ?? []
    },
    get effectiveWeights() {
      return query.data?.effective_weights ?? {}
    },
    get dataAgeHours() {
      return query.data?.data_age_hours ?? null
    },
    get isDataStale() {
      return (
        query.data?.data_age_hours !== undefined &&
        query.data.data_age_hours > STALE_BETA_DATA_THRESHOLD_HOURS
      )
    },
    get methodology() {
      return methodology()
    },
  }
}

export { STALE_BETA_DATA_THRESHOLD_HOURS }
