import { type Order, type OrderRequest } from "ccxt"
import { pro } from "ccxt"
import type { NetworkMode, WalletCredentials } from "@/contexts/wallet-context"
import type { RebalanceAction } from "@/pages/Portfolio/hooks/portfolioRebalancer"

const HYPERLIQUID_MAINNET_INFO_URL = "https://api.hyperliquid.xyz/info"
const HYPERLIQUID_TESTNET_INFO_URL = "https://api.hyperliquid-testnet.xyz/info"

const hyperliquidInfoUrl = (network: NetworkMode): string =>
  network === "testnet"
    ? HYPERLIQUID_TESTNET_INFO_URL
    : HYPERLIQUID_MAINNET_INFO_URL

const HYPERLIQUID_REQUEST_TIMEOUT_MS = 10_000
const HYPERLIQUID_WATCH_ORDERS_TIMEOUT_MS = 10_000

type LeverageChangedAction = Extract<
  RebalanceAction,
  { kind: "rebalance" } | { kind: "preciseRebalance" }
> & { leverageChanged: true }

const isLeverageChangedAction = (
  action: RebalanceAction,
): action is LeverageChangedAction =>
  (action.kind === "rebalance" || action.kind === "preciseRebalance") &&
  action.leverageChanged

interface PerpMarketContext {
  szDecimals: number
  markPx: number
}

/** Matches `finance::hyperliquid_swap_ccxt_symbol` base normalization. */
const normalizePerpMarketLookupKey = (base: string): string =>
  base.toUpperCase().replace(/:/g, "-")

/** Matches `finance::hyperliquid_swap_ccxt_symbol`. */
const hyperliquidSwapCcxtSymbol = (baseName: string): string => {
  const base = baseName.toUpperCase().replace(/:/g, "-")
  return `${base}/USDC:USDC`
}

const lookupPerpMarketContext = (
  contexts: Map<string, PerpMarketContext>,
  base: string,
): PerpMarketContext | undefined =>
  contexts.get(normalizePerpMarketLookupKey(base))

const decimalStep = (fractionDigits: number): number => {
  if (fractionDigits <= 0) {
    return 1
  }

  return Number(`0.${"0".repeat(fractionDigits - 1)}1`)
}

const amountPrecisionStepFromSzDecimals = (szDecimals: number): number =>
  szDecimals <= 0 ? 1 : decimalStep(szDecimals)

/** Mirrors CCXT hyperliquid.calculatePricePrecision for perps (maxDecimals = 6). */
const calculateHyperliquidPricePrecision = (
  price: number,
  szDecimals: number,
  maxDecimals = 6,
): number => {
  if (!Number.isFinite(price) || price < 0) return 0

  const priceText = String(price)

  if (price === 0) {
    return Math.min(maxDecimals - szDecimals, 5)
  }

  if (price > 0 && price < 1) {
    const decimalPart = priceText.split(".")[1] ?? ""
    let leadingZeros = 0
    while (
      leadingZeros < decimalPart.length &&
      decimalPart.charAt(leadingZeros) === "0"
    ) {
      leadingZeros += 1
    }
    const pricePrecision = leadingZeros + 5
    return Math.min(maxDecimals - szDecimals, pricePrecision)
  }

  const integerPart = priceText.split(".")[0] ?? "0"
  const significantDigits = Math.max(5, integerPart.length)
  return Math.min(
    maxDecimals - szDecimals,
    significantDigits - integerPart.length,
  )
}

const pricePrecisionStepFromDecimals = (priceDecimals: number): number =>
  priceDecimals <= 0 ? 1 : decimalStep(priceDecimals)

