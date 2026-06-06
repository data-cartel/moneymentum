import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

export class WalletConnectError extends Data.TaggedError("WalletConnectError")<{
  readonly cause: unknown
}> {}

export class WalletUnlockError extends Data.TaggedError("WalletUnlockError")<{
  readonly cause: unknown
}> {}

export class WalletCredentialCryptoFailure extends Data.TaggedError(
  "WalletCredentialCryptoFailure",
)<{
  readonly cause: unknown
}> {}

export class WalletIncorrectPin extends Data.TaggedError("WalletIncorrectPin")<
  Record<string, never>
> {}

export class WalletSessionMissing extends Data.TaggedError(
  "WalletSessionMissing",
)<Record<string, never>> {}

export class WalletAddressMissing extends Data.TaggedError(
  "WalletAddressMissing",
)<Record<string, never>> {}

export class ClipboardWriteFailed extends Data.TaggedError(
  "ClipboardWriteFailed",
)<{
  readonly cause: unknown
}> {}

export class WalletDisconnectFailed extends Data.TaggedError(
  "WalletDisconnectFailed",
)<{
  readonly cause: unknown
}> {}

export class WalletAuthorizationAccountChanged extends Data.TaggedError(
  "WalletAuthorizationAccountChanged",
)<Record<string, never>> {}

export class WalletAuthorizationNetworkChanged extends Data.TaggedError(
  "WalletAuthorizationNetworkChanged",
)<Record<string, never>> {}

export class WalletAuthorizationContextChanged extends Data.TaggedError(
  "WalletAuthorizationContextChanged",
)<Record<string, never>> {}

export class WalletConnectionContextChanged extends Data.TaggedError(
  "WalletConnectionContextChanged",
)<Record<string, never>> {}

export class WalletOperationContextChanged extends Data.TaggedError(
  "WalletOperationContextChanged",
)<{ readonly cause?: unknown }> {}

export class WalletUnlockContextChanged extends Data.TaggedError(
  "WalletUnlockContextChanged",
)<Record<string, never>> {}

export class WalletDisconnectContextChanged extends Data.TaggedError(
  "WalletDisconnectContextChanged",
)<Record<string, never>> {}

export const copyWalletAddressToClipboard = (
  address: string,
): Effect.Effect<void, WalletAddressMissing | ClipboardWriteFailed> =>
  Effect.gen(function* () {
    if (!address) {
      return yield* Effect.fail(new WalletAddressMissing())
    }

    yield* Effect.tryPromise({
      try: () => navigator.clipboard.writeText(address),
      catch: cause => new ClipboardWriteFailed({ cause }),
    })
  })

export type WalletUnlockFailure =
  | WalletSessionMissing
  | WalletIncorrectPin
  | WalletUnlockError
  | WalletCredentialCryptoFailure
  | WalletUnlockContextChanged

export type WalletDisconnectFailure =
  | WalletDisconnectFailed
  | WalletDisconnectContextChanged

export type WalletDecryptFailure =
  | WalletIncorrectPin
  | WalletCredentialCryptoFailure
