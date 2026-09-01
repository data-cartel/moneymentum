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
  isCcxtRequestTimeout,
  snapToDeriveStep,
  DEFAULT_DERIVE_AMOUNT_STEP,
  type DeriveBatchOrderRequest,
  type DeriveSessionCredentials,
} from "@/services/derive/index"

const credentials = (): DeriveSessionCredentials => ({
  deriveWallet: "0x2625A865DeD8FA2C36183E299A1a358B64EE7238",
  sessionAddress: "0xA62eF13dF0037Ca5A95F7759b79202ce9eF2B7fd",
  sessionPrivateKey:
    "0x5b47181e772213c58ba3880a6e63a4458df76b3642209f95a817c697d5bf4548",
  networkMode: "testnet",
  subaccountId: 144457,
})

describe("isCcxtRequestTimeout", () => {
  it("matches CCXT RequestTimeout by name or message", () => {
    const named = new Error("boom")
    named.name = "RequestTimeout"
    expect(isCcxtRequestTimeout(named)).toBe(true)
    expect(
      isCcxtRequestTimeout(
        new Error("derive POST /private/order request timed out (10000 ms)"),
      ),
    ).toBe(true)
    expect(isCcxtRequestTimeout(new Error("insufficient margin"))).toBe(false)
  })
})

describe("snapToDeriveStep", () => {
  it("rounds contracts onto the venue amount_step", () => {
    expect(snapToDeriveStep(0.011866234, DEFAULT_DERIVE_AMOUNT_STEP)).toBe(
      0.01187,
    )
    expect(snapToDeriveStep(2, DEFAULT_DERIVE_AMOUNT_STEP)).toBe(2)
    expect(snapToDeriveStep(0, DEFAULT_DERIVE_AMOUNT_STEP)).toBe(0)
  })
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

  it("recovers a timed-out createOrder from a matching open order", async () => {
    const timeout = new Error(
      "derive POST /derive-api-demo/private/order request timed out (10000 ms)",
    )
    timeout.name = "RequestTimeout"
    const createOrder = vi.fn().mockRejectedValue(timeout)
    const fetchOpenOrders = vi.fn().mockResolvedValue([
      {
        id: "recovered",
        symbol: "ETH/USD:USDC",
        side: "buy",
        amount: 0.01,
        price: 2000,
        status: "open",
      },
    ])

    const client = new DeriveTradingClient(credentials())
    const exchange = (
      client as unknown as {
        exchange: {
          createOrder: typeof createOrder
          fetchOpenOrders: typeof fetchOpenOrders
        }
      }
    ).exchange
    exchange.createOrder = createOrder
    exchange.fetchOpenOrders = fetchOpenOrders
    vi.spyOn(client, "resolveSymbol").mockResolvedValue("ETH/USD:USDC")

    const orders = await client.createOrdersBatch([
      { symbol: "ETH-PERP", side: "buy", amount: 0.01, price: 2000 },
    ])

    expect(orders).toEqual([
      expect.objectContaining({ id: "recovered", status: "open" }),
    ])
    expect(fetchOpenOrders).toHaveBeenCalled()
  })

  it("snaps amount and price to market steps before createOrder", async () => {
    const createOrder = vi.fn().mockResolvedValue({
      id: "snapped",
      symbol: "BTC/USD:USDC-260816-64000-C",
      side: "buy",
    })
    const client = new DeriveTradingClient(credentials())
    const exchange = (
      client as unknown as {
        exchange: {
          createOrder: typeof createOrder
          market: (symbol: string) => {
            symbol: string
            option: boolean
            precision: { amount: number; price: number }
            info: { amount_step: string; tick_size: string }
          }
        }
      }
    ).exchange
    exchange.createOrder = createOrder
    exchange.market = () => ({
      symbol: "BTC/USD:USDC-260816-64000-C",
      option: true,
      precision: { amount: 0.00001, price: 0.1 },
      info: { amount_step: "0.00001", tick_size: "0.1" },
    })
    vi.spyOn(client, "resolveSymbol").mockResolvedValue(
      "BTC/USD:USDC-260816-64000-C",
    )

    await client.createOrdersBatch([
      {
        symbol: "BTC-20260816-64000-C",
        side: "buy",
        amount: 0.011866234,
        price: 927.04,
      },
    ])

    expect(createOrder).toHaveBeenCalledWith(
      "BTC/USD:USDC-260816-64000-C",
      "limit",
      "buy",
      0.01187,
      927,
      {
        subaccount_id: 144457,
        max_fee: 927 * 0.01187 * 2,
      },
    )
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
    ).rejects.toMatchObject({ _tag: "DeriveSubaccountMissing" })
  })
})

describe("DeriveTradingClient.placeAndMonitorOrders", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns open createOrder results as working without watching fills", async () => {
    const createOrder = vi.fn().mockResolvedValue({
      id: "order-1",
      symbol: "ETH/USD:USDC",
      side: "buy",
      status: "open",
      info: { order_status: "open" },
    })

    const client = new DeriveTradingClient(credentials())
    const exchange = (
      client as unknown as {
        exchange: {
          loadMarkets: () => Promise<Record<string, never>>
          markets: Record<string, { symbol: string; swap: boolean }>
          markets_by_id: Record<string, { symbol: string }>
          createOrder: typeof createOrder
          watchOrders?: unknown
        }
      }
    ).exchange

    exchange.loadMarkets = vi.fn().mockResolvedValue({})
    exchange.markets = {
      "ETH/USD:USDC": { symbol: "ETH/USD:USDC", swap: true },
    }
    exchange.markets_by_id = {}
    exchange.createOrder = createOrder
    exchange.watchOrders = vi.fn()
    vi.spyOn(client, "resolveSymbol").mockResolvedValue("ETH/USD:USDC")

    const results = await client.placeAndMonitorOrders([
      { symbol: "ETH-PERP", side: "buy", amount: 0.01, price: 2000 },
    ])

    expect(results).toEqual([
      {
        symbol: "ETH-PERP",
        side: "buy",
        status: "working",
        message: null,
      },
    ])
    expect(exchange.watchOrders).not.toHaveBeenCalled()
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
