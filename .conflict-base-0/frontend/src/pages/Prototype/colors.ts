export type FactorName =
  | "β to BTC"
  | "β to SPY"
  | "Momentum"
  | "Carry"
  | "Volatility"
  | "Idiosyncratic"

const FACTOR_CSS_VARS: Record<FactorName, string> = {
  "β to BTC": "var(--factor-btc-beta)",
  "β to SPY": "var(--factor-spy-beta)",
  "Momentum": "var(--factor-momentum)",
  "Carry": "var(--factor-carry)",
  "Volatility": "var(--factor-volatility)",
  "Idiosyncratic": "var(--factor-idiosyncratic)",
}

const FACTOR_HEX_FALLBACK: Record<FactorName, string> = {
  "β to BTC": "#3b82f6",
  "β to SPY": "#22c55e",
  "Momentum": "#f59e0b",
  "Carry": "#ef4444",
  "Volatility": "#8b5cf6",
  "Idiosyncratic": "#888888",
}

export const getFactorColor = (factor: string): string => {
  const color = FACTOR_HEX_FALLBACK[factor as FactorName] as string | undefined
  return color ?? "#888888"
}

export const getFactorCssVar = (factor: string): string => {
  const cssVar = FACTOR_CSS_VARS[factor as FactorName] as string | undefined
  return cssVar ?? "var(--factor-idiosyncratic)"
}

export const getCorrelationColorClass = (correlation: number): string => {
  if (correlation >= 0.7) return "bg-positive"
  if (correlation >= 0.3) return "bg-positive/60"
  if (correlation >= 0) return "bg-positive/30"
  if (correlation >= -0.3) return "bg-negative/30"
  if (correlation >= -0.7) return "bg-negative/60"
  return "bg-negative"
}

export const getValueTextClass = (value: number): string => {
  if (value > 0) return "text-positive"
  if (value < 0) return "text-negative"
  return "text-muted-foreground"
}

export const getValueBackgroundClass = (value: number): string => {
  if (value > 0) return "bg-positive"
  if (value < 0) return "bg-negative"
  return "bg-muted"
}

export const CHART_COLORS = {
  positive: "#22c55e",
  negative: "#ef4444",
  factorBtcBeta: "#3b82f6",
  factorSpyBeta: "#22c55e",
  factorMomentum: "#f59e0b",
  factorCarry: "#ef4444",
  factorVolatility: "#8b5cf6",
  factorIdiosyncratic: "#888888",
} as const
