import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Order } from "ccxt"

import type { WalletCredentials } from "@/contexts/wallet-context"
import type { RebalanceAction } from "@/pages/Portfolio/hooks/portfolioRebalancer"

const mockExchange = {
  setSandboxMode: vi.fn(),
  options: {} as Record<string, unknown>,
  urls: {} as Record<string, string | Record<string, string>>,
  walletAddress: "0xWallet",
  markets: undefined as Record<string, unknown> | undefined,
  markets_by_id: undefined as Record<string, unknown[]> | undefined,

  setMarkets: vi.fn(
    (
      markets: Array<{ id: string; symbol: string } & Record<string, unknown>>,
    ) => {
      const bySymbol: Record<string, unknown> = {}
      const byId: Record<string, unknown[]> = {}
      for (const market of markets) {
        bySymbol[market.symbol] = market
        const existing = byId[market.id] ?? []
        existing.push(market)
        byId[market.id] = existing
      }
      mockExchange.markets = bySymbol
      mockExchange.markets_by_id = byId
    },
  ),

  fetchBalance: vi.fn(),
  fetchTickers: vi.fn(),
  fetchTicker: vi.fn(),
  fetchPositions: vi.fn(),
  setLeverage: vi.fn(),
  createOrder: vi.fn(),
  createOrdersWs: vi.fn(),
  watchOrders: vi.fn(),
  unWatchOrders: vi.fn(),
  fetchOrders: vi.fn(),
}

vi.mock("ccxt", () => ({
  default: {},
  pro: {
    hyperliquid: class {
      setSandboxMode = mockExchange.setSandboxMode
      options = mockExchange.options
      urls = mockExchange.urls
      walletAddress = mockExchange.walletAddress

      get markets() {
        return mockExchange.markets
      }
      set markets(value) {
        mockExchange.markets = value
      }
      get markets_by_id() {
        return mockExchange.markets_by_id
      }
      set markets_by_id(value) {
        mockExchange.markets_by_id = value
      }

      setMarkets = mockExchange.setMarkets
      fetchBalance = mockExchange.fetchBalance
      fetchTickers = mockExchange.fetchTickers
      fetchTicker = mockExchange.fetchTicker
      fetchPositions = mockExchange.fetchPositions
      setLeverage = mockExchange.setLeverage
      createOrder = mockExchange.createOrder
      createOrdersWs = mockExchange.createOrdersWs
      watchOrders = mockExchange.watchOrders
      unWatchOrders = mockExchange.unWatchOrders
      fetchOrders = mockExchange.fetchOrders
    },
  },
}))

import {
  HyperliquidClient,
  millisecondsUntilNextUtcMidnight,
} from "./hyperliquid-client"

const stubBackendMarketsFetch = (
  network: "mainnet" | "testnet",
  tickers: Array<{
    symbol: string
    assetIndex: number
    universeName?: string
    maxLeverage?: number
    onlyIsolated?: boolean
    szDecimals?: number
    markPx?: number
  }>,
  clearinghousePositions: Array<{
    coin: string
    szi: string
    positionValue: string
  }> = [],
): void => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    if (url.includes("/info")) {
      const rawBody = init?.body
      const bodyText =
        typeof rawBody === "string"
          ? rawBody
          : rawBody === undefined
            ? "{}"
            : null

      if (bodyText === null) {
        throw new Error("unexpected fetch body type in test stub")
      }

      const body = JSON.parse(bodyText) as { type?: string }
      if (body.type === "metaAndAssetCtxs") {
        return {
          ok: true,
          json: async () => [
            {
              universe: tickers.map(entry => ({
                name: entry.universeName ?? entry.symbol.split("/")[0],
                szDecimals: entry.szDecimals ?? 5,
              })),
            },
            tickers.map(entry => ({
              markPx: String(entry.markPx ?? 50_000),
            })),
          ],
        } as Response
      }

      if (body.type === "clearinghouseState") {
        return {
          ok: true,
          json: async () => ({
            assetPositions: clearinghousePositions.map(position => ({
              position: {
                coin: position.coin,
                szi: position.szi,
                entryPx: "1",
                positionValue: position.positionValue,
                unrealizedPnl: "0",
                leverage: { value: "2" },
              },
            })),
          }),
        } as Response
      }
    }

    if (!url.includes(`network=${network}`)) {
      throw new Error(`unexpected fetch: ${url}`)
    }

    return {
      ok: true,
      headers: new Headers({ "cache-control": "public, max-age=86400" }),
      json: async () =>
        ({
          tickers: tickers.map(entry => entry.symbol),
          leverageLimits: tickers.map(entry => ({
            symbol: entry.symbol,
            maxLeverage: entry.maxLeverage ?? 50,
            assetIndex: entry.assetIndex,
            onlyIsolated: entry.onlyIsolated === true,
          })),
          refreshedAt: new Date().toISOString(),
        }) as const,
    } as Response
  })
}

