import * as Effect from "effect/Effect"
import { privateKeyToAccount } from "viem/accounts"

import {
  postJson,
  type HttpStatusError,
  type JsonParseError,
  type JsonSerializeError,
  type NetworkError,
} from "@/lib/http"
import { ExchangeRequestError } from "@/services/hyperliquid"
import type { CurrentPosition, OrderSide } from "@/services/hyperliquid-client"

import { createDeriveExchange } from "./exchange"
import {
  deriveRestBaseUrl,
  parseDeriveNumeric,
  requireDeriveSession,
  type DeriveBaseUrl,
  type DeriveSessionCredentials,
  DeriveRpcError,
  DeriveSessionMissing,
  DeriveSessionSignFailed,
} from "./session"

export type { CurrentPosition }

/** Open Derive position with kind so portfolio can distinguish options vs perps. */
export type DeriveMappedPosition = CurrentPosition & {
  positionKind: "option" | "perp"
}

/**
 * Balance summary from CCXT `derive.fetchBalance` (`private/get_all_portfolios`).
 * `accountValue` is the USD equity analogue of Hyperliquid's margin account value.
 */
export interface DeriveBalanceSummary {
  accountValue: number
  positionsValue: number
  collateralsValue: number
  /** Unified CCXT totals by currency code (token amounts, not USD). */
  totals: Record<string, number>
}

export interface DeriveSubaccountSnapshot {
  subaccountId: number
  subaccountValue: string
  collateralsValue: string
  initialMargin: string
  maintenanceMargin: string
  positionsValue: string
  positions: DeriveMappedPosition[]
}

export interface DeriveAccountSnapshot {
  deriveWallet: string
  subaccountIds: number[]
  subaccounts: DeriveSubaccountSnapshot[]
}

type HttpFailure =
  | NetworkError
  | HttpStatusError
  | JsonParseError
  | JsonSerializeError

type RpcPostFailure = HttpFailure | DeriveRpcError

type SessionPrivateCallFailure = RpcPostFailure | DeriveSessionSignFailed

interface DeriveRpcEnvelope<Result> {
  readonly id?: string | number
  readonly result?: Result
  readonly error?: {
    readonly code?: number | string
    readonly message?: string
    readonly data?: unknown
  } | null
}

/** Wire shape of one row in `private/get_subaccount` -> `positions`. */
export interface DeriveApiPosition {
  readonly instrument_name: string
  readonly instrument_type?: string
  readonly amount: string | number
  readonly average_price?: string | number
  readonly mark_price?: string | number
  readonly mark_value?: string | number
  readonly unrealized_pnl?: string | number
  readonly delta?: string | number
}

interface RawSubaccount {
  readonly subaccount_id: number
  readonly subaccount_value: string
  readonly collaterals_value: string
  readonly initial_margin: string
  readonly maintenance_margin: string
  readonly positions_value: string
  readonly positions: DeriveApiPosition[]
}

interface RawSubaccountsResult {
  readonly wallet: string
  readonly subaccount_ids: number[]
}

const signTimestampWithSessionKey = (
  sessionPrivateKey: `0x${string}`,
  timestampMs: string,
): Effect.Effect<string, DeriveSessionSignFailed> =>
  Effect.tryPromise({
    try: () => {
      const account = privateKeyToAccount(sessionPrivateKey)
      return account.signMessage({ message: timestampMs })
    },
    catch: cause => new DeriveSessionSignFailed({ cause }),
  })

const authHeadersFromSignature = (
  deriveWallet: string,
  timestampMs: string,
  signature: string,
): Record<string, string> => ({
  "X-LyraWallet": deriveWallet,
  "X-LyraTimestamp": timestampMs,
  "X-LyraSignature": signature,
})

const unwrapRpcResult = <Result>(
  envelope: DeriveRpcEnvelope<Result>,
): Effect.Effect<Result, DeriveRpcError> => {
  if (envelope.error !== undefined && envelope.error !== null) {
    return Effect.fail(
      new DeriveRpcError({
        code: envelope.error.code ?? null,
        message:
          envelope.error.message ??
          "Derive returned an error without a message.",
      }),
    )
  }

  if (envelope.result === undefined) {
    return Effect.fail(
      new DeriveRpcError({
        code: null,
        message: "Derive response missing result.",
      }),
    )
  }

  return Effect.succeed(envelope.result)
}

