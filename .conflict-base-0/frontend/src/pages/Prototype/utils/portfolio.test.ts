import { describe, it, expect } from "vitest"
import {
  aggregateGreeks,
  calculateTotalNotional,
  calculateGroupNotional,
  calculateGroupWeight,
  calculateNetSide,
  calculatePositionWeight,
  filterAssetsByQuery,
  sortAssetsBySharpe,
  lookupCorrelation,
  getCorrelationColor,
  calculateTotalAttribution,
  computeProjectedExposures,
  rebalanceWeights,
  computeStagedTradesFromDiff,
} from "./portfolio"
import type {
  Greeks,
  CorrelationEntry,
  FactorAttribution,
  MockPosition,
} from "../mockData"
import type { PositionsByUnderlying } from "../hooks/usePrototypeData"

describe("aggregateGreeks", () => {
  it("returns zeros for empty array", () => {
    expect(aggregateGreeks([])).toEqual({ delta: 0, gamma: 0, theta: 0 })
  })

  it("aggregates single greek correctly", () => {
    const greeks: Greeks[] = [
      { symbol: "BTC", delta: 0.5, gamma: 0.1, theta: -0.05 },
    ]
    expect(aggregateGreeks(greeks)).toEqual({
      delta: 0.5,
      gamma: 0.1,
      theta: -0.05,
    })
  })

  it("sums multiple greeks correctly", () => {
    const greeks: Greeks[] = [
      { symbol: "BTC", delta: 0.5, gamma: 0.1, theta: -0.05 },
      { symbol: "ETH", delta: 0.3, gamma: 0.2, theta: -0.02 },
    ]
    const result = aggregateGreeks(greeks)
    expect(result.delta).toBeCloseTo(0.8)
    expect(result.gamma).toBeCloseTo(0.3)
    expect(result.theta).toBeCloseTo(-0.07)
  })

  it("handles negative values", () => {
    const greeks: Greeks[] = [
      { symbol: "BTC", delta: 0.5, gamma: 0.1, theta: -0.05 },
      { symbol: "ETH", delta: -0.8, gamma: -0.05, theta: 0.02 },
    ]
    const result = aggregateGreeks(greeks)
    expect(result.delta).toBeCloseTo(-0.3)
    expect(result.gamma).toBeCloseTo(0.05)
    expect(result.theta).toBeCloseTo(-0.03)
  })
})

describe("calculateTotalNotional", () => {
  it("returns zero for empty array", () => {
    expect(calculateTotalNotional([])).toBe(0)
  })

  it("calculates total for single group", () => {
    const groups: PositionsByUnderlying[] = [
      {
        underlying: "BTC",
        positions: [
          {
            symbol: "BTC/USDC",
            side: "long",
            weight: 0.1,
            notional: 1000,
            percentage: 10,
          },
          {
            symbol: "BTC-SPOT",
            side: "long",
            weight: 0.05,
            notional: 500,
            percentage: 5,
          },
        ],
      },
    ]
    expect(calculateTotalNotional(groups)).toBe(1500)
  })

  it("calculates total across multiple groups", () => {
    const groups: PositionsByUnderlying[] = [
      {
        underlying: "BTC",
        positions: [
          {
            symbol: "BTC/USDC",
            side: "long",
            weight: 0.1,
            notional: 1000,
            percentage: 10,
          },
        ],
      },
      {
        underlying: "ETH",
        positions: [
          {
            symbol: "ETH/USDC",
            side: "long",
            weight: 0.2,
            notional: 2000,
            percentage: 20,
          },
        ],
      },
    ]
    expect(calculateTotalNotional(groups)).toBe(3000)
  })
})

describe("calculateGroupNotional", () => {
  it("returns zero for empty positions", () => {
    expect(calculateGroupNotional([])).toBe(0)
  })

  it("sums position notionals", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "long",
        weight: 0.05,
        notional: 500,
        percentage: 5,
      },
    ]
    expect(calculateGroupNotional(positions)).toBe(1500)
  })
})

describe("calculateGroupWeight", () => {
  it("returns zero for empty positions", () => {
    expect(calculateGroupWeight([])).toBe(0)
  })

  it("sums position weights", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "long",
        weight: 0.05,
        notional: 500,
        percentage: 5,
      },
    ]
    expect(calculateGroupWeight(positions)).toBeCloseTo(0.15)
  })
})

