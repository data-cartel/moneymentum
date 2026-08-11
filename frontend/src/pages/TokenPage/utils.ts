import type { TradingData } from "@/hooks/useApi"

export interface IOHLCData {
  readonly close: number
  readonly date: Date
  readonly high: number
  readonly low: number
  readonly open: number
  readonly volume: number
}

// Transform trading data to OHLC format for price chart
export const transformToOHLC = (data: TradingData[]): IOHLCData[] => {
  return data
    .map(item => ({
      date: new Date(item.timestamp),
      close: item.close,
      open: item.close, // Using close as open since we don't have separate OHLC data
      high: item.close,
      low: item.close,
      volume: item.volume || 0,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .filter((item, index, array) => {
      // Remove duplicates based on timestamp (keep the last one)
      if (index === array.length - 1) return true
      return item.date.getTime() !== array[index + 1].date.getTime()
    })
}

// Transform trading data to line chart format for metrics
export const transformToLineData = (
  data: TradingData[],
  metric: keyof TradingData,
): { time: string; value: number }[] => {
  const processedData = data
    .filter(item => {
      const value = item[metric]
      return typeof value === "number" && !isNaN(value)
    })
    .map(item => ({
      time: item.timestamp,
      value: item[metric] as number,
    }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  // Remove duplicates by keeping the last value for each timestamp
  const uniqueData: { time: string; value: number }[] = []
  const timeSet = new Set<string>()

  for (let index = processedData.length - 1; index >= 0; index--) {
    const item = processedData[index]
    if (!timeSet.has(item.time)) {
      timeSet.add(item.time)
      uniqueData.unshift(item)
    }
  }

  return uniqueData
}
