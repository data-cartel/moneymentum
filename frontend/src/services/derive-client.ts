import type { Order } from "ccxt"
import * as Effect from "effect/Effect"

import { ExchangeRequestError } from "@/services/hyperliquid"
import type { OrderResult, OrderSide } from "@/services/hyperliquid-client"
import {
  createDeriveExchange,
  DeriveSessionMissing,
  type DeriveCcxtExchange,
  type DeriveCcxtMarket,
  type DeriveCcxtOrder,
  type DeriveCcxtTicker,
  type DeriveSessionCredentials,
} from "@/services/deriveAccount"

const DERIVE_WATCH_ORDERS_TIMEOUT_MS = 10_000
const DERIVE_ORDER_NONCE_GAP_MS = 2
/** Derive always requires max_fee; ~2x notional matches the UI default for options. */
const DEFAULT_MAX_FEE_NOTIONAL_MULTIPLIER = 2

const FILLED_STATUSES = new Set(["filled", "closed"])
const OPEN_STATUSES = new Set(["open", "triggered", "untriggered", "working"])

export interface DeriveBatchOrderRequest {
  /** CCXT unified symbol or Derive instrument_name (e.g. ETH-20260925-2000-C). */
  symbol: string
  side: OrderSide
  amount: number
  price: number
  type?: "limit" | "market"
  maxFee?: number
  reduceOnly?: boolean
}

export interface DeriveTickerQuote {
  symbol: string
  bid: number | null
  ask: number | null
  last: number | null
  mark: number | null
}

export interface DeriveFundingRateQuote {
  symbol: string
  fundingRate: number
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  })

const parseNumeric = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

const readOrderStatus = (order: DeriveCcxtOrder | Order): string => {
  const info: unknown = order.info
  if (typeof info === "object" && info !== null) {
    const orderStatus = (info as { order_status?: unknown }).order_status
    if (typeof orderStatus === "string" && orderStatus.length > 0) {
      return orderStatus
    }
    const status = (info as { status?: unknown }).status
    if (typeof status === "string" && status.length > 0) {
      return status
    }
  }
  return typeof order.status === "string" ? order.status : ""
}

export const mapDeriveOrderForWatch = (
  order: DeriveCcxtOrder | Order,
): { status: OrderResult["status"]; message: string | null } => {
  const status = readOrderStatus(order).toLowerCase()

  if (FILLED_STATUSES.has(status)) {
    return { status: "filled", message: null }
  }

  if (
    status === "cancelled" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "expired"
  ) {
    return {
      status: "failed",
      message: `Order ${status}`,
    }
  }

  if (OPEN_STATUSES.has(status) || status === "") {
    return { status: "working", message: null }
  }

  return { status: "working", message: null }
}

const defaultMaxFee = (price: number, amount: number): number =>
  Math.abs(price * amount * DEFAULT_MAX_FEE_NOTIONAL_MULTIPLIER)

const requireSubaccountId = (credentials: DeriveSessionCredentials): number => {
  if (credentials.subaccountId === null) {
    throw new Error(
      "Derive trading requires a subaccount id -- set it in credentials",
    )
  }
  return credentials.subaccountId
}

/**
 * Derive trading client: batch create (sequential -- CCXT has no createOrders),
 * fill monitoring via watchOrders (+ fetchOrders timeout backup), tickers and
 * funding via CCXT. Analogous to HyperliquidClient's trade path.
 */
export class DeriveTradingClient {
  private readonly exchange: DeriveCcxtExchange
  private readonly credentials: DeriveSessionCredentials
  private marketsLoaded = false

  constructor(credentials: DeriveSessionCredentials) {
    this.credentials = credentials
    this.exchange = createDeriveExchange(credentials)
  }

  private subaccountParams(): { subaccount_id: number } {
    return { subaccount_id: requireSubaccountId(this.credentials) }
  }

  private async ensureMarketsLoaded(): Promise<void> {
    if (this.marketsLoaded) {
      return
    }
    await this.exchange.loadMarkets()
    this.marketsLoaded = true
  }