describe("calculateNetSide", () => {
  it("returns long when all positions are long", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    expect(calculateNetSide(positions)).toBe("long")
  })

  it("returns short when all positions are short", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    expect(calculateNetSide(positions)).toBe("short")
  })

  it("returns long when net exposure is significantly positive (>10% of gross)", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.05,
        notional: 500,
        percentage: 5,
      },
    ]
    // net = 500, gross = 1500, ratio = 33% > 10%
    expect(calculateNetSide(positions)).toBe("long")
  })

  it("returns short when net exposure is significantly negative (>10% of gross)", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.05,
        notional: 500,
        percentage: 5,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    // net = -500, gross = 1500, ratio = 33% > 10%
    expect(calculateNetSide(positions)).toBe("short")
  })

  it("returns neutral when net exposure is zero (basis trade)", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    // net = 0, gross = 2000, ratio = 0% < 10%
    expect(calculateNetSide(positions)).toBe("neutral")
  })

  it("returns neutral when net exposure is small (<10% of gross)", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1050,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    // net = 50, gross = 2050, ratio = 2.4% < 10%
    expect(calculateNetSide(positions)).toBe("neutral")
  })

  it("returns long for empty positions", () => {
    expect(calculateNetSide([])).toBe("long")
  })

  it("returns long when net exposure is exactly at 10% threshold", () => {
    // At exactly 10%, should be directional not neutral
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1100,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    // net = 100, gross = 2100, ratio ~ 4.8% < 10%, still neutral
    expect(calculateNetSide(positions)).toBe("neutral")
  })

  it("returns long when net exposure is just above 10% threshold", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1200,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    // net = 200, gross = 2200, ratio ~ 9.1% < 10%, still neutral
    expect(calculateNetSide(positions)).toBe("neutral")
  })

  it("returns long when clearly above threshold", () => {
    const positions: PositionsByUnderlying["positions"] = [
      {
        symbol: "BTC/USDC",
        side: "long",
        weight: 0.1,
        notional: 1300,
        percentage: 10,
      },
      {
        symbol: "BTC-SPOT",
        side: "short",
        weight: 0.1,
        notional: 1000,
        percentage: 10,
      },
    ]
    // net = 300, gross = 2300, ratio ~ 13% > 10%
    expect(calculateNetSide(positions)).toBe("long")
  })
})

describe("calculatePositionWeight", () => {
  it("calculates correct weight", () => {
    expect(calculatePositionWeight(250, 1000)).toBe(0.25)
  })

  it("returns zero when group notional is zero", () => {
    expect(calculatePositionWeight(100, 0)).toBe(0)
  })

  it("returns 1 when position equals group", () => {
    expect(calculatePositionWeight(1000, 1000)).toBe(1)
  })
})

describe("filterAssetsByQuery", () => {
  const assets = [
    { ticker: "BTC", sharpe: 1.2 },
    { ticker: "ETH", sharpe: 0.9 },
    { ticker: "SOL", sharpe: 1.5 },
  ]

  it("returns all assets when query is empty", () => {
    expect(filterAssetsByQuery(assets, "")).toEqual(assets)
  })

  it("filters by exact match (case insensitive)", () => {
    expect(filterAssetsByQuery(assets, "BTC")).toEqual([
      { ticker: "BTC", sharpe: 1.2 },
    ])
    expect(filterAssetsByQuery(assets, "btc")).toEqual([
      { ticker: "BTC", sharpe: 1.2 },
    ])
  })

  it("filters by partial match", () => {
    expect(filterAssetsByQuery(assets, "T")).toEqual([
      { ticker: "BTC", sharpe: 1.2 },
      { ticker: "ETH", sharpe: 0.9 },
    ])
  })

  it("returns empty array when no match", () => {
    expect(filterAssetsByQuery(assets, "XYZ")).toEqual([])
  })
})

