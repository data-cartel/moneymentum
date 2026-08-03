import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import * as Effect from "effect/Effect"

import { fetchDeriveMarkets } from "./derive-markets"

describe("fetchDeriveMarkets", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            tickers: ["ETH-PERP"],
            instruments: [
              {
                instrumentName: "ETH-PERP",
                instrumentType: "perp",
                baseCurrency: "ETH",
                quoteCurrency: "USD",
                isActive: true,
                optionType: null,
                strike: null,
                expiryUnix: null,
              },
            ],
            refreshedAt: "2026-08-03T12:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("requests the derive markets app API for the selected network", async () => {
    const markets = await Effect.runPromise(fetchDeriveMarkets("testnet"))

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/derive/markets?network=testnet"),
      expect.objectContaining({ cache: "no-store" }),
    )
    expect(markets.tickers).toEqual(["ETH-PERP"])
    expect(markets.instruments[0]?.instrumentType).toBe("perp")
    expect(
      (markets.instruments[0] as Record<string, unknown>).maxLeverage,
    ).toBeUndefined()
  })
})