const postPrivate = <Result>(
  baseUrl: DeriveBaseUrl,
  methodPath: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Effect.Effect<Result, RpcPostFailure> =>
  postJson<DeriveRpcEnvelope<Result>>(`${baseUrl}/${methodPath}`, body, {
    headers,
    signal,
  }).pipe(Effect.flatMap(unwrapRpcResult))

const sideFromSignedAmount = (signedAmount: number): OrderSide =>
  signedAmount < 0 ? "sell" : "buy"

/**
 * Classifies a Derive instrument as option or perp for portfolio rows.
 * Prefers API `instrument_type`; falls back to option name shape
 * `BASE-YYYYMMDD-STRIKE-C|P`.
 */
export const classifyDeriveInstrument = (
  instrumentName: string,
  instrumentType: string | undefined,
): "option" | "perp" => {
  const normalizedType = (instrumentType ?? "").trim().toLowerCase()
  if (normalizedType === "option") {
    return "option"
  }
  if (normalizedType === "perp" || normalizedType === "perpetual") {
    return "perp"
  }
  if (/-\d{8}-\d+(?:\.\d+)?-[CP]$/i.test(instrumentName)) {
    return "option"
  }
  return "perp"
}

/**
 * Maps a Derive `private/get_subaccount` position row onto the shared
 * `CurrentPosition` shape used by Hyperliquid / portfolio, plus Derive kind.
 * Options have no leverage field -- fixed at 1.
 *
 * Openness is gated on `amount` (non-zero), not `mark_value`: short / near-zero
 * mark rows are still open positions. Notional prefers |mark_value|, then
 * |amount * mark_price|, then |amount * average_price|.
 */
export const mapDerivePosition = (
  position: DeriveApiPosition,
): DeriveMappedPosition | null => {
  const instrumentName =
    typeof position.instrument_name === "string" ? position.instrument_name : ""
  if (instrumentName === "") {
    return null
  }

  const signedAmount = parseDeriveNumeric(position.amount, 0)
  if (!Number.isFinite(signedAmount) || signedAmount === 0) {
    return null
  }

  const markValue = Math.abs(parseDeriveNumeric(position.mark_value, 0))
  const markPrice = parseDeriveNumeric(position.mark_price, 0)
  const averagePrice = parseDeriveNumeric(position.average_price, 0)
  const notionalFromSize = Math.abs(signedAmount * markPrice)
  const notionalFromEntry = Math.abs(signedAmount * averagePrice)

  const notional =
    markValue > 0
      ? markValue
      : notionalFromSize > 0
        ? notionalFromSize
        : notionalFromEntry

  return {
    symbol: instrumentName,
    side: sideFromSignedAmount(signedAmount),
    notional,
    entryPrice: averagePrice,
    unrealizedPnl: parseDeriveNumeric(position.unrealized_pnl, 0),
    leverage: 1,
    positionKind: classifyDeriveInstrument(
      instrumentName,
      position.instrument_type,
    ),
  }
}

const mapSubaccount = (subaccount: RawSubaccount): DeriveSubaccountSnapshot => {
  const rawPositions = Array.isArray(subaccount.positions)
    ? subaccount.positions
    : []

  return {
    subaccountId: subaccount.subaccount_id,
    subaccountValue: subaccount.subaccount_value,
    collateralsValue: subaccount.collaterals_value,
    initialMargin: subaccount.initial_margin,
    maintenanceMargin: subaccount.maintenance_margin,
    positionsValue: subaccount.positions_value,
    positions: rawPositions.flatMap(position => {
      const mapped = mapDerivePosition(position)
      return mapped === null ? [] : [mapped]
    }),
  }
}

const privateCallWithSession = <Result>(
  baseUrl: DeriveBaseUrl,
  methodPath: string,
  body: unknown,
  credentials: DeriveSessionCredentials,
  signal?: AbortSignal,
): Effect.Effect<Result, SessionPrivateCallFailure> =>
  Effect.gen(function* () {
    const timestampMs = Date.now().toString()
    const signature = yield* signTimestampWithSessionKey(
      credentials.sessionPrivateKey,
      timestampMs,
    )
    return yield* postPrivate(
      baseUrl,
      methodPath,
      body,
      authHeadersFromSignature(
        credentials.deriveWallet,
        timestampMs,
        signature,
      ),
      signal,
    )
  })

/**
 * Loads subaccounts + positions using Developers session credentials.
 * Auth: session key signs timestamp; X-LyraWallet = Derive Wallet (SCW).
 */
export const fetchDeriveAccountSnapshot = (
  credentials: DeriveSessionCredentials | null,
  signal?: AbortSignal,
): Effect.Effect<
  DeriveAccountSnapshot,
  SessionPrivateCallFailure | DeriveSessionMissing
> =>
  Effect.gen(function* () {
    const session = yield* requireDeriveSession(credentials)
    const baseUrl = deriveRestBaseUrl(session.networkMode)

    const subaccountIds =
      session.subaccountId !== null
        ? [session.subaccountId]
        : (yield* privateCallWithSession<RawSubaccountsResult>(
            baseUrl,
            "private/get_subaccounts",
            { wallet: session.deriveWallet },
            session,
            signal,
          )).subaccount_ids

    const subaccounts = yield* Effect.forEach(
      subaccountIds,
      subaccountId =>
        privateCallWithSession<RawSubaccount>(
          baseUrl,
          "private/get_subaccount",
          { subaccount_id: subaccountId },
          session,
          signal,
        ).pipe(Effect.map(mapSubaccount)),
      { concurrency: 3 },
    )

    return {
      deriveWallet: session.deriveWallet,
      subaccountIds,
      subaccounts,
    }
  })

const parseTotals = (
  total: Record<string, number | string | undefined> | undefined,
): Record<string, number> => {
  if (total === undefined) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(total).flatMap(([currency, rawAmount]) => {
      const amount = parseDeriveNumeric(rawAmount, Number.NaN)
      if (!Number.isFinite(amount)) {
        return []
      }
      return [[currency, amount] as const]
    }),
  )
}

