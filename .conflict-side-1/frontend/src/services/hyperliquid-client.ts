import { type Order, type OrderRequest } from "ccxt"
import { pro } from "ccxt"
import type { NetworkMode, WalletCredentials } from "@/contexts/wallet-context"
import type { RebalanceAction } from "@/pages/Portfolio/hooks/portfolioRebalancer"

const MARKETS_CACHE_KEY = "hyperliquid_markets_cache"
const MARKETS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

const HYPERLIQUID_MAINNET_INFO_URL = "https://api.hyperliquid.xyz/info"
const HYPERLIQUID_TESTNET_INFO_URL = "https://api.hyperliquid-testnet.xyz/info"

interface MarketsCache {
  markets: Record<string, unknown>
  timestamp: number
  networkMode: NetworkMode
}

const isDeployed = (): boolean =>
  typeof window !== "undefined" && window.location.hostname !== "localhost"

const applyApiProxy = (
  exchange: HyperliquidExchange,
  networkMode: NetworkMode,
): void => {
  if (!isDeployed()) return
  const proxyBase = networkMode === "testnet" ? "/hl-testnet" : "/hl"
  exchange.urls["api"] = { public: proxyBase, private: proxyBase }
}

const createTempExchange = (networkMode: NetworkMode): HyperliquidExchange => {
  const HyperliquidClass = pro.hyperliquid as unknown as new (
    config: Record<string, unknown>,
  ) => HyperliquidExchange

  const exchange = new HyperliquidClass({
    enableRateLimit: true,
  })

  if (networkMode === "testnet") {
    exchange.setSandboxMode(true)
  }

  applyApiProxy(exchange, networkMode)

  return exchange
}

const getCachedMarkets = (
  networkMode: NetworkMode,
): Record<string, unknown> | null => {
  try {
    const cached = localStorage.getItem(MARKETS_CACHE_KEY)
    if (!cached) {
      return null
    }

    const parsed: MarketsCache = JSON.parse(cached) as MarketsCache
    const { markets, timestamp, networkMode: cachedMode } = parsed

    if (cachedMode !== networkMode) {
      return null
    }

    const ageMs = Date.now() - timestamp
    if (ageMs >= MARKETS_CACHE_TTL_MS) {
      return null
    }

    return markets
  } catch {
    return null
  }
}

const setCachedMarkets = (
  markets: Record<string, unknown>,
  networkMode: NetworkMode,
): void => {
  const cacheData: MarketsCache = {
    markets,
    timestamp: Date.now(),
    networkMode,
  }
  localStorage.setItem(MARKETS_CACHE_KEY, JSON.stringify(cacheData))
}

export const preloadMarkets = async (
  networkMode: NetworkMode,
): Promise<Record<string, unknown> | null> => {
  const cached = getCachedMarkets(networkMode)
  if (cached) {
    return cached
  }

  try {
    const tempExchange = createTempExchange(networkMode)
    const markets = await tempExchange.loadMarkets()

    setCachedMarkets(markets, networkMode)
    return markets
  } catch {
    // Network errors are expected when offline or API is unreachable
    // Markets will be loaded on-demand when needed
    return null
  }
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
  status: "working" | "filled" | "failed"
  message?: string | null
}

export interface LeverageLimit {
  symbol: string
  maxLeverage: number
}

// Minimum order size on Hyperliquid is $10, but we use $11 to guarantee orders will be opened
const SLIPPAGE = 0.05

interface HyperliquidExchange {
  setSandboxMode: (enabled: boolean) => void
  options: Record<string, unknown>
  urls: Record<string, string | Record<string, string>>
  walletAddress?: string
  loadMarkets: () => Promise<Record<string, unknown>>
  fetchBalance: () => Promise<{
    total: Record<string, unknown>
    info?: Record<string, unknown>
  }>
  fetchTickers: (
    symbols?: string[],
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
}

export class HyperliquidClient {
  private exchange: HyperliquidExchange
  private networkMode: NetworkMode
  private vaultAddress: string | undefined