  private marketsByIdEntry(
    instrumentName: string,
  ): DeriveCcxtMarket | undefined {
    const entry = this.exchange.markets_by_id?.[instrumentName]
    if (entry === undefined) {
      return undefined
    }
    return Array.isArray(entry) ? entry[0] : entry
  }

  /**
   * Resolves a CCXT symbol or Derive instrument_name, hydrating missing option
   * markets (CCXT only loads the first options page by default).
   */
  async resolveSymbol(instrumentOrSymbol: string): Promise<string> {
    await this.ensureMarketsLoaded()

    const markets = this.exchange.markets ?? {}
    if (instrumentOrSymbol in markets) {
      return instrumentOrSymbol
    }

    const byId = this.marketsByIdEntry(instrumentOrSymbol)
    if (byId !== undefined) {
      return byId.symbol
    }

    const response = await this.exchange.publicPostGetInstrument({
      instrument_name: instrumentOrSymbol,
    })
    if (response.result === undefined || response.result === null) {
      throw new Error(`Derive instrument not found: ${instrumentOrSymbol}`)
    }

    const market = this.exchange.parseMarket(response.result)
    this.exchange.setMarkets([...Object.values(markets), market])
    return market.symbol
  }

  async fetchTickers(
    instrumentsOrSymbols: string[],
  ): Promise<Record<string, DeriveTickerQuote>> {
    const unique = [...new Set(instrumentsOrSymbols)]
    const entries = await Promise.all(
      unique.map(async instrumentOrSymbol => {
        const symbol = await this.resolveSymbol(instrumentOrSymbol)
        const ticker: DeriveCcxtTicker = await this.exchange.fetchTicker(symbol)
        const markFromInfo = parseNumeric(
          (ticker.info as { mark_price?: unknown } | undefined)?.mark_price,
          Number.NaN,
        )
        const quote: DeriveTickerQuote = {
          symbol,
          bid: ticker.bid ?? null,
          ask: ticker.ask ?? null,
          last: ticker.last ?? ticker.close ?? null,
          mark:
            ticker.mark ??
            (Number.isFinite(markFromInfo) ? markFromInfo : null),
        }
        return [instrumentOrSymbol, quote] as const
      }),
    )
    return Object.fromEntries(entries)
  }

  /**
   * Hourly funding for perp symbols. Options are skipped (no funding).
   */
  async fetchFundingRates(
    instrumentsOrSymbols: string[],
  ): Promise<Record<string, DeriveFundingRateQuote>> {
    const unique = [...new Set(instrumentsOrSymbols)]
    const entries = await Promise.all(
      unique.map(async instrumentOrSymbol => {
        const symbol = await this.resolveSymbol(instrumentOrSymbol)
        const market = this.exchange.market(symbol)
        if (market.option === true || market.swap !== true) {
          return null
        }
        const funding = await this.exchange.fetchFundingRate(symbol)
        const rate = funding.fundingRate
        if (rate === undefined || !Number.isFinite(rate)) {
          return null
        }
        return [
          instrumentOrSymbol,
          { symbol, fundingRate: rate } satisfies DeriveFundingRateQuote,
        ] as const
      }),
    )

    return Object.fromEntries(
      entries.flatMap(entry => (entry === null ? [] : [entry])),
    )
  }

  private async createOne(
    request: DeriveBatchOrderRequest,
  ): Promise<DeriveCcxtOrder> {
    const symbol = await this.resolveSymbol(request.symbol)
    const maxFee =
      request.maxFee ?? defaultMaxFee(request.price, request.amount)

    return this.exchange.createOrder(
      symbol,
      request.type ?? "limit",
      request.side,
      request.amount,
      request.price,
      {
        ...this.subaccountParams(),
        max_fee: maxFee,
        ...(request.reduceOnly === true ? { reduceOnly: true } : {}),
      },
    )
  }

