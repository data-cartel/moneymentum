import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as Runtime from "effect/Runtime"

/**
 * Turns any error surfaced to the UI into human-readable display text.
 *
 * Effects bridged to TanStack Query via `Effect.runPromise` reject with a
 * `FiberFailure` whose own `message` is generic, so the tagged error has to be
 * unwrapped from its `Cause` before it can be matched on `_tag`. Components must
 * render errors through this helper instead of reading `error.message`.
 */
export const getErrorMessage = (error: unknown): string => {
  const unwrapped = unwrapTaggedError(error)

  if (hasTag(unwrapped)) {
    const message = messageForTag(unwrapped)
    if (message !== null) return message
  }

  if (unwrapped instanceof Error) {
    const message = unwrapped.message.trim()
    if (message.length > 0 && message !== FIBER_FAILURE_OPAQUE_MESSAGE) {
      return message
    }
  }

  return String(unwrapped)
}

const EXCHANGE_REJECTED_MESSAGE =
  "The exchange rejected the request. Please try again."

/** Effect FiberFailure's generic `Error.message` when the Cause is not unwrapped. */
const FIBER_FAILURE_OPAQUE_MESSAGE = "An error has occurred"

/** Readable text from an ExchangeRequestError cause, or null if unusable. */
const messageFromExchangeCause = (cause: unknown): string | null => {
  const unwrappedCause = unwrapTaggedError(cause)

  if (hasTag(unwrappedCause)) {
    const taggedMessage = messageForTag(unwrappedCause)
    if (taggedMessage !== null) {
      return taggedMessage
    }
  }

  if (unwrappedCause instanceof Error) {
    const message = unwrappedCause.message.trim()
    if (message.length > 0 && message !== FIBER_FAILURE_OPAQUE_MESSAGE) {
      return message
    }
  }
  if (typeof unwrappedCause === "string") {
    const message = unwrappedCause.trim()
    return message.length > 0 ? message : null
  }
  if (
    typeof unwrappedCause === "object" &&
    unwrappedCause !== null &&
    "message" in unwrappedCause &&
    typeof (unwrappedCause as { message: unknown }).message === "string"
  ) {
    const message = (unwrappedCause as { message: string }).message.trim()
    if (message.length > 0 && message !== FIBER_FAILURE_OPAQUE_MESSAGE) {
      return message
    }
  }
  return null
}

/** Unwraps ExchangeRequestError to the underlying exchange failure for logs. */
export const getExchangeErrorDetail = (error: unknown): string => {
  const unwrapped = unwrapTaggedError(error)

  if (
    hasTag(unwrapped) &&
    unwrapped._tag === "ExchangeRequestError" &&
    "cause" in unwrapped
  ) {
    return (
      messageFromExchangeCause((unwrapped as { cause: unknown }).cause) ??
      EXCHANGE_REJECTED_MESSAGE
    )
  }

  return getErrorMessage(error)
}

/**
 * Peel nested FiberFailures until a typed / raw error remains. Nested
 * `Effect.runPromise` inside `wrapExchange` is a common source of
 * ExchangeRequestError → FiberFailure → real error chains.
 */
const unwrapTaggedError = (error: unknown): unknown => {
  let current: unknown = error

  for (let depth = 0; depth < 8; depth++) {
    if (!Runtime.isFiberFailure(current)) {
      break
    }

    const failure = Cause.failureOption(current[Runtime.FiberFailureCauseId])
    if (Option.isNone(failure)) {
      break
    }
    current = failure.value
  }

  return current
}

interface TaggedError {
  readonly _tag: string
  readonly status?: number
  readonly detail?: string
  readonly message?: string
}

const hasTag = (value: unknown): value is TaggedError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof (value as { _tag: unknown })._tag === "string"

