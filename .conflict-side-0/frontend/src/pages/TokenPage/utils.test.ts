import { describe, it, expect } from "vitest"
import { transformToOHLC, transformToLineData } from "./utils"
import type { TradingData } from "@/hooks/useApi"

const createTradingData = (
  overrides: Partial<TradingData> = {},
): TradingData => ({
  timestamp: "2024-01-01T00:00:00Z",
  close: 100,
  volume: 1000,
  ticker: "BTC",
  log_return: 0.01,
  cum_return: 0.05,
  autocorrelation: 0.3,
  stddev: 0.02,
  annualized_volatility: 0.4,
  sma: 99,
  mean_return: 0.01,
  price_stddev: 5,
  return_stddev: 0.02,
  price_zscore: 0.5,
  covariance: 0.001,
  beta: 1.2,
  information_discreteness: 0.8,
  sharpe: 1.5,
  log_return_above_mar: 0.005,
  downside_deviation: 0.015,
  sortino: 2.0,
  ...overrides,
})

describe("transformToOHLC", () => {
  it("transforms trading data to OHLC format", () => {
    const data = [createTradingData({ close: 100, volume: 1000 })]

    const result = transformToOHLC(data)

    expect(result).toHaveLength(1)
    expect(result[0].close).toBe(100)
    expect(result[0].open).toBe(100)
    expect(result[0].high).toBe(100)
    expect(result[0].low).toBe(100)
    expect(result[0].volume).toBe(1000)
    expect(result[0].date).toBeInstanceOf(Date)
  })

  it("returns empty array for empty input", () => {
    const result = transformToOHLC([])

    expect(result).toEqual([])
  })

  it("sorts data by timestamp ascending", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-03T00:00:00Z",
        close: 103,
      }),
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        close: 101,
      }),
      createTradingData({
        timestamp: "2024-01-02T00:00:00Z",
        close: 102,
      }),
    ]

    const result = transformToOHLC(data)

    expect(result[0].close).toBe(101)
    expect(result[1].close).toBe(102)
    expect(result[2].close).toBe(103)
  })

  it("removes duplicate timestamps keeping the last one", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        close: 100,
      }),
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        close: 101,
      }),
      createTradingData({
        timestamp: "2024-01-02T00:00:00Z",
        close: 102,
      }),
    ]

    const result = transformToOHLC(data)

    expect(result).toHaveLength(2)
    expect(result[0].close).toBe(101)
    expect(result[1].close).toBe(102)
  })

  it("handles missing volume by defaulting to 0", () => {
    const data = [
      createTradingData({
        volume: 0,
      }),
    ]

    const result = transformToOHLC(data)

    expect(result[0].volume).toBe(0)
  })
})

describe("transformToLineData", () => {
  it("transforms trading data to line chart format", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        sharpe: 1.5,
      }),
    ]

    const result = transformToLineData(data, "sharpe")

    expect(result).toHaveLength(1)
    expect(result[0].time).toBe("2024-01-01T00:00:00Z")
    expect(result[0].value).toBe(1.5)
  })

  it("returns empty array for empty input", () => {
    const result = transformToLineData([], "sharpe")

    expect(result).toEqual([])
  })

  it("filters out null values", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        sharpe: null,
      }),
      createTradingData({
        timestamp: "2024-01-02T00:00:00Z",
        sharpe: 1.5,
      }),
    ]

    const result = transformToLineData(data, "sharpe")

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(1.5)
  })

  it("filters out NaN values", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        sharpe: NaN,
      }),
      createTradingData({
        timestamp: "2024-01-02T00:00:00Z",
        sharpe: 1.5,
      }),
    ]

    const result = transformToLineData(data, "sharpe")

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(1.5)
  })

  it("sorts data by timestamp ascending", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-03T00:00:00Z",
        sharpe: 3,
      }),
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        sharpe: 1,
      }),
      createTradingData({
        timestamp: "2024-01-02T00:00:00Z",
        sharpe: 2,
      }),
    ]

    const result = transformToLineData(data, "sharpe")

    expect(result[0].value).toBe(1)
    expect(result[1].value).toBe(2)
    expect(result[2].value).toBe(3)
  })

  it("removes duplicate timestamps keeping the last one", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        sharpe: 1.0,
      }),
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        sharpe: 1.5,
      }),
      createTradingData({
        timestamp: "2024-01-02T00:00:00Z",
        sharpe: 2.0,
      }),
    ]

    const result = transformToLineData(data, "sharpe")

    expect(result).toHaveLength(2)
    expect(result[0].value).toBe(1.5)
    expect(result[1].value).toBe(2.0)
  })

  it("works with different numeric metrics", () => {
    const data = [
      createTradingData({
        timestamp: "2024-01-01T00:00:00Z",
        beta: 1.2,
        sortino: 2.5,
      }),
    ]

    const betaResult = transformToLineData(data, "beta")
    const sortinoResult = transformToLineData(data, "sortino")

    expect(betaResult[0].value).toBe(1.2)
    expect(sortinoResult[0].value).toBe(2.5)
  })
})