  constructor(
    credentials: WalletCredentials,
    networkMode: NetworkMode,
    markets?: Record<string, unknown>,
  ) {
    this.networkMode = networkMode
    this.vaultAddress = credentials.vaultAddress

    const HyperliquidClass = pro.hyperliquid as unknown as new (
      config: Record<string, unknown>,
    ) => HyperliquidExchange

    // walletAddress is used for info requests (fetching positions/balance)
    // When trading on behalf of a vault, use vault address; otherwise use account address
    const effectiveWalletAddress =
      credentials.vaultAddress ?? credentials.accountAddress

    // Use pre-loaded markets if available, otherwise ccxt will load them on first use
    const cachedMarkets = markets ?? getCachedMarkets(networkMode)

    this.exchange = new HyperliquidClass({
      walletAddress: effectiveWalletAddress,
      privateKey: credentials.privateKey,
      enableRateLimit: true,
      ...(cachedMarkets && { markets: cachedMarkets }),
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
      signal: AbortSignal.timeout(10_000),
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

  async listPerpTickers(): Promise<string[]> {
    const markets = await this.exchange.loadMarkets()

    // Update cache with fresh markets data
    setCachedMarkets(markets, this.networkMode)

    const perpSymbols = Object.entries(markets)
      .filter(
        ([symbol, data]) =>
          symbol.includes(":") && (data as { swap?: boolean }).swap,
      )
      .map(([symbol]) => symbol)
      .sort()
    return perpSymbols
  }

  async getLeverageLimits(): Promise<LeverageLimit[]> {
    const tickers = await this.exchange.fetchTickers()
    const results: LeverageLimit[] = []

    for (const [symbol, ticker] of Object.entries(tickers)) {
      if (!symbol.includes(":")) continue

      let maxLeverage = 1.0
      if (ticker.info !== undefined && ticker.info !== null) {
        const info = ticker.info as Record<string, unknown>
        const rawMaxLeverage = info["maxLeverage"]
        if (typeof rawMaxLeverage === "number") {
          maxLeverage = rawMaxLeverage
        } else if (typeof rawMaxLeverage === "string") {
          maxLeverage = parseFloat(rawMaxLeverage)
        }
      }

      results.push({ symbol, maxLeverage })
    }

    return results.sort((a, b) => a.symbol.localeCompare(b.symbol))
  }

  async getCurrentPositions(): Promise<CurrentPosition[]> {
    const positions = await this.exchange.fetchPositions()
    const processed: CurrentPosition[] = []

    for (const pos of positions) {
      try {
        const notionalRaw = pos.notional
        if (notionalRaw === undefined) continue
        const notional =
          typeof notionalRaw === "number"
            ? notionalRaw
            : parseFloat(notionalRaw)
        if (notional <= 0) continue

        const parseNumeric = (value: unknown, fallback: number): number => {
          if (value === undefined || value === null) return fallback
          if (typeof value === "number") return value
          if (typeof value === "string") return parseFloat(value)
          return fallback
        }

        processed.push({
          symbol: pos.symbol,
          side: pos.side === "long" ? "buy" : "sell",
          notional,
          entryPrice: parseNumeric(pos.entryPrice, 0),
          unrealizedPnl: parseNumeric(pos.unrealizedPnl, 0),
          leverage: Math.round(parseNumeric(pos.leverage, 1)),
        })
      } catch {
        continue
      }
    }

    return processed
  }

  private async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.exchange.setLeverage(leverage, symbol, this.vaultParams)
  }

  private get vaultParams(): Record<string, unknown> | undefined {
    return this.vaultAddress ? { vaultAddress: this.vaultAddress } : undefined
  }

  private mapOrderResults(
    requests: OrderRequest[],
    responses: Order[],
  ): OrderResult[] {
    return requests.map((request, index): OrderResult => {
      const res: Order | undefined =
        index < responses.length ? responses[index] : undefined
      if (res === undefined) {
        return {
          symbol: request.symbol,
          side: (request.side ?? "buy") as OrderSide,
          status: "working",
          message: "order response missing",
        }
      }
      return {
        symbol: request.symbol,
        side: (request.side ?? "buy") as OrderSide,
        status:
          res.status === "closed" || res.status === "filled"
            ? "filled"
            : "working",
        message: this.parseOrderErrorMessage(res.info),
      }
    })
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
      price: side === "buy" ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE),
      params: reduceOnly
        ? { reduceOnly: true, ...this.vaultParams }
        : { ...this.vaultParams },
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
    await this.exchange.loadMarkets()
    const allSymbols = [...new Set(actions.map(action => action.symbol))]

    for (const action of actions) {
      if ("leverageChanged" in action && action.leverageChanged) {
        await this.setLeverage(action.symbol, action.leverage)
      }
    }

    const [tickers, positions] = await Promise.all([
      this.exchange.fetchTickers(allSymbols),
      this.exchange.fetchPositions(),
    ])

    const { reduction, expansion } = this.splitRebalanceActionsIntoPhases(
      actions,
      tickers,
      positions,
    )

    const results: OrderResult[] = []

    if (reduction.length > 0) {
      const reductionResponses = await this.exchange.createOrdersWs(reduction)
      const reductionResults = this.mapOrderResults(
        reduction,
        reductionResponses,
      )
      results.push(...reductionResults)
    }

    if (expansion.length > 0) {
      const expansionResponses = await this.exchange.createOrdersWs(expansion)
      results.push(...this.mapOrderResults(expansion, expansionResponses))
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
