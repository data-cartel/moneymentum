import { describe, it, expect } from "vitest"
import {
  computeDailyReturns,
  computeDrawdown,
  computeRollingSharpe,
  computeRollingSortino,
  computeRollingVolatility,
  computeCumulativeReturns,
  identity,
} from "./computations"
import type { TimeSeriesPoint } from "./registry"

const createTimeSeries = (values: number[]): TimeSeriesPoint[] =>
  values.map((value, i) => ({ time: i + 1, value }))

describe("identity", () => {
  it("returns the input unchanged", () => {
    const data = createTimeSeries([100, 101, 102])
    expect(identity(data)).toEqual(data)
  })

  it("returns empty array for empty input", () => {
    expect(identity([])).toEqual([])
  })
})

describe("computeDailyReturns", () => {
  it("returns empty array for empty input", () => {
    expect(computeDailyReturns([])).toEqual([])
  })

  it("returns empty array for single point", () => {
    expect(computeDailyReturns(createTimeSeries([100]))).toEqual([])
  })

  it("computes correct returns for normal case", () => {
    const data = createTimeSeries([100, 110, 105])
    const result = computeDailyReturns(data)

    expect(result).toHaveLength(2)
    expect(result[0].time).toBe(2)
    expect(result[0].value).toBeCloseTo(0.1) // (110-100)/100
    expect(result[1].time).toBe(3)
    expect(result[1].value).toBeCloseTo(-0.0455) // (105-110)/110
  })

  it("handles negative returns", () => {
    const data = createTimeSeries([100, 80])
    const result = computeDailyReturns(data)

    expect(result[0].value).toBeCloseTo(-0.2) // -20%
  })

  it("handles zero starting value gracefully", () => {
    const data = createTimeSeries([0, 100])
    const result = computeDailyReturns(data)

    expect(result[0].value).toBe(Infinity)
  })
})

describe("computeDrawdown", () => {
  it("returns empty array for empty input", () => {
    expect(computeDrawdown([])).toEqual([])
  })

  it("returns zero drawdown for constant rising values", () => {
    const data = createTimeSeries([100, 110, 120, 130])
    const result = computeDrawdown(data)

    expect(result).toHaveLength(4)
    result.forEach(point => {
      expect(point.value).toBe(0)
    })
  })

  it("computes correct drawdown after peak", () => {
    const data = createTimeSeries([100, 120, 100, 90])
    const result = computeDrawdown(data)

    expect(result[0].value).toBe(0) // At initial value
    expect(result[1].value).toBe(0) // New peak
    expect(result[2].value).toBeCloseTo(-0.1667) // (100-120)/120
    expect(result[3].value).toBeCloseTo(-0.25) // (90-120)/120
  })

  it("handles recovery from drawdown", () => {
    const data = createTimeSeries([100, 80, 100, 120])
    const result = computeDrawdown(data)

    expect(result[0].value).toBe(0)
    expect(result[1].value).toBeCloseTo(-0.2) // (80-100)/100
    expect(result[2].value).toBe(0) // Back to peak
    expect(result[3].value).toBe(0) // New peak
  })

  it("tracks maximum peak correctly across multiple peaks", () => {
    const data = createTimeSeries([100, 120, 110, 130, 100])
    const result = computeDrawdown(data)

    expect(result[2].value).toBeCloseTo(-0.0833) // (110-120)/120
    expect(result[4].value).toBeCloseTo(-0.2308) // (100-130)/130
  })
})

describe("computeRollingSharpe", () => {
  it("returns empty array when data shorter than window", () => {
    const data = createTimeSeries([100, 101, 102])
    expect(computeRollingSharpe(data, 30)).toEqual([])
  })

  it("returns empty array for empty input", () => {
    expect(computeRollingSharpe([], 30)).toEqual([])
  })

  it("computes sharpe for data exactly matching window size plus 1", () => {
    // 31 data points produces 30 returns, which is exactly window size
    const data = createTimeSeries(
      Array.from({ length: 31 }, (_, i) => 100 + i * 0.1),
    )
    const result = computeRollingSharpe(data, 30)

    expect(result).toHaveLength(1)
    // Returns have times 2-31, the rolling window ends at index 29 (time=31)
    expect(result[0].time).toBe(31)
  })

  it("handles zero volatility without division error", () => {
    const constantValues = Array.from({ length: 35 }, () => 100)
    const data = createTimeSeries(constantValues)
    const result = computeRollingSharpe(data, 30)

    result.forEach(point => {
      expect(point.value).toBe(0) // Zero mean return / zero std = 0
      expect(Number.isFinite(point.value)).toBe(true)
    })
  })

  it("returns positive sharpe for consistently positive returns", () => {
    const growingValues = Array.from(
      { length: 35 },
      (_, i) => 100 * Math.pow(1.001, i),
    )
    const data = createTimeSeries(growingValues)
    const result = computeRollingSharpe(data, 30)

    result.forEach(point => {
      expect(point.value).toBeGreaterThan(0)
    })
  })

  it("returns negative sharpe for consistently negative returns", () => {
    const decliningValues = Array.from(
      { length: 35 },
      (_, i) => 100 * Math.pow(0.999, i),
    )
    const data = createTimeSeries(decliningValues)
    const result = computeRollingSharpe(data, 30)

    result.forEach(point => {
      expect(point.value).toBeLessThan(0)
    })
  })
})

