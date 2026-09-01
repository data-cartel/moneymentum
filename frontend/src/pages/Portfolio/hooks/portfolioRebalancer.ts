import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { type OrderSide, type RebalanceParams } from "@/hooks/useTrading"
import type { OrderResult } from "@/services/hyperliquid-client"
import type {
  DeriveBatchOrderRequest,
  DeriveMappedPosition,
  DeriveTickerQuote,
} from "@/services/derive/index"

export const MIN_USD = 11

export type PortfolioPositionKind = "perp" | "option"
export type PortfolioVenue = "hyperliquid" | "derive"

/** Hyperliquid or Derive perp row in the unified portfolio model. */
export interface PerpPortfolioPosition {
  kind: "perp"
  venue: PortfolioVenue
  symbol: string
  side: OrderSide
  leverage: number
  notional: number
}

/**
 * Derive option row. Notional is premium USD (`contracts * mark` at fetch /
 * `contracts * limit` when staging); contracts are derived at order time as
 * `notional / price`.
 */
export interface OptionPortfolioPosition {
  kind: "option"
  venue: "derive"
  symbol: string
  side: OrderSide
  notional: number
}

export type PortfolioInterface = PerpPortfolioPosition | OptionPortfolioPosition

export const isPerpPosition = (
  position: PortfolioInterface,
): position is PerpPortfolioPosition => position.kind === "perp"

export const isOptionPosition = (
  position: PortfolioInterface,
): position is OptionPortfolioPosition => position.kind === "option"

/** Accepted on the venue: filled, still resting (working), or watch timed out. */
const orderAcceptedOnExchange = (order: OrderResult): boolean =>
  order.status === "filled" ||
  order.status === "working" ||
  order.status === "timed_out"

const rebalanceOrderUserMessage = (order: OrderResult): string => {
  if (order.message) {
    return order.message
  }
  return "Order was not filled"
}

export interface ExchangePositionRow {
  symbol: string
  side: OrderSide
  notional: number
  leverage: number
}

export const portfolioMapFromExchangePositions = (
  positions: ExchangePositionRow[],
): {
  map: Record<string, PortfolioInterface | undefined>
  totalNotional: number
} => {
  const totalNotional = positions.reduce(
    (sum, position) => sum + position.notional,
    0,
  )
  const map = Object.fromEntries(
    positions.map(position => [
      position.symbol,
      {
        kind: "perp" as const,
        venue: "hyperliquid" as const,
        symbol: position.symbol,
        side: position.side,
        leverage: position.leverage || 1,
        notional: position.notional,
      },
    ]),
  ) as Record<string, PortfolioInterface | undefined>

  return { map, totalNotional }
}

/** Maps Derive open positions (options + perps) into portfolio rows. */
export const portfolioMapFromDerivePositions = (
  positions: DeriveMappedPosition[],
): {
  map: Record<string, PortfolioInterface | undefined>
  totalNotional: number
} => {
  const totalNotional = positions.reduce(
    (sum, position) => sum + position.notional,
    0,
  )
  const map = Object.fromEntries(
    positions.map(position => {
      if (position.positionKind === "option") {
        const optionRow: PortfolioInterface = {
          kind: "option",
          venue: "derive",
          symbol: position.symbol,
          side: position.side,
          notional: position.notional,
        }
        return [position.symbol, optionRow]
      }

      const perpRow: PortfolioInterface = {
        kind: "perp",
        venue: "derive",
        symbol: position.symbol,
        side: position.side,
        leverage: position.leverage || 1,
        notional: position.notional,
      }
      return [position.symbol, perpRow]
    }),
  ) as Record<string, PortfolioInterface | undefined>

  return { map, totalNotional }
}

export const mergePortfolioMaps = (
  ...maps: Array<Record<string, PortfolioInterface | undefined>>
): {
  map: Record<string, PortfolioInterface | undefined>
  totalNotional: number
} => {
  const map = Object.assign({}, ...maps) as Record<
    string,
    PortfolioInterface | undefined
  >
  const totalNotional = Object.values(map).reduce(
    (sum, position) => sum + (position?.notional ?? 0),
    0,
  )
  return { map, totalNotional }
}

/** Mark / dust noise below this is not treated as intentional staging. */
export const STAGED_NOTIONAL_EPSILON_USD = 0.1

const getSignedNotional = (side: OrderSide, notional: number): number =>
  side === "buy" ? notional : -notional

