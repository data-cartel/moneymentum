import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { getAddress, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type { NetworkMode } from "@/contexts/wallet-context"

export type DeriveBaseUrl = "/derive-api" | "/derive-api-demo"

export const deriveRestBaseUrl = (networkMode: NetworkMode): DeriveBaseUrl =>
  networkMode === "testnet" ? "/derive-api-demo" : "/derive-api"

/**
 * Credentials copied from derive.xyz Developers:
 * Derive Wallet + Session Key private key (+ optional subaccount id).
 * Session keys are created in the web UI -- not via this app.
 */
export interface DeriveSessionCredentials {
  deriveWallet: string
  sessionAddress: string
  sessionPrivateKey: `0x${string}`
  networkMode: NetworkMode
  /** When set, skip get_subaccounts and load only this id. */
  subaccountId: number | null
}

export class DeriveRpcError extends Data.TaggedError("DeriveRpcError")<{
  readonly code: number | string | null
  readonly message: string
}> {}

export class DeriveWalletInvalid extends Data.TaggedError(
  "DeriveWalletInvalid",
)<{
  readonly cause: unknown
}> {}

export class DeriveSessionMissing extends Data.TaggedError(
  "DeriveSessionMissing",
)<Record<string, never>> {}

export class DeriveSubaccountMissing extends Data.TaggedError(
  "DeriveSubaccountMissing",
)<Record<string, never>> {}

export class DeriveSessionSignFailed extends Data.TaggedError(
  "DeriveSessionSignFailed",
)<{
  readonly cause: unknown
}> {}

export class DeriveSessionKeyInvalid extends Data.TaggedError(
  "DeriveSessionKeyInvalid",
)<{
  readonly cause: unknown
}> {}

export class DeriveSubaccountIdInvalid extends Data.TaggedError(
  "DeriveSubaccountIdInvalid",
)<{
  readonly cause: unknown
}> {}

/** Shared numeric parse for Derive wire / CCXT fields. */
export const parseDeriveNumeric = (
  value: unknown,
  fallback: number,
): number => {
  if (value === undefined || value === null) return fallback
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

export const requireDeriveSession = (
  credentials: DeriveSessionCredentials | null,
): Effect.Effect<DeriveSessionCredentials, DeriveSessionMissing> =>
  credentials === null
    ? Effect.fail(new DeriveSessionMissing())
    : Effect.succeed(credentials)

/** Session present and a concrete subaccount id selected (trading / open orders). */
export type DeriveSessionWithSubaccount = DeriveSessionCredentials & {
  subaccountId: number
}

export const requireDeriveSessionWithSubaccount = (
  credentials: DeriveSessionCredentials | null,
): Effect.Effect<
  DeriveSessionWithSubaccount,
  DeriveSessionMissing | DeriveSubaccountMissing
> =>
  requireDeriveSession(credentials).pipe(
    Effect.flatMap(session =>
      session.subaccountId === null
        ? Effect.fail(new DeriveSubaccountMissing())
        : Effect.succeed({
            ...session,
            subaccountId: session.subaccountId,
          }),
    ),
  )

export const normalizeDeriveWallet = (
  value: string,
): Effect.Effect<string, DeriveWalletInvalid> =>
  Effect.try({
    try: () => getAddress(value.trim()),
    catch: cause => new DeriveWalletInvalid({ cause }),
  })

export const parseSessionPrivateKey = (
  sessionPrivateKeyRaw: string,
): Effect.Effect<
  { sessionPrivateKey: `0x${string}`; sessionAddress: string },
  DeriveSessionKeyInvalid
> =>
  Effect.gen(function* () {
    const trimmed = sessionPrivateKeyRaw.trim()

    if (!isHex(trimmed) || trimmed.length !== 66) {
      return yield* Effect.fail(
        new DeriveSessionKeyInvalid({
          cause: "Session private key must be a 0x-prefixed 32-byte hex string",
        }),
      )
    }

    const sessionPrivateKey = trimmed
    const sessionAddress = yield* Effect.try({
      try: () => privateKeyToAccount(sessionPrivateKey).address,
      catch: cause => new DeriveSessionKeyInvalid({ cause }),
    })

    return { sessionPrivateKey, sessionAddress }
  })

export const parseOptionalSubaccountId = (
  raw: string,
): Effect.Effect<number | null, DeriveSubaccountIdInvalid> => {
  const trimmed = raw.trim()
  if (trimmed === "") {
    return Effect.succeed(null)
  }

  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return Effect.fail(
      new DeriveSubaccountIdInvalid({
        cause: "Subaccount id must be a non-negative integer",
      }),
    )
  }

  return Effect.succeed(parsed)
}

/** Parse a JSON blob into session credentials (e.g. encrypted wallet payload). */
export const parseStoredDeriveSession = (
  raw: string,
): Effect.Effect<DeriveSessionCredentials | null> =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: cause => cause,
  }).pipe(
    Effect.map(parsed => {
      if (typeof parsed !== "object" || parsed === null) {
        return null
      }

      const record = parsed as Record<string, unknown>
      const deriveWallet = record.deriveWallet
      const sessionAddress = record.sessionAddress
      const sessionPrivateKey = record.sessionPrivateKey
      const networkMode = record.networkMode
      const subaccountId = record.subaccountId

      if (typeof deriveWallet !== "string") return null
      if (typeof sessionAddress !== "string") return null
      if (typeof sessionPrivateKey !== "string") return null
      if (!sessionPrivateKey.startsWith("0x")) return null
      if (networkMode !== "testnet" && networkMode !== "mainnet") return null
      if (
        subaccountId !== null &&
        (typeof subaccountId !== "number" ||
          !Number.isSafeInteger(subaccountId) ||
          subaccountId < 0)
      ) {
        return null
      }

      return {
        deriveWallet,
        sessionAddress,
        sessionPrivateKey: sessionPrivateKey as `0x${string}`,
        networkMode,
        subaccountId,
      }
    }),
    Effect.orElseSucceed(() => null),
  )
