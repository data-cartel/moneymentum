import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { Timeframe } from "@/components/ui/timeframe-select"

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

interface ApiError {
  detail?: string
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

export const useDateRange = (timeframe: () => Timeframe) => {
  return useQuery<DateRange>(() => ({
    queryKey: ["dateRange", timeframe()],
    queryFn: async () => {
      const response = await fetch(`/api/date-range?timeframe=${timeframe()}`)
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as ApiError
        throw new Error(
          errorData.detail ?? `HTTP error! status: ${String(response.status)}`,
        )
      }
      return response.json() as Promise<DateRange>
    },
  }))
}

export const useAnalysisData = (params: () => AnalysisDataParams) => {
  return useQuery<{ data: TradingData[]; message: string | null }>(() => {
    const { startDate, endDate, timeframe } = params()
    return {
      queryKey: ["analysisData", timeframe, startDate, endDate],
      queryFn: async () => {
        const startDateTime = `${startDate}T00:00:00Z`
        const endDateTime = `${endDate}T23:59:59Z`

        const response = await fetch(`/api/data?timeframe=${timeframe}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            start_date: startDateTime,
            end_date: endDateTime,
          }),
        })

        if (!response.ok) {
          const errorData = (await response
            .json()
            .catch(() => ({}))) as ApiError
          throw new Error(
            errorData.detail ??
              `HTTP error! status: ${String(response.status)}`,
          )
        }

        return response.json() as Promise<{
          data: TradingData[]
          message: string | null
        }>
      },
      enabled: !!startDate && !!endDate,
    }
  })
}

export const useTokenData = (
  ticker: () => string | undefined,
  timeframe: () => Timeframe,
) => {
  return useQuery<{ data: TradingData[]; message?: string }>(() => ({
    queryKey: ["tokenData", ticker(), timeframe()],
    queryFn: async () => {
      const t = ticker()
      if (!t) {
        throw new Error("Ticker is required")
      }

      const response = await fetch(
        `/api/token/${encodeURIComponent(t)}?timeframe=${timeframe()}`,
      )

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${String(response.status)}`)
      }

      const result = (await response.json()) as {
        data: TradingData[]
        message?: string
      }

      if (result.message) {
        throw new Error(result.message)
      }

      return result
    },
    enabled: !!ticker(),
  }))
}

export const useReloadData = () => {
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: async ({ mode }: { mode: string }) => {
      const controller = new AbortController()

      const response = await fetch("/api/reload_data/stream", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${String(response.status)}`)
      }

      if (!response.body) {
        throw new Error("No response body received")
      }

      const reader = response.body.getReader()
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["analysisData"] })
      void queryClient.invalidateQueries({ queryKey: ["tokenData"] })
      void queryClient.invalidateQueries({ queryKey: ["dateRange"] })
    },
  }))
}

export const useStopReload = () => {
  return useMutation(() => ({
    mutationFn: async () => {
      const response = await fetch("/api/stop_reload", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${String(response.status)}`)
      }
    },
  }))
}

export const useBudgetPreference = () => {
  return useQuery<{ budget: number }>(() => ({
    queryKey: ["hyperliquid", "budget-preference"],
    queryFn: async () => {
      const response = await fetch("/api/hyperliquid/budget-preference")
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as ApiError
        throw new Error(errorData.detail ?? "Unable to fetch budget preference")
      }
      return response.json() as Promise<{ budget: number }>
    },
  }))
}

export const useSaveBudgetPreference = () => {
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: async (payload: { budget: number }) => {
      const response = await fetch("/api/hyperliquid/budget-preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as ApiError
        throw new Error(errorData.detail ?? "Unable to save budget preference")
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["hyperliquid", "budget-preference"],
      })
    },
  }))
}
