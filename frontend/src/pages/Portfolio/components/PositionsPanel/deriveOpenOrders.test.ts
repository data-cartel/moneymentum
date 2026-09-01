import { describe, expect, it } from "vitest"

import {
  formatDeriveInstrumentLabel,
  mapDeriveOpenOrderRow,
  mapDeriveOpenOrderRows,
  refreshProgressAlongCycle,
} from "./deriveOpenOrders"

describe("refreshProgressAlongCycle", () => {
  it("tracks progress from 0 to 1 across the duration window", () => {
    expect(refreshProgressAlongCycle(1000, 1000, 10_000)).toBe(0)
    expect(refreshProgressAlongCycle(1000, 6000, 10_000)).toBe(0.5)
    expect(refreshProgressAlongCycle(1000, 11_000, 10_000)).toBe(1)
  })
})

describe("formatDeriveInstrumentLabel", () => {
  it("formats put and call instrument names like the Derive UI", () => {
    expect(formatDeriveInstrumentLabel("BTC-20250821-62000-P")).toBe(
      "BTC $62,000 Put Aug 21 2025",
    )
    expect(formatDeriveInstrumentLabel("ETH-20250925-2000-C")).toBe(
      "ETH $2,000 Call Sep 25 2025",
    )
  })

  it("omits the year for expiries in the current UTC year", () => {
    const year = new Date().getUTCFullYear()
    const yyyymmdd = `${String(year)}0815`
    expect(formatDeriveInstrumentLabel(`BTC-${yyyymmdd}-1000-C`)).toBe(
      "BTC $1,000 Call Aug 15",
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
      label: "BTC $62,000 Put Aug 21 2025",
      side: "buy",
      amount: 1,
      price: 0.07813,
      notional: 0.07813,
      status: "open",
      orderType: "limit",
    })
  })

  it("reads size and price from Derive info when CCXT leaves amount/cost empty", () => {
    expect(
      mapDeriveOpenOrderRow({
        id: "order-2",
        symbol: "ETH/USD:USDC-250925-2000-C",
        side: "buy",
        price: 497.2,
        cost: 0,
        status: "open",
        info: {
          instrument_name: "ETH-20260925-2000-C",
          amount: "0.20112626527132446",
          filled_amount: "0",
          limit_price: "497.2",
          order_status: "open",
          order_type: "limit",
        },
      }),
    ).toEqual({
      id: "order-2",
      symbol: "ETH/USD:USDC-250925-2000-C",
      label: "ETH $2,000 Call Sep 25",
      side: "buy",
      amount: 0.20112626527132446,
      price: 497.2,
      notional: 0.20112626527132446 * 497.2,
      status: "open",
      orderType: "limit",
    })
  })

  it("uses remaining size after partial fills from info.filled_amount", () => {
    const row = mapDeriveOpenOrderRow({
      id: "order-3",
      symbol: "ETH/USD:USDC-250925-2000-C",
      side: "sell",
      info: {
        instrument_name: "ETH-20260925-2000-C",
        amount: "1",
        filled_amount: "0.25",
        limit_price: "100",
        order_status: "open",
        order_type: "limit",
      },
    })

    expect(row?.amount).toBe(0.75)
    expect(row?.notional).toBe(75)
  })

  it("drops orders without an id or symbol", () => {
    expect(mapDeriveOpenOrderRow({ side: "buy", amount: 1 })).toBeNull()
    expect(mapDeriveOpenOrderRows([{ id: "1" }, { symbol: "X" }])).toEqual([])
  })
})
