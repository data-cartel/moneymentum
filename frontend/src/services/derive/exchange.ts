import derive from "ccxt/derive"
import type { Market, Order, Ticker } from "ccxt"

import type { NetworkMode } from "@/contexts/wallet-context"

import { deriveRestBaseUrl, type DeriveSessionCredentials } from "./session"

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
  timeout?: number
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

type OptionalPick<Type, Keys extends keyof Type> = {
  [Key in Keys]?: Type[Key]
}

type CcxtMarket = NonNullable<Market>
type CcxtOrder = NonNullable<Order>
type CcxtTicker = NonNullable<Ticker>

/** Shared CCXT order projection used by status mapping and watch recovery. */
export type DeriveCcxtOrder = OptionalPick<
  CcxtOrder,
  | "id"
  | "symbol"
  | "side"
  | "status"
  | "amount"
  | "filled"
  | "remaining"
  | "price"
  | "average"
  | "cost"
  | "timestamp"
> & {
  info?: Record<string, unknown>
}

export type DeriveCcxtMarket = Pick<CcxtMarket, "symbol"> &
  OptionalPick<CcxtMarket, "id" | "option" | "swap" | "precision"> & {
    info?: Record<string, unknown>
  }

export type DeriveCcxtTicker = OptionalPick<
  CcxtTicker,
  "symbol" | "last" | "close" | "bid" | "ask"
> & {
  mark?: number
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
  const proxyBase = deriveRestBaseUrl(networkMode)
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
 * Option `base_asset_sub_id` is a uint256 that does not fit in a JS number.
 * CCXT `parseToNumeric` uses `parseInt`, then ethers.encode overflows
 * (`INVALID_ARGUMENT` with value ~3.96e28). Keep full precision as BigInt.
 */
export const integerForAbiEncode = (value: unknown): bigint | null => {
  if (typeof value !== "string") {
    return null
  }
  const digits = value.trim()
  if (!/^-?\d+$/.test(digits)) {
    return null
  }
  const asBigInt = BigInt(digits)
  if (
    asBigInt <= BigInt(Number.MAX_SAFE_INTEGER) &&
    asBigInt >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return null
  }
  return asBigInt
}

const patchParseToNumericForOptionSubIds = (
  exchange: DeriveCcxtExchange,
): void => {
  const patchable = exchange as DeriveCcxtExchange & {
    parseToNumeric?: (value: unknown) => number | bigint
  }
  if (typeof patchable.parseToNumeric !== "function") {
    return
  }
  const originalParseToNumeric = patchable.parseToNumeric.bind(patchable)
  patchable.parseToNumeric = (value: unknown): number | bigint => {
    const encoded = integerForAbiEncode(value)
    if (encoded !== null) {
      return encoded
    }
    return originalParseToNumeric(value)
  }
}

/** CCXT default is 10s; private/order through the Vite proxy often needs longer. */
export const DERIVE_REQUEST_TIMEOUT_MS = 30_000

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
    timeout: DERIVE_REQUEST_TIMEOUT_MS,
  })

  if (credentials.networkMode === "testnet") {
    exchange.setSandboxMode(true)
  }

  exchange.options["deriveWalletAddress"] = credentials.deriveWallet
  if (credentials.subaccountId !== null) {
    exchange.options["subaccount_id"] = credentials.subaccountId
  }

  applyDeriveApiProxy(exchange, credentials.networkMode)
  patchParseToNumericForOptionSubIds(exchange)
  return exchange
}