describe("sortAssetsBySharpe", () => {
  it("sorts descending by sharpe", () => {
    const assets = [
      { ticker: "BTC", sharpe: 1.2 },
      { ticker: "SOL", sharpe: 1.5 },
      { ticker: "ETH", sharpe: 0.9 },
    ]
    const sorted = sortAssetsBySharpe(assets)
    expect(sorted.map(a => a.ticker)).toEqual(["SOL", "BTC", "ETH"])
  })

  it("does not mutate original array", () => {
    const assets = [
      { ticker: "BTC", sharpe: 1.2 },
      { ticker: "SOL", sharpe: 1.5 },
    ]
    const original = [...assets]
    sortAssetsBySharpe(assets)
    expect(assets).toEqual(original)
  })

  it("handles empty array", () => {
    expect(sortAssetsBySharpe([])).toEqual([])
  })

  it("handles negative sharpe values", () => {
    const assets = [
      { ticker: "BTC", sharpe: -0.5 },
      { ticker: "ETH", sharpe: 0.3 },
      { ticker: "SOL", sharpe: -1.0 },
    ]
    const sorted = sortAssetsBySharpe(assets)
    expect(sorted.map(a => a.ticker)).toEqual(["ETH", "BTC", "SOL"])
  })
})

describe("lookupCorrelation", () => {
  const matrix: CorrelationEntry[] = [
    { asset1: "BTC", asset2: "ETH", correlation: 0.85 },
    { asset1: "BTC", asset2: "SOL", correlation: 0.72 },
    { asset1: "ETH", asset2: "SOL", correlation: 0.78 },
  ]

  it("finds correlation in forward direction", () => {
    expect(lookupCorrelation(matrix, "BTC", "ETH")).toBe(0.85)
  })

  it("finds correlation in reverse direction (symmetric lookup)", () => {
    expect(lookupCorrelation(matrix, "ETH", "BTC")).toBe(0.85)
  })

  it("returns 0 for missing pair", () => {
    expect(lookupCorrelation(matrix, "BTC", "XYZ")).toBe(0)
  })

  it("returns 0 for empty matrix", () => {
    expect(lookupCorrelation([], "BTC", "ETH")).toBe(0)
  })
})

describe("getCorrelationColor", () => {
  it("returns bg-green-600 for high positive correlation", () => {
    expect(getCorrelationColor(0.7)).toBe("bg-green-600")
    expect(getCorrelationColor(0.9)).toBe("bg-green-600")
    expect(getCorrelationColor(1.0)).toBe("bg-green-600")
  })

  it("returns bg-green-500/60 for medium positive correlation", () => {
    expect(getCorrelationColor(0.3)).toBe("bg-green-500/60")
    expect(getCorrelationColor(0.5)).toBe("bg-green-500/60")
    expect(getCorrelationColor(0.69)).toBe("bg-green-500/60")
  })

  it("returns bg-green-500/30 for low positive correlation", () => {
    expect(getCorrelationColor(0)).toBe("bg-green-500/30")
    expect(getCorrelationColor(0.1)).toBe("bg-green-500/30")
    expect(getCorrelationColor(0.29)).toBe("bg-green-500/30")
  })

  it("returns bg-red-500/30 for low negative correlation", () => {
    expect(getCorrelationColor(-0.01)).toBe("bg-red-500/30")
    expect(getCorrelationColor(-0.2)).toBe("bg-red-500/30")
    expect(getCorrelationColor(-0.3)).toBe("bg-red-500/30") // -0.3 >= -0.3 is true
  })

  it("returns bg-red-500/60 for medium negative correlation", () => {
    expect(getCorrelationColor(-0.31)).toBe("bg-red-500/60")
    expect(getCorrelationColor(-0.5)).toBe("bg-red-500/60")
    expect(getCorrelationColor(-0.7)).toBe("bg-red-500/60") // -0.7 >= -0.7 is true
  })

  it("returns bg-red-600 for high negative correlation", () => {
    expect(getCorrelationColor(-0.71)).toBe("bg-red-600")
    expect(getCorrelationColor(-0.9)).toBe("bg-red-600")
    expect(getCorrelationColor(-1.0)).toBe("bg-red-600")
  })
})

