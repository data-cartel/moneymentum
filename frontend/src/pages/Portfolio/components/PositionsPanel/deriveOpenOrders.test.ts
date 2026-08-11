import { describe, expect, it } from "vitest"

import {
  formatDeriveInstrumentLabel,
  mapDeriveOpenOrderRow,
  mapDeriveOpenOrderRows,
} from "./deriveOpenOrders"

describe("formatDeriveInstrumentLabel", () => {
  it("formats put and call instrument names like the Derive UI", () => {
    expect(formatDeriveInstrumentLabel("BTC-20250821-62000-P")).toBe(
      "BTC $62,000 Put Aug 21",
    )
    expect(formatDeriveInstrumentLabel("ETH-20250925-2000-C")).toBe(
      "ETH $2,000 Call Sep 25",
    )
  })

  it("returns the raw string when the instrument name is not recognized", () => {
    expect(formatDeriveInstrumentLabel("BTC/USDC:USDC")).toBe("BTC/USDC:USDC")
  })
})

describe("mapDeriveOpenOrderRow", () => {
  it("maps a resting limit into a display row", () => {
    expect(
      mapDeriveOpenOrderRow({
        id: "order-1",
        symbol: "BTC/USD:USDC-250821-62000-P",
        side: "buy",
        amount: 1,
        price: 0.07813,
        status: "open",
        info: {
          instrument_name: "BTC-20250821-62000-P",
          order_status: "open",
          order_type: "limit",
        },
      }),
    ).toEqual({
      id: "order-1",
      symbol: "BTC/USD:USDC-250821-62000-P",
      label: "BTC $62,000 Put Aug 21",
      side: "buy",
      amount: 1,
      price: 0.07813,
      notional: 0.07813,
      status: "open",
      orderType: "limit",
    })
  })

  it("drops orders without an id or symbol", () => {
    expect(mapDeriveOpenOrderRow({ side: "buy", amount: 1 })).toBeNull()
    expect(mapDeriveOpenOrderRows([{ id: "1" }, { symbol: "X" }])).toEqual([])
  })
})
