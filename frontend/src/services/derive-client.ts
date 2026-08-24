import type { Order } from "ccxt"
import * as Effect from "effect/Effect"

import { getErrorMessage } from "@/lib/error-message"
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

const DERIVE_ORDER_NONCE_GAP_MS = 2
/** Derive always requires max_fee; ~2x notional matches the UI default for options. */
const DEFAULT_MAX_FEE_NOTIONAL_MULTIPLIER = 2
/** Venue error 11012: amount must be a multiple of this step when market metadata is missing. */
export const DEFAULT_DERIVE_AMOUNT_STEP = 0.00001

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

export const isCcxtRequestTimeout = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false
  }
  const name =
    "name" in error && typeof error.name === "string" ? error.name : ""
  const message = error instanceof Error ? error.message : ""
  return (
    name === "RequestTimeout" ||
    message.includes("timed out") ||
    message.includes("request timed out")
  )
}

const amountsMatch = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * 1e-8)

const pricesMatch = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-6)

const orderMatchesRequest = (
  order: DeriveCcxtOrder,
  symbol: string,
  request: DeriveBatchOrderRequest,
): boolean => {
  const orderSymbol = typeof order.symbol === "string" ? order.symbol : ""
  const sameSymbol =
    orderSymbol === symbol ||
    orderSymbol === request.symbol ||
    orderSymbol.includes(request.symbol) ||
    request.symbol.includes(orderSymbol)
  if (!sameSymbol || order.side !== request.side) {
    return false
  }
  if (
    order.amount !== undefined &&
    !amountsMatch(order.amount, request.amount)
  ) {
    return false
  }
  if (order.price !== undefined && !pricesMatch(order.price, request.price)) {
    return false
  }
  return true
}

const parseNumeric = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

const positivePriceOrNull = (
  value: number | null | undefined,
): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null

const decimalPlacesFromStep = (step: number): number => {
  const exponential = step.toExponential()
  const scientific = /e-(\d+)$/i.exec(exponential)
  if (scientific !== null) {
    const digits = Number(scientific[1])
    return Number.isFinite(digits) ? digits : 8
  }
  const fraction = String(step).split(".")
  return fraction.length < 2 ? 0 : (fraction[1] ?? "").length
}

/** Round `value` to the nearest multiple of `step` (Derive amount_step / tick). */
export const snapToDeriveStep = (value: number, step: number): number => {
  if (!(value > 0) || !(step > 0)) {
    return 0
  }
  const units = Math.round(value / step)
  return Number((units * step).toFixed(decimalPlacesFromStep(step)))
}

const readMarketAmountStep = (market: DeriveCcxtMarket | undefined): number => {
  const fromPrecision = market?.precision?.amount
  if (typeof fromPrecision === "number" && fromPrecision > 0) {
    return fromPrecision
  }
  const fromInfo = parseNumeric(market?.info?.amount_step, Number.NaN)
  return fromInfo > 0 ? fromInfo : DEFAULT_DERIVE_AMOUNT_STEP
}