const isMeaningfullyStagedPosition = (
  current: PortfolioInterface,
  target: PortfolioInterface,
): boolean => {
  if (current.side !== target.side) {
    return true
  }
  if (
    isPerpPosition(current) &&
    isPerpPosition(target) &&
    current.leverage !== target.leverage
  ) {
    return true
  }

  return (
    Math.abs(
      getSignedNotional(target.side, target.notional) -
        getSignedNotional(current.side, current.notional),
    ) > STAGED_NOTIONAL_EPSILON_USD
  )
}

/**
 * Keep staged-close snapshots aligned with live exchange marks so undo restore
 * does not revive a stale notional after a venue/mark refresh.
 */
export const syncDeletedArchiveWithCurrent = (
  deletedArchive: Record<string, PortfolioInterface | undefined>,
  current: Record<string, PortfolioInterface | undefined>,
): Record<string, PortfolioInterface | undefined> => {
  const next: Record<string, PortfolioInterface | undefined> = {}

  for (const [symbol, archived] of Object.entries(deletedArchive)) {
    if (archived === undefined) {
      continue
    }
    const livePosition = current[symbol]
    next[symbol] =
      livePosition !== undefined ? { ...livePosition } : { ...archived }
  }

  return next
}

/**
 * Intentional target edits relative to current (not dust). Used when venue
 * composition changes so exchange marks can refresh without dropping staging.
 */
export type StagedPortfolioOverlay = {
  targetOverrides: Record<string, PortfolioInterface>
  deletedArchive: Record<string, PortfolioInterface | undefined>
}

export const captureStagedPortfolioOverlay = (
  current: Record<string, PortfolioInterface | undefined>,
  target: Record<string, PortfolioInterface | undefined>,
  deletedArchive: Record<string, PortfolioInterface | undefined>,
): StagedPortfolioOverlay => {
  const targetOverrides: Record<string, PortfolioInterface> = {}
  const nextDeletedArchive: Record<string, PortfolioInterface | undefined> = {
    ...deletedArchive,
  }

  const symbols = new Set([...Object.keys(current), ...Object.keys(target)])

  for (const symbol of symbols) {
    const currentPosition = current[symbol]
    const targetPosition = target[symbol]

    if (currentPosition !== undefined && targetPosition === undefined) {
      // Always refresh from live current — archive is "position to close", not
      // a frozen pre-delete target snapshot.
      nextDeletedArchive[symbol] = { ...currentPosition }
      continue
    }

    if (targetPosition === undefined) {
      continue
    }

    if (currentPosition === undefined) {
      targetOverrides[symbol] = { ...targetPosition }
      continue
    }

    if (isMeaningfullyStagedPosition(currentPosition, targetPosition)) {
      targetOverrides[symbol] = { ...targetPosition }
    }
  }

  return {
    targetOverrides,
    deletedArchive: syncDeletedArchiveWithCurrent(nextDeletedArchive, current),
  }
}

/**
 * Start from a fresh exchange map, drop symbols staged to close, then reapply
 * absolute target overrides (including brand-new staged rows).
 */
export const mergeExchangeTargetWithStagedOverlay = (
  exchangeMap: Record<string, PortfolioInterface | undefined>,
  overlay: StagedPortfolioOverlay,
): {
  map: Record<string, PortfolioInterface | undefined>
  totalNotional: number
} => {
  const map: Record<string, PortfolioInterface | undefined> = {}

  for (const [symbol, position] of Object.entries(exchangeMap)) {
    if (position === undefined) {
      continue
    }
    if (overlay.deletedArchive[symbol] !== undefined) {
      continue
    }
    map[symbol] = { ...position }
  }

  for (const [symbol, position] of Object.entries(overlay.targetOverrides)) {
    map[symbol] = { ...position }
  }

  const totalNotional = Object.values(map).reduce(
    (sum, position) => sum + (position?.notional ?? 0),
    0,
  )
  return { map, totalNotional }
}

/**
 * Keep intentional unused / over-allocated capacity across an exchange merge.
 * `mergedTargetSum - beforeTargetSum` is mark / overlay drift; unused capacity
 * (`beforeTargetTotal - beforeTargetSum`) stays put so manual under-100%
 * allocation is not wiped on every mark refresh.
 */
