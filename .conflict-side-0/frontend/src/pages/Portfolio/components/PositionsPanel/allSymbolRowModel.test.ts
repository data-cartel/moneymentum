import { describe, expect, it } from "vitest"

import type { FactorScore } from "../../hooks/useFactorScores"

import {
  allSymbolPortfolioState,
  betaClassName,
  buildAllSymbolRows,
  filterAllSymbolRows,
  fundingRateClassName,
  resolveAllSymbolClick,
  riskAdjustedReturnClassName,
  signedMetricClassName,
  volatilityClassName,
} from "./allSymbolRowModel"

const sampleFactors: FactorScore[] = [
  {
    ticker: "BTC",
    beta: 1,
    annualized_volatility: 0.45,
    sharpe: 1.2,
    sortino: 1.5,
    cum_return: 0.1,
    carry: 0.0001,
  },
  {
    ticker: "ETH",
    beta: 1.3,
    annualized_volatility: 0.55,
    sharpe: 0.8,
    sortino: 0.9,
    cum_return: -0.05,
    carry: null,
  },
]

describe("buildAllSymbolRows", () => {
  it("maps hyperliquid symbols to factor scores by base ticker", () => {
    const rows = buildAllSymbolRows(
      ["BTC/USDC:USDC", "ETH/USDC:USDC", "SOL/USDC:USDC"],
      sampleFactors,
      { BTC: 0.00001, ETH: -0.00002 },
    )

    const btcRow = rows.find(row => row.baseSymbol === "BTC")
    const ethRow = rows.find(row => row.baseSymbol === "ETH")
    const solRow = rows.find(row => row.baseSymbol === "SOL")

    expect(btcRow?.beta).toBe(1)
    expect(btcRow?.sharpe).toBe(1.2)
    expect(btcRow?.fundingRateAnnualized).toBeCloseTo(0.00001 * 24 * 365)
    expect(ethRow?.sortino).toBe(0.9)
    expect(ethRow?.fundingRateAnnualized).toBeCloseTo(-0.00002 * 24 * 365)
    expect(solRow?.beta).toBeNull()
  })
})

describe("filterAllSymbolRows", () => {
  const rows = buildAllSymbolRows(
    ["BTC/USDC:USDC", "ETH/USDC:USDC", "SOL/USDC:USDC"],
    sampleFactors,
  )

  it("returns all rows when the search query is empty", () => {
    expect(filterAllSymbolRows(rows, "")).toHaveLength(3)
    expect(filterAllSymbolRows(rows, "   ")).toHaveLength(3)
  })

  it("filters by base symbol case-insensitively", () => {
    expect(filterAllSymbolRows(rows, "btc").map(row => row.baseSymbol)).toEqual(
      ["BTC"],
    )
  })

  it("filters by partial base symbol substring", () => {
    const extendedRows = buildAllSymbolRows(
      ["BTC/USDC:USDC", "ETH/USDC:USDC", "ZEREBRO/USDC:USDC", "ZEC/USDC:USDC"],
      sampleFactors,
    )

    expect(
      filterAllSymbolRows(extendedRows, "btc").map(row => row.baseSymbol),
    ).toEqual(["BTC"])
    expect(
      filterAllSymbolRows(extendedRows, "bt").map(row => row.baseSymbol),
    ).toEqual(["BTC"])
    expect(
      filterAllSymbolRows(extendedRows, "eth").map(row => row.baseSymbol),
    ).toEqual(["ETH"])
    expect(filterAllSymbolRows(extendedRows, "eth")).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ baseSymbol: "ZEREBRO" }),
        expect.objectContaining({ baseSymbol: "ZEC" }),
      ]),
    )
  })
})

describe("allSymbolPortfolioState", () => {
  it("matches trash semantics for target, closing, and absent symbols", () => {
    const targetPortfolio = { "BTC/USDC:USDC": { symbol: "BTC/USDC:USDC" } }
    const deletedArchive = { "ETH/USDC:USDC": { symbol: "ETH/USDC:USDC" } }

    expect(
      allSymbolPortfolioState("BTC/USDC:USDC", targetPortfolio, deletedArchive),
    ).toBe("target")
    expect(
      allSymbolPortfolioState("ETH/USDC:USDC", targetPortfolio, deletedArchive),
    ).toBe("closing")
    expect(
      allSymbolPortfolioState("SOL/USDC:USDC", targetPortfolio, deletedArchive),
    ).toBe("absent")
  })
})

describe("resolveAllSymbolClick", () => {
  it("routes clicks to add, remove, and undo remove", () => {
    expect(resolveAllSymbolClick("target")).toBe("remove")
    expect(resolveAllSymbolClick("closing")).toBe("undoRemove")
    expect(resolveAllSymbolClick("absent")).toBe("add")
  })
})

describe("fundingRateClassName", () => {
  it("colors positive rates green and negative rates red", () => {
    expect(fundingRateClassName(0.12)).toBe("text-emerald-500")
    expect(fundingRateClassName(-0.03)).toBe("text-rose-500")
    expect(fundingRateClassName(null)).toBe("text-muted-foreground")
    expect(fundingRateClassName(0)).toBe("text-muted-foreground")
  })
})

describe("metric class names", () => {
  it("colors signed metrics by direction", () => {
    expect(signedMetricClassName(0.12)).toBe("text-positive")
    expect(signedMetricClassName(-0.03)).toBe("text-negative")
    expect(signedMetricClassName(null)).toBe("text-muted-foreground")
  })

  it("highlights strong risk-adjusted returns", () => {
    expect(riskAdjustedReturnClassName(1.2)).toBe("text-positive")
    expect(riskAdjustedReturnClassName(0.4)).toBe("text-emerald-400")
    expect(riskAdjustedReturnClassName(-0.2)).toBe("text-negative")
  })

  it("colors beta by market sensitivity", () => {
    expect(betaClassName(1.8)).toBe("text-amber-400")
    expect(betaClassName(0.3)).toBe("text-violet-400")
    expect(betaClassName(1)).toBe("text-sky-400")
  })

  it("colors volatility by magnitude", () => {
    expect(volatilityClassName(0.9)).toBe("text-rose-400")
    expect(volatilityClassName(0.6)).toBe("text-amber-400")
    expect(volatilityClassName(0.3)).toBe("text-violet-400")
  })
})
