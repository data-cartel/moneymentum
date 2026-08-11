import derive from "ccxt/derive"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { getAddress, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type { NetworkMode } from "@/contexts/wallet-context"
import {
  postJson,
  type HttpStatusError,
  type JsonParseError,
  type JsonSerializeError,
  type NetworkError,
} from "@/lib/http"
import { ExchangeRequestError } from "@/services/hyperliquid"
import type { CurrentPosition, OrderSide } from "@/services/hyperliquid-client"

export const DERIVE_SESSION_STORAGE_KEY = "derive-test-session"

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

/** Wire shape of one row in `private/get_subaccount` → `positions`. */
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
  if (!Number.isInteger(parsed) || parsed < 0) {
    return Effect.fail(
      new DeriveSubaccountIdInvalid({
        cause: "Subaccount id must be a non-negative integer",
      }),
    )
  }

  return Effect.succeed(parsed)
}

/**
 * Validates Developers-page fields and persists them for private REST calls.
 */
export const saveDeriveCredentials = (
  deriveWalletRaw: string,
  sessionPrivateKeyRaw: string,
  networkMode: NetworkMode,
  subaccountIdRaw: string,
): Effect.Effect<
  DeriveSessionCredentials,
  DeriveWalletInvalid | DeriveSessionKeyInvalid | DeriveSubaccountIdInvalid
> =>
  Effect.gen(function* () {
    const deriveWallet = yield* normalizeDeriveWallet(deriveWalletRaw)
    const session = yield* parseSessionPrivateKey(sessionPrivateKeyRaw)
    const subaccountId = yield* parseOptionalSubaccountId(subaccountIdRaw)

    const credentials: DeriveSessionCredentials = {
      deriveWallet,
      sessionAddress: session.sessionAddress,
      sessionPrivateKey: session.sessionPrivateKey,
      networkMode,
      subaccountId,
    }

    writeStoredDeriveSession(credentials)
    return credentials
  })

export const readStoredDeriveSession = (): DeriveSessionCredentials | null => {
  const raw = localStorage.getItem(DERIVE_SESSION_STORAGE_KEY)
  if (raw === null || raw.trim() === "") {
    return null
  }

  return parseStoredDeriveSession(raw)
}

export const writeStoredDeriveSession = (
  credentials: DeriveSessionCredentials,
): void => {
  localStorage.setItem(DERIVE_SESSION_STORAGE_KEY, JSON.stringify(credentials))
}

export const clearStoredDeriveSession = (): void => {
  localStorage.removeItem(DERIVE_SESSION_STORAGE_KEY)
}

export const parseStoredDeriveSession = (
  raw: string,
): DeriveSessionCredentials | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

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
    (typeof subaccountId !== "number" || !Number.isInteger(subaccountId))
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

const parseNumericValue = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null) return fallback
  if (typeof value === "number") return value
  if (typeof value === "string") return Number.parseFloat(value)
  return fallback
}

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

  const signedAmount = parseNumericValue(position.amount, 0)
  if (!Number.isFinite(signedAmount) || signedAmount === 0) {
    return null
  }

  const markValue = Math.abs(parseNumericValue(position.mark_value, 0))
  const markPrice = parseNumericValue(position.mark_price, 0)
  const averagePrice = parseNumericValue(position.average_price, 0)
  const notionalFromSize = Math.abs(signedAmount * markPrice)
  const notionalFromEntry = Math.abs(signedAmount * averagePrice)

  const notional =
    markValue > 0
      ? markValue
      : notionalFromSize > 0
        ? notionalFromSize
        : notionalFromEntry

  if (!(notional > 0)) {
    return null
  }

  return {
    symbol: instrumentName,
    side: sideFromSignedAmount(signedAmount),
    notional,
    entryPrice: averagePrice,
    unrealizedPnl: parseNumericValue(position.unrealized_pnl, 0),
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
    if (credentials === null) {
      return yield* Effect.fail(new DeriveSessionMissing())
    }

    const baseUrl = deriveRestBaseUrl(credentials.networkMode)

    const subaccountIds =
      credentials.subaccountId !== null
        ? [credentials.subaccountId]
        : (yield* privateCallWithSession<RawSubaccountsResult>(
            baseUrl,
            "private/get_subaccounts",
            { wallet: credentials.deriveWallet },
            credentials,
            signal,
          )).subaccount_ids

    const subaccounts = yield* Effect.forEach(
      subaccountIds,
      subaccountId =>
        privateCallWithSession<RawSubaccount>(
          baseUrl,
          "private/get_subaccount",
          { subaccount_id: subaccountId },
          credentials,
          signal,
        ).pipe(Effect.map(mapSubaccount)),
      { concurrency: 3 },
    )

    return {
      deriveWallet: credentials.deriveWallet,
      subaccountIds,
      subaccounts,
    }
  })

