import { describe, expect, it } from "vitest"

import { parseFactorScores } from "./useFactorScores"

const validRow = {
  ticker: "BTC",
  beta: 1.1,
  annualized_volatility: 0.45,
  sharpe: 1.2,
  sortino: 1.5,
  cum_return: 0.1,
  carry: null,
}

describe("parseFactorScores", () => {
  it("parses a valid factor scores payload", () => {
    expect(parseFactorScores([validRow])).toEqual([validRow])
  })

  it("rejects a non-array response", () => {
    expect(() => parseFactorScores({ ticker: "BTC" })).toThrow(
      "invalid factor scores response: expected a JSON array",
    )
  })

  it("rejects rows with a missing ticker", () => {
    expect(() =>
      parseFactorScores([
        {
          beta: 1,
          annualized_volatility: 0.4,
          sharpe: 1,
          sortino: 1,
          cum_return: 0.1,
          carry: null,
        },
      ]),
    ).toThrow("invalid factor score: ticker must be a non-empty string")
  })

  it("rejects rows with a renamed or missing metric field", () => {
    expect(() =>
      parseFactorScores([
        {
          ticker: "BTC",
          annualized_volatility: 0.4,
          sharpe: 1,
          sortino: 1,
          cum_return: 0.1,
          carry: null,
        },
      ]),
    ).toThrow("invalid factor score for BTC: missing beta")
  })

  it("rejects rows where a metric has the wrong type", () => {
    expect(() =>
      parseFactorScores([
        {
          ...validRow,
          sharpe: "high",
        },
      ]),
    ).toThrow(
      "invalid factor score for BTC: sharpe must be a finite number or null",
    )
  })
})
