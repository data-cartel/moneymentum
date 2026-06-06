export interface TimeSeriesPoint {
  time: number
  value: number
}

export type ChartType = "area" | "line" | "histogram"

export interface MetricDefinition {
  id: string
  name: string
  compute: (data: TimeSeriesPoint[], windowDays?: number) => TimeSeriesPoint[]
  chartType: ChartType
  color: string
  negativeColor?: string
}

export interface WindowConfig {
  id: string
  label: string
  days: number
}

import {
  identity,
  computeDailyReturns,
  computeDrawdown,
  computeRollingSharpe,
  computeRollingSortino,
  computeRollingVolatility,
  computeCumulativeReturns,
} from "./computations"

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  equity: {
    id: "equity",
    name: "Equity Curve",
    compute: identity,
    chartType: "area",
    color: "#22c55e",
  },
  cumulativeReturns: {
    id: "cumulativeReturns",
    name: "Cumulative Returns",
    compute: computeCumulativeReturns,
    chartType: "area",
    color: "#22c55e",
  },
  returns: {
    id: "returns",
    name: "Daily Returns",
    compute: computeDailyReturns,
    chartType: "histogram",
    color: "#22c55e",
    negativeColor: "#ef4444",
  },
  drawdown: {
    id: "drawdown",
    name: "Drawdown",
    compute: computeDrawdown,
    chartType: "area",
    color: "#ef4444",
  },
  sharpe: {
    id: "sharpe",
    name: "Rolling Sharpe",
    compute: computeRollingSharpe,
    chartType: "line",
    color: "#3b82f6",
  },
  sortino: {
    id: "sortino",
    name: "Rolling Sortino",
    compute: computeRollingSortino,
    chartType: "line",
    color: "#8b5cf6",
  },
  volatility: {
    id: "volatility",
    name: "Rolling Volatility",
    compute: computeRollingVolatility,
    chartType: "line",
    color: "#f59e0b",
  },
}

export const WINDOW_OPTIONS: WindowConfig[] = [
  { id: "7d", label: "7d", days: 7 },
  { id: "14d", label: "14d", days: 14 },
  { id: "30d", label: "30d", days: 30 },
  { id: "60d", label: "60d", days: 60 },
  { id: "90d", label: "90d", days: 90 },
]

export const METRIC_OPTIONS = Object.values(METRIC_REGISTRY)

export const getMetricById = (id: string): MetricDefinition | undefined =>
  METRIC_REGISTRY[id]
