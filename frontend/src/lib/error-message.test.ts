import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"

import { getErrorMessage, getExchangeErrorDetail } from "./error-message"
import { HttpStatusError, NetworkError } from "./http"
import { ApiMessageError, MissingTickerError } from "@/hooks/useApi"
import { ExchangeRequestError } from "@/services/hyperliquid"
import {
  ClipboardWriteFailed,
  WalletAddressMissing,
  WalletAuthorizationAccountChanged,
  WalletAuthorizationContextChanged,
  WalletAuthorizationNetworkChanged,
  WalletConnectError,
  WalletConnectionContextChanged,
  WalletDisconnectContextChanged,
  WalletDisconnectFailed,
  WalletOperationContextChanged,
  WalletUnlockContextChanged,
} from "@/services/wallet"
import { DeriveOrderMappingFailed } from "@/pages/Portfolio/hooks/portfolioRebalancer"
import {
  DeriveRpcError,
  DeriveSessionKeyInvalid,
  DeriveSessionMissing,
  DeriveSubaccountMissing,
  DeriveInstrumentNotFound,
  DeriveOrderSizeInvalid,
} from "@/services/derive/index"
import {
  ApproveAgentFailed,
  ReownWalletRejected,
  ReownWalletUnavailable,
  RevokeAgentFailed,
} from "@/services/hyperliquidAgent"

const asFiberFailure = async (error: unknown): Promise<unknown> => {
  try {
    await Effect.runPromise(Effect.fail(error))
  } catch (caught) {
    return caught
  }
  throw new Error("expected the effect to fail")
}