export const targetTotalAfterExchangeMerge = (
  beforeTargetSum: number,
  beforeTargetTotal: number,
  mergedTargetSum: number,
): number => {
  const unusedCapacity = beforeTargetTotal - beforeTargetSum
  return mergedTargetSum + unusedCapacity
}

export const targetAndArchiveAfterRebalance = (
  target: Record<string, PortfolioInterface | undefined>,
  deletedArchive: Record<string, PortfolioInterface | undefined>,
  current: Record<string, PortfolioInterface | undefined>,
  actions: RebalanceAction[],
  orders: OrderResult[],
): {
  nextTarget: Record<string, PortfolioInterface | undefined>
  nextDeletedArchive: Record<string, PortfolioInterface | undefined>
  errorsBySymbol: Record<string, string>
} => {
  const actionBySymbol = new Map(actions.map(action => [action.symbol, action]))
  const orderBySymbol = new Map(orders.map(order => [order.symbol, order]))

  // Start from exchange current (HL refresh), then keep staged options (and any
  // other non-touched venues) from the prior target so a HL settle does not
  // wipe Derive rows.
  const nextTarget = Object.fromEntries(
    Object.entries(current)
      .filter(
        (entry): entry is [string, PortfolioInterface] =>
          entry[1] !== undefined,
      )
      .map(([symbol, position]) => [symbol, { ...position }]),
  ) as Record<string, PortfolioInterface | undefined>

  for (const [symbol, priorTarget] of Object.entries(target)) {
    if (priorTarget === undefined) {
      continue
    }
    if (actionBySymbol.has(symbol)) {
      continue
    }
    nextTarget[symbol] ??= { ...priorTarget }
  }

  const symbolsToDropFromTarget = new Set<string>()

  for (const order of orders) {
    // working / timed_out: resting on the venue (open orders). Accept exchange
    // current and clear staged so the row is not duplicated in Staged Changes.
    if (orderAcceptedOnExchange(order)) {
      continue
    }

    const action = actionBySymbol.get(order.symbol)
    const priorTarget = target[order.symbol]

    if (action?.kind === "close") {
      symbolsToDropFromTarget.add(order.symbol)
      continue
    }

    if (priorTarget !== undefined) {
      nextTarget[order.symbol] = { ...priorTarget }
    }
  }

  const filteredNextTarget =
    symbolsToDropFromTarget.size === 0
      ? nextTarget
      : (Object.fromEntries(
          Object.entries(nextTarget).filter(
            ([symbol]) => !symbolsToDropFromTarget.has(symbol),
          ),
        ) as Record<string, PortfolioInterface | undefined>)

  const nextDeletedArchive = Object.fromEntries(
    Object.entries(deletedArchive)
      .filter((entry): entry is [string, PortfolioInterface] => {
        const [symbol, position] = entry
        if (position === undefined) {
          return false
        }

        const order = orderBySymbol.get(symbol)
        const action = actionBySymbol.get(symbol)
        return !(
          order !== undefined &&
          action?.kind === "close" &&
          orderAcceptedOnExchange(order)
        )
      })
      .map(([symbol, position]) => [symbol, { ...position }]),
  ) as Record<string, PortfolioInterface | undefined>

  const errorsBySymbol = Object.fromEntries(
    orders
      .filter(order => !orderAcceptedOnExchange(order))
      .map(order => [order.symbol, rebalanceOrderUserMessage(order)]),
  ) as Record<string, string>

  return { nextTarget: filteredNextTarget, nextDeletedArchive, errorsBySymbol }
}

export type RebalanceAction =
  | {
      kind: "close"
      symbol: string
      side: OrderSide
      positionKind: PortfolioPositionKind
      venue: PortfolioVenue
    }
  | {
      kind: "rebalance"
      symbol: string
      signedNotionalDelta: number
      leverage: number
      leverageChanged: boolean
      positionKind: PortfolioPositionKind
      venue: PortfolioVenue
    }
  | {
      kind: "preciseRebalance"
      symbol: string
      /** Target side for the open leg after the reduce-only close. */
      side: OrderSide
      leverage: number
      leverageChanged: boolean
      closeNotional: number
      openNotional: number
      positionKind: PortfolioPositionKind
      venue: PortfolioVenue
    }

export type DeriveRebalanceAction = Exclude<
  RebalanceAction,
  { kind: "preciseRebalance" }
>

export class DeriveOrderMappingFailed extends Data.TaggedError(
  "DeriveOrderMappingFailed",
)<{
  readonly reason: string
}> {}

