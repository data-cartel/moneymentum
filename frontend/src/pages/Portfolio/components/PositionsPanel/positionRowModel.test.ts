import { describe, expect, it } from "vitest"

import type { PortfolioInterface } from "../../hooks/usePortfolioState"

import {
  displayPosition,
  positionDelta,
  signedFundingRateForPosition,
} from "./positionRowModel"

const btcPosition = (
  overrides: Partial<PortfolioInterface> = {},
): PortfolioInterface => ({
  symbol: "BTC/USDC:USDC",
  side: "buy",
  leverage: 1,
  notional: 5000,
  ...overrides,
})

describe("signedFundingRateForPosition", () => {
  const hourlyBtcRate = 0.00001
  const annualizedBtcRate = hourlyBtcRate * 24 * 365

  it("returns null when funding rate is missing for the base symbol", () => {
    expect(
      signedFundingRateForPosition(btcPosition(), { ETH: hourlyBtcRate }),
    ).toBeNull()
    expect(signedFundingRateForPosition(btcPosition())).toBeNull()
  })

  it("negates annualized funding for long positions", () => {
    expect(
      signedFundingRateForPosition(btcPosition({ side: "buy" }), {
        BTC: hourlyBtcRate,
      }),
    ).toBe(-annualizedBtcRate)
  })

  it("keeps positive annualized funding for short positions", () => {
    expect(
      signedFundingRateForPosition(btcPosition({ side: "sell" }), {
        BTC: hourlyBtcRate,
      }),
    ).toBe(annualizedBtcRate)
  })
})

describe("positionDelta", () => {
  it("computes signed delta when flipping from long to short", () => {
    const symbol = "BTC/USDC:USDC"
    const currentPortfolio = {
      [symbol]: btcPosition({ side: "buy", notional: 5000 }),
    }
    const targetPortfolio = {
      [symbol]: btcPosition({ side: "sell", notional: 5000 }),
    }

    expect(positionDelta(symbol, currentPortfolio, targetPortfolio)).toBe(10000)
  })

  it("treats a missing current position as zero notional", () => {
    const symbol = "BTC/USDC:USDC"
    const targetPortfolio = {
      [symbol]: btcPosition({ side: "buy", notional: 2500 }),
    }

    expect(positionDelta(symbol, {}, targetPortfolio)).toBe(2500)
  })
})

describe("displayPosition", () => {
  const symbol = "BTC/USDC:USDC"

  it("prefers target portfolio over archived and current entries", () => {
    const target = btcPosition({ notional: 3000 })
    const archived = btcPosition({ notional: 2000 })
    const current = btcPosition({ notional: 1000 })

    expect(
      displayPosition(
        symbol,
        { [symbol]: current },
        { [symbol]: target },
        { [symbol]: archived },
      ),
    ).toBe(target)
  })

  it("falls back to archived portfolio when target is absent", () => {
    const archived = btcPosition({ notional: 2000 })

    expect(displayPosition(symbol, {}, {}, { [symbol]: archived })).toBe(
      archived,
    )
  })

  it("throws when the symbol is missing from all portfolios", () => {
    expect(() => displayPosition(symbol, {}, {}, {})).toThrow(
      `Symbol ${symbol} not found in any portfolio`,
    )
  })
})