const readMarketPriceStep = (
  market: DeriveCcxtMarket | undefined,
): number | null => {
  const fromPrecision = market?.precision?.price
  if (typeof fromPrecision === "number" && fromPrecision > 0) {
    return fromPrecision
  }
  const fromInfo = parseNumeric(market?.info?.tick_size, Number.NaN)
  return fromInfo > 0 ? fromInfo : null
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
 * Derive trading client: sequential createOrder (CCXT has no createOrders),
 * tickers and funding via CCXT. Rebalance does not wait for fills -- open
 * orders rest on the venue and appear in the open-orders panel.
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
        const info = ticker.info as
          | {
              mark_price?: unknown
              option_pricing?: { m?: unknown; mark_price?: unknown }
            }
          | undefined
        const markFromInfo = parseNumeric(info?.mark_price, Number.NaN)
        const modelMark = parseNumeric(
          info?.option_pricing?.m ?? info?.option_pricing?.mark_price,
          Number.NaN,
        )
        const quote: DeriveTickerQuote = {
          symbol,
          bid: positivePriceOrNull(ticker.bid),
          ask: positivePriceOrNull(ticker.ask),
          last: positivePriceOrNull(ticker.last ?? ticker.close ?? null),
          mark:
            positivePriceOrNull(ticker.mark) ??
            positivePriceOrNull(markFromInfo) ??
            positivePriceOrNull(modelMark),
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

  private lookupMarket(symbol: string): DeriveCcxtMarket | undefined {
    if (typeof this.exchange.market !== "function") {
      return undefined
    }
    try {
      return this.exchange.market(symbol)
    } catch {
      return undefined
    }
  }

  private async createOne(
    request: DeriveBatchOrderRequest,
    index: number,
    total: number,
  ): Promise<DeriveCcxtOrder> {
    const stepLabel = `[derive] order ${String(index + 1)}/${String(total)}`
    console.info(`${stepLabel} request`, {
      symbol: request.symbol,
      side: request.side,
      type: request.type ?? "limit",
      rawAmount: request.amount,
      rawPrice: request.price,
      reduceOnly: request.reduceOnly === true,
      maxFeeOverride: request.maxFee ?? null,
    })

    const symbol = await this.resolveSymbol(request.symbol)
    const market = this.lookupMarket(symbol)
    console.info(`${stepLabel} symbol resolved`, {
      requested: request.symbol,
      ccxtSymbol: symbol,
      marketId: market?.id ?? null,
      option: market?.option === true,
    })

    const amountStep = readMarketAmountStep(market)
    const amount = snapToDeriveStep(request.amount, amountStep)
    const priceStep = readMarketPriceStep(market)
    const price =
      priceStep === null
        ? request.price
        : snapToDeriveStep(request.price, priceStep)
    console.info(`${stepLabel} size snapped`, {
      rawAmount: request.amount,
      amountStep,
      amount,
      rawPrice: request.price,
      priceStep,
      price,
    })

    if (!(amount > 0) || !(price > 0)) {
      throw new Error(
        `Derive amount/price snapped to zero for ${request.symbol} (amount=${String(request.amount)} step=${String(amountStep)})`,
      )
    }

    const maxFee = request.maxFee ?? defaultMaxFee(price, amount)
    const params = {
      ...this.subaccountParams(),
      max_fee: maxFee,
      ...(request.reduceOnly === true ? { reduceOnly: true } : {}),
    }
    const sent: DeriveBatchOrderRequest = {
      ...request,
      symbol,
      amount,
      price,
      maxFee,
    }
    console.info(`${stepLabel} createOrder payload`, {
      symbol,
      type: request.type ?? "limit",
      side: request.side,
      amount,
      price,
      premium: amount * price,
      params,
    })

    try {
      const created = await this.exchange.createOrder(
        symbol,
        request.type ?? "limit",
        request.side,
        amount,
        price,
        params,
      )
      console.info(`${stepLabel} createOrder accepted`, {
        id: created.id ?? null,
        symbol: created.symbol ?? symbol,
        side: created.side ?? request.side,
        status: readOrderStatus(created) || null,
        amount: created.amount ?? amount,
        price: created.price ?? price,
      })
      return created
    } catch (error) {
      console.error(`${stepLabel} createOrder rejected`, {
        symbol,
        amount,
        price,
        params,
        error: getErrorMessage(error),
      })
      if (!isCcxtRequestTimeout(error)) {
        throw error
      }
      console.info(`${stepLabel} createOrder timed out, checking open orders`)
      const recovered = await this.recoverTimedOutOrder(symbol, sent)
      if (recovered !== null) {
        console.info(`${stepLabel} recovered open order after timeout`, {
          id: recovered.id ?? null,
          status: recovered.status ?? null,
        })
        return recovered
      }
      throw error
    }
  }

  private async recoverTimedOutOrder(
    symbol: string,
    request: DeriveBatchOrderRequest,
  ): Promise<DeriveCcxtOrder | null> {
    const openOrders = await this.fetchOpenOrders()
    const match = openOrders.find(order =>
      orderMatchesRequest(order, symbol, request),
    )
    return match ?? null
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
    console.info("[derive] createOrdersBatch start", {
      count: requests.length,
      subaccountId: this.credentials.subaccountId,
      networkMode: this.credentials.networkMode,
      requests,
    })
    const created: DeriveCcxtOrder[] = []

    for (const [index, request] of requests.entries()) {
      if (index > 0) {
        await sleep(DERIVE_ORDER_NONCE_GAP_MS)
      }
      created.push(await this.createOne(request, index, requests.length))
    }

    console.info("[derive] createOrdersBatch done", {
      count: created.length,
      ids: created.map(order => order.id ?? null),
    })
    return created
  }

  private orderResultFromCreated(
    order: DeriveCcxtOrder,
    request: DeriveBatchOrderRequest,
  ): OrderResult {
    const mapped = mapDeriveOrderForWatch(order)
    const side =
      order.side === "buy" || order.side === "sell" ? order.side : request.side

    return {
      symbol: request.symbol,
      side,
      status: mapped.status,
      message: mapped.message,
    }
  }

  /**
   * Places the batch and returns immediately from createOrder responses.
   * Open/working orders are left on the venue (open-orders panel); the
   * portfolio picks up fills on the next exchange refresh.
   */
  async placeAndMonitorOrders(
    requests: DeriveBatchOrderRequest[],
  ): Promise<OrderResult[]> {
    if (requests.length === 0) {
      return []
    }

    console.info("[derive] placeAndMonitorOrders start", {
      count: requests.length,
      requests,
    })

    const created = await this.createOrdersBatch(requests)
    const results = created.map((order, index) =>
      this.orderResultFromCreated(order, requests[index]),
    )

    console.info("[derive] placeAndMonitorOrders done", { results })
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
