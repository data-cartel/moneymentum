import { useQuery } from "@tanstack/solid-query"

export interface FactorScore {
  ticker: string
  beta: number | null
  annualized_volatility: number | null
  sharpe: number | null
  sortino: number | null
  cum_return: number | null
  carry: number | null
}

const parseNullableNumberField = (
  record: Record<string, unknown>,
  field: keyof Omit<FactorScore, "ticker">,
  ticker: string,
): number | null => {
  if (!(field in record)) {
    throw new Error(`invalid factor score for ${ticker}: missing ${field}`)
  }

  const value = record[field]
  if (value === null) return null
  if (typeof value === "number" && Number.isFinite(value)) return value

  throw new Error(
    `invalid factor score for ${ticker}: ${field} must be a finite number or null`,
  )
}

const parseFactorScore = (value: unknown): FactorScore => {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid factor score: expected an object")
  }

  const record = value as Record<string, unknown>
  if (typeof record.ticker !== "string" || record.ticker.length === 0) {
    throw new Error("invalid factor score: ticker must be a non-empty string")
  }

  const ticker = record.ticker

  return {
    ticker,
    beta: parseNullableNumberField(record, "beta", ticker),
    annualized_volatility: parseNullableNumberField(
      record,
      "annualized_volatility",
      ticker,
    ),
    sharpe: parseNullableNumberField(record, "sharpe", ticker),
    sortino: parseNullableNumberField(record, "sortino", ticker),
    cum_return: parseNullableNumberField(record, "cum_return", ticker),
    carry: parseNullableNumberField(record, "carry", ticker),
  }
}

export const parseFactorScores = (value: unknown): FactorScore[] => {
  if (!Array.isArray(value)) {
    throw new Error("invalid factor scores response: expected a JSON array")
  }

  return value.map(parseFactorScore)
}

const FACTORS_TIMEFRAME = "1d"

export const useFactorScores = () => {
  return useQuery<FactorScore[]>(() => ({
    queryKey: ["factorScores", FACTORS_TIMEFRAME],
    queryFn: async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}api/factors/${FACTORS_TIMEFRAME}`,
      )
      if (!response.ok) {
        throw new Error(
          `factor scores request failed: ${String(response.status)}`,
        )
      }
      const payload: unknown = await response.json()
      return parseFactorScores(payload)
    },
    staleTime: 60_000,
  }))
}
