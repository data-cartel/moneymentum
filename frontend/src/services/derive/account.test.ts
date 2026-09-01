import { describe, expect, it, vi, beforeEach } from "vitest"
import * as Effect from "effect/Effect"

const mockFetchBalance = vi.fn()
const mockSetSandboxMode = vi.fn()
const mockExchange = {
  setSandboxMode: mockSetSandboxMode,
  urls: { api: {} as Record<string, string> },
  options: {} as Record<string, unknown>,
  fetchBalance: mockFetchBalance,
}

vi.mock("ccxt/derive", () => ({
  default: vi.fn(function DeriveMock(this: typeof mockExchange) {
    this.setSandboxMode = mockSetSandboxMode
    this.fetchBalance = mockFetchBalance
    this.urls = mockExchange.urls
    this.options = mockExchange.options
    return this
  }),
}))

import derive from "ccxt/derive"

import {
  DERIVE_REQUEST_TIMEOUT_MS,
  deriveRestBaseUrl,
  fetchDeriveBalance,
  integerForAbiEncode,
  mapDerivePosition,
  parseOptionalSubaccountId,
  parseSessionPrivateKey,
  parseStoredDeriveSession,
  summarizeDeriveBalance,
  type DeriveApiPosition,
  type DeriveSessionCredentials,
} from "@/services/derive/index"

const sampleOptionLong = (): DeriveApiPosition => ({
  instrument_name: "ETH-20260327-2000-C",
  instrument_type: "option",
  amount: "2.5",
  average_price: "120.5",
  mark_price: "130",
  mark_value: "325",
  unrealized_pnl: "23.75",
  delta: "0.42",
})

const sampleCredentials = (): DeriveSessionCredentials => ({
  deriveWallet: "0x1111111111111111111111111111111111111111",
  sessionAddress: "0x2222222222222222222222222222222222222222",
  sessionPrivateKey:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  networkMode: "testnet",
  subaccountId: null,
})

describe("deriveRestBaseUrl", () => {
  it("maps mainnet to the Vite mainnet proxy", () => {
    expect(deriveRestBaseUrl("mainnet")).toBe("/derive-api")
  })

  it("maps testnet to the Vite demo proxy", () => {
    expect(deriveRestBaseUrl("testnet")).toBe("/derive-api-demo")
  })
})

describe("mapDerivePosition", () => {
  it("maps a Derive option row onto CurrentPosition", () => {
    expect(mapDerivePosition(sampleOptionLong())).toEqual({
      symbol: "ETH-20260327-2000-C",
      side: "buy",
      notional: 325,
      entryPrice: 120.5,
      unrealizedPnl: 23.75,
      leverage: 1,
      positionKind: "option",
    })
  })

  it("maps negative amount to sell and uses absolute mark value as notional", () => {
    expect(
      mapDerivePosition({
        ...sampleOptionLong(),
        amount: "-1.25",
        mark_value: "-180.5",
      }),
    ).toEqual({
      symbol: "ETH-20260327-2000-C",
      side: "sell",
      notional: 180.5,
      entryPrice: 120.5,
      unrealizedPnl: 23.75,
      leverage: 1,
      positionKind: "option",
    })
  })

  it("keeps an ETH-2000 option when mark_value is zero but amount is open", () => {
    expect(
      mapDerivePosition({
        instrument_name: "ETH-20260829-2000-C",
        instrument_type: "option",
        amount: "1",
        average_price: "85",
        mark_price: "90",
        mark_value: "0",
        unrealized_pnl: "5",
        delta: "0.55",
      }),
    ).toEqual({
      symbol: "ETH-20260829-2000-C",
      side: "buy",
      notional: 90,
      entryPrice: 85,
      unrealizedPnl: 5,
      leverage: 1,
      positionKind: "option",
    })
  })

  it("uses abs(mark_value) when present for a short ETH-2000 option", () => {
    expect(
      mapDerivePosition({
        instrument_name: "ETH-20260829-2000-P",
        instrument_type: "option",
        amount: "-2",
        average_price: "40",
        mark_price: "35",
        mark_value: "-70",
        unrealized_pnl: "10",
        delta: "-0.3",
      }),
    ).toEqual({
      symbol: "ETH-20260829-2000-P",
      side: "sell",
      notional: 70,
      entryPrice: 40,
      unrealizedPnl: 10,
      leverage: 1,
      positionKind: "option",
    })
  })

  it("classifies ETH-PERP as a derive perp", () => {
    expect(
      mapDerivePosition({
        instrument_name: "ETH-PERP",
        instrument_type: "perp",
        amount: "0.5",
        average_price: "2000",
        mark_price: "2100",
        mark_value: "1050",
        unrealized_pnl: "50",
      }),
    ).toEqual({
      symbol: "ETH-PERP",
      side: "buy",
      notional: 1050,
      entryPrice: 2000,
      unrealizedPnl: 50,
      leverage: 1,
      positionKind: "perp",
    })
  })

  it("drops rows with zero amount", () => {
    expect(
      mapDerivePosition({
        ...sampleOptionLong(),
        amount: "0",
        mark_value: "100",
      }),
    ).toBeNull()
  })

  it("keeps non-zero amount rows when mark and average prices are missing", () => {
    expect(
      mapDerivePosition({
        ...sampleOptionLong(),
        mark_value: "0",
        mark_price: "0",
        average_price: "0",
      }),
    ).toEqual({
      symbol: "ETH-20260327-2000-C",
      side: "buy",
      notional: 0,
      entryPrice: 0,
      unrealizedPnl: 23.75,
      leverage: 1,
      positionKind: "option",
    })
  })
})