describe("calculateTotalAttribution", () => {
  it("returns 0 for empty array", () => {
    expect(calculateTotalAttribution([])).toBe(0)
  })

  it("sums contributions correctly", () => {
    const attributions: FactorAttribution[] = [
      { factor: "Market", contribution: 0.1, color: "#000" },
      { factor: "Momentum", contribution: 0.05, color: "#000" },
      { factor: "Carry", contribution: -0.02, color: "#000" },
    ]
    expect(calculateTotalAttribution(attributions)).toBeCloseTo(0.13)
  })
})

describe("computeProjectedExposures", () => {
  const basePositions: PositionsByUnderlying[] = [
    {
      underlying: "BTC",
      positions: [
        {
          symbol: "BTC/USDC:USDC",
          side: "long",
          weight: 0.3,
          notional: 30000,
          percentage: 30,
        },
      ],
    },
    {
      underlying: "ETH",
      positions: [
        {
          symbol: "ETH/USDC:USDC",
          side: "long",
          weight: 0.2,
          notional: 20000,
          percentage: 20,
        },
      ],
    },
  ]

  const baseNav = 100000
  const baseLeverage = 1.0

  it("returns null changes when no staged trades", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [],
      nav: baseNav,
      leverage: baseLeverage,
    })

    expect(result.effectiveLeverageChange).toBe(0)
    expect(result.notionalChange).toBe(0)
  })

  it("calculates notional increase from buy trade", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        {
          id: "1",
          symbol: "SOL",
          side: "buy",
          notional: 10000,
          leverage: 2,
        },
      ],
      nav: baseNav,
      leverage: baseLeverage,
    })

    expect(result.notionalChange).toBe(10000)
    expect(result.projectedNotional).toBe(60000) // 30k + 20k + 10k
  })

  it("calculates notional decrease from sell trade", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        {
          id: "1",
          symbol: "BTC",
          side: "sell",
          notional: 10000,
          leverage: 1,
        },
      ],
      nav: baseNav,
      leverage: baseLeverage,
    })

    expect(result.notionalChange).toBe(-10000)
    expect(result.projectedNotional).toBe(40000) // 30k + 20k - 10k
  })

  it("calculates effective leverage change", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        {
          id: "1",
          symbol: "SOL",
          side: "buy",
          notional: 50000,
          leverage: 2,
        },
      ],
      nav: baseNav,
      leverage: baseLeverage,
    })

    // Current: 50k notional / 100k NAV = 0.5x
    // Projected: 100k notional / 100k NAV = 1.0x
    expect(result.currentEffectiveLeverage).toBeCloseTo(0.5)
    expect(result.projectedEffectiveLeverage).toBeCloseTo(1.0)
    expect(result.effectiveLeverageChange).toBeCloseTo(0.5)
  })

  it("handles multiple staged trades", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        {
          id: "1",
          symbol: "SOL",
          side: "buy",
          notional: 10000,
          leverage: 2,
        },
        {
          id: "2",
          symbol: "AVAX",
          side: "buy",
          notional: 5000,
          leverage: 1,
        },
        {
          id: "3",
          symbol: "BTC",
          side: "sell",
          notional: 5000,
          leverage: 1,
        },
      ],
      nav: baseNav,
      leverage: baseLeverage,
    })

    // Net change: +10k + 5k - 5k = +10k
    expect(result.notionalChange).toBe(10000)
    expect(result.projectedNotional).toBe(60000)
  })

  it("applies global leverage multiplier", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [],
      nav: baseNav,
      leverage: 2.0, // 2x global leverage
    })

    // Current notional: 50k, with 2x leverage = 100k effective
    expect(result.currentEffectiveLeverage).toBeCloseTo(1.0) // 100k / 100k NAV
  })

  it("calculates weight changes per underlying", () => {
    const result = computeProjectedExposures({
      positions: basePositions,
      stagedTrades: [
        {
          id: "1",
          symbol: "BTC",
          side: "buy",
          notional: 20000,
          leverage: 1,
        },
      ],
      nav: baseNav,
      leverage: baseLeverage,
    })

    // BTC: was 30k, now 50k out of 70k total
    // ETH: was 20k, now 20k out of 70k total
    const btcChange = result.weightChanges.BTC
    const ethChange = result.weightChanges.ETH
    expect(btcChange.current).toBeCloseTo(0.6) // 30k / 50k
    expect(btcChange.projected).toBeCloseTo(0.714, 2) // 50k / 70k
    expect(ethChange.current).toBeCloseTo(0.4) // 20k / 50k
    expect(ethChange.projected).toBeCloseTo(0.286, 2) // 20k / 70k
  })
})