  /**
   * Places orders one-by-one (Derive/CCXT has no createOrders). Gaps avoid
   * millisecond nonce collisions.
   */
  async createOrdersBatch(
    requests: DeriveBatchOrderRequest[],
  ): Promise<DeriveCcxtOrder[]> {
    if (requests.length === 0) {
      return []
    }

    requireSubaccountId(this.credentials)
    const created: DeriveCcxtOrder[] = []

    for (const [index, request] of requests.entries()) {
      if (index > 0) {
        await sleep(DERIVE_ORDER_NONCE_GAP_MS)
      }
      created.push(await this.createOne(request))
    }

    return created
  }

  private workingResultsFromRequests(
    requests: DeriveBatchOrderRequest[],
  ): OrderResult[] {
    return requests.map(request => ({
      symbol: request.symbol,
      side: request.side,
      status: "working" as const,
      message: null,
    }))
  }

  private mergeWatchUpdates(
    results: OrderResult[],
    orders: Array<DeriveCcxtOrder | Order>,
  ): OrderResult[] {
    let next = [...results]

    for (const order of orders) {
      const mapped = mapDeriveOrderForWatch(order)
      if (mapped.status === "working") {
        continue
      }

      const orderSymbol =
        typeof order.symbol === "string" ? order.symbol : undefined
      const orderSide =
        order.side === "buy" || order.side === "sell" ? order.side : undefined

      const matchIndex = next.findIndex(result => {
        if (result.status !== "working") return false
        if (orderSide !== undefined && result.side !== orderSide) return false
        if (orderSymbol === undefined) return true
        return (
          result.symbol === orderSymbol ||
          orderSymbol.includes(result.symbol) ||
          result.symbol.includes(orderSymbol)
        )
      })

      if (matchIndex < 0) {
        continue
      }

      const matched = next[matchIndex]

      next = [
        ...next.slice(0, matchIndex),
        {
          ...matched,
          status: mapped.status,
          message: mapped.message,
        },
        ...next.slice(matchIndex + 1),
      ]
    }

    return next
  }

  private hasWorking(results: OrderResult[]): boolean {
    return results.some(result => result.status === "working")
  }

  private markTimedOut(results: OrderResult[]): OrderResult[] {
    return results.map(result =>
      result.status === "working"
        ? {
            ...result,
            status: "timed_out" as const,
            message: "Order still open after watch timeout",
          }
        : result,
    )
  }

  /**
   * Create a batch then monitor fills via watchOrders; on timeout reconcile
   * with fetchOrders (same pattern as HyperliquidClient.rebalancePositions).
   */
  async placeAndMonitorOrders(
    requests: DeriveBatchOrderRequest[],
  ): Promise<OrderResult[]> {
    if (requests.length === 0) {
      return []
    }

    const subaccountParams = this.subaccountParams()
    const watchSince = Date.now()
    let nextWatch = this.exchange.watchOrders(
      undefined,
      watchSince,
      undefined,
      subaccountParams,
    )

    let results: OrderResult[] = []
    let watchTimedOut = false

    try {
      await this.createOrdersBatch(requests)
      results = this.workingResultsFromRequests(requests)

      while (this.hasWorking(results)) {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise: Promise<Error> = new Promise(resolve => {
          timeoutHandle = setTimeout(() => {
            resolve(
              new Error(
                `Derive watchOrders timed out after ${DERIVE_WATCH_ORDERS_TIMEOUT_MS}ms`,
              ),
            )
          }, DERIVE_WATCH_ORDERS_TIMEOUT_MS)
        })

        let ordersUpdate: DeriveCcxtOrder[] | Error
        try {
          ordersUpdate = await Promise.race([nextWatch, timeoutPromise])
        } finally {
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle)
          }
        }

        if (ordersUpdate instanceof Error) {
          results = this.markTimedOut(results)
          watchTimedOut = true
          break
        }

        results = this.mergeWatchUpdates(results, ordersUpdate)

        if (this.hasWorking(results)) {
          nextWatch = this.exchange.watchOrders(
            undefined,
            watchSince,
            undefined,
            subaccountParams,
          )
        }
      }
    } finally {
      if (typeof this.exchange.close === "function") {
        await this.exchange.close().catch(() => undefined)
      }
    }

    if (watchTimedOut) {
      const fetched = await this.exchange.fetchOrders(
        undefined,
        watchSince,
        undefined,
        subaccountParams,
      )
      results = this.mergeWatchUpdates(
        results.map(result =>
          result.status === "timed_out"
            ? { ...result, status: "working" as const, message: null }
            : result,
        ),
        fetched,
      )
      results = results.map(result =>
        result.status === "working"
          ? {
              ...result,
              status: "timed_out" as const,
              message: "Order still open after watch timeout",
            }
          : result,
      )
    }

    return results
  }

  async fetchOpenOrders(): Promise<DeriveCcxtOrder[]> {
    return this.exchange.fetchOpenOrders(
      undefined,
      undefined,
      undefined,
      this.subaccountParams(),
    )
  }

  async cancelOrder(id: string, symbol: string): Promise<DeriveCcxtOrder> {
    await this.ensureMarketsLoaded()
    const resolvedSymbol = await this.resolveSymbol(symbol)
    return this.exchange.cancelOrder(
      id,
      resolvedSymbol,
      this.subaccountParams(),
    )
  }
}