describe("summarizeDeriveBalance", () => {
  it("sums portfolio equity fields and keeps CCXT currency totals", () => {
    const summary = summarizeDeriveBalance(
      {
        total: { ETH: "0.1", USDC: 50 },
        info: [
          {
            subaccount_id: 1,
            subaccount_value: "318.07",
            positions_value: "10",
            collaterals_value: "308.07",
          },
          {
            subaccount_id: 2,
            subaccount_value: "100",
            positions_value: "0",
            collaterals_value: "100",
          },
        ],
      },
      sampleCredentials(),
    )

    expect(summary).toEqual({
      accountValue: 418.07,
      positionsValue: 10,
      collateralsValue: 408.07,
      totals: { ETH: 0.1, USDC: 50 },
    })
  })

  it("filters to the selected subaccount when set", () => {
    const summary = summarizeDeriveBalance(
      {
        total: { USDC: 50 },
        info: [
          {
            subaccount_id: 1,
            subaccount_value: "318.07",
            positions_value: "10",
            collaterals_value: "308.07",
          },
          {
            subaccount_id: 2,
            subaccount_value: "100",
            positions_value: "0",
            collaterals_value: "100",
          },
        ],
      },
      { ...sampleCredentials(), subaccountId: 2 },
    )

    expect(summary.accountValue).toBe(100)
    expect(summary.positionsValue).toBe(0)
    expect(summary.collateralsValue).toBe(100)
  })
})

describe("fetchDeriveBalance", () => {
  beforeEach(() => {
    mockFetchBalance.mockReset()
    mockSetSandboxMode.mockReset()
    mockExchange.urls = { api: {} }
    mockExchange.options = {}
  })

  it("fails when credentials are missing", async () => {
    const result = await Effect.runPromiseExit(fetchDeriveBalance(null))
    expect(result._tag).toBe("Failure")
  })

  it("calls CCXT fetchBalance with sandbox + derive wallet options", async () => {
    mockFetchBalance.mockResolvedValue({
      total: { USDC: 12 },
      info: [
        {
          subaccount_id: 9,
          subaccount_value: "12",
          positions_value: "0",
          collaterals_value: "12",
        },
      ],
    })

    const summary = await Effect.runPromise(
      fetchDeriveBalance(sampleCredentials()),
    )

    expect(mockSetSandboxMode).toHaveBeenCalledWith(true)
    expect(mockExchange.options["deriveWalletAddress"]).toBe(
      sampleCredentials().deriveWallet,
    )
    expect(vi.mocked(derive)).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: DERIVE_REQUEST_TIMEOUT_MS }),
    )
    expect(mockExchange.urls.api).toEqual({
      public: "/derive-api-demo/public",
      private: "/derive-api-demo/private",
      ws: "wss://api-demo.lyra.finance/ws",
    })
    expect(summary.accountValue).toBe(12)
    expect(summary.totals).toEqual({ USDC: 12 })
  })
})