export const buildApiPayload = (
  current: Record<string, PortfolioInterface | undefined>,
  target: Record<string, PortfolioInterface | undefined>,
  precise: boolean,
): RebalanceParams => {
  const actions = diffPortfolios(current, target, precise).filter(
    action => action.venue === "hyperliquid",
  )
  return { actions }
}

/** Signed delta: targetSigned - currentSigned (same convention as diffPortfolios). */
export const preciseRebalanceLegs = (
  positionSide: OrderSide,
  deltaSigned: number,
  currentNotional: number,
): { closeNotional: number; openNotional: number } => {
  const closeWanted =
    positionSide === "buy"
      ? deltaSigned > 0
        ? MIN_USD
        : MIN_USD + Math.abs(deltaSigned)
      : deltaSigned > 0
        ? MIN_USD + deltaSigned
        : MIN_USD

  const closeNotional = Math.min(currentNotional, closeWanted)
  const openNotional =
    positionSide === "buy"
      ? closeNotional + deltaSigned
      : closeNotional - deltaSigned

  return {
    closeNotional: Math.max(0, closeNotional),
    openNotional: Math.max(0, openNotional),
  }
}

export const diffPortfolios = (
  current: Record<string, PortfolioInterface | undefined>,
  target: Record<string, PortfolioInterface | undefined>,
  precise: boolean,
): RebalanceAction[] => {
  const actions: RebalanceAction[] = []
  const allSymbols = new Set([...Object.keys(current), ...Object.keys(target)])

  for (const symbol of allSymbols) {
    const currentPosition = current[symbol]
    const targetPosition = target[symbol]

    const currentSigned = currentPosition
      ? getSignedNotional(currentPosition.side, currentPosition.notional)
      : 0
    const targetSigned = targetPosition
      ? getSignedNotional(targetPosition.side, targetPosition.notional)
      : 0

    const delta = targetSigned - currentSigned
    const deltaAbs = Math.abs(delta)

    if (currentPosition && !targetPosition) {
      actions.push({
        kind: "close",
        symbol,
        side: currentPosition.side,
        positionKind: currentPosition.kind,
        venue: currentPosition.venue,
      })
      continue
    }

    if (!targetPosition) {
      continue
    }

    if (
      currentPosition &&
      targetPosition.notional <= STAGED_NOTIONAL_EPSILON_USD
    ) {
      actions.push({
        kind: "close",
        symbol,
        side: currentPosition.side,
        positionKind: currentPosition.kind,
        venue: currentPosition.venue,
      })
      continue
    }

    const leverageChanged =
      isPerpPosition(targetPosition) &&
      currentPosition !== undefined &&
      isPerpPosition(currentPosition)
        ? currentPosition.leverage !== targetPosition.leverage
        : false

    const hasSignificantDelta = deltaAbs > STAGED_NOTIONAL_EPSILON_USD

    if (!hasSignificantDelta && !leverageChanged) {
      continue
    }

    const targetLeverage = isPerpPosition(targetPosition)
      ? targetPosition.leverage
      : 1

    // Precise path is HL min-order workaround; options use simple notional delta.
    if (
      precise &&
      isPerpPosition(targetPosition) &&
      hasSignificantDelta &&
      deltaAbs < MIN_USD &&
      currentPosition?.side === targetPosition.side
    ) {
      const { closeNotional, openNotional } = preciseRebalanceLegs(
        targetPosition.side,
        delta,
        currentPosition.notional,
      )
      actions.push({
        kind: "preciseRebalance",
        symbol,
        side: targetPosition.side,
        leverage: targetLeverage,
        leverageChanged,
        closeNotional,
        openNotional,
        positionKind: targetPosition.kind,
        venue: targetPosition.venue,
      })
      continue
    }

    actions.push({
      kind: "rebalance",
      symbol,
      signedNotionalDelta: delta,
      leverage: targetLeverage,
      leverageChanged,
      positionKind: targetPosition.kind,
      venue: targetPosition.venue,
    })
  }

  return actions
}

/**
 * Aggressive limit for rebalance fills: buy at ask, sell at bid, fall back to
 * mark/last when the book side is missing.
 */
