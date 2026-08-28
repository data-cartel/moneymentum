import { describe, expect, it } from "vitest"

import type { OptionQuote } from "./optionsSnapshot"
import {
  amountFromNotionalAndPrice,
  amountStepFromPremium,
  defaultContractsForPremium,
  formatOptionSelectionLabel,
  limitPriceStepFromPremium,
  notionalFromAmountAndPrice,
  quoteSideForOrderSide,
  selectionFromQuoteClick,
  selectionWithOrderSide,
} from "./orderTicket"

const sampleQuote = (overrides: Partial<OptionQuote> = {}): OptionQuote => ({
  instrument_name: "BTC-20260829-100000-P",
  kind: "P",
  strike: 100_000,
  expiry: "2026-08-29",
  expiry_unix: 1_788_000_000 as OptionQuote["expiry_unix"],
  bid: 200,
  ask: 210,
  bid_size: 1,
  ask_size: 1,
  mark: 205,
  spot_price: 110_000,
  moneyness: "out_of_the_money",
  greeks: {
    bid_iv: 0.4,
    ask_iv: 0.42,
    delta: -0.2,
    gamma: 0.01,
    vega: 10,
    theta: -5,
    iv: 0.41,
    rho: -1,
    forward_price: 110_000,
    discount_factor: 0.99,
    option_model_mark: 205,
  },
  ...overrides,
})

describe("selectionFromQuoteClick", () => {
  it("maps ask click to buy at ask", () => {
    expect(selectionFromQuoteClick(sampleQuote(), "ask")).toEqual({
      instrumentName: "BTC-20260829-100000-P",
      displayLabel: "BTC $100000 Put Aug 29",
      side: "buy",
      limitPrice: 210,
      quoteSide: "ask",
    })
  })

  it("maps bid click to sell at bid", () => {
    expect(selectionFromQuoteClick(sampleQuote(), "bid")).toEqual({
      instrumentName: "BTC-20260829-100000-P",
      displayLabel: "BTC $100000 Put Aug 29",
      side: "sell",
      limitPrice: 200,
      quoteSide: "bid",
    })
  })

  it("selects with limitPrice 0 when clicked side has no quote", () => {
    expect(selectionFromQuoteClick(sampleQuote({ ask: null }), "ask")).toEqual({
      instrumentName: "BTC-20260829-100000-P",
      displayLabel: "BTC $100000 Put Aug 29",
      side: "buy",
      limitPrice: 0,
      quoteSide: "ask",
    })
    expect(selectionFromQuoteClick(sampleQuote({ bid: 0 }), "bid")).toEqual({
      instrumentName: "BTC-20260829-100000-P",
      displayLabel: "BTC $100000 Put Aug 29",
      side: "sell",
      limitPrice: 0,
      quoteSide: "bid",
    })
  })

  it("replaces previous selection when a different empty quote is clicked", () => {
    const previous = selectionFromQuoteClick(sampleQuote(), "ask")
    expect(
      selectionFromQuoteClick(
        sampleQuote({
          instrument_name: "ETH-20260829-3000-C",
          kind: "C",
          strike: 3000,
          ask: null,
          expiry: "2026-08-29",
        }),
        "ask",
        previous,
      ),
    ).toEqual({
      instrumentName: "ETH-20260829-3000-C",
      displayLabel: "ETH $3000 Call Aug 29",
      side: "buy",
      limitPrice: 0,
      quoteSide: "ask",
    })
  })

  it("clears selection when the same instrument and side is clicked again", () => {
    const previous = selectionFromQuoteClick(sampleQuote(), "ask")
    expect(previous).not.toBeNull()
    expect(selectionFromQuoteClick(sampleQuote(), "ask", previous)).toBeNull()
  })

  it("replaces selection when a different side or instrument is clicked", () => {
    const previous = selectionFromQuoteClick(sampleQuote(), "ask")
    expect(selectionFromQuoteClick(sampleQuote(), "bid", previous)).toEqual({
      instrumentName: "BTC-20260829-100000-P",
      displayLabel: "BTC $100000 Put Aug 29",
      side: "sell",
      limitPrice: 200,
      quoteSide: "bid",
    })
  })
})

describe("selectionWithOrderSide", () => {
  it("maps buy to ask highlight and sell to bid", () => {
    const base = selectionFromQuoteClick(sampleQuote(), "ask")
    expect(base).not.toBeNull()
    expect(selectionWithOrderSide(base!, "sell", 200)).toEqual({
      ...base!,
      side: "sell",
      quoteSide: "bid",
      limitPrice: 200,
    })
    expect(selectionWithOrderSide(base!, "buy", 210).quoteSide).toBe("ask")
  })

  it("sets limit to 0 when live price is missing", () => {
    const base = selectionFromQuoteClick(sampleQuote(), "ask")
    expect(base).not.toBeNull()
    expect(selectionWithOrderSide(base!, "sell", null).limitPrice).toBe(0)
  })
})

describe("quoteSideForOrderSide", () => {
  it("pairs order side with book side", () => {
    expect(quoteSideForOrderSide("buy")).toBe("ask")
    expect(quoteSideForOrderSide("sell")).toBe("bid")
  })
})

describe("formatOptionSelectionLabel", () => {
  it("formats asset strike kind and expiry", () => {
    expect(
      formatOptionSelectionLabel(
        sampleQuote({
          instrument_name: "SOL-20260814-76-C",
          kind: "C",
          strike: 76,
          expiry: "2026-08-14",
        }),
      ),
    ).toBe("SOL $76 Call Aug 14")
  })
})

describe("defaultContractsForPremium", () => {
  it("uses one contract when premium already meets minimum", () => {
    expect(defaultContractsForPremium(200, 11)).toBe(1)
  })

  it("rounds up contracts so premium meets minimum", () => {
    expect(defaultContractsForPremium(5, 11)).toBe(2.2)
  })
})

describe("amountStepFromPremium", () => {
  it("uses a fine step for expensive BTC-like premiums", () => {
    expect(amountStepFromPremium(1000)).toBe(0.00001)
  })

  it("uses a coarser step for cheap SOL-like premiums", () => {
    expect(amountStepFromPremium(0.1)).toBe(0.1)
  })

  it("falls back to the finest step when premium is missing", () => {
    expect(amountStepFromPremium(0)).toBe(0.00001)
  })
})

describe("limitPriceStepFromPremium", () => {
  it("uses 1 for large premiums and 0.01 for small ones", () => {
    expect(limitPriceStepFromPremium(2000)).toBe(1)
    expect(limitPriceStepFromPremium(5)).toBe(0.01)
  })
})

describe("notional and amount conversion", () => {
  it("converts amount and price to notional", () => {
    expect(notionalFromAmountAndPrice(2, 50)).toBe(100)
  })

  it("converts notional and price to amount", () => {
    expect(amountFromNotionalAndPrice(100, 50)).toBe(2)
  })
})