describe("parseStoredDeriveSession", () => {
  it("returns null for invalid JSON", () => {
    expect(Effect.runSync(parseStoredDeriveSession("{not-json"))).toBeNull()
  })

  it("returns null when deriveWallet is missing", () => {
    expect(
      Effect.runSync(
        parseStoredDeriveSession(
          JSON.stringify({
            sessionAddress: "0xdef",
            sessionPrivateKey:
              "0x3333333333333333333333333333333333333333333333333333333333333333",
            networkMode: "testnet",
            subaccountId: null,
          }),
        ),
      ),
    ).toBeNull()
  })

  it("parses a valid session payload", () => {
    const parsed = Effect.runSync(
      parseStoredDeriveSession(
        JSON.stringify({
          deriveWallet: "0x1111111111111111111111111111111111111111",
          sessionAddress: "0x2222222222222222222222222222222222222222",
          sessionPrivateKey:
            "0x3333333333333333333333333333333333333333333333333333333333333333",
          networkMode: "testnet",
          subaccountId: 42,
        }),
      ),
    )

    expect(parsed).toEqual({
      deriveWallet: "0x1111111111111111111111111111111111111111",
      sessionAddress: "0x2222222222222222222222222222222222222222",
      sessionPrivateKey:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      networkMode: "testnet",
      subaccountId: 42,
    })
  })

  it("returns null for a negative subaccount id", () => {
    expect(
      Effect.runSync(
        parseStoredDeriveSession(
          JSON.stringify({
            deriveWallet: "0x1111111111111111111111111111111111111111",
            sessionAddress: "0x2222222222222222222222222222222222222222",
            sessionPrivateKey:
              "0x3333333333333333333333333333333333333333333333333333333333333333",
            networkMode: "testnet",
            subaccountId: -1,
          }),
        ),
      ),
    ).toBeNull()
  })
})

describe("parseSessionPrivateKey", () => {
  it("fails when the private key is malformed", async () => {
    const result = await Effect.runPromiseExit(
      parseSessionPrivateKey("not-a-key"),
    )
    expect(result._tag).toBe("Failure")
  })

  it("derives the session address from a valid key", async () => {
    const parsed = await Effect.runPromise(
      parseSessionPrivateKey(
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      ),
    )
    expect(parsed.sessionPrivateKey).toBe(
      "0x3333333333333333333333333333333333333333333333333333333333333333",
    )
    expect(parsed.sessionAddress.startsWith("0x")).toBe(true)
  })
})

describe("integerForAbiEncode", () => {
  it("keeps option base_asset_sub_id as BigInt", () => {
    expect(integerForAbiEncode("39614108744922863198558842368")).toBe(
      39614108744922863198558842368n,
    )
  })

  it("leaves safe integers to CCXT parseToNumeric", () => {
    expect(integerForAbiEncode("0")).toBeNull()
    expect(integerForAbiEncode("144457")).toBeNull()
    expect(integerForAbiEncode(144457)).toBeNull()
  })

  it("ignores non-integers and already-lossy numbers", () => {
    expect(integerForAbiEncode("3.96e+28")).toBeNull()
    expect(integerForAbiEncode(3.961410874492286e28)).toBeNull()
    expect(integerForAbiEncode(undefined)).toBeNull()
  })
})

describe("parseOptionalSubaccountId", () => {
  it("treats empty as null", async () => {
    expect(await Effect.runPromise(parseOptionalSubaccountId(""))).toBeNull()
  })

  it("parses a valid integer", async () => {
    expect(await Effect.runPromise(parseOptionalSubaccountId("12"))).toBe(12)
  })

  it("rejects non-integers", async () => {
    const result = await Effect.runPromiseExit(parseOptionalSubaccountId("1.5"))
    expect(result._tag).toBe("Failure")
  })

  it("rejects negative and unsafe integers", async () => {
    const negative = await Effect.runPromiseExit(
      parseOptionalSubaccountId("-1"),
    )
    expect(negative._tag).toBe("Failure")
    const unsafe = await Effect.runPromiseExit(
      parseOptionalSubaccountId("9007199254740993"),
    )
    expect(unsafe._tag).toBe("Failure")
  })
})
