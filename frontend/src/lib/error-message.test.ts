import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"

import { getErrorMessage, getExchangeErrorDetail } from "./error-message"
import { HttpStatusError, NetworkError } from "./http"
import { ApiMessageError, MissingTickerError } from "@/hooks/useApi"
import { ExchangeRequestError } from "@/services/hyperliquid"
import {
  ClipboardWriteFailed,
  WalletAddressMissing,
  WalletConnectError,
  WalletDisconnectFailed,
} from "@/services/wallet"
import { RevokeAgentFailed } from "@/services/hyperliquidAgent"

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

  it("keeps the generic WalletConnectError message for other causes", async () => {
    const failure = await asFiberFailure(
      new WalletConnectError({ cause: new Error("encrypt failed") }),
    )
    expect(getErrorMessage(failure)).toBe(
      "Failed to connect Hyperliquid agent. Please try again.",
    )
  })

  it("falls back to a plain Error message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom")
  })

  it("stringifies unknown non-error values", () => {
    expect(getErrorMessage("weird")).toBe("weird")
  })
})