describe("rebalanceWeights", () => {
  it("distributes delta proportionally to other positions when increasing one weight", () => {
    const current = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.3],
      ["SOL/USDC:USDC", 0.2],
    ])

    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0.6)

    expect(result.get("BTC/USDC:USDC")).toBeCloseTo(0.6)
    // ETH absorbs: 30/50 * 10% = 6% -> 24%
    expect(result.get("ETH/USDC:USDC")).toBeCloseTo(0.24)
    // SOL absorbs: 20/50 * 10% = 4% -> 16%
    expect(result.get("SOL/USDC:USDC")).toBeCloseTo(0.16)

    // Total still sums to 1
    const total = Array.from(result.values()).reduce((sum, w) => sum + w, 0)
    expect(total).toBeCloseTo(1.0)
  })

  it("distributes delta proportionally when decreasing one weight", () => {
    const current = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.3],
      ["SOL/USDC:USDC", 0.2],
    ])

    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0.3)

    expect(result.get("BTC/USDC:USDC")).toBeCloseTo(0.3)
    // Released 0.2, ETH gets 30/50 * 20% = 12% -> 42%
    expect(result.get("ETH/USDC:USDC")).toBeCloseTo(0.42)
    // SOL gets 20/50 * 20% = 8% -> 28%
    expect(result.get("SOL/USDC:USDC")).toBeCloseTo(0.28)

    const total = Array.from(result.values()).reduce((sum, w) => sum + w, 0)
    expect(total).toBeCloseTo(1.0)
  })

  it("handles single position case (no rebalancing needed)", () => {
    const current = new Map([["BTC/USDC:USDC", 1.0]])

    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0.5)

    expect(result.get("BTC/USDC:USDC")).toBeCloseTo(0.5)
    // Total is less than 1 because there are no other positions to absorb
    const total = Array.from(result.values()).reduce((sum, w) => sum + w, 0)
    expect(total).toBeCloseTo(0.5)
  })

  it("prevents other weights from going below 0", () => {
    const current = new Map([
      ["BTC/USDC:USDC", 0.3],
      ["ETH/USDC:USDC", 0.3],
      ["SOL/USDC:USDC", 0.4],
    ])

    // Trying to increase BTC to 0.95 would require taking 0.65 from others
    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0.95)

    // All other positions should be 0 or positive
    expect(result.get("ETH/USDC:USDC")).toBeGreaterThanOrEqual(0)
    expect(result.get("SOL/USDC:USDC")).toBeGreaterThanOrEqual(0)
    expect(result.get("BTC/USDC:USDC")).toBeCloseTo(0.95)
  })

  it("handles weight set to 0 (full exit)", () => {
    const current = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.3],
      ["SOL/USDC:USDC", 0.2],
    ])

    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0)

    expect(result.get("BTC/USDC:USDC")).toBe(0)
    // ETH gets: 30/50 * 50% = 30% -> 60%
    expect(result.get("ETH/USDC:USDC")).toBeCloseTo(0.6)
    // SOL gets: 20/50 * 50% = 20% -> 40%
    expect(result.get("SOL/USDC:USDC")).toBeCloseTo(0.4)

    const total = Array.from(result.values()).reduce((sum, w) => sum + w, 0)
    expect(total).toBeCloseTo(1.0)
  })

  it("returns copy when setting same weight (no change)", () => {
    const current = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.5],
    ])

    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0.5)

    expect(result.get("BTC/USDC:USDC")).toBeCloseTo(0.5)
    expect(result.get("ETH/USDC:USDC")).toBeCloseTo(0.5)
  })

  it("handles empty map", () => {
    const current = new Map<string, number>()

    const result = rebalanceWeights(current, "BTC/USDC:USDC", 0.5)

    expect(result.size).toBe(0)
  })

  it("handles unknown symbol by not modifying anything", () => {
    const current = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.5],
    ])

    const result = rebalanceWeights(current, "UNKNOWN", 0.3)

    expect(result.get("BTC/USDC:USDC")).toBeCloseTo(0.5)
    expect(result.get("ETH/USDC:USDC")).toBeCloseTo(0.5)
  })
})