describe("HyperliquidClient", () => {
  const credentials: WalletCredentials = {
    accountAddress: "0xAccount",
    apiWalletAddress: "0xApiWallet",
    privateKey: "secret",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()

    mockExchange.options = {}
    mockExchange.urls = {}
    mockExchange.markets = undefined
    mockExchange.markets_by_id = undefined
    mockExchange.watchOrders.mockImplementation(async () => {
      const batches = mockExchange.createOrdersWs.mock.calls as Array<
        [Array<{ symbol: string }>]
      >
      if (batches.length === 0) {
        return []
      }

      return batches.flatMap(([requests]) =>
        requests.map(request => ({
          symbol: request.symbol,
          status: "closed",
          info: {},
        })),
      )
    })
    mockExchange.unWatchOrders.mockResolvedValue(undefined)
    mockExchange.fetchOrders.mockResolvedValue([])

    stubBackendMarketsFetch("mainnet", [
      { symbol: "BTC/USDC:USDC", assetIndex: 0, markPx: 50_000 },
      { symbol: "ETH/USDC:USDC", assetIndex: 1, markPx: 4_000 },
    ])

    const globalAny = globalThis as { localStorage?: Storage }
    if (
      !globalAny.localStorage ||
      typeof globalAny.localStorage.setItem !== "function"
    ) {
      const store = new Map<string, string>()
      globalAny.localStorage = {
        getItem: key => (store.has(key) ? store.get(key)! : null),
        setItem: (key, value) => {
          store.set(key, value)
        },
        removeItem: key => {
          store.delete(key)
        },
        clear: () => {
          store.clear()
        },
        key: index => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size
        },
      } as unknown as Storage
    }
  })

  it("enables sandbox mode on testnet", () => {
    new HyperliquidClient(credentials, "testnet")
    expect(mockExchange.setSandboxMode).toHaveBeenCalledWith(true)
  })

  it("parses account summary values from balance info", async () => {
    mockExchange.fetchBalance.mockResolvedValue({
      total: { USDC: 123 },
      info: {
        marginSummary: { accountValue: "1000.5", totalNtlPos: "1500" },
        withdrawable: "777.1",
      },
    })

    const client = new HyperliquidClient(credentials, "mainnet")
    const summary = await client.getAccountSummary()

    expect(summary).toEqual({
      accountValue: 1000.5,
      totalNotionalPosition: 1500,
      withdrawable: 777.1,
    })
  })

  it("maps positions to buy/sell current positions", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      if (!url.includes("/info")) {
        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      const rawBody = init?.body
      const bodyText =
        typeof rawBody === "string"
          ? rawBody
          : rawBody === undefined
            ? "{}"
            : null

      if (bodyText === null) {
        throw new Error("unexpected fetch body type in test stub")
      }

      const body = JSON.parse(bodyText) as { type?: string }

      if (body.type === "clearinghouseState") {
        return {
          ok: true,
          json: async () => ({
            assetPositions: [
              {
                position: {
                  coin: "BTC",
                  szi: "0.001",
                  entryPx: "50000",
                  positionValue: "100",
                  unrealizedPnl: "1",
                  leverage: { value: "2" },
                },
              },
              {
                position: {
                  coin: "ETH",
                  szi: "-0.1",
                  entryPx: "2000",
                  positionValue: "200",
                  unrealizedPnl: "-2",
                  leverage: { value: "3" },
                },
              },
              {
                position: {
                  coin: "SOL",
                  szi: "0",
                  positionValue: "0",
                  leverage: { value: "1" },
                },
              },
            ],
          }),
        } as Response
      }

      throw new Error(`Unexpected info request type: ${body.type ?? "unknown"}`)
    })

    const client = new HyperliquidClient(credentials, "mainnet")
    const positions = await client.getCurrentPositions()

    expect(positions).toHaveLength(2)
    expect(positions[0]).toMatchObject({
      symbol: "BTC/USDC:USDC",
      side: "buy",
      notional: 100,
      leverage: 2,
    })
    expect(positions[1]).toMatchObject({
      symbol: "ETH/USDC:USDC",
      side: "sell",
      notional: 200,
      leverage: 3,
    })
    expect(mockExchange.fetchPositions).not.toHaveBeenCalled()
  })

  it("rejects a malformed metaAndAssetCtxs payload shape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      if (url.includes("/info")) {
        return { ok: true, json: async () => [null, []] } as Response
      }

      return {
        ok: true,
        headers: new Headers({ "cache-control": "public, max-age=86400" }),
        json: async () => ({
          tickers: ["BTC/USDC:USDC"],
          leverageLimits: [
            { symbol: "BTC/USDC:USDC", maxLeverage: 50, assetIndex: 0 },
          ],
          refreshedAt: new Date().toISOString(),
        }),
      } as Response
    })

    const actions: RebalanceAction[] = [
      { kind: "close", symbol: "BTC/USDC:USDC", side: "buy" },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await expect(client.rebalancePositions(actions)).rejects.toThrow(
      "Unexpected metaAndAssetCtxs payload shape",
    )
  })

  it("rejects a metaAndAssetCtxs universe with a null entry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      if (url.includes("/info")) {
        return {
          ok: true,
          json: async () => [{ universe: [null] }, []],
        } as Response
      }

      return {
        ok: true,
        headers: new Headers({ "cache-control": "public, max-age=86400" }),
        json: async () => ({
          tickers: ["BTC/USDC:USDC"],
          leverageLimits: [
            { symbol: "BTC/USDC:USDC", maxLeverage: 50, assetIndex: 0 },
          ],
          refreshedAt: new Date().toISOString(),
        }),
      } as Response
    })

    const actions: RebalanceAction[] = [
      { kind: "close", symbol: "BTC/USDC:USDC", side: "buy" },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await expect(client.rebalancePositions(actions)).rejects.toThrow(
      "Unexpected metaAndAssetCtxs payload shape",
    )
  })

  it("sets leverage first then sends reduction batch and expansion batch", async () => {
    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 5,
        leverageChanged: true,
      },
      {
        kind: "close",
        symbol: "ETH/USDC:USDC",
        side: "buy",
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "ETH/USDC:USDC", side: "long", contracts: 0.5 },
    ])
    mockExchange.createOrdersWs
      .mockResolvedValueOnce([{ status: "closed", info: {} }])
      .mockResolvedValueOnce([{ status: "closed", info: {} }])

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(mockExchange.setLeverage).toHaveBeenCalledWith(
      5,
      "BTC/USDC:USDC",
      {},
    )

    expect(mockExchange.createOrdersWs).toHaveBeenCalledTimes(2)
    expect(mockExchange.fetchPositions).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2)
    expect(result[0].status).toBe("filled")
    expect(result[1].status).toBe("filled")

    const reductionBatch = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(reductionBatch).toHaveLength(1)
    expect(reductionBatch[0]).toMatchObject({
      symbol: "ETH/USDC:USDC",
      side: "sell",
      params: expect.objectContaining({ reduceOnly: true }),
    })

    const expansionBatch = mockExchange.createOrdersWs.mock.calls[1][0]
    expect(expansionBatch).toHaveLength(1)
    expect(expansionBatch[0]).toMatchObject({
      symbol: "BTC/USDC:USDC",
      side: "buy",
    })

    expect(expansionBatch[0].params).not.toMatchObject({
      reduceOnly: true,
    })
  })

  it("throws when setLeverage is rejected", async () => {
    stubBackendMarketsFetch("mainnet", [
      { symbol: "BTC/USDC:USDC", assetIndex: 0 },
      { symbol: "ETH/USDC:USDC", assetIndex: 1 },
      {
        symbol: "BANANA/USDC:USDC",
        assetIndex: 2,
        markPx: 0.05,
        universeName: "BANANA",
      },
    ])

    const leverageError = new Error(
      'hyperliquid {"status":"err","response":"Cross margin is not allowed for this asset."}',
    )

    mockExchange.setLeverage.mockRejectedValueOnce(leverageError)

    mockExchange.fetchTickers.mockResolvedValue({
      "BANANA/USDC:USDC": { last: 0.05 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BANANA/USDC:USDC",
        signedNotionalDelta: 15,
        leverage: 3,
        leverageChanged: true,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await expect(client.rebalancePositions(actions)).rejects.toThrow(
      "Failed to set leverage for BANANA/USDC:USDC: Cross margin is not allowed for this asset.",
    )

    expect(mockExchange.setLeverage).toHaveBeenCalledWith(
      3,
      "BANANA/USDC:USDC",
      {},
    )
    expect(mockExchange.createOrdersWs).not.toHaveBeenCalled()
  })

  it("sets isolated marginMode when backend marks onlyIsolated", async () => {
    stubBackendMarketsFetch("mainnet", [
      { symbol: "BTC/USDC:USDC", assetIndex: 0 },
      {
        symbol: "BANANA/USDC:USDC",
        assetIndex: 2,
        markPx: 0.05,
        universeName: "BANANA",
        onlyIsolated: true,
      },
    ])

    mockExchange.fetchTickers.mockResolvedValue({
      "BANANA/USDC:USDC": { last: 0.05 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockResolvedValue([
      { symbol: "BANANA/USDC:USDC", status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BANANA/USDC:USDC",
        signedNotionalDelta: 15,
        leverage: 3,
        leverageChanged: true,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.setLeverage).toHaveBeenCalledWith(
      3,
      "BANANA/USDC:USDC",
      { marginMode: "isolated" },
    )
  })

  it("OrderResult array lists reduction fills before expansion fills", async () => {
    const actions: RebalanceAction[] = [
      {
        kind: "close",
        symbol: "ETH/USDC:USDC",
        side: "buy",
      },
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "ETH/USDC:USDC", side: "long", contracts: 0.5 },
    ])
    mockExchange.createOrdersWs
      .mockResolvedValueOnce([{ status: "closed", info: {} }])
      .mockResolvedValueOnce([{ status: "closed", info: {} }])

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result).toHaveLength(2)
    expect(result[0].symbol).toBe("ETH/USDC:USDC")
    expect(result[1].symbol).toBe("BTC/USDC:USDC")
  })

  it("long shrink rebalance routes sell to the reduction phase (before any expansion batch)", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })

    mockExchange.fetchPositions.mockResolvedValue([
      {
        symbol: "BTC/USDC:USDC",
        side: "long",
        contracts: 0.002,
        notional: 100,
      },
    ])

    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: -50,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.createOrdersWs).toHaveBeenCalledTimes(1)
    const batch = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(batch[0]).toMatchObject({
      side: "sell",
      amount: 50 / 50_000,
    })
  })

  it("rebalance with no open position sends only an expansion batch", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })

    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.createOrdersWs).toHaveBeenCalledTimes(1)
    const batch = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(batch[0]).toMatchObject({
      side: "buy",
      amount: 100 / 50_000,
    })
    expect(batch[0].params).not.toMatchObject({ reduceOnly: true })
  })

  it("rebalance hydrates ccxt markets from backend with asset indices", async () => {
    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 10,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/hyperliquid/markets?network=mainnet"),
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    )

    expect(mockExchange.setMarkets).toHaveBeenCalled()
    expect(mockExchange.markets?.["BTC/USDC:USDC"]).toMatchObject({
      symbol: "BTC/USDC:USDC",
      baseId: "0",
      id: "0",
      swap: true,
      precision: { amount: 0.00001, price: 1 },
    })
  })

  it("hydrates low-price perps with szDecimals-based precision", async () => {
    stubBackendMarketsFetch("testnet", [
      {
        symbol: "AERO/USDC:USDC",
        assetIndex: 198,
        szDecimals: 0,
        markPx: 0.5288,
      },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "AERO/USDC:USDC",
        signedNotionalDelta: -10,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "AERO/USDC:USDC": { last: 0.5288 },
    })

    mockExchange.fetchPositions.mockResolvedValue([
      {
        symbol: "AERO/USDC:USDC",
        side: "long",
        contracts: 20,
        notional: 10.5,
      },
    ])

    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const client = new HyperliquidClient(credentials, "testnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.markets?.["AERO/USDC:USDC"]).toMatchObject({
      baseId: "198",
      precision: { amount: 1, price: 0.00001 },
    })
  })

  it("rebalance hydrates markets when universe name casing differs from ccxt base", async () => {
    stubBackendMarketsFetch("testnet", [
      {
        symbol: "KPEPE/USDC:USDC",
        assetIndex: 42,
        universeName: "kPEPE",
        szDecimals: 5,
        markPx: 0.007,
      },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "KPEPE/USDC:USDC",
        signedNotionalDelta: -10,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "KPEPE/USDC:USDC": { last: 0.007 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const client = new HyperliquidClient(credentials, "testnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.setMarkets).toHaveBeenCalled()
    expect(mockExchange.markets?.["KPEPE/USDC:USDC"]).toMatchObject({
      baseId: "42",
      precision: { amount: 0.00001, price: 0.1 },
    })

    expect(mockExchange.markets?.["KPEPE/USDC:USDC"]).not.toMatchObject({
      precision: { amount: 1, price: 0.0001 },
    })
  })

  it("rebalance hydrates markets when universe name contains colons", async () => {
    stubBackendMarketsFetch("testnet", [
      {
        symbol: "FLX-CRCL/USDC:USDC",
        assetIndex: 77,
        universeName: "flx:crcl",
        szDecimals: 3,
        markPx: 12.5,
      },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "FLX-CRCL/USDC:USDC",
        signedNotionalDelta: 10,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "FLX-CRCL/USDC:USDC": { last: 12.5 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const client = new HyperliquidClient(credentials, "testnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.markets?.["FLX-CRCL/USDC:USDC"]).toMatchObject({
      baseId: "77",
      precision: { amount: 0.001, price: 0.001 },
    })

    expect(mockExchange.markets?.["FLX-CRCL/USDC:USDC"]).not.toMatchObject({
      precision: { amount: 1, price: 0.0001 },
    })
  })

  it("fetchTickers and fetchPositions run together during rebalance", async () => {
    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 10,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.fetchTickers).toHaveBeenCalledWith(["BTC/USDC:USDC"], {
      type: "swap",
    })

    expect(mockExchange.fetchPositions).toHaveBeenCalledWith()
  })

  it("batches preciseRebalance close with other reductions then opens in phase two", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })

    mockExchange.fetchPositions.mockResolvedValue([
      {
        symbol: "BTC/USDC:USDC",
        side: "long",
        contracts: 0.002,
        notional: 100,
      },
    ])

    mockExchange.createOrdersWs
      .mockResolvedValueOnce([{ status: "closed", info: {} }])
      .mockResolvedValueOnce([{ status: "closed", info: {} }])

    const actions: RebalanceAction[] = [
      {
        kind: "preciseRebalance",
        symbol: "BTC/USDC:USDC",
        side: "buy",
        leverage: 2,
        leverageChanged: false,
        closeNotional: 11,
        openNotional: 13,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(mockExchange.createOrdersWs).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)

    const reductionBatch = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(reductionBatch).toHaveLength(1)
    expect(reductionBatch[0]).toEqual({
      symbol: "BTC/USDC:USDC",
      type: "market",
      side: "sell",
      amount: 11 / 50_000,
      price: 50_000,
      params: { reduceOnly: true },
    })

    const expansionBatch = mockExchange.createOrdersWs.mock.calls[1][0]
    expect(expansionBatch).toHaveLength(1)
    expect(expansionBatch[0]).toEqual({
      symbol: "BTC/USDC:USDC",
      type: "market",
      side: "buy",
      amount: 13 / 50_000,
      price: 50_000,
      params: {},
    })
  })

  it("close on short position sends buy reduce-only in the reduction batch", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "ETH/USDC:USDC", side: "short", contracts: 1.2 },
    ])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "close",
        symbol: "ETH/USDC:USDC",
        side: "sell",
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.createOrdersWs).toHaveBeenCalledTimes(1)
    const batch = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(batch[0]).toMatchObject({
      symbol: "ETH/USDC:USDC",
      side: "buy",
      amount: 1.2,
      params: expect.objectContaining({ reduceOnly: true }),
    })
  })

  it("concatenates every reduction order into one createOrdersWs call", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "ETH/USDC:USDC", side: "long", contracts: 0.5 },
      {
        symbol: "BTC/USDC:USDC",
        side: "long",
        contracts: 0.002,
        notional: 100,
      },
    ])
    mockExchange.createOrdersWs.mockResolvedValue([
      { status: "closed", info: {} },
      { status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "close",
        symbol: "ETH/USDC:USDC",
        side: "buy",
      },
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: -25,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.createOrdersWs).toHaveBeenCalledTimes(1)
    const batch = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(batch).toHaveLength(2)
    expect(
      batch.map((order: { symbol: string }) => order.symbol).sort(),
    ).toEqual(["BTC/USDC:USDC", "ETH/USDC:USDC"])
  })

  it("preciseRebalance uses full close when close notional wipes position", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      {
        symbol: "BTC/USDC:USDC",
        side: "long",
        contracts: 0.002,
        notional: 8,
      },
    ])
    mockExchange.createOrdersWs
      .mockResolvedValueOnce([{ status: "closed", info: {} }])
      .mockResolvedValueOnce([{ status: "closed", info: {} }])

    const actions: RebalanceAction[] = [
      {
        kind: "preciseRebalance",
        symbol: "BTC/USDC:USDC",
        side: "buy",
        leverage: 2,
        leverageChanged: false,
        closeNotional: 11,
        openNotional: 13,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    const firstCall = mockExchange.createOrdersWs.mock.calls[0][0]
    expect(firstCall[0]).toMatchObject({
      side: "sell",
      amount: 0.002,
      params: expect.objectContaining({ reduceOnly: true }),
    })
  })

  it("subscribes watchOrders before createOrdersWs and unwatchs after collection", async () => {
    const callOrder: string[] = []
    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
      {
        kind: "close",
        symbol: "ETH/USDC:USDC",
        side: "buy",
      },
    ]

    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "ETH/USDC:USDC", side: "long", contracts: 0.5 },
    ])
    mockExchange.watchOrders.mockImplementation(async () => {
      callOrder.push("watchOrders")
      const batches = mockExchange.createOrdersWs.mock.calls as Array<
        [Array<{ symbol: string }>]
      >
      if (batches.length === 0) {
        return []
      }

      return batches.flatMap(([orders]) =>
        orders.map(order => ({
          symbol: order.symbol,
          status: "closed",
          info: {},
        })),
      )
    })
    mockExchange.unWatchOrders.mockImplementation(async () => {
      callOrder.push("unWatchOrders")
      return undefined
    })
    mockExchange.createOrdersWs.mockImplementation(async orders => {
      callOrder.push("createOrdersWs")
      return orders.map(() => ({ status: "closed", info: {} }))
    })

    const client = new HyperliquidClient(credentials, "mainnet")
    await client.rebalancePositions(actions)

    expect(mockExchange.watchOrders).toHaveBeenCalledTimes(2)
    expect(mockExchange.watchOrders).toHaveBeenCalledWith(
      undefined,
      expect.any(Number),
    )
    expect(mockExchange.unWatchOrders).toHaveBeenCalledTimes(1)
    expect(mockExchange.unWatchOrders).toHaveBeenCalledWith()
    expect(callOrder).toEqual([
      "watchOrders",
      "createOrdersWs",
      "createOrdersWs",
      "watchOrders",
      "unWatchOrders",
    ])
  })

  it("skips watchOrders for leverage-only actions with no order legs", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "BTC/USDC:USDC", side: "long", contracts: 0.1 },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 0,
        leverage: 5,
        leverageChanged: true,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const results = await client.rebalancePositions(actions)

    expect(results).toEqual([])
    expect(mockExchange.setLeverage).toHaveBeenCalledWith(
      5,
      "BTC/USDC:USDC",
      {},
    )
    expect(mockExchange.watchOrders).not.toHaveBeenCalled()
    expect(mockExchange.unWatchOrders).not.toHaveBeenCalled()
    expect(mockExchange.createOrdersWs).not.toHaveBeenCalled()
  })

  it("unWatches orders when createOrdersWsBatch fails after watch subscribe", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])
    mockExchange.createOrdersWs.mockRejectedValueOnce(new Error("ws down"))

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    await expect(client.rebalancePositions(actions)).rejects.toThrow("ws down")

    expect(mockExchange.watchOrders).toHaveBeenCalled()
    expect(mockExchange.unWatchOrders).toHaveBeenCalledTimes(1)
  })

  it("marks results filled when watch reports closed after createOrdersWs", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    mockExchange.createOrdersWs.mockResolvedValue([
      {
        symbol: "BTC/USDC:USDC",
        info: { filled: { totalSz: "0.002", avgPx: "50000", oid: 1 } },
      },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe("filled")
    expect(mockExchange.watchOrders).toHaveBeenCalled()
  })

  it("rejects when watch stalls past the watch timeout", async () => {
    vi.useFakeTimers()

    try {
      mockExchange.fetchTickers.mockResolvedValue({
        "BTC/USDC:USDC": { last: 50_000 },
      })
      mockExchange.fetchPositions.mockResolvedValue([])

      mockExchange.createOrdersWs.mockResolvedValue([
        { symbol: "BTC/USDC:USDC", status: "open", info: {} },
      ])
      mockExchange.watchOrders.mockImplementation(
        () =>
          new Promise<Order[]>(() => {
            // never resolves
          }),
      )
      mockExchange.fetchOrders.mockResolvedValue([])

      const actions: RebalanceAction[] = [
        {
          kind: "rebalance",
          symbol: "BTC/USDC:USDC",
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
        },
      ]

      const client = new HyperliquidClient(credentials, "mainnet")
      const resultPromise = client.rebalancePositions(actions)

      await vi.advanceTimersByTimeAsync(10_000)

      const results = await resultPromise
      expect(results).toHaveLength(1)
      expect(results[0]?.status).toBe("timed_out")
      expect(mockExchange.fetchOrders).toHaveBeenCalledWith(
        undefined,
        expect.any(Number),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("reconciles timed_out results to filled via fetchOrders backup", async () => {
    vi.useFakeTimers()

    try {
      mockExchange.fetchTickers.mockResolvedValue({
        "BERA/USDC:USDC": { last: 0.18 },
      })
      mockExchange.fetchPositions.mockResolvedValue([])
      stubBackendMarketsFetch("mainnet", [
        {
          symbol: "BERA/USDC:USDC",
          assetIndex: 10,
          markPx: 0.18,
          universeName: "BERA",
        },
      ])

      mockExchange.createOrdersWs.mockResolvedValue([
        { symbol: "BERA/USDC:USDC", status: "open", info: {} },
      ])
      mockExchange.watchOrders.mockImplementation(
        () =>
          new Promise<Order[]>(() => {
            // never resolves
          }),
      )
      mockExchange.fetchOrders.mockResolvedValue([
        {
          info: {
            order: {
              coin: "BERA",
              side: "A",
              oid: "56173782575",
            },
            status: "filled",
            statusTimestamp: "1783512080220",
          },
          id: "56173782575",
          symbol: "BERA/USDC:USDC",
          side: "sell",
          status: "closed",
          filled: 57.6,
          remaining: 0,
        } as Order,
      ])

      const actions: RebalanceAction[] = [
        {
          kind: "rebalance",
          symbol: "BERA/USDC:USDC",
          signedNotionalDelta: -10,
          leverage: 2,
          leverageChanged: false,
        },
      ]

      const client = new HyperliquidClient(credentials, "mainnet")
      const resultPromise = client.rebalancePositions(actions)
      await vi.advanceTimersByTimeAsync(10_000)
      const results = await resultPromise

      expect(results[0]?.status).toBe("filled")
      expect(mockExchange.fetchOrders).toHaveBeenCalledWith(
        undefined,
        expect.any(Number),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("maps fetchOrders reject statuses to failed with human message after timeout", async () => {
    vi.useFakeTimers()

    try {
      mockExchange.fetchTickers.mockResolvedValue({
        "BTC/USDC:USDC": { last: 50_000 },
      })
      mockExchange.fetchPositions.mockResolvedValue([])

      mockExchange.createOrdersWs.mockResolvedValue([
        { symbol: "BTC/USDC:USDC", status: "open", info: {} },
      ])
      mockExchange.watchOrders.mockImplementation(
        () =>
          new Promise<Order[]>(() => {
            // never resolves
          }),
      )
      mockExchange.fetchOrders.mockResolvedValue([
        {
          symbol: "BTC/USDC:USDC",
          side: "buy",
          status: "canceled",
          info: { status: "minTradeNtlRejected" },
        } as Order,
      ])

      const actions: RebalanceAction[] = [
        {
          kind: "rebalance",
          symbol: "BTC/USDC:USDC",
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
        },
      ]

      const client = new HyperliquidClient(credentials, "mainnet")
      const resultPromise = client.rebalancePositions(actions)
      await vi.advanceTimersByTimeAsync(10_000)
      const results = await resultPromise

      expect(results[0]?.status).toBe("failed")
      expect(results[0]?.message).toBe("Order rejected: below minimum notional")
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps timed_out when fetchOrders backup throws", async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      mockExchange.fetchTickers.mockResolvedValue({
        "BTC/USDC:USDC": { last: 50_000 },
      })
      mockExchange.fetchPositions.mockResolvedValue([])

      mockExchange.createOrdersWs.mockResolvedValue([
        { symbol: "BTC/USDC:USDC", status: "open", info: {} },
      ])
      mockExchange.watchOrders.mockImplementation(
        () =>
          new Promise<Order[]>(() => {
            // never resolves
          }),
      )
      mockExchange.fetchOrders.mockRejectedValueOnce(new Error("info down"))

      const actions: RebalanceAction[] = [
        {
          kind: "rebalance",
          symbol: "BTC/USDC:USDC",
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
        },
      ]

      const client = new HyperliquidClient(credentials, "mainnet")
      const resultPromise = client.rebalancePositions(actions)
      await vi.advanceTimersByTimeAsync(10_000)
      const results = await resultPromise

      expect(results[0]?.status).toBe("timed_out")
      expect(consoleError).toHaveBeenCalledWith(
        "fetchOrders backup after watch timeout failed",
        "info down",
      )
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it("marks still-open fetchOrders backup as failed after timeout", async () => {
    vi.useFakeTimers()

    try {
      mockExchange.fetchTickers.mockResolvedValue({
        "BTC/USDC:USDC": { last: 50_000 },
      })
      mockExchange.fetchPositions.mockResolvedValue([])

      mockExchange.createOrdersWs.mockResolvedValue([
        { symbol: "BTC/USDC:USDC", status: "open", info: {} },
      ])
      mockExchange.watchOrders.mockImplementation(
        () =>
          new Promise<Order[]>(() => {
            // never resolves
          }),
      )
      mockExchange.fetchOrders.mockResolvedValue([
        {
          symbol: "BTC/USDC:USDC",
          side: "buy",
          status: "open",
          info: { status: "open" },
        } as Order,
      ])

      const actions: RebalanceAction[] = [
        {
          kind: "rebalance",
          symbol: "BTC/USDC:USDC",
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
        },
      ]

      const client = new HyperliquidClient(credentials, "mainnet")
      const resultPromise = client.rebalancePositions(actions)
      await vi.advanceTimersByTimeAsync(10_000)
      const results = await resultPromise

      expect(results[0]?.status).toBe("failed")
      expect(results[0]?.message).toBe("Order still open after watch timeout")
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not call fetchOrders on happy-path watch fill", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    mockExchange.createOrdersWs.mockResolvedValue([
      { symbol: "BTC/USDC:USDC", status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result[0]?.status).toBe("filled")
    expect(mockExchange.fetchOrders).not.toHaveBeenCalled()
  })

  it("marks results filled when watch reports closed after createOrdersWs submit", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    mockExchange.createOrdersWs.mockResolvedValue([
      { symbol: "BTC/USDC:USDC", status: "closed", info: {} },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe("filled")
    expect(mockExchange.watchOrders).toHaveBeenCalled()
    expect(mockExchange.unWatchOrders).toHaveBeenCalledTimes(1)
  })

  it("loops watchOrders until working orders receive filled updates", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    mockExchange.createOrdersWs.mockResolvedValue([
      { symbol: "BTC/USDC:USDC", status: "open", info: {} },
    ])
    mockExchange.watchOrders
      .mockResolvedValueOnce([{ symbol: "BTC/USDC:USDC", status: "open" }])
      .mockResolvedValueOnce([{ symbol: "BTC/USDC:USDC", status: "closed" }])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result[0].status).toBe("filled")
    expect(mockExchange.watchOrders).toHaveBeenCalledTimes(2)
    expect(mockExchange.unWatchOrders).toHaveBeenCalledTimes(1)
  })

  it("maps expired watch updates to failed OrderResult", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    mockExchange.createOrdersWs.mockResolvedValue([
      { symbol: "BTC/USDC:USDC", status: "open", info: {} },
    ])
    mockExchange.watchOrders.mockResolvedValue([
      {
        symbol: "BTC/USDC:USDC",
        status: "expired",
        info: { status: "expired" },
      },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result[0]?.status).toBe("failed")
    expect(result[0]?.message).toBe("Order expired")
  })

  it("maps rejected createOrdersWs responses to failed OrderResult", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([])

    mockExchange.createOrdersWs.mockResolvedValue([
      {
        status: "rejected",
        info: { error: "Order must have minimum value of $10." },
      },
    ])
    mockExchange.watchOrders.mockImplementation(async () => [
      {
        symbol: "ETH/USDC:USDC",
        status: "rejected",
        info: { error: "Order must have minimum value of $10." },
      },
    ])

    const actions: RebalanceAction[] = [
      {
        kind: "rebalance",
        symbol: "ETH/USDC:USDC",
        signedNotionalDelta: 5,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("failed")
  })

  it("recovers per-order results when ccxt throws on partial batch error", async () => {
    mockExchange.fetchTickers.mockResolvedValue({
      "BTC/USDC:USDC": { last: 50_000 },
      "ETH/USDC:USDC": { last: 4_000 },
    })
    mockExchange.fetchPositions.mockResolvedValue([
      { symbol: "ETH/USDC:USDC", side: "long", contracts: 0.5 },
    ])

    mockExchange.createOrdersWs
      .mockResolvedValueOnce([{ status: "closed", info: {} }])
      .mockRejectedValueOnce(
        new Error(
          'hyperliquid {"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.002","avgPx":"50000","oid":2}},{"error":"Order must have minimum value of $10. asset=131"}]}}}',
        ),
      )
    mockExchange.watchOrders.mockImplementation(async () => [
      { symbol: "ETH/USDC:USDC", status: "closed", info: {} },
      { symbol: "BTC/USDC:USDC", status: "closed", info: {} },
      {
        symbol: "ETH/USDC:USDC",
        status: "rejected",
        info: { error: "Order must have minimum value of $10. asset=131" },
      },
    ])
    const actions: RebalanceAction[] = [
      {
        kind: "close",
        symbol: "ETH/USDC:USDC",
        side: "buy",
      },
      {
        kind: "rebalance",
        symbol: "BTC/USDC:USDC",
        signedNotionalDelta: 100,
        leverage: 2,
        leverageChanged: false,
      },
      {
        kind: "rebalance",
        symbol: "ETH/USDC:USDC",
        signedNotionalDelta: 5,
        leverage: 2,
        leverageChanged: false,
      },
    ]

    const client = new HyperliquidClient(credentials, "mainnet")
    const result = await client.rebalancePositions(actions)

    expect(result).toHaveLength(3)
    expect(result[0].status).toBe("filled")
    expect(result[1].status).toBe("filled")
    expect(result[2].status).toBe("failed")
    expect(mockExchange.watchOrders).toHaveBeenCalledTimes(1)
  })
})

describe("millisecondsUntilNextUtcMidnight", () => {
  it("reaches the next utc midnight from noon", () => {
    const noonUtc = new Date("2026-07-01T12:00:00.000Z")
    expect(millisecondsUntilNextUtcMidnight(noonUtc)).toBe(12 * 60 * 60 * 1000)
  })

  it("returns at least one millisecond before midnight", () => {
    const lastMillisecond = new Date("2026-07-01T23:59:59.999Z")
    expect(millisecondsUntilNextUtcMidnight(lastMillisecond)).toBe(1)
  })

  it("returns a full day at utc midnight", () => {
    const midnightUtc = new Date("2026-07-01T00:00:00.000Z")
    expect(millisecondsUntilNextUtcMidnight(midnightUtc)).toBe(
      24 * 60 * 60 * 1000,
    )
  })
})