export interface DeriveCcxtExchange {
  setSandboxMode: (enable: boolean) => void
  urls: {
    api?:
      | string
      | {
          public?: string
          private?: string
          ws?: string
          [key: string]: unknown
        }
  }
  options: Record<string, unknown>
  markets?: Record<string, DeriveCcxtMarket>
  markets_by_id?: Record<string, DeriveCcxtMarket | DeriveCcxtMarket[]>
  loadMarkets: (reload?: boolean) => Promise<Record<string, DeriveCcxtMarket>>
  setMarkets: (markets: DeriveCcxtMarket[]) => void
  market: (symbol: string) => DeriveCcxtMarket
  parseMarket: (raw: unknown) => DeriveCcxtMarket
  publicPostGetInstrument: (params: {
    instrument_name: string
  }) => Promise<{ result?: unknown }>
  fetchBalance: () => Promise<{
    total?: Record<string, number | string | undefined>
    info?: unknown
  }>
  fetchTicker: (symbol: string) => Promise<DeriveCcxtTicker>
  fetchFundingRate: (symbol: string) => Promise<{
    symbol?: string
    fundingRate?: number
  }>
  createOrder: (
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ) => Promise<DeriveCcxtOrder>
  watchOrders: (
    symbol?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ) => Promise<DeriveCcxtOrder[]>
  fetchOrders: (
    symbol?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ) => Promise<DeriveCcxtOrder[]>
  fetchOpenOrders: (
    symbol?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ) => Promise<DeriveCcxtOrder[]>
  cancelOrder: (
    id: string,
    symbol: string,
    params?: Record<string, unknown>,
  ) => Promise<DeriveCcxtOrder>
  close?: () => Promise<void>
}

export interface DeriveCcxtMarket {
  id?: string
  symbol: string
  option?: boolean
  swap?: boolean
  info?: Record<string, unknown>
}

export interface DeriveCcxtTicker {
  symbol?: string
  last?: number
  close?: number
  bid?: number
  ask?: number
  mark?: number
  info?: Record<string, unknown>
}

export interface DeriveCcxtOrder {
  id?: string
  symbol?: string
  side?: string
  status?: string
  amount?: number
  filled?: number
  remaining?: number
  price?: number
  average?: number
  cost?: number
  timestamp?: number
  info?: Record<string, unknown>
}

const deriveWsUrl = (networkMode: NetworkMode): string =>
  networkMode === "testnet"
    ? "wss://api-demo.lyra.finance/ws"
    : "wss://api.lyra.finance/ws"

const applyDeriveApiProxy = (
  exchange: DeriveCcxtExchange,
  networkMode: NetworkMode,
): void => {
  const proxyBase =
    networkMode === "testnet" ? "/derive-api-demo" : "/derive-api"
  const existingApi = exchange.urls.api
  const previous = typeof existingApi === "object" ? existingApi : {}

  exchange.urls.api = {
    ...previous,
    public: `${proxyBase}/public`,
    private: `${proxyBase}/private`,
    // CCXT overwrites urls.api as a whole -- keep the WS endpoint for watchOrders.
    ws: deriveWsUrl(networkMode),
  }
}

/**
 * Shared CCXT Derive exchange (REST + WS when aliased to pro/derive).
 * Auth is the Developers session key; `deriveWalletAddress` is the SCW.
 */
export const createDeriveExchange = (
  credentials: DeriveSessionCredentials,
): DeriveCcxtExchange => {
  const DeriveClass = derive as unknown as new (
    config: Record<string, unknown>,
  ) => DeriveCcxtExchange

  const exchange = new DeriveClass({
    walletAddress: credentials.sessionAddress,
    privateKey: credentials.sessionPrivateKey,
    enableRateLimit: true,
  })

  if (credentials.networkMode === "testnet") {
    exchange.setSandboxMode(true)
  }

  exchange.options["deriveWalletAddress"] = credentials.deriveWallet
  if (credentials.subaccountId !== null) {
    exchange.options["subaccount_id"] = credentials.subaccountId
  }

  applyDeriveApiProxy(exchange, credentials.networkMode)
  return exchange
}

const parseTotals = (
  total: Record<string, number | string | undefined> | undefined,
): Record<string, number> => {
  if (total === undefined) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(total).flatMap(([currency, rawAmount]) => {
      const amount = parseNumericValue(rawAmount, Number.NaN)
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
    (sum, row) => sum + parseNumericValue(row.subaccount_value, 0),
    0,
  )
  const positionsValue = portfolios.reduce(
    (sum, row) => sum + parseNumericValue(row.positions_value, 0),
    0,
  )
  const collateralsValue = portfolios.reduce(
    (sum, row) => sum + parseNumericValue(row.collaterals_value, 0),
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
    if (credentials === null) {
      return yield* Effect.fail(new DeriveSessionMissing())
    }

    const balance = yield* Effect.tryPromise({
      try: () => createDeriveExchange(credentials).fetchBalance(),
      catch: cause => new ExchangeRequestError({ cause }),
    })

    return summarizeDeriveBalance(balance, credentials)
  })