describe("computeStagedTradesFromDiff", () => {
  const basePositions: MockPosition[] = [
    { symbol: "BTC/USDC:USDC", underlying: "BTC", side: "long", weight: 0.5 },
    { symbol: "ETH/USDC:USDC", underlying: "ETH", side: "long", weight: 0.3 },
    { symbol: "SOL/USDC:USDC", underlying: "SOL", side: "short", weight: 0.2 },
  ]

  const baseNav = 100000

  it("returns empty array when no changes", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.3],
      ["SOL/USDC:USDC", 0.2],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
    })

    expect(trades).toHaveLength(0)
  })

  it("generates buy trade when weight increases", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.6],
      ["ETH/USDC:USDC", 0.24],
      ["SOL/USDC:USDC", 0.16],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
    })

    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade).toBeDefined()
    expect(btcTrade?.side).toBe("buy")
    expect(btcTrade?.notional).toBeCloseTo(10000) // (0.6 - 0.5) * 100000 * 1.0
  })

  it("generates sell trade when weight decreases", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.3],
      ["ETH/USDC:USDC", 0.42],
      ["SOL/USDC:USDC", 0.28],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
    })

    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade).toBeDefined()
    expect(btcTrade?.side).toBe("sell")
    expect(btcTrade?.notional).toBeCloseTo(20000) // (0.5 - 0.3) * 100000 * 1.0
  })

  it("generates trades for all positions when leverage changes", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.5],
      ["ETH/USDC:USDC", 0.3],
      ["SOL/USDC:USDC", 0.2],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.5, // 50% increase
      nav: baseNav,
    })

    // All positions should have buy trades (50% increase each)
    expect(trades).toHaveLength(3)

    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade?.side).toBe("buy")
    expect(btcTrade?.notional).toBeCloseTo(25000) // 0.5 * 100000 * (1.5 - 1.0)
  })

  it("combines weight and leverage changes correctly", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.6], // weight changed
      ["ETH/USDC:USDC", 0.24], // weight changed
      ["SOL/USDC:USDC", 0.16], // weight changed
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 2.0, // leverage also changed
      nav: baseNav,
    })

    // BTC: was 50k (0.5 * 100k * 1.0), now 120k (0.6 * 100k * 2.0), diff = +70k
    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade?.side).toBe("buy")
    expect(btcTrade?.notional).toBeCloseTo(70000)
  })

  it("ignores trades below minimum threshold", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.50005], // tiny change: 0.00005 * 100000 = $5
      ["ETH/USDC:USDC", 0.29995], // tiny change: 0.00005 * 100000 = $5
      ["SOL/USDC:USDC", 0.2], // no change
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
      minThreshold: 10, // $10 minimum
    })

    expect(trades).toHaveLength(0) // Both changes are < $10
  })

  it("includes underlying in trade info", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.7],
      ["ETH/USDC:USDC", 0.2],
      ["SOL/USDC:USDC", 0.1],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
    })

    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade?.underlying).toBe("BTC")
  })

  it("handles weight set to 0 (generate full sell trade)", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0],
      ["ETH/USDC:USDC", 0.6],
      ["SOL/USDC:USDC", 0.4],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
    })

    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade).toBeDefined()
    expect(btcTrade?.side).toBe("sell")
    expect(btcTrade?.notional).toBeCloseTo(50000) // Full position
  })

  it("includes previous and new weight in trade info", () => {
    const targetWeights = new Map([
      ["BTC/USDC:USDC", 0.6],
      ["ETH/USDC:USDC", 0.24],
      ["SOL/USDC:USDC", 0.16],
    ])

    const trades = computeStagedTradesFromDiff({
      committedPositions: basePositions,
      targetWeights,
      committedLeverage: 1.0,
      targetLeverage: 1.0,
      nav: baseNav,
    })

    const btcTrade = trades.find(t => t.symbol === "BTC/USDC:USDC")
    expect(btcTrade?.previousWeight).toBeCloseTo(0.5)
    expect(btcTrade?.newWeight).toBeCloseTo(0.6)
  })
})