describe("getErrorMessage", () => {
  it("maps a FiberFailure-wrapped HttpStatusError to its detail", async () => {
    const failure = await asFiberFailure(
      new HttpStatusError({ status: 503, detail: "service unavailable" }),
    )
    expect(getErrorMessage(failure)).toBe("service unavailable")
  })

  it("maps an HttpStatusError without detail to its status", async () => {
    const failure = await asFiberFailure(new HttpStatusError({ status: 500 }))
    expect(getErrorMessage(failure)).toBe("Request failed with status 500.")
  })

  it("maps a NetworkError to a connection message", async () => {
    const failure = await asFiberFailure(new NetworkError({ cause: "offline" }))
    expect(getErrorMessage(failure)).toContain("Network request failed")
  })

  it("maps a MissingTickerError to a ticker prompt", async () => {
    const failure = await asFiberFailure(new MissingTickerError())
    expect(getErrorMessage(failure)).toBe("Select a ticker to continue.")
  })

  it("surfaces the ApiMessageError message verbatim", async () => {
    const failure = await asFiberFailure(
      new ApiMessageError({ message: "no data for ticker" }),
    )
    expect(getErrorMessage(failure)).toBe("no data for ticker")
  })

  it("surfaces ExchangeRequestError cause message when present", async () => {
    const failure = await asFiberFailure(
      new ExchangeRequestError({
        cause: new Error(
          "Failed to set leverage for BANANA/USDC:USDC: Cross margin is not allowed for this asset.",
        ),
      }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to set leverage for BANANA/USDC:USDC: Cross margin is not allowed for this asset.",
    )
  })

  it("unwraps a nested FiberFailure inside ExchangeRequestError", async () => {
    const inner = await asFiberFailure(
      new HttpStatusError({ status: 502, detail: "bad gateway from api" }),
    )
    const failure = await asFiberFailure(
      new ExchangeRequestError({ cause: inner }),
    )
    expect(getErrorMessage(failure)).toBe("bad gateway from api")
    expect(getExchangeErrorDetail(failure)).toBe("bad gateway from api")
  })

  it("does not surface Effect's opaque FiberFailure message", async () => {
    const failure = await asFiberFailure(
      new ExchangeRequestError({
        cause: new Error("An error has occurred"),
      }),
    )
    expect(getErrorMessage(failure)).toBe(
      "The exchange rejected the request. Please try again.",
    )
  })

  it("falls back when ExchangeRequestError cause is an empty Error", async () => {
    const failure = await asFiberFailure(
      new ExchangeRequestError({ cause: new Error("") }),
    )
    expect(getErrorMessage(failure)).toBe(
      "The exchange rejected the request. Please try again.",
    )
  })

  it("falls back when ExchangeRequestError cause is a non-string object", async () => {
    const failure = await asFiberFailure(
      new ExchangeRequestError({ cause: { code: 1 } }),
    )
    expect(getErrorMessage(failure)).toBe(
      "The exchange rejected the request. Please try again.",
    )
  })

  it("surfaces a non-empty string ExchangeRequestError cause", async () => {
    const failure = await asFiberFailure(
      new ExchangeRequestError({ cause: "rate limited" }),
    )
    expect(getErrorMessage(failure)).toBe("rate limited")
  })

  it("getExchangeErrorDetail skips opaque ExchangeRequestError causes", async () => {
    const failure = await asFiberFailure(
      new ExchangeRequestError({ cause: { nested: true } }),
    )
    expect(getExchangeErrorDetail(failure)).toBe(
      "The exchange rejected the request. Please try again.",
    )
  })

  it("maps WalletAddressMissing to a copy prompt", async () => {
    const failure = await asFiberFailure(new WalletAddressMissing())
    expect(getErrorMessage(failure)).toBe("No wallet address to copy.")
  })

  it("maps ClipboardWriteFailed to a permissions message", async () => {
    const failure = await asFiberFailure(
      new ClipboardWriteFailed({ cause: new Error("denied") }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to copy address. Check clipboard permissions.",
    )
  })

  it("maps WalletDisconnectFailed to a disconnect message", async () => {
    const failure = await asFiberFailure(
      new WalletDisconnectFailed({ cause: new Error("reown failed") }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to disconnect wallet. Please try again.",
    )
  })

  it("unwraps RevokeAgentFailed from WalletConnectError", async () => {
    const failure = await asFiberFailure(
      new WalletConnectError({
        cause: new RevokeAgentFailed({ cause: new Error("revoke rejected") }),
      }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to revoke Hyperliquid agent. Please try again.",
    )
  })

  it("unwraps DeriveSessionKeyInvalid from WalletConnectError", async () => {
    const failure = await asFiberFailure(
      new WalletConnectError({
        cause: new DeriveSessionKeyInvalid({ cause: new Error("bad key") }),
      }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Invalid session private key. Paste a 0x-prefixed 32-byte hex key from derive.xyz Developers.",
    )
  })

  it.each([
    [
      new ApproveAgentFailed({ cause: new Error("approval rejected") }),
      "Hyperliquid agent approval failed. Please try again.",
    ],
    [new ReownWalletUnavailable(), "Connect a wallet with Reown first."],
    [
      new ReownWalletRejected({ cause: new Error("wallet rejected") }),
      "Wallet request was rejected.",
    ],
    [
      new WalletAuthorizationAccountChanged(),
      "Wallet changed during agent authorization. Please try again.",
    ],
    [
      new WalletAuthorizationNetworkChanged(),
      "Network changed during agent authorization. Please try again.",
    ],
    [
      new WalletAuthorizationContextChanged(),
      "Wallet context changed during agent authorization. Please try again.",
    ],
    [
      new WalletConnectionContextChanged(),
      "Wallet changed while credentials were connecting. Please try again.",
    ],
    [
      new WalletOperationContextChanged(),
      "Wallet changed before the operation completed. Please try again.",
    ],
  ])(
    "unwraps authorization failures from WalletConnectError",
    async (cause, expected) => {
      const failure = await asFiberFailure(new WalletConnectError({ cause }))

      expect(getErrorMessage(failure)).toBe(expected)
    },
  )

  it.each([
    [
      new WalletUnlockContextChanged(),
      "Wallet changed while unlocking. Please try again.",
    ],
    [
      new WalletDisconnectContextChanged(),
      "Wallet changed while disconnecting. Please try again.",
    ],
  ])("maps stale wallet operation failures", async (error, expected) => {
    const failure = await asFiberFailure(error)

    expect(getErrorMessage(failure)).toBe(expected)
  })

  it("surfaces plain Error cause text from WalletConnectError", async () => {
    const failure = await asFiberFailure(
      new WalletConnectError({ cause: new Error("encrypt failed") }),
    )
    expect(getErrorMessage(failure)).toBe("encrypt failed")
  })

  it("falls back when WalletConnectError cause has no message", async () => {
    const failure = await asFiberFailure(
      new WalletConnectError({ cause: new Error("") }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to connect wallet credentials. Please try again.",
    )
  })

  it("falls back to a plain Error message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom")
  })

  it("does not surface Effect's opaque FiberFailure message from a plain Error", () => {
    expect(getErrorMessage(new Error("An error has occurred"))).toBe(
      "Something went wrong. Please try again.",
    )
  })

  it("does not surface opaque FiberFailure text from WalletConnectError cause", async () => {
    const failure = await asFiberFailure(
      new WalletConnectError({ cause: new Error("An error has occurred") }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to connect wallet credentials. Please try again.",
    )
  })

  it("stringifies unknown non-error values", () => {
    expect(getErrorMessage("weird")).toBe("weird")
  })

  it("maps DeriveOrderMappingFailed to its reason", async () => {
    const failure = await asFiberFailure(
      new DeriveOrderMappingFailed({
        reason: "Missing Derive ticker for close of ETH-20260925-2000-C",
      }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Missing Derive ticker for close of ETH-20260925-2000-C",
    )
  })

  it("maps DeriveRpcError to a provider message", async () => {
    const failure = await asFiberFailure(
      new DeriveRpcError({ code: 14021, message: "missing wallet header" }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Derive rejected the request: missing wallet header",
    )
  })

  it("maps DeriveSessionMissing to a setup message", async () => {
    const failure = await asFiberFailure(new DeriveSessionMissing())
    expect(getErrorMessage(failure)).toContain("No Derive credentials")
  })

  it("maps DeriveSubaccountMissing to a subaccount selection message", async () => {
    const failure = await asFiberFailure(new DeriveSubaccountMissing())
    expect(getErrorMessage(failure)).toContain("Select a Derive subaccount")
  })

  it("maps DeriveInstrumentNotFound to an instrument message", async () => {
    const failure = await asFiberFailure(
      new DeriveInstrumentNotFound({ instrument: "ETH-PERP" }),
    )
    expect(getErrorMessage(failure)).toContain("instrument was not found")
  })

  it("maps DeriveOrderSizeInvalid to a size message", async () => {
    const failure = await asFiberFailure(
      new DeriveOrderSizeInvalid({
        symbol: "ETH-PERP",
        amount: 0,
        amountStep: 0.00001,
      }),
    )
    expect(getErrorMessage(failure)).toContain("rounded to zero")
  })
})
