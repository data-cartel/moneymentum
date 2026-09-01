import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { describe, expect, it } from "vitest"

/* eslint-disable solid/reactivity -- assertions read the store after each apply */

import type { OptionQuote, OptionsSnapshot } from "./optionsSnapshot"
import {
  applyOptionsSnapshot,
  emptyQuoteBook,
  type QuoteBook,
} from "./quoteBook"
import { useDeriveOrderSelection } from "./useDeriveOrderSelection"

const sampleQuote = (overrides: Partial<OptionQuote> = {}): OptionQuote => ({
  instrument_name: "ETH-20260327-2000-C",
  kind: "C",
  strike: 2000,
  expiry: "2026-03-27",
  expiry_unix: 1_774_569_600 as OptionQuote["expiry_unix"],
  bid: 90,
  ask: 95,
  bid_size: 1,
  ask_size: 1,
  mark: 92,
  spot_price: 2100,
  moneyness: "in_the_money",
  greeks: {
    bid_iv: 0.4,
    ask_iv: 0.42,
    delta: 0.55,
    gamma: 0.01,
    vega: 10,
    theta: -5,
    iv: 0.41,
    rho: -1,
    forward_price: 2100,
    discount_factor: 0.99,
    option_model_mark: 92,
  },
  ...overrides,
})

const snapshotWithQuotes = (quotes: OptionQuote[]): OptionsSnapshot => ({
  asset: "ETH",
  updated_at: "2026-03-01T00:00:00Z",
  active_expiry_unix: 1_774_569_600 as OptionsSnapshot["active_expiry_unix"],
  expiry_unixes: [1_774_569_600 as OptionsSnapshot["active_expiry_unix"]],
  spot_price: 2100,
  expiry_dates: ["2026-03-27"],
  strikes: [...new Set(quotes.map(quote => quote.strike))],
  quotes,
})

const callQuote = sampleQuote({
  instrument_name: "ETH-20260327-2000-C",
  kind: "C",
})
const putQuote = sampleQuote({
  instrument_name: "ETH-20260327-2000-P",
  kind: "P",
  bid: 40,
  ask: 42,
  mark: 41,
  moneyness: "out_of_the_money",
  greeks: {
    ...callQuote.greeks,
    delta: -0.3,
  },
})

describe("applyOptionsSnapshot", () => {
  it("drops a call/put leg that a later snapshot omits", () => {
    createRoot(dispose => {
      const [book, setBook] = createStore(emptyQuoteBook())

      applyOptionsSnapshot(
        setBook,
        snapshotWithQuotes([callQuote, putQuote]),
        book.byInstrument,
        { applyColdGreeks: true },
      )
      expect(book.callByStrike[2000]).toBe("ETH-20260327-2000-C")
      expect(book.putByStrike[2000]).toBe("ETH-20260327-2000-P")
      expect(book.byInstrument["ETH-20260327-2000-P"]).toBeDefined()

      applyOptionsSnapshot(
        setBook,
        snapshotWithQuotes([callQuote]),
        book.byInstrument,
        { applyColdGreeks: true },
      )

      expect(book.callByStrike[2000]).toBe("ETH-20260327-2000-C")
      expect(book.putByStrike[2000]).toBeUndefined()
      expect(book.byInstrument["ETH-20260327-2000-P"]).toBeUndefined()

      const selection = useDeriveOrderSelection({
        book,
        onOpenOrderPanel: () => undefined,
      })
      selection.handleQuoteSelect("ETH-20260327-2000-P", "ask")
      expect(selection.selection()).toBeNull()

      expect(chainLegInstrument(book, 2000, "put")).toBeUndefined()

      dispose()
    })
  })
})

const chainLegInstrument = (
  book: QuoteBook,
  strike: number,
  leg: "call" | "put",
): string | undefined =>
  leg === "call" ? book.callByStrike[strike] : book.putByStrike[strike]