export const deriveLimitPriceForSide = (
  ticker: DeriveTickerQuote,
  side: OrderSide,
): number | null => {
  const preferred =
    side === "buy"
      ? (ticker.ask ?? ticker.mark ?? ticker.last)
      : (ticker.bid ?? ticker.mark ?? ticker.last)

  if (preferred === null || !(preferred > 0)) {
    return null
  }

  return preferred
}

const isReduceOnlyOrder = (
  current: PortfolioInterface | undefined,
  orderSide: OrderSide,
): boolean => {
  if (current === undefined) {
    return false
  }
  return (
    (current.side === "buy" && orderSide === "sell") ||
    (current.side === "sell" && orderSide === "buy")
  )
}

const contractsFromPremiumNotional = (
  notionalUsd: number,
  limitPrice: number,
): number => {
  if (!(notionalUsd > 0) || !(limitPrice > 0)) {
    return 0
  }
  return notionalUsd / limitPrice
}

/** Prefer mark for converting premium USD <-> contracts; fall back to last. */
const deriveSizingPrice = (ticker: DeriveTickerQuote): number | null => {
  const preferred = ticker.mark ?? ticker.last
  if (preferred === null || !(preferred > 0)) {
    return null
  }
  return preferred
}

const requireDeriveTicker = (
  tickers: Record<string, DeriveTickerQuote>,
  symbol: string,
  actionLabel: string,
): Effect.Effect<DeriveTickerQuote, DeriveOrderMappingFailed> => {
  if (!(symbol in tickers)) {
    return Effect.fail(
      new DeriveOrderMappingFailed({
        reason: `Missing Derive ticker for ${actionLabel} of ${symbol}`,
      }),
    )
  }
  return Effect.succeed(tickers[symbol])
}

/**
 * Maps Derive portfolio actions to limit order requests. Premium notionals
 * convert to contracts as `notional / mark` (same as the order ticket).
 * Limit price is aggressive book (ask/bid). Fails if a required ticker or
 * price is missing. Precise rebalance is not a Derive action.
 */
export const deriveActionsToOrderRequests = (
  actions: DeriveRebalanceAction[],
  current: Record<string, PortfolioInterface | undefined>,
  tickers: Record<string, DeriveTickerQuote>,
): Effect.Effect<DeriveBatchOrderRequest[], DeriveOrderMappingFailed> =>
  Effect.gen(function* () {
    const deriveActions = actions.filter(action => action.venue === "derive")
    const requests: DeriveBatchOrderRequest[] = []

    for (const action of deriveActions) {
      const currentPosition = current[action.symbol]

      switch (action.kind) {
        case "close": {
          if (currentPosition === undefined) {
            continue
          }
          const orderSide: OrderSide = action.side === "buy" ? "sell" : "buy"
          const ticker = yield* requireDeriveTicker(
            tickers,
            action.symbol,
            "close",
          )
          const price = deriveLimitPriceForSide(ticker, orderSide)
          const sizingPrice = deriveSizingPrice(ticker) ?? price
          if (price === null || sizingPrice === null) {
            return yield* Effect.fail(
              new DeriveOrderMappingFailed({
                reason: `No usable Derive price for close of ${action.symbol}`,
              }),
            )
          }
          const amount = contractsFromPremiumNotional(
            currentPosition.notional,
            sizingPrice,
          )
          if (!(amount > 0)) {
            continue
          }
          requests.push({
            symbol: action.symbol,
            side: orderSide,
            amount,
            price,
            type: "limit",
            reduceOnly: true,
          })
          break
        }
        case "rebalance": {
          const orderSide: OrderSide =
            action.signedNotionalDelta > 0 ? "buy" : "sell"
          const ticker = yield* requireDeriveTicker(
            tickers,
            action.symbol,
            "rebalance",
          )
          const price = deriveLimitPriceForSide(ticker, orderSide)
          const sizingPrice = deriveSizingPrice(ticker) ?? price
          if (price === null || sizingPrice === null) {
            return yield* Effect.fail(
              new DeriveOrderMappingFailed({
                reason: `No usable Derive price for rebalance of ${action.symbol}`,
              }),
            )
          }
          const amount = contractsFromPremiumNotional(
            Math.abs(action.signedNotionalDelta),
            sizingPrice,
          )
          if (!(amount > 0)) {
            continue
          }
          requests.push({
            symbol: action.symbol,
            side: orderSide,
            amount,
            price,
            type: "limit",
            reduceOnly: isReduceOnlyOrder(currentPosition, orderSide),
          })
          break
        }
      }
    }

    return requests
  })