const fetchPerpMarketContexts = async (
  network: NetworkMode,
): Promise<Map<string, PerpMarketContext>> => {
  const response = await fetch(hyperliquidInfoUrl(network), {
    method: "POST",
    signal: AbortSignal.timeout(HYPERLIQUID_REQUEST_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch perp market contexts: ${response.statusText}`,
    )
  }

  const json = (await response.json()) as unknown
  if (!Array.isArray(json) || json.length < 2) {
    throw new Error("Unexpected metaAndAssetCtxs payload shape")
  }

  const meta = json[0] as { universe?: unknown[] } | null
  const assetContexts = json[1] as Array<
    { markPx?: string | number } | null | undefined
  >
  if (
    meta === null ||
    !Array.isArray(meta.universe) ||
    meta.universe.some(asset => asset === null || typeof asset !== "object") ||
    !Array.isArray(assetContexts)
  ) {
    throw new Error("Unexpected metaAndAssetCtxs payload shape")
  }
  const universe = meta.universe as Array<{
    name?: string
    szDecimals?: number
  }>
  const contexts = new Map<string, PerpMarketContext>()

  universe.forEach((asset, index) => {
    const name = asset.name
    if (!name) return
    const rawMarkPx = assetContexts[index]?.markPx ?? 0
    const markPx =
      typeof rawMarkPx === "number" ? rawMarkPx : Number.parseFloat(rawMarkPx)
    contexts.set(normalizePerpMarketLookupKey(name), {
      szDecimals: asset.szDecimals ?? 0,
      markPx: Number.isFinite(markPx) ? markPx : 0,
    })
  })

  return contexts
}

const isDeployed = (): boolean =>
  typeof window !== "undefined" && window.location.hostname !== "localhost"

const applyApiProxy = (
  exchange: HyperliquidExchange,
  networkMode: NetworkMode,
): void => {
  if (!isDeployed()) return
  const proxyBase = networkMode === "testnet" ? "/hl-testnet" : "/hl"
  const existingApi = exchange.urls["api"]
  if (typeof existingApi === "object") {
    exchange.urls["api"] = {
      ...existingApi,
      public: proxyBase,
      private: proxyBase,
    }
    return
  }
  exchange.urls["api"] = { public: proxyBase, private: proxyBase }
}

export type OrderSide = "buy" | "sell"
export type PositionStatus =
  | "synced"
  | "modified"
  | "deleted"
  | "idle"
  | "working"

export interface Position {
  symbol: string
  notional: number
  side: OrderSide
  leverage: number
  leverageChanged: boolean
  currentNotional?: number
  currentSide?: OrderSide
  status: PositionStatus
}

export interface CurrentPosition {
  symbol: string
  side: OrderSide
  notional: number
  entryPrice: number
  unrealizedPnl: number
  leverage: number
}

export interface OrderResult {
  symbol: string
  side: OrderSide
  status: "working" | "filled" | "failed" | "timed_out"
  message?: string | null
}

type TerminalOrderResultStatus = Extract<
  OrderResult["status"],
  "filled" | "failed"
>

type WatchMappedOrderStatus = TerminalOrderResultStatus | "working"

/** User-facing copy for Hyperliquid / CCXT order status strings. */
const ORDER_STATUS_USER_MESSAGES: Record<string, string> = {
  open: "Order still open after watch timeout",
  triggered: "Order still open after watch timeout",
  canceled: "Order was canceled",
  cancelled: "Order was canceled",
  expired: "Order expired",
  rejected: "Order was rejected",
  marginCanceled: "Order canceled due to margin",
  vaultWithdrawalCanceled: "Order canceled due to vault withdrawal",
  openInterestCapCanceled: "Order canceled due to open interest cap",
  selfTradeCanceled: "Order canceled due to self-trade prevention",
  reduceOnlyCanceled: "Reduce-only order was canceled",
  siblingFilledCanceled: "Order canceled after a sibling fill",
  delistedCanceled: "Order canceled because the market was delisted",
  liquidatedCanceled: "Order canceled due to liquidation",
  scheduledCancel: "Order was scheduled for cancel",
  tickRejected: "Order rejected: invalid tick size",
  minTradeNtlRejected: "Order rejected: below minimum notional",
  perpMarginRejected: "Order rejected: insufficient perp margin",
  reduceOnlyRejected: "Reduce-only order was rejected",
  badAloPxRejected: "Order rejected: invalid ALO price",
  iocCancelRejected: "IOC order was rejected or canceled",
  badTriggerPxRejected: "Order rejected: invalid trigger price",
  marketOrderNoLiquidityRejected: "Market order rejected: no liquidity",
  positionIncreaseAtOpenInterestCapRejected:
    "Order rejected: position increase at open interest cap",
  positionFlipAtOpenInterestCapRejected:
    "Order rejected: position flip at open interest cap",
  tooAggressiveAtOpenInterestCapRejected:
    "Order rejected: too aggressive at open interest cap",
  openInterestIncreaseRejected: "Order rejected: open interest increase",
  insufficientSpotBalanceRejected: "Order rejected: insufficient spot balance",
  oracleRejected: "Order rejected by oracle",
  perpMaxPositionRejected: "Order rejected: perp max position",
}

const FILLED_STATUSES = new Set(["filled", "closed"])
const OPEN_STATUSES = new Set(["open", "triggered"])

const readHyperliquidInfoStatus = (order: Order): string | null => {
  const info: unknown = order.info
  if (typeof info !== "object" || info === null || !("status" in info)) {
    return null
  }
  const status = (info as { status: unknown }).status
  return typeof status === "string" && status.length > 0 ? status : null
}

const hasOrderStatusUserMessage = (status: string): boolean =>
  Object.prototype.hasOwnProperty.call(ORDER_STATUS_USER_MESSAGES, status)

const normalizeExchangeOrderStatus = (status: string | undefined): string =>
  (status ?? "").trim()

const userMessageForOrderStatus = (status: string): string =>
  ORDER_STATUS_USER_MESSAGES[status] ??
  (status.length > 0 ? status : "Order was not filled")

/**
 * Maps a CCXT/Hyperliquid order into filled | failed | working for the live
 * watch loop. Prefer raw info.status for user messages when present.
 */
const mapExchangeOrderForWatch = (
  order: Order,
): { status: WatchMappedOrderStatus; message: string | null } => {
  const ccxtStatus = normalizeExchangeOrderStatus(order.status)
  const infoStatus = readHyperliquidInfoStatus(order)

  if (
    FILLED_STATUSES.has(ccxtStatus) ||
    (infoStatus !== null && FILLED_STATUSES.has(infoStatus))
  ) {
    return { status: "filled", message: null }
  }

  if (OPEN_STATUSES.has(ccxtStatus) || OPEN_STATUSES.has(infoStatus ?? "")) {
    return { status: "working", message: null }
  }

  if (
    ccxtStatus === "rejected" ||
    ccxtStatus === "canceled" ||
    ccxtStatus === "cancelled" ||
    ccxtStatus === "expired" ||
    (infoStatus !== null &&
      (infoStatus.endsWith("Canceled") ||
        infoStatus.endsWith("Rejected") ||
        infoStatus === "rejected" ||
        infoStatus === "canceled" ||
        infoStatus === "expired" ||
        hasOrderStatusUserMessage(infoStatus)))
  ) {
    const messageKey = infoStatus ?? ccxtStatus
    return {
      status: "failed",
      message: userMessageForOrderStatus(messageKey),
    }
  }

  return { status: "working", message: null }
}

/**
 * Maps a fetched order after watch timeout. Open/triggered become failed.
 */
const mapExchangeOrderAfterTimeout = (
  order: Order,
): { status: TerminalOrderResultStatus; message: string | null } => {
  const mapped = mapExchangeOrderForWatch(order)
  if (mapped.status === "filled") {
    return { status: "filled", message: null }
  }
  if (mapped.status === "failed") {
    return mapped
  }

  const infoStatus = readHyperliquidInfoStatus(order)
  const ccxtStatus = normalizeExchangeOrderStatus(order.status)
  const messageKey =
    infoStatus ??
    (OPEN_STATUSES.has(ccxtStatus) ? ccxtStatus : ccxtStatus || "open")

  return {
    status: "failed",
    message: userMessageForOrderStatus(
      OPEN_STATUSES.has(messageKey) ? messageKey : "open",
    ),
  }
}

export interface LeverageLimit {
  symbol: string
  maxLeverage: number
  assetIndex: number
  /** `true` when Hyperliquid forbids cross margin; always a boolean from the backend. */
  onlyIsolated: boolean
}

export interface HyperliquidMarketsResponse {
  tickers: string[]
  leverageLimits: LeverageLimit[]
  refreshedAt: string | null
  marketsMaxAgeMs?: number
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export const millisecondsUntilNextUtcMidnight = (
  now: Date = new Date(),
): number => {
  const millisecondsIntoDay = now.getTime() % MILLISECONDS_PER_DAY
  return Math.max(MILLISECONDS_PER_DAY - millisecondsIntoDay, 1)
}

const parseCacheMaxAgeMs = (cacheControl: string | null): number | null => {
  if (!cacheControl) return null
  const match = cacheControl.match(/max-age=(\d+)/)
  if (!match) return null
  const maxAgeSeconds = Number(match[1])
  return Number.isFinite(maxAgeSeconds) ? maxAgeSeconds * 1000 : null
}

export const fetchHyperliquidMarkets = async (
  network: NetworkMode,
): Promise<HyperliquidMarketsResponse> => {
  const url = `${import.meta.env.BASE_URL}api/hyperliquid/markets?network=${network}`
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(HYPERLIQUID_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `hyperliquid markets request failed: ${String(response.status)}`,
    )
  }
  const markets = (await response.json()) as HyperliquidMarketsResponse
  const marketsMaxAgeMs =
    parseCacheMaxAgeMs(response.headers.get("cache-control")) ??
    millisecondsUntilNextUtcMidnight()
  return { ...markets, marketsMaxAgeMs }
}

interface CcxtMarket {
  id: string
  baseId: string
  quoteId: string
  settleId: string
  symbol: string
  base: string
  quote: string
  settle: string
  type: string
  spot: boolean
  margin: boolean
  swap: boolean
  future: boolean
  option: boolean
  active: boolean
  contract: boolean
  linear: boolean
  precision: { amount: number; price: number }
  limits: {
    amount: { min?: number; max?: number }
    price: { min?: number; max?: number }
    cost: { min?: number; max?: number }
  }
  info: Record<string, unknown>
}

// Minimum order size on Hyperliquid is $10, but we use $11 to guarantee orders will be opened
const SLIPPAGE = 0.05

interface HyperliquidExchange {
  setSandboxMode: (enabled: boolean) => void
  options: Record<string, unknown>
  urls: Record<string, string | Record<string, string>>
  walletAddress?: string
  markets?: Record<string, CcxtMarket>
  markets_by_id?: Record<string, CcxtMarket[]>
  setMarkets: (markets: CcxtMarket[]) => void
  fetchBalance: () => Promise<{
    total: Record<string, unknown>
    info?: Record<string, unknown>
  }>
  fetchTickers: (
    symbols?: string[],
    params?: { type?: "spot" | "swap" },
  ) => Promise<
    Record<
      string,
      { last?: number; bid?: number; ask?: number; info?: unknown }
    >
  >
  fetchTicker: (symbol: string) => Promise<{ last?: number }>
  fetchPositions: (symbols?: string[]) => Promise<
    Array<{
      symbol: string
      side: string
      contracts: number | string
      notional?: number | string
      entryPrice?: number | string
      unrealizedPnl?: number | string
      leverage?: number | string
    }>
  >
  setLeverage: (
    leverage: number,
    symbol: string,
    params?: Record<string, unknown>,
  ) => Promise<void>
  createOrder: (
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ) => Promise<unknown>
  createOrdersWs: (
    orders: OrderRequest[],
    params?: Record<string, unknown>,
  ) => Promise<Order[]>
  watchOrders: (
    symbol?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ) => Promise<Order[]>
  unWatchOrders: (
    symbol?: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>
  fetchOrders: (
    symbol?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ) => Promise<Order[]>
}

export class HyperliquidClient {
  private exchange: HyperliquidExchange
  private networkMode: NetworkMode

  constructor(credentials: WalletCredentials, networkMode: NetworkMode) {
    this.networkMode = networkMode

    const HyperliquidClass = pro.hyperliquid as unknown as new (
      config: Record<string, unknown>,
    ) => HyperliquidExchange

    this.exchange = new HyperliquidClass({
      walletAddress: credentials.accountAddress,
      privateKey: credentials.privateKey,
      enableRateLimit: true,
    })

    if (networkMode === "testnet") {
      this.exchange.setSandboxMode(true)
    }

    applyApiProxy(this.exchange, networkMode)

    this.exchange.options["builderFee"] = false
    this.exchange.options["approvedBuilderFee"] = false
    this.exchange.options["defaultSlippage"] = SLIPPAGE
    // Skip the setRef() call that wastes ~2.4 seconds trying to set a referral code
    this.exchange.options["refSet"] = true
  }

  async getFundingRates(): Promise<Record<string, number>> {
    const infoUrl =
      this.networkMode === "testnet"
        ? HYPERLIQUID_TESTNET_INFO_URL
        : HYPERLIQUID_MAINNET_INFO_URL

    const response = await fetch(infoUrl, {
      method: "POST",
      // Abort if the info endpoint is unresponsive for too long to avoid hanging the UI.
      signal: AbortSignal.timeout(HYPERLIQUID_REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch funding rates: ${response.statusText}`)
    }

    const json = (await response.json()) as unknown

    if (
      !Array.isArray(json) ||
      json.length < 2 ||
      typeof json[0] !== "object" ||
      json[0] === null ||
      !Array.isArray((json[0] as { universe?: unknown }).universe) ||
      !Array.isArray(json[1])
    ) {
      console.error(
        "[HyperliquidClient] Unexpected metaAndAssetCtxs payload shape",
        { json },
      )
      return {}
    }

    const [meta, assetCtxs] = json as [
      { universe: Array<{ name: string }> },
      Array<{ funding?: string | number } | null | undefined>,
    ]

    const fundingByBaseAsset: Record<string, number> = Object.fromEntries(
      meta.universe
        .map((asset, index) => {
          const assetCtx = assetCtxs[index]
          if (!assetCtx) return null

          const rawFunding = assetCtx.funding
          if (rawFunding === undefined) return null

          const parsedFundingRate = this.parseNumericValue(
            rawFunding,
            Number.NaN,
          )

          if (!Number.isFinite(parsedFundingRate)) return null

          return [asset.name, parsedFundingRate] as const
        })
        .filter((entry): entry is readonly [string, number] => entry !== null),
    )

    return fundingByBaseAsset
  }

  async getBalance(): Promise<number> {
    const balance = await this.exchange.fetchBalance()
    const usdc = balance.total["USDC"]
    if (usdc === undefined || usdc === null) return 0
    if (typeof usdc === "number") return usdc
    if (typeof usdc === "string") return parseFloat(usdc)
    return 0
  }

  async getAccountSummary(): Promise<{
    accountValue: number
    totalNotionalPosition: number
    withdrawable: number
  }> {
    const balance = await this.exchange.fetchBalance()
    const info = balance.info

    let accountValue = 0
    let totalNotionalPosition = 0
    let withdrawable = 0

    if (info?.marginSummary) {
      const marginSummary = info.marginSummary as Record<string, unknown>
      accountValue = this.parseNumericValue(marginSummary.accountValue, 0)
      totalNotionalPosition = this.parseNumericValue(
        marginSummary.totalNtlPos,
        0,
      )
    }

    if (info?.withdrawable !== undefined) {
      withdrawable = this.parseNumericValue(info.withdrawable, 0)
    }

    return { accountValue, totalNotionalPosition, withdrawable }
  }

  private parseNumericValue(value: unknown, fallback: number): number {
    if (value === undefined || value === null) return fallback
    if (typeof value === "number") return value
    if (typeof value === "string") return parseFloat(value)
    return fallback
  }

  private parseOrderErrorMessage(info: unknown): string | null {
    if (typeof info !== "object" || info === null || !("error" in info)) {
      return null
    }

    const orderError = (info as { error: unknown }).error
    return typeof orderError === "string" ? orderError : null
  }

  private hyperliquidStatusEntryToOrder(status: unknown): Order {
    if (typeof status !== "object" || status === null) {
      return { info: status } as Order
    }
    if ("error" in status) {
      return { status: "rejected", info: status } as Order
    }
    if ("filled" in status) {
      return { status: "closed", info: status } as Order
    }
    if ("resting" in status) {
      return { status: "open", info: status } as Order
    }
    return { info: status } as Order
  }

  /**
   * CCXT hyperliquid handleErrors throws ExchangeError when any order in a batch
   * statuses[] has { error: "..." }, even if status is "ok" and other orders filled.
   * The full response JSON is embedded in the error message -- recover per-order results.
   */
  private parseOrdersFromPartialBatchExchangeError(
    error: unknown,
  ): Order[] | null {
    const message = error instanceof Error ? error.message : String(error)
    const jsonStart = message.indexOf("{")
    if (jsonStart < 0) return null

    let payload: unknown
    try {
      payload = JSON.parse(message.slice(jsonStart))
    } catch {
      return null
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { status?: string }).status !== "ok"
    ) {
      return null
    }

    const statuses = (
      payload as { response?: { data?: { statuses?: unknown[] } } }
    ).response?.data?.statuses
    if (!Array.isArray(statuses)) return null

    const exchange = this.exchange as HyperliquidExchange & {
      parseOrders?: (orders: unknown[], market?: undefined) => Order[]
    }

    if (typeof exchange.parseOrders === "function") {
      return exchange.parseOrders(statuses, undefined)
    }

    return statuses.map(status => this.hyperliquidStatusEntryToOrder(status))
  }

  private async createOrdersWsBatch(orders: OrderRequest[]): Promise<Order[]> {
    try {
      return await this.exchange.createOrdersWs(orders)
    } catch (error: unknown) {
      const recovered = this.parseOrdersFromPartialBatchExchangeError(error)
      if (recovered === null) {
        throw error
      }

      console.warn(
        "[HyperliquidClient] createOrdersWs partial batch recovered",
        {
          requestCount: orders.length,
          responseCount: recovered.length,
          outcomes: recovered.map((response, index) => ({
            index,
            symbol: orders[index]?.symbol,
            side: orders[index]?.side,
            status: response.status,
            message: this.parseOrderErrorMessage(response.info),
          })),
        },
      )

      return recovered
    }
  }

  private async fetchClearinghouseState(): Promise<Record<string, unknown>> {
    const userAddress = this.getWalletAddress()
    if (!userAddress) {
      throw new Error("Wallet address is required for clearinghouse state")
    }

    const response = await fetch(hyperliquidInfoUrl(this.networkMode), {
      method: "POST",
      signal: AbortSignal.timeout(HYPERLIQUID_REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "clearinghouseState",
        user: userAddress,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch clearinghouse state: ${response.statusText}`,
      )
    }

    const json = (await response.json()) as unknown
    if (typeof json !== "object" || json === null) {
      throw new Error("Unexpected clearinghouseState payload shape")
    }

    return json as Record<string, unknown>
  }

  private parseClearinghouseAssetPositions(
    assetPositions: unknown,
  ): CurrentPosition[] {
    if (!Array.isArray(assetPositions)) {
      return []
    }

    const processed: CurrentPosition[] = []

    for (const item of assetPositions) {
      if (typeof item !== "object" || item === null) {
        continue
      }

      const position = (item as { position?: unknown }).position
      if (typeof position !== "object" || position === null) {
        continue
      }

      const entry = position as Record<string, unknown>
      const coin = typeof entry.coin === "string" ? entry.coin : ""
      if (!coin) {
        continue
      }

      const notional = Math.abs(this.parseNumericValue(entry.positionValue, 0))
      if (notional <= 0) {
        continue
      }

      const signedSize = this.parseNumericValue(entry.szi, 0)
      const leverageEntry = entry.leverage
      const leverageValue =
        typeof leverageEntry === "object" && leverageEntry !== null
          ? this.parseNumericValue(
              (leverageEntry as { value?: unknown }).value,
              1,
            )
          : 1

      processed.push({
        symbol: hyperliquidSwapCcxtSymbol(coin),
        side: signedSize >= 0 ? "buy" : "sell",
        notional,
        entryPrice: this.parseNumericValue(entry.entryPx, 0),
        unrealizedPnl: this.parseNumericValue(entry.unrealizedPnl, 0),
        leverage: Math.round(leverageValue),
      })
    }

    return processed
  }

  async getCurrentPositions(): Promise<CurrentPosition[]> {
    const state = await this.fetchClearinghouseState()
    return this.parseClearinghouseAssetPositions(state.assetPositions)
  }

  private parseHyperliquidExchangeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    const jsonStart = message.indexOf("{")
    if (jsonStart >= 0) {
      try {
        const payload = JSON.parse(message.slice(jsonStart)) as {
          response?: unknown
        }
        if (typeof payload.response === "string") {
          return payload.response
        }
      } catch {
        // fall through to the raw exchange message
      }
    }

    return message.replace(/^hyperliquid\s+/i, "")
  }

  private exchangeOperationError(
    symbol: string,
    operation: string,
    error: unknown,
  ): Error {
    const detail = this.parseHyperliquidExchangeErrorMessage(error)
    return new Error(`Failed to ${operation} for ${symbol}: ${detail}`)
  }

  private async setLeverage(
    symbol: string,
    leverage: number,
    onlyIsolated: boolean,
  ): Promise<void> {
    // Default {} in setLeverage is cross margin
    const params = onlyIsolated ? { marginMode: "isolated" } : {}
    try {
      await this.exchange.setLeverage(leverage, symbol, params)
    } catch (error: unknown) {
      throw this.exchangeOperationError(symbol, "set leverage", error)
    }
  }

  private parseCcxtPerpSymbolParts(symbol: string): {
    base: string
    quote: string
    settle: string
  } {
    const colonIndex = symbol.indexOf(":")
    const pair = colonIndex === -1 ? symbol : symbol.slice(0, colonIndex)
    const settle = colonIndex === -1 ? "" : symbol.slice(colonIndex + 1)
    const slashIndex = pair.indexOf("/")
    if (slashIndex === -1) {
      return { base: pair, quote: "USDC", settle: settle || "USDC" }
    }
    const base = pair.slice(0, slashIndex)
    const quote = pair.slice(slashIndex + 1)
    return { base, quote, settle: settle || quote }
  }

  private hydrateMarketsFromBackend(
    leverageLimits: LeverageLimit[],
    perpContexts: Map<string, PerpMarketContext>,
  ): void {
    const markets = leverageLimits.map(entry => {
      const { base, quote, settle } = this.parseCcxtPerpSymbolParts(
        entry.symbol,
      )
      const baseId = String(entry.assetIndex)
      const context = lookupPerpMarketContext(perpContexts, base) ?? {
        szDecimals: 0,
        markPx: 1,
      }
      const amountStep = amountPrecisionStepFromSzDecimals(context.szDecimals)
      const priceDecimals = calculateHyperliquidPricePrecision(
        context.markPx,
        context.szDecimals,
      )
      const priceStep = pricePrecisionStepFromDecimals(priceDecimals)
      return {
        id: baseId,
        baseId,
        quoteId: quote,
        settleId: settle,
        symbol: entry.symbol,
        base,
        quote,
        settle,
        type: "swap",
        spot: false,
        margin: false,
        swap: true,
        future: false,
        option: false,
        active: true,
        contract: true,
        linear: true,
        precision: { amount: amountStep, price: priceStep },
        limits: {
          amount: { min: undefined, max: undefined },
          price: { min: undefined, max: undefined },
          cost: { min: 10, max: undefined },
        },
        info: { szDecimals: context.szDecimals },
      } satisfies CcxtMarket
    })
    this.exchange.setMarkets(markets)
  }

  private workingOrderResultsFromRequests(
    requests: OrderRequest[],
  ): OrderResult[] {
    return requests.map(
      (request): OrderResult => ({
        symbol: request.symbol,
        side: (request.side ?? "buy") as OrderSide,
        status: "working",
      }),
    )
  }

  private mergeWatchUpdatesIntoResults(
    results: OrderResult[],
    orders: Order[],
  ): OrderResult[] {
    return orders.reduce((updatedResults, order) => {
      const index = updatedResults.findIndex(
        result => result.symbol === order.symbol && result.status === "working",
      )
      if (index < 0) {
        return updatedResults
      }

      const current = updatedResults[index]
      const mapped = mapExchangeOrderForWatch(order)
      if (mapped.status === "working") {
        return updatedResults
      }

      return updatedResults.map((result, resultIndex) =>
        resultIndex === index
          ? {
              ...current,
              status: mapped.status,
              message: mapped.message,
            }
          : result,
      )
    }, results)
  }

  private hasWorkingOrderResults(results: OrderResult[]): boolean {
    return results.some(result => result.status === "working")
  }

  private markWorkingOrdersTimedOut(results: OrderResult[]): OrderResult[] {
    return results.map(result =>
      result.status === "working" ? { ...result, status: "timed_out" } : result,
    )
  }

  /**
   * After watch timeout, reconcile timed_out slots with fetchOrders.
   * One result per symbol for now (precise multi-leg matching is a follow-up).
   */
  private reconcileTimedOutResultsWithFetchedOrders(
    results: OrderResult[],
    fetchedOrders: Order[],
  ): OrderResult[] {
    return fetchedOrders.reduce((updatedResults, order) => {
      const index = updatedResults.findIndex(
        result =>
          result.symbol === order.symbol && result.status === "timed_out",
      )
      if (index < 0) {
        return updatedResults
      }

      const current = updatedResults[index]
      const mapped = mapExchangeOrderAfterTimeout(order)

      return updatedResults.map((result, resultIndex) =>
        resultIndex === index
          ? {
              ...current,
              status: mapped.status,
              message: mapped.message,
            }
          : result,
      )
    }, results)
  }

  private positionSideIsBuy(pos: { side: string }): boolean {
    return pos.side === "long" || pos.side === "buy"
  }

  private positionUsdApprox(
    pos: {
      notional?: number | string
      contracts: number | string
    },
    price: number,
  ): number {
    const raw = pos.notional
    if (raw !== undefined && raw !== "") {
      const parsed = typeof raw === "number" ? raw : parseFloat(raw)
      if (Number.isFinite(parsed) && Math.abs(parsed) > 0) {
        return Math.abs(parsed)
      }
    }
    return Math.abs(parseFloat(String(pos.contracts))) * price
  }

  /** Long: sell reduces. Short: buy (cover) reduces. */
  private rebalanceIsReduction(
    pos: { side: string },
    notional: number,
  ): boolean {
    const long = this.positionSideIsBuy(pos)
    if (long) return notional < 0
    return notional > 0
  }

  private buildPreciseRebalanceOrderRequests(opts: {
    symbol: string
    side: OrderSide
    closeNotional: number
    openNotional: number
    price: number
    position: {
      side: string
      contracts: number | string
      notional?: number | string
    }
  }): { closeRequest: OrderRequest | null; openRequest: OrderRequest | null } {
    const { symbol, side, closeNotional, openNotional, price, position } = opts

    const isPositionBuy = this.positionSideIsBuy(position)
    const currentUsd = this.positionUsdApprox(position, price)

    // Full close (Wipes) to avoid leaving dust
    const closeWipes =
      closeNotional >= currentUsd - 0.02 || closeNotional >= currentUsd * 0.999

    const closeAmount = closeWipes
      ? Math.abs(parseFloat(String(position.contracts)))
      : closeNotional / price

    const closeRequest = this.buildOrderRequest(
      symbol,
      isPositionBuy ? "sell" : "buy",
      closeAmount,
      price,
      true,
    )

    const openRequest = this.buildOrderRequest(
      symbol,
      side,
      openNotional / price,
      price,
      false,
    )

    return { closeRequest, openRequest }
  }

  private buildOrderRequest(
    symbol: string,
    side: OrderSide,
    amount: number,
    price: number,
    reduceOnly: boolean,
  ): OrderRequest | null {
    if (amount <= 0 || !Number.isFinite(amount)) return null

    return {
      symbol,
      type: "market",
      side,
      amount,
      price,
      params: reduceOnly ? { reduceOnly: true } : {},
    }
  }

  private splitRebalanceActionsIntoPhases(
    actions: RebalanceAction[],
    tickers: Partial<
      Record<
        string,
        { last?: number; bid?: number; ask?: number; info?: unknown }
      >
    >,
    positions: Array<{
      symbol: string
      side: string
      contracts: number | string
      notional?: number | string
    }>,
  ): {
    reduction: OrderRequest[]
    expansion: OrderRequest[]
  } {
    const reduction: OrderRequest[] = []
    const expansion: OrderRequest[] = []

    for (const action of actions) {
      const position = positions.find(
        candidate => candidate.symbol === action.symbol,
      )
      const price = tickers[action.symbol]?.last ?? undefined
      if (price === undefined) continue

      switch (action.kind) {
        case "close": {
          if (position === undefined) continue
          const closingSide: OrderSide = action.side === "buy" ? "sell" : "buy"
          const request = this.buildOrderRequest(
            action.symbol,
            closingSide,
            Math.abs(parseFloat(String(position.contracts))),
            price,
            true,
          )
          if (request) reduction.push(request)
          break
        }
        case "rebalance": {
          const side = action.signedNotionalDelta > 0 ? "buy" : "sell"
          const amount = Math.abs(action.signedNotionalDelta) / price

          const request = this.buildOrderRequest(
            action.symbol,
            side,
            amount,
            price,
            false,
          )
          if (request) {
            const isRed = position
              ? this.rebalanceIsReduction(position, action.signedNotionalDelta)
              : false

            if (isRed) reduction.push(request)
            else expansion.push(request)
          }
          break
        }
        case "preciseRebalance": {
          if (position === undefined) continue

          const { closeRequest, openRequest } =
            this.buildPreciseRebalanceOrderRequests({
              symbol: action.symbol,
              side: action.side,
              closeNotional: action.closeNotional,
              openNotional: action.openNotional,
              price,
              position,
            })

          if (closeRequest) reduction.push(closeRequest)
          if (openRequest) expansion.push(openRequest)
          break
        }
        default:
          break
      }
    }

    return { reduction, expansion }
  }

  async rebalancePositions(actions: RebalanceAction[]): Promise<OrderResult[]> {
    console.log("rebalancePositions", actions)
    const allSymbols = [...new Set(actions.map(action => action.symbol))]

    const [backendMarkets, perpContexts] = await Promise.all([
      fetchHyperliquidMarkets(this.networkMode),
      fetchPerpMarketContexts(this.networkMode),
    ])

    this.hydrateMarketsFromBackend(backendMarkets.leverageLimits, perpContexts)

    const leverageBySymbol = new Map(
      backendMarkets.leverageLimits.map(entry => [entry.symbol, entry]),
    )
    const leverageActions = actions.filter(isLeverageChangedAction)
    for (const action of leverageActions) {
      const onlyIsolated =
        leverageBySymbol.get(action.symbol)?.onlyIsolated === true
      await this.setLeverage(action.symbol, action.leverage, onlyIsolated)
    }

    const [tickers, positions] = await Promise.all([
      this.exchange.fetchTickers(allSymbols, { type: "swap" }),
      this.exchange.fetchPositions(),
    ])

    const { reduction, expansion } = this.splitRebalanceActionsIntoPhases(
      actions,
      tickers,
      positions,
    )

    // Leverage-only / no-op paths never place orders -- skip watch subscription.
    if (reduction.length === 0 && expansion.length === 0) {
      return []
    }

    let results: OrderResult[] = []
    let watchTimedOut = false

    // Subscribe to orders before sending them
    const watchSince = Date.now()
    let nextWatch = this.exchange.watchOrders(undefined, watchSince)

    try {
      if (reduction.length > 0) {
        const responses = await this.createOrdersWsBatch(reduction)
        console.log("responses", responses)
        results.push(...this.workingOrderResultsFromRequests(reduction))
      }

      if (expansion.length > 0) {
        const responses = await this.createOrdersWsBatch(expansion)
        console.log("responses", responses)
        results.push(...this.workingOrderResultsFromRequests(expansion))
      }

      console.log("results after create orders", results)

      while (this.hasWorkingOrderResults(results)) {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise: Promise<Error> = new Promise(resolve => {
          timeoutHandle = setTimeout(() => {
            resolve(
              new Error(
                `Operation timed out after ${HYPERLIQUID_WATCH_ORDERS_TIMEOUT_MS}ms`,
              ),
            )
          }, HYPERLIQUID_WATCH_ORDERS_TIMEOUT_MS)
        })

        let ordersUpdate: Order[] | Error
        try {
          ordersUpdate = await Promise.race([nextWatch, timeoutPromise])
        } finally {
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle)
          }
        }

        console.log("ordersUpdate", ordersUpdate)

        if (ordersUpdate instanceof Error) {
          console.error(ordersUpdate.message)
          results = this.markWorkingOrdersTimedOut(results)
          watchTimedOut = true
          break
        }

        results = this.mergeWatchUpdatesIntoResults(results, ordersUpdate)

        if (this.hasWorkingOrderResults(results)) {
          nextWatch = this.exchange.watchOrders(undefined, watchSince)
        }
      }
    } finally {
      await this.exchange.unWatchOrders()
    }

    console.log("unwatching orders")
    console.log("results after watch", results)

    if (watchTimedOut) {
      try {
        const passedOrders = await this.exchange.fetchOrders(
          undefined,
          watchSince,
        )
        console.log("passedOrders", passedOrders)
        results = this.reconcileTimedOutResultsWithFetchedOrders(
          results,
          passedOrders,
        )
      } catch (error: unknown) {
        console.error(
          "fetchOrders backup after watch timeout failed",
          error instanceof Error ? error.message : error,
        )
      }
    }

    return results
  }

  getNetworkMode(): NetworkMode {
    return this.networkMode
  }

  getWalletAddress(): string {
    return this.exchange.walletAddress ?? ""
  }
}
