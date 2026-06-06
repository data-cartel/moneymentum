import type { TimeSeriesPoint } from "./registry"

export const identity = (data: TimeSeriesPoint[]): TimeSeriesPoint[] => data

export const computeDailyReturns = (
  data: TimeSeriesPoint[],
): TimeSeriesPoint[] => {
  if (data.length < 2) return []

  return data.slice(1).map((point, i) => ({
    time: point.time,
    value: (point.value - data[i].value) / data[i].value,
  }))
}

export const computeDrawdown = (data: TimeSeriesPoint[]): TimeSeriesPoint[] => {
  if (data.length === 0) return []

  let peak = data[0].value
  return data.map(point => {
    if (point.value > peak) {
      peak = point.value
    }
    return {
      time: point.time,
      value: (point.value - peak) / peak,
    }
  })
}

const computeRollingMean = (values: number[]): number => {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

const computeRollingStd = (values: number[], mean: number): number => {
  if (values.length === 0) return 0
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

const computeRollingDownsideStd = (values: number[], mean: number): number => {
  if (values.length === 0) return 0
  const downsideValues = values.filter(v => v < mean)
  if (downsideValues.length === 0) return 0
  const variance =
    downsideValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    downsideValues.length
  return Math.sqrt(variance)
}

export const computeRollingSharpe = (
  data: TimeSeriesPoint[],
  windowDays: number = 30,
): TimeSeriesPoint[] => {
  const returns = computeDailyReturns(data)
  if (returns.length < windowDays) return []

  const annualizationFactor = Math.sqrt(252)
  const result: TimeSeriesPoint[] = []

  for (let i = windowDays - 1; i < returns.length; i++) {
    const window = returns.slice(i - windowDays + 1, i + 1).map(p => p.value)
    const mean = computeRollingMean(window)
    const std = computeRollingStd(window, mean)
    const sharpe = std > 0 ? (mean / std) * annualizationFactor : 0

    result.push({ time: returns[i].time, value: sharpe })
  }

  return result
}

export const computeRollingSortino = (
  data: TimeSeriesPoint[],
  windowDays: number = 30,
): TimeSeriesPoint[] => {
  const returns = computeDailyReturns(data)
  if (returns.length < windowDays) return []

  const annualizationFactor = Math.sqrt(252)
  const result: TimeSeriesPoint[] = []

  for (let i = windowDays - 1; i < returns.length; i++) {
    const window = returns.slice(i - windowDays + 1, i + 1).map(p => p.value)
    const mean = computeRollingMean(window)
    const downsideStd = computeRollingDownsideStd(window, 0)
    const sortino =
      downsideStd > 0 ? (mean / downsideStd) * annualizationFactor : 0

    result.push({ time: returns[i].time, value: sortino })
  }

  return result
}

export const computeRollingVolatility = (
  data: TimeSeriesPoint[],
  windowDays: number = 30,
): TimeSeriesPoint[] => {
  const returns = computeDailyReturns(data)
  if (returns.length < windowDays) return []

  const annualizationFactor = Math.sqrt(252)
  const result: TimeSeriesPoint[] = []

  for (let i = windowDays - 1; i < returns.length; i++) {
    const window = returns.slice(i - windowDays + 1, i + 1).map(p => p.value)
    const mean = computeRollingMean(window)
    const std = computeRollingStd(window, mean)

    result.push({ time: returns[i].time, value: std * annualizationFactor })
  }

  return result
}

export const computeCumulativeReturns = (
  data: TimeSeriesPoint[],
): TimeSeriesPoint[] => {
  if (data.length === 0) return []

  const initial = data[0].value
  return data.map(point => ({
    time: point.time,
    value: (point.value - initial) / initial,
  }))
}
