import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { Timeframe } from "@/components/ui/timeframe-select"
import { fetchJson, postJson, postEmpty, fetchStreamChecked } from "@/lib/http"

export class MissingTickerError extends Data.TaggedError("MissingTickerError")<
  Record<string, never>
> {}

export class EmptyStreamError extends Data.TaggedError("EmptyStreamError")<
  Record<string, never>
> {}

export class StreamReadError extends Data.TaggedError("StreamReadError")<{
  readonly cause: unknown
}> {}

export class ApiMessageError extends Data.TaggedError("ApiMessageError")<{
  readonly message: string
}> {}

export type TradingData = {
  timestamp: string
  close: number
  volume: number
  ticker: string
  log_return: number | null
  cum_return: number | null
  autocorrelation: number | null
  stddev: number | null
  annualized_volatility: number | null
  sma: number | null
  mean_return: number | null
  price_stddev: number | null
  return_stddev: number | null
  price_zscore: number | null
  covariance: number | null
  beta: number | null
  information_discreteness: number | null
  sharpe: number | null
  log_return_above_mar: number | null
  downside_deviation: number | null
  sortino: number | null
}

export interface DateRange {
  min_date: string
  max_date: string
  last_timestamp: string | null
}

export interface AnalysisDataParams {
  startDate: string
  endDate: string
  timeframe: Timeframe
}

const fetchDateRange = (timeframe: Timeframe, signal: AbortSignal) =>
  fetchJson<DateRange>(`/api/date-range?timeframe=${timeframe}`, { signal })

const fetchAnalysisData = (
  timeframe: Timeframe,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) =>
  postJson<{ data: TradingData[]; message: string | null }>(
    `/api/data?timeframe=${timeframe}`,
    {
      start_date: `${startDate}T00:00:00Z`,
      end_date: `${endDate}T23:59:59Z`,
    },
    { signal },
  )

const fetchTokenData = (
  ticker: string | undefined,
  timeframe: Timeframe,
  signal: AbortSignal,
) =>
  Effect.Do.pipe(
    Effect.bind("tickerValue", () =>
      ticker ? Effect.succeed(ticker) : Effect.fail(new MissingTickerError()),
    ),
    Effect.flatMap(({ tickerValue }) =>
      fetchJson<{ data: TradingData[]; message?: string }>(
        `/api/token/${encodeURIComponent(tickerValue)}?timeframe=${timeframe}`,
        { signal },
      ),
    ),
    Effect.flatMap(tokenResponse =>
      tokenResponse.message
        ? Effect.fail(new ApiMessageError({ message: tokenResponse.message }))
        : Effect.succeed(tokenResponse),
    ),
  )

const streamReload = (mode: string) =>
  fetchStreamChecked("/api/reload_data/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).pipe(
    Effect.flatMap(response =>
      response.body
        ? Effect.succeed(response.body)
        : Effect.fail(new EmptyStreamError()),
    ),
    Effect.flatMap(body =>
      Effect.tryPromise({
        try: async () => {
          const reader = body.getReader()
          const decoder = new TextDecoder("utf-8")
          try {
            let done = false
            while (!done) {
              const readResult = await reader.read()
              done = readResult.done
              if (readResult.value) {
                console.log(decoder.decode(readResult.value, { stream: true }))
              }
            }
          } finally {
            reader.releaseLock()
          }
        },
        catch: cause => new StreamReadError({ cause }),
      }),
    ),
  )

const fetchBudgetPreference = (signal: AbortSignal) =>
  fetchJson<{ budget: number }>("/api/hyperliquid/budget-preference", {
    signal,
  })

const saveBudgetPreference = (payload: { budget: number }) =>
  postJson("/api/hyperliquid/budget-preference", payload).pipe(Effect.asVoid)

export const useDateRange = (timeframe: () => Timeframe) =>
  useQuery<DateRange>(() => ({
    queryKey: ["dateRange", timeframe()],
    queryFn: ({ signal }) =>
      Effect.runPromise(fetchDateRange(timeframe(), signal)),
  }))

export const useAnalysisData = (params: () => AnalysisDataParams) =>
  useQuery<{ data: TradingData[]; message: string | null }>(() => {
    const { startDate, endDate, timeframe } = params()
    return {
      queryKey: ["analysisData", timeframe, startDate, endDate],
      queryFn: ({ signal }) =>
        Effect.runPromise(
          fetchAnalysisData(timeframe, startDate, endDate, signal),
        ),
      enabled: !!startDate && !!endDate,
    }
  })

export const useTokenData = (
  ticker: () => string | undefined,
  timeframe: () => Timeframe,
) =>
  useQuery<{ data: TradingData[]; message?: string }>(() => ({
    queryKey: ["tokenData", ticker(), timeframe()],
    queryFn: ({ signal }) =>
      Effect.runPromise(fetchTokenData(ticker(), timeframe(), signal)),
    enabled: !!ticker(),
  }))

export const useReloadData = () => {
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: ({ mode }: { mode: string }) =>
      Effect.runPromise(streamReload(mode)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["analysisData"] })
      void queryClient.invalidateQueries({ queryKey: ["tokenData"] })
      void queryClient.invalidateQueries({ queryKey: ["dateRange"] })
    },
  }))
}

export const useStopReload = () =>
  useMutation(() => ({
    mutationFn: () => Effect.runPromise(postEmpty("/api/stop_reload")),
  }))

export const useBudgetPreference = () =>
  useQuery<{ budget: number }>(() => ({
    queryKey: ["hyperliquid", "budget-preference"],
    queryFn: ({ signal }) => Effect.runPromise(fetchBudgetPreference(signal)),
  }))

export const useSaveBudgetPreference = () => {
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: (payload: { budget: number }) =>
      Effect.runPromise(saveBudgetPreference(payload)),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["hyperliquid", "budget-preference"],
      })
    },
  }))
}