interface DerivePortfolioRow {
  readonly subaccount_id?: number
  readonly subaccount_value?: string | number
  readonly positions_value?: string | number
  readonly collaterals_value?: string | number
}

const filterPortfoliosForCredentials = (
  info: unknown,
  credentials: DeriveSessionCredentials,
): DerivePortfolioRow[] => {
  if (!Array.isArray(info)) {
    return []
  }

  const rows = info.filter(
    (row): row is DerivePortfolioRow => typeof row === "object" && row !== null,
  )

  if (credentials.subaccountId === null) {
    return rows
  }

  return rows.filter(row => row.subaccount_id === credentials.subaccountId)
}

export const summarizeDeriveBalance = (
  balance: {
    total?: Record<string, number | string | undefined>
    info?: unknown
  },
  credentials: DeriveSessionCredentials,
): DeriveBalanceSummary => {
  const portfolios = filterPortfoliosForCredentials(balance.info, credentials)

  const accountValue = portfolios.reduce(
    (sum, row) => sum + parseDeriveNumeric(row.subaccount_value, 0),
    0,
  )
  const positionsValue = portfolios.reduce(
    (sum, row) => sum + parseDeriveNumeric(row.positions_value, 0),
    0,
  )
  const collateralsValue = portfolios.reduce(
    (sum, row) => sum + parseDeriveNumeric(row.collaterals_value, 0),
    0,
  )

  return {
    accountValue,
    positionsValue,
    collateralsValue,
    totals: parseTotals(balance.total),
  }
}

/**
 * CCXT `fetchBalance` for Derive (`private/get_all_portfolios`), same auth
 * model as Hyperliquid: session key signs; Derive Wallet is the account.
 */
export const fetchDeriveBalance = (
  credentials: DeriveSessionCredentials | null,
): Effect.Effect<
  DeriveBalanceSummary,
  DeriveSessionMissing | ExchangeRequestError
> =>
  Effect.gen(function* () {
    const session = yield* requireDeriveSession(credentials)

    const balance = yield* Effect.tryPromise({
      try: () => createDeriveExchange(session).fetchBalance(),
      catch: cause => new ExchangeRequestError({ cause }),
    })

    return summarizeDeriveBalance(balance, session)
  })
