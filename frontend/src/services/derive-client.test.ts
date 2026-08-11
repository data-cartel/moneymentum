import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("ccxt/derive", () => ({
  default: vi.fn(function DeriveMock(this: {
    setSandboxMode: ReturnType<typeof vi.fn>
    urls: { api: Record<string, string> }
    options: Record<string, unknown>
  }) {
    this.setSandboxMode = vi.fn()
    this.urls = { api: {} }
    this.options = {}
    return this
  }),
}))

import {
  mapDeriveOrderForWatch,
  DeriveTradingClient,
  type DeriveBatchOrderRequest,
} from "./derive-client"
import type { DeriveSessionCredentials } from "./deriveAccount"

const credentials = (): DeriveSessionCredentials => ({
  deriveWallet: "0x2625A865DeD8FA2C36183E299A1a358B64EE7238",
  sessionAddress: "0xA62eF13dF0037Ca5A95F7759b79202ce9eF2B7fd",
  sessionPrivateKey:
    "0x5b47181e772213c58ba3880a6e63a4458df76b3642209f95a817c697d5bf4548",
  networkMode: "testnet",
  subaccountId: 144457,
})

describe("mapDeriveOrderForWatch", () => {
  it("maps filled order_status to filled", () => {
    expect(
      mapDeriveOrderForWatch({
        status: "closed",
        info: { order_status: "filled" },
      }),
    ).toEqual({ status: "filled", message: null })
  })

  it("maps open order_status to working", () => {
    expect(
      mapDeriveOrderForWatch({
        status: "open",
        info: { order_status: "open" },
      }),
    ).toEqual({ status: "working", message: null })
  })

  it("maps cancelled order_status to failed", () => {
    expect(
      mapDeriveOrderForWatch({
        status: "canceled",
        info: { order_status: "cancelled" },
      }),
    ).toEqual({ status: "failed", message: "Order cancelled" })
  })
})

describe("DeriveTradingClient.createOrdersBatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("creates orders sequentially with max_fee and subaccount_id", async () => {
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce({ id: "1", symbol: "ETH/USD:USDC", side: "buy" })
      .mockResolvedValueOnce({ id: "2", symbol: "ETH/USD:USDC", side: "sell" })

    const client = new DeriveTradingClient(credentials())
    const exchange = (
      client as unknown as {
        exchange: {
          loadMarkets: () => Promise<Record<string, never>>
          markets: Record<string, { symbol: string; swap: boolean }>
          markets_by_id: Record<string, { symbol: string }>
          createOrder: typeof createOrder
          resolveSymbol?: unknown
        }
      }
    ).exchange

    exchange.loadMarkets = vi.fn().mockResolvedValue({})
    exchange.markets = {
      "ETH/USD:USDC": { symbol: "ETH/USD:USDC", swap: true },
    }
    exchange.markets_by_id = {
      "ETH-PERP": { symbol: "ETH/USD:USDC" },
    }
    exchange.createOrder = createOrder

    // Bypass private marketsLoaded + resolve via public resolveSymbol path
    vi.spyOn(client, "resolveSymbol").mockResolvedValue("ETH/USD:USDC")

    const requests: DeriveBatchOrderRequest[] = [
      {
        symbol: "ETH-PERP",
        side: "buy",
        amount: 0.01,
        price: 2000,
      },
      {
        symbol: "ETH-PERP",
        side: "sell",
        amount: 0.01,
        price: 2100,
        maxFee: 50,
      },
    ]

    const orders = await client.createOrdersBatch(requests)

    expect(orders).toHaveLength(2)
    expect(createOrder).toHaveBeenCalledTimes(2)
    expect(createOrder.mock.calls[0]).toEqual([
      "ETH/USD:USDC",
      "limit",
      "buy",
      0.01,
      2000,
      { subaccount_id: 144457, max_fee: 40 },
    ])
    expect(createOrder.mock.calls[1]).toEqual([
      "ETH/USD:USDC",
      "limit",
      "sell",
      0.01,
      2100,
      { subaccount_id: 144457, max_fee: 50 },
    ])
  })

  it("rejects trading when subaccount id is missing", async () => {
    const client = new DeriveTradingClient({
      ...credentials(),
      subaccountId: null,
    })
    vi.spyOn(client, "resolveSymbol").mockResolvedValue("ETH/USD:USDC")

    await expect(
      client.createOrdersBatch([
        { symbol: "ETH-PERP", side: "buy", amount: 1, price: 10 },
      ]),
    ).rejects.toThrow(/subaccount id/)
  })
})

describe("DeriveTradingClient.cancelOrder", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("cancels by id with subaccount params and resolved symbol", async () => {
    const cancelOrder = vi.fn().mockResolvedValue({
      id: "order-1",
      symbol: "ETH/USD:USDC-250925-2000-C",
      status: "canceled",
    })

    const client = new DeriveTradingClient(credentials())
    const exchange = (
      client as unknown as {
        exchange: {
          loadMarkets: () => Promise<Record<string, never>>
          markets: Record<string, { symbol: string }>
          markets_by_id: Record<string, { symbol: string }>
          cancelOrder: typeof cancelOrder
        }
      }
    ).exchange

    exchange.loadMarkets = vi.fn().mockResolvedValue({})
    exchange.markets = {
      "ETH/USD:USDC-250925-2000-C": { symbol: "ETH/USD:USDC-250925-2000-C" },
    }
    exchange.markets_by_id = {}
    exchange.cancelOrder = cancelOrder
    vi.spyOn(client, "resolveSymbol").mockResolvedValue(
      "ETH/USD:USDC-250925-2000-C",
    )

    await client.cancelOrder("order-1", "ETH-20250925-2000-C")

    expect(cancelOrder).toHaveBeenCalledWith(
      "order-1",
      "ETH/USD:USDC-250925-2000-C",
      { subaccount_id: 144457 },
    )
  })
})
