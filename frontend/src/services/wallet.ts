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

export type WalletDecryptFailure =
  | WalletIncorrectPin
  | WalletCredentialCryptoFailure