const requireCredentials = (
  credentials: DeriveSessionCredentials | null,
): Effect.Effect<DeriveSessionCredentials, DeriveSessionMissing> =>
  credentials === null
    ? Effect.fail(new DeriveSessionMissing())
    : Effect.succeed(credentials)

const wrapExchange = <Value>(
  run: () => Promise<Value>,
): Effect.Effect<Value, ExchangeRequestError> =>
  Effect.tryPromise({
    try: run,
    catch: cause => new ExchangeRequestError({ cause }),
  })

export const fetchDeriveTickers = (
  credentials: DeriveSessionCredentials | null,
  instrumentsOrSymbols: string[],
): Effect.Effect<
  Record<string, DeriveTickerQuote>,
  DeriveSessionMissing | ExchangeRequestError
> =>
  requireCredentials(credentials).pipe(
    Effect.flatMap(session =>
      wrapExchange(() =>
        new DeriveTradingClient(session).fetchTickers(instrumentsOrSymbols),
      ),
    ),
  )

export const fetchDeriveFundingRates = (
  credentials: DeriveSessionCredentials | null,
  instrumentsOrSymbols: string[],
): Effect.Effect<
  Record<string, DeriveFundingRateQuote>,
  DeriveSessionMissing | ExchangeRequestError
> =>
  requireCredentials(credentials).pipe(
    Effect.flatMap(session =>
      wrapExchange(() =>
        new DeriveTradingClient(session).fetchFundingRates(
          instrumentsOrSymbols,
        ),
      ),
    ),
  )

export const placeAndMonitorDeriveOrders = (
  credentials: DeriveSessionCredentials | null,
  requests: DeriveBatchOrderRequest[],
): Effect.Effect<OrderResult[], DeriveSessionMissing | ExchangeRequestError> =>
  requireCredentials(credentials).pipe(
    Effect.flatMap(session =>
      wrapExchange(() =>
        new DeriveTradingClient(session).placeAndMonitorOrders(requests),
      ),
    ),
  )

export const fetchDeriveOpenOrders = (
  credentials: DeriveSessionCredentials | null,
): Effect.Effect<
  DeriveCcxtOrder[],
  DeriveSessionMissing | ExchangeRequestError
> =>
  requireCredentials(credentials).pipe(
    Effect.flatMap(session =>
      wrapExchange(() => new DeriveTradingClient(session).fetchOpenOrders()),
    ),
  )

export const cancelDeriveOrder = (
  credentials: DeriveSessionCredentials | null,
  request: { id: string; symbol: string },
): Effect.Effect<
  DeriveCcxtOrder,
  DeriveSessionMissing | ExchangeRequestError
> =>
  requireCredentials(credentials).pipe(
    Effect.flatMap(session =>
      wrapExchange(() =>
        new DeriveTradingClient(session).cancelOrder(
          request.id,
          request.symbol,
        ),
      ),
    ),
  )
