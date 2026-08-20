import * as Effect from "effect/Effect"
import { useQuery } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import { getErrorMessage } from "@/lib/error-message"
import { postJson } from "@/lib/http"
import type { PortfolioInterface } from "./usePortfolioState"

export interface BetaBenchmark {
  symbol: string
  label: string
  interval: string
  lookback: string
}
const STALE_BETA_DATA_THRESHOLD_HOURS = 24

export interface ReadonlyBetaEntry {
  address: string
  includeInBeta: boolean
}

interface BetaPositionInput {
  symbol: string
  side: "buy" | "sell"
  notionalUsd: string
}

interface BetaRequest {
  positions: BetaPositionInput[]
  readOnlyBtc: ReadonlyBetaEntry[]
  benchmark: string
}

export type BetaDegradedReason =
  | "missing_bitcoin_balance"
  | "btc_price_unavailable"

const betaRequestFromPortfolio = (
  portfolio: Record<string, PortfolioInterface | undefined>,
  readonlyEntries: ReadonlyBetaEntry[],
  benchmark: string,
): BetaRequest => ({
  positions: Object.values(portfolio).flatMap(position =>
    position === undefined
      ? []
      : [
          {
            symbol: position.symbol,
            side: position.side,
            notionalUsd: String(position.notional),
          },
        ],
  ),
  readOnlyBtc: readonlyEntries,
  benchmark,
})

const degradedReasonFromError = (
  error: unknown,
): BetaDegradedReason | null => {
  const message = getErrorMessage(error)

  return message === "missing_bitcoin_balance" ||
    message === "btc_price_unavailable"
    ? message
    : null
}

interface BetaResponse {
  beta: number | null
  excluded_symbols: string[]
  effective_weights: Record<string, number>
  data_age_hours: number
}

const fetchBeta = (request: BetaRequest, signal?: AbortSignal) =>
  postJson<BetaResponse>(
    `${import.meta.env.BASE_URL}api/beta`,
    request,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    },
  )

export const useBeta = (
  portfolio: () => Record<string, PortfolioInterface | undefined>,
  readonlyEntries: () => ReadonlyBetaEntry[],
  selectedBenchmark: () => BetaBenchmark,
) => {
  const request = createMemo(() =>
    betaRequestFromPortfolio(
      portfolio(),
      readonlyEntries(),
      selectedBenchmark().symbol,
    ),
  )
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
    const currentRequest = request()
    const hasIncludedExposure =
      currentRequest.positions.length > 0 ||
      currentRequest.readOnlyBtc.some(entry => entry.includeInBeta)

    return {
      queryKey: ["beta", currentRequest] as const,
      queryFn: (ctx: { signal: AbortSignal }) =>
        Effect.runPromise(fetchBeta(currentRequest, ctx.signal)),
      enabled: hasIncludedExposure,
      retry: (failureCount: number, error: unknown) =>
        degradedReasonFromError(error) === null && failureCount < 2,
      placeholderData: (previousData: BetaResponse | undefined) => previousData,
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
    get degradedReason() {
      return degradedReasonFromError(query.error)
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