const messageForTag = (error: TaggedError): string | null => {
  switch (error._tag) {
    case "NetworkError":
      return "Network request failed. Check your connection and try again."
    case "HttpStatusError":
      if (error.status === 403) {
        return "Derive auth gateway rejected the request (403). Retry Sign and load once; if it persists, the account wallet may need a registered session key."
      }
      return (
        error.detail ??
        (error.status
          ? `Request failed with status ${error.status}.`
          : "Request failed.")
      )
    case "JsonParseError":
      return "The server returned a response we could not read."
    case "JsonSerializeError":
      return "We could not encode the request."
    case "MissingTickerError":
      return "Select a ticker to continue."
    case "EmptyStreamError":
      return "The server returned an empty response."
    case "StreamReadError":
      return "We lost the connection while reading the server response."
    case "ApiMessageError":
      return error.message ?? "The server reported an error."
    case "WalletNotConnected":
      return "Connect a wallet to continue."
    case "ExchangeRequestError": {
      const cause = "cause" in error ? error.cause : undefined
      return messageFromExchangeCause(cause) ?? EXCHANGE_REJECTED_MESSAGE
    }
    case "WalletConnectError": {
      const cause = "cause" in error ? error.cause : undefined
      if (hasTag(cause)) {
        const causeMessage = messageForTag(cause)
        if (causeMessage !== null) {
          return causeMessage
        }
      }
      if (cause instanceof Error) {
        const message = cause.message.trim()
        if (message.length > 0) {
          return message
        }
      }
      return "Failed to connect wallet credentials. Please try again."
    }
    case "WalletUnlockError":
      return "Failed to unlock wallet. Please try again."
    case "WalletIncorrectPin":
      return "Incorrect PIN"
    case "WalletCredentialCryptoFailure":
      return "Failed to unlock wallet. Please try again."
    case "WalletSessionMissing":
      return "No saved wallet session found."
    case "WalletAddressMissing":
      return "No wallet address to copy."
    case "ClipboardWriteFailed":
      return "Failed to copy address. Check clipboard permissions."
    case "WalletDisconnectFailed":
      return "Failed to disconnect wallet. Please try again."
    case "WalletAuthorizationAccountChanged":
      return "Wallet changed during agent authorization. Please try again."
    case "WalletAuthorizationNetworkChanged":
      return "Network changed during agent authorization. Please try again."
    case "WalletAuthorizationContextChanged":
      return "Wallet context changed during agent authorization. Please try again."
    case "WalletConnectionContextChanged":
      return "Wallet changed while credentials were connecting. Please try again."
    case "WalletOperationContextChanged":
      return "Wallet changed before the operation completed. Please try again."
    case "WalletUnlockContextChanged":
      return "Wallet changed while unlocking. Please try again."
    case "WalletDisconnectContextChanged":
      return "Wallet changed while disconnecting. Please try again."
    case "ReownWalletUnavailable":
      return "Connect a wallet with Reown first."
    case "ReownWalletRejected":
      return "Wallet request was rejected."
    case "ApproveAgentFailed":
      return "Hyperliquid agent approval failed. Please try again."
    case "RevokeAgentFailed":
      return "Failed to revoke Hyperliquid agent. Please try again."
    case "ReownModalOpenFailed":
      return "Could not open wallet connect."
    case "ReownAppKitUnavailable":
      return "Could not open wallet connect."
    case "ReownProviderUnavailable":
      return "Connect a wallet with Reown first."
    case "DeriveWalletInvalid":
      return "Invalid Derive wallet address."
    case "DeriveSessionMissing":
      return "No Derive credentials. Paste Derive Wallet and Session Key from Developers."
    case "DeriveSubaccountMissing":
      return "Select a Derive subaccount before trading or loading open orders."
    case "DeriveSessionSignFailed":
      return "Failed to sign with the Derive session key."
    case "DeriveSessionKeyInvalid":
      return "Invalid session private key. Paste a 0x-prefixed 32-byte hex key from derive.xyz Developers."
    case "DeriveSubaccountIdInvalid":
      return "Subaccount ID must be a non-negative integer, or leave empty."
    case "DeriveRpcError": {
      const message =
        "message" in error && typeof error.message === "string"
          ? error.message.trim()
          : ""
      return message.length > 0
        ? `Derive rejected the request: ${message}`
        : "Derive rejected the request."
    }
    case "HyperliquidClientLoadFailed":
      return "Could not load Hyperliquid trading. Please try again."
    case "BitcoinAddressValidatorLoadFailed":
      return "Could not load Bitcoin address validation. Please try again."
    default:
      return null
  }
}
