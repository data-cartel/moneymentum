import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchHyperliquidMarkets } from "./hyperliquid-markets"

const marketsResponse = (payload: unknown): Response =>
  ({
    ok: true,
    headers: new Headers({ "cache-control": "public, max-age=86400" }),
    json: async () => payload,
  }) as Response

const mockMarketsFetch = (payload: unknown) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(marketsResponse(payload))
}

const runMarketsFetch = () =>
  Effect.runPromise(Effect.either(fetchHyperliquidMarkets("mainnet")))

describe("fetchHyperliquidMarkets", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("decodes the backend catalog and derives the cache lifetime", async () => {
    mockMarketsFetch({
      tickers: ["BTC/USDC:USDC", "ETH/USDC:USDC"],
      leverageLimits: [
        {
          symbol: "BTC/USDC:USDC",
          maxLeverage: 50,
          assetIndex: 0,
          onlyIsolated: false,
        },
      ],
      refreshedAt: "2026-07-11T12:00:00Z",
    })

    const markets = await runMarketsFetch()

    if (Either.isLeft(markets)) {
      throw new Error("expected the markets catalog to decode")
    }
    expect(markets.right.tickers).toEqual(["BTC/USDC:USDC", "ETH/USDC:USDC"])
    expect(markets.right.leverageLimits).toEqual([
      {
        symbol: "BTC/USDC:USDC",
        maxLeverage: 50,
        assetIndex: 0,
        onlyIsolated: false,
      },
    ])
    expect(markets.right.refreshedAt).toBe("2026-07-11T12:00:00Z")
    expect(markets.right.marketsMaxAgeMs).toBe(86_400_000)
  })

  it("accepts a catalog that has never been refreshed", async () => {
    mockMarketsFetch({
      tickers: [],
      leverageLimits: [],
      refreshedAt: null,
    })

    const markets = await runMarketsFetch()

    if (Either.isLeft(markets)) {
      throw new Error("expected an empty catalog to decode")
    }
    expect(markets.right.refreshedAt).toBeNull()
  })

  it("fails when a leverage limit does not match the backend contract", async () => {
    mockMarketsFetch({
      tickers: ["BTC/USDC:USDC"],
      leverageLimits: [
        { symbol: "BTC/USDC:USDC", maxLeverage: "50", assetIndex: 0 },
      ],
      refreshedAt: "2026-07-11T12:00:00Z",
    })

    const markets = await runMarketsFetch()

    if (Either.isRight(markets)) {
      throw new Error("expected a mistyped leverage limit to be rejected")
    }
    expect(markets.left._tag).toBe("JsonParseError")
  })

  it("fails when the catalog is missing required fields", async () => {
    mockMarketsFetch({ tickers: ["BTC/USDC:USDC"] })

    const markets = await runMarketsFetch()

    if (Either.isRight(markets)) {
      throw new Error("expected an incomplete catalog to be rejected")
    }
    expect(markets.left._tag).toBe("JsonParseError")
  })
})
