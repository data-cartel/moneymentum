import type { FactorScore } from "../../hooks/useFactorScores"
import type { PortfolioInterface } from "../../hooks/usePortfolioState"

export interface AllSymbolRowData {
  symbol: string
  baseSymbol: string
  fundingRateAnnualized: number | null
  beta: number | null
  volatility: number | null
  sharpe: number | null
  sortino: number | null
  momentum: number | null
  carry: number | null
}

export type AllSymbolPortfolioState = "absent" | "target" | "closing"

export type AllSymbolClickAction = "add" | "remove" | "undoRemove"

export const allSymbolPortfolioState = (
  symbol: string,
  targetPortfolio: Record<string, PortfolioInterface | undefined>,
  deletedArchive: Record<string, PortfolioInterface | undefined>,
): AllSymbolPortfolioState => {
  if (targetPortfolio[symbol]) return "target"
  if (deletedArchive[symbol] !== undefined) return "closing"
  return "absent"
}

export const resolveAllSymbolClick = (
  state: AllSymbolPortfolioState,
): AllSymbolClickAction => {
  switch (state) {
    case "target":
      return "remove"
    case "closing":
      return "undoRemove"
    case "absent":
      return "add"
  }
}

export const formatPercent = (value: number | null, digits = 2): string => {
  if (value === null) return "—"
  return `${(value * 100).toFixed(digits)}%`
}

export const formatDecimal = (value: number | null, digits = 2): string => {
  if (value === null) return "—"
  return value.toFixed(digits)
}

export const fundingRateClassName = (rate: number | null): string => {
  if (rate === null || rate === 0) return "text-muted-foreground"
  return rate > 0 ? "text-emerald-500" : "text-rose-500"
}

export const signedMetricClassName = (value: number | null): string => {
  if (value === null) return "text-muted-foreground"
  if (value > 0) return "text-positive"
  if (value < 0) return "text-negative"
  return "text-muted-foreground"
}

export const riskAdjustedReturnClassName = (value: number | null): string => {
  if (value === null) return "text-muted-foreground"
  if (value >= 1) return "text-positive"
  if (value > 0) return "text-emerald-400"
  if (value < 0) return "text-negative"
  return "text-muted-foreground"
}

export const betaClassName = (value: number | null): string => {
  if (value === null) return "text-muted-foreground"
  if (value >= 1.5) return "text-amber-400"
  if (value <= 0.5) return "text-violet-400"
  return "text-sky-400"
}

export const volatilityClassName = (value: number | null): string => {
  if (value === null) return "text-muted-foreground"
  if (value >= 0.8) return "text-rose-400"
  if (value >= 0.5) return "text-amber-400"
  return "text-violet-400"
}

export const annualizedFundingRate = (
  hourlyRate: number | undefined,
): number | null => {
  if (hourlyRate === undefined) return null
  return hourlyRate * 24 * 365
}

export const buildAllSymbolRows = (
  symbols: string[],
  factorScores: FactorScore[],
  fundingRatesByBaseSymbol?: Record<string, number>,
): AllSymbolRowData[] => {
  const factorsByTicker = new Map(
    factorScores.map(score => [score.ticker, score]),
  )

  return symbols.map(symbol => {
    const baseSymbol = symbol.split("/")[0] ?? symbol
    const factors = factorsByTicker.get(baseSymbol)

    return {
      symbol,
      baseSymbol,
      fundingRateAnnualized: annualizedFundingRate(
        fundingRatesByBaseSymbol?.[baseSymbol],
      ),
      beta: factors?.beta ?? null,
      volatility: factors?.annualized_volatility ?? null,
      sharpe: factors?.sharpe ?? null,
      sortino: factors?.sortino ?? null,
      momentum: factors?.cum_return ?? null,
      carry: factors?.carry ?? null,
    }
  })
}

export const filterAllSymbolRows = (
  rows: AllSymbolRowData[],
  searchQuery: string,
): AllSymbolRowData[] => {
  const query = searchQuery.trim().toLowerCase()
  if (query === "") return rows

  return rows.filter(
    row =>
      row.baseSymbol.toLowerCase().includes(query) ||
      row.symbol.toLowerCase().includes(query),
  )
}
