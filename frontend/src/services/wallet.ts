import * as Data from "effect/Data"

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

export type WalletUnlockFailure =
  | WalletSessionMissing
  | WalletIncorrectPin
  | WalletUnlockError
  | WalletCredentialCryptoFailure

export type WalletDecryptFailure =
  | WalletIncorrectPin
  | WalletCredentialCryptoFailure