describe("computeRollingSortino", () => {
  it("returns empty array when data shorter than window", () => {
    const data = createTimeSeries([100, 101, 102])
    expect(computeRollingSortino(data, 30)).toEqual([])
  })

  it("returns empty array for empty input", () => {
    expect(computeRollingSortino([], 30)).toEqual([])
  })

  it("returns zero when no downside returns exist", () => {
    const growingValues = Array.from(
      { length: 35 },
      (_, i) => 100 * Math.pow(1.001, i),
    )
    const data = createTimeSeries(growingValues)
    const result = computeRollingSortino(data, 30)

    result.forEach(point => {
      expect(point.value).toBe(0) // No downside vol means zero sortino by our impl
    })
  })

  it("computes sortino for mixed returns", () => {
    const values = Array.from(
      { length: 35 },
      (_, i) => 100 + (i % 2 === 0 ? i * 0.1 : -i * 0.05),
    )
    const data = createTimeSeries(values)
    const result = computeRollingSortino(data, 30)

    expect(result.length).toBeGreaterThan(0)
    result.forEach(point => {
      expect(Number.isFinite(point.value)).toBe(true)
    })
  })
})

describe("computeRollingVolatility", () => {
  it("returns empty array when data shorter than window", () => {
    const data = createTimeSeries([100, 101, 102])
    expect(computeRollingVolatility(data, 30)).toEqual([])
  })

  it("returns empty array for empty input", () => {
    expect(computeRollingVolatility([], 30)).toEqual([])
  })

  it("returns zero volatility for constant prices", () => {
    const constantValues = Array.from({ length: 35 }, () => 100)
    const data = createTimeSeries(constantValues)
    const result = computeRollingVolatility(data, 30)

    result.forEach(point => {
      expect(point.value).toBe(0)
    })
  })

  it("computes higher volatility for more volatile series", () => {
    const lowVolValues = Array.from(
      { length: 35 },
      (_, i) => 100 + Math.sin(i) * 1,
    )
    const highVolValues = Array.from(
      { length: 35 },
      (_, i) => 100 + Math.sin(i) * 10,
    )

    const lowVolResult = computeRollingVolatility(
      createTimeSeries(lowVolValues),
      30,
    )
    const highVolResult = computeRollingVolatility(
      createTimeSeries(highVolValues),
      30,
    )

    expect(highVolResult[0].value).toBeGreaterThan(lowVolResult[0].value)
  })

  it("returns annualized volatility", () => {
    const values = Array.from(
      { length: 35 },
      (_, i) => 100 * Math.pow(1.001, i),
    )
    const data = createTimeSeries(values)
    const result = computeRollingVolatility(data, 30)

    // Volatility should be positive and annualized (multiplied by sqrt(252))
    result.forEach(point => {
      expect(point.value).toBeGreaterThanOrEqual(0)
    })
  })
})

describe("computeCumulativeReturns", () => {
  it("returns empty array for empty input", () => {
    expect(computeCumulativeReturns([])).toEqual([])
  })

  it("starts at zero for first point", () => {
    const data = createTimeSeries([100, 110, 120])
    const result = computeCumulativeReturns(data)

    expect(result[0].value).toBe(0) // (100-100)/100
  })

  it("computes correct cumulative returns", () => {
    const data = createTimeSeries([100, 110, 121])
    const result = computeCumulativeReturns(data)

    expect(result).toHaveLength(3)
    expect(result[0].value).toBe(0) // 0%
    expect(result[1].value).toBeCloseTo(0.1) // 10%
    expect(result[2].value).toBeCloseTo(0.21) // 21%
  })

  it("handles negative cumulative returns", () => {
    const data = createTimeSeries([100, 90, 80])
    const result = computeCumulativeReturns(data)

    expect(result[1].value).toBeCloseTo(-0.1) // -10%
    expect(result[2].value).toBeCloseTo(-0.2) // -20%
  })

  it("preserves time values", () => {
    const data = [
      { time: 1000, value: 100 },
      { time: 2000, value: 110 },
      { time: 3000, value: 105 },
    ]
    const result = computeCumulativeReturns(data)

    expect(result[0].time).toBe(1000)
    expect(result[1].time).toBe(2000)
    expect(result[2].time).toBe(3000)
  })
})
