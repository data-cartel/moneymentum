import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from "solid-js"
import Decimal from "decimal.js"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import {
  useHyperliquidAccountSummary,
  useHyperliquidPositions,
  useHyperliquidLeverageLimits,
  useRebalanceHyperliquidPositions,
  useRebalanceDerivePositions,
  useDeriveBalance,
  useDeriveAccountSnapshot,
  useDeriveSessionCredentials,
  type OrderSide,
  type OrderResult,
} from "@/hooks/useTrading"
import { fetchDeriveTickers } from "@/services/derive/index"
import {
  captureStagedPortfolioOverlay,
  deriveActionsToOrderRequests,
  diffPortfolios,
  mergeExchangeTargetWithStagedOverlay,
  mergePortfolioMaps,
  portfolioMapFromDerivePositions,
  portfolioMapFromExchangePositions,
  syncDeletedArchiveWithCurrent,
  targetAndArchiveAfterRebalance,
  targetTotalAfterExchangeMerge,
  isOptionPosition,
  isPerpPosition,
  MIN_USD,
  type DeriveRebalanceAction,
  type OptionPortfolioPosition,
  type PerpPortfolioPosition,
  type PortfolioInterface,
  type PortfolioPositionKind,
  type PortfolioVenue,
  type RebalanceAction,
} from "./portfolioRebalancer"
import { getErrorMessage, getExchangeErrorDetail } from "@/lib/error-message"
import { toast } from "solid-sonner"
import {
  useReadonlyPortfolioState,
  type ReadonlyBetaPosition,
  type ReadonlyBtcRow,
} from "./useReadonlyPortfolioState"
import { useWallet } from "@/hooks/useWallet"
import { createStore, produce, reconcile } from "solid-js/store"

export {
  isOptionPosition,
  isPerpPosition,
  MIN_USD,
  type OptionPortfolioPosition,
  type PerpPortfolioPosition,
  type PortfolioInterface,
  type PortfolioPositionKind,
  type PortfolioVenue,
}

/**
 * Target allocation band for submit + the under/over-100% alerts.
 * Story 0x006: block outside ~99%..101%; UI uses a tight band around 100%.
 */
export const ALLOCATION_MIN_PERCENT = 99.95
export const ALLOCATION_MAX_PERCENT = 100.01

export const PRECISE_TOGGLE_STORAGE_KEY = "portfolio-precise-toggle"

/** When true, changing one weight only updates that symbol; others stay fixed. */
export const MANUAL_WEIGHT_ENTRY_STORAGE_KEY = "portfolio-manual-weight-entry"

const initialPreciseFromStorage = (): boolean =>
  typeof localStorage !== "undefined" &&
  typeof localStorage.getItem === "function" &&
  localStorage.getItem(PRECISE_TOGGLE_STORAGE_KEY) === "true"

const initialManualWeightEntryFromStorage = (): boolean =>
  typeof localStorage !== "undefined" &&
  typeof localStorage.getItem === "function" &&
  localStorage.getItem(MANUAL_WEIGHT_ENTRY_STORAGE_KEY) === "true"

export const writePreciseToggle = (isPrecise: boolean): void => {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.setItem !== "function"
  ) {
    return
  }

  localStorage.setItem(PRECISE_TOGGLE_STORAGE_KEY, String(isPrecise))
}

export const writeManualWeightEntry = (isManualWeightEntry: boolean): void => {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.setItem !== "function"
  ) {
    return
  }

  localStorage.setItem(
    MANUAL_WEIGHT_ENTRY_STORAGE_KEY,
    String(isManualWeightEntry),
  )
}

const MAX_CROSS_ACCOUNT_LEVERAGE = 5
const DEFAULT_CROSS_ACCOUNT_LEVERAGE = 1
const POSITION_CLOSE_EPSILON = 0.01

export interface StagedTradeItem {
  underlying: string
  side: OrderSide
  notional: number
  kind: PortfolioPositionKind
  venue: PortfolioVenue
  previousWeight?: number
  newWeight?: number
  orderError?: string
  /** Filled at Derive execution: live premium used for `amount = notional / price`. */
  markPrice?: number
  /** Filled at Derive execution: contract size sent to createOrder. */
  amount?: number
}

const calcLeverage = (totalNotional: number, accountValue: number): number => {
  if (accountValue <= 0) return 1
  const leverage = new Decimal(totalNotional)
    .div(accountValue)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toNumber()
  return Math.min(MAX_CROSS_ACCOUNT_LEVERAGE, leverage)
}

const omitVenueFromPortfolio = (
  portfolio: Record<string, PortfolioInterface | undefined>,
  venue: PortfolioVenue,
): Record<string, PortfolioInterface | undefined> =>
  Object.fromEntries(
    Object.entries(portfolio).filter(([, position]) => {
      if (position === undefined) {
        return false
      }
      return position.venue !== venue
    }),
  )

const portfolioNotionalSum = (
  portfolio: Record<string, PortfolioInterface | undefined>,
): number =>
  Object.values(portfolio).reduce(
    (sum, position) => sum + (position?.notional ?? 0),
    0,
  )

export const usePortfolioState = () => {
  const {
    isConnected,
    isHyperliquidConnected,
    isDeriveConnected,
    isDeriveLocked,
  } = useWallet()

  const [isPrecise, setPreciseSignal] = createSignal(
    initialPreciseFromStorage(),
  )
  const [isManualWeightEntry, setManualWeightEntrySignal] = createSignal(
    initialManualWeightEntryFromStorage(),
  )

  // Exchange data queries
  const accountSummaryQuery = useHyperliquidAccountSummary()
  const deriveBalanceQuery = useDeriveBalance()
  const deriveAccountQuery = useDeriveAccountSnapshot()
  const deriveSession = useDeriveSessionCredentials()
  const positionsQuery = useHyperliquidPositions()
  const leverageLimitsQuery = useHyperliquidLeverageLimits()
  // Mutations
  const rebalanceHyperliquidMutation = useRebalanceHyperliquidPositions()
  const rebalanceDeriveMutation = useRebalanceDerivePositions()

  const [currentPortfolio, setCurrentPortfolio] = createStore<
    Record<string, PortfolioInterface | undefined>
  >({})

  const [targetPortfolio, setTargetPortfolio] = createStore<
    Record<string, PortfolioInterface | undefined>
  >({})

  const [deletedArchive, setDeletedArchive] = createStore<
    Record<string, PortfolioInterface | undefined>
  >({})

  const [errorsBySymbol, setErrorsBySymbol] = createStore<
    Record<string, string | undefined>
  >({})

  const [currentCrossAccountLeverage, setCurrentCrossAccountLeverage] =
    createSignal(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
  const [targetCrossAccountLeverage, setTargetCrossAccountLeverage] =
    createSignal(DEFAULT_CROSS_ACCOUNT_LEVERAGE)

  const [currentTotalNotional, setCurrentTotalNotional] = createSignal(0)
  const [targetTotalNotional, setTargetTotalNotional] = createSignal(0)

  const [isRebalancingUi, setIsRebalancingUi] = createSignal(false)

  const [positionsLoadedFromExchange, setPositionsLoadedFromExchange] =
    createSignal(false)

  // Track previous connection state for disconnect cleanup
  let wasConnected = isConnected()

  const selectedDerivePositions = createMemo(() => {
    const snapshot = deriveAccountQuery.data
    if (snapshot === undefined) {
      return []
    }
    const selectedSubaccountId = deriveSession()?.subaccountId ?? null
    if (selectedSubaccountId === null) {
      return snapshot.subaccounts.flatMap(subaccount => subaccount.positions)
    }
    const selected = snapshot.subaccounts.find(
      subaccount => subaccount.subaccountId === selectedSubaccountId,
    )
    return selected?.positions ?? []
  })

  const buildExchangePortfolioSnapshot = (): {
    map: Record<string, PortfolioInterface | undefined>
    totalNotional: number
    venueKey: string
  } | null => {
    const hyperliquidWanted = isHyperliquidConnected()
    const deriveWanted = isDeriveConnected() && !isDeriveLocked()

    // Only block on the initial load for a venue (no data yet). A later error
    // or a failed Derive refetch must not freeze HL portfolio updates.
    if (hyperliquidWanted && positionsQuery.isLoading) {
      return null
    }
    if (deriveWanted && deriveAccountQuery.isLoading) {
      return null
    }

    const hyperliquidSnapshot =
      hyperliquidWanted && positionsQuery.data !== undefined
        ? portfolioMapFromExchangePositions(positionsQuery.data.positions)
        : { map: {}, totalNotional: 0 }

    const deriveSnapshot =
      deriveWanted && deriveAccountQuery.data !== undefined
        ? portfolioMapFromDerivePositions(selectedDerivePositions())
        : { map: {}, totalNotional: 0 }

    // Connected venues with no data yet (and not loading) still cannot seed.
    if (hyperliquidWanted && positionsQuery.data === undefined) {
      return null
    }

    const merged = mergePortfolioMaps(
      hyperliquidSnapshot.map,
      deriveSnapshot.map,
    )
    const selectedSubaccountId = deriveSession()?.subaccountId ?? "all"
    const venueKey = [
      hyperliquidWanted ? "hl" : "",
      deriveWanted ? `derive:${selectedSubaccountId}` : "",
    ].join("|")

    return { ...merged, venueKey }
  }

  const handleDisconnect = () => {
    batch(() => {
      setCurrentPortfolio(reconcile({}))
      setTargetPortfolio(reconcile({}))
      setDeletedArchive(reconcile({}))
      setErrorsBySymbol(reconcile({}))
      readonlyPortfolio.clearAddresses()
      setCurrentCrossAccountLeverage(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
      setTargetCrossAccountLeverage(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
      setCurrentTotalNotional(0)
      setTargetTotalNotional(0)
      setPositionsLoadedFromExchange(false)
    })
  }

  const handleDisconnectDerive = () => {
    const nextCurrent = omitVenueFromPortfolio(
      untrack(() => ({ ...currentPortfolio })),
      "derive",
    )
    const nextTarget = omitVenueFromPortfolio(
      untrack(() => ({ ...targetPortfolio })),
      "derive",
    )
    const nextArchive = omitVenueFromPortfolio(
      untrack(() => ({ ...deletedArchive })),
      "derive",
    )
    const remainingSymbols = new Set([
      ...Object.keys(nextCurrent),
      ...Object.keys(nextTarget),
      ...Object.keys(nextArchive),
    ])
    const nextErrors = Object.fromEntries(
      Object.entries(untrack(() => ({ ...errorsBySymbol }))).filter(
        ([symbol]) => remainingSymbols.has(symbol),
      ),
    )

    batch(() => {
      setCurrentPortfolio(reconcile(nextCurrent))
      setTargetPortfolio(reconcile(nextTarget))
      setDeletedArchive(reconcile(nextArchive))
      setErrorsBySymbol(reconcile(nextErrors))
      setCurrentTotalNotional(portfolioNotionalSum(nextCurrent))
      setTargetTotalNotional(portfolioNotionalSum(nextTarget))
    })
  }

  const clearRebalanceErrorForSymbol = (symbol: string) => {
    if (errorsBySymbol[symbol] !== undefined) {
      setErrorsBySymbol(symbol, undefined)
    }
  }

  const redistributeWeights = (
    changedSymbol: string,
    newPercentage: number,
  ) => {
    const totalNotional = targetTotalNotional()
    const portfolio = untrack(() => targetPortfolio)
    const symbols = Object.keys(portfolio)

    if (totalNotional <= 0 || !symbols.includes(changedSymbol)) return

    const clampedNew = Math.max(0, Math.min(100, newPercentage))
    const otherSymbols = symbols.filter(symbol => symbol !== changedSymbol)

    const otherTotalPercent = otherSymbols.reduce((sum, symbol) => {
      const pos = portfolio[symbol]
      const currentNotional = pos?.notional ?? 0
      return sum + (currentNotional / totalNotional) * 100
    }, 0)

    batch(() => {
      const newTargetNotional = (clampedNew / 100) * totalNotional
      setTargetPortfolio(changedSymbol, "notional", newTargetNotional)

      const remainingPercentForOthers = 100 - clampedNew

      otherSymbols.forEach(symbol => {
        let nextPercent: number

        if (otherTotalPercent <= 0) {
          nextPercent = remainingPercentForOthers / otherSymbols.length
        } else {
          const pos = portfolio[symbol]
          const currentPercent = ((pos?.notional ?? 0) / totalNotional) * 100
          nextPercent =
            (currentPercent / otherTotalPercent) * remainingPercentForOthers
        }

        setTargetPortfolio(
          symbol,
          "notional",
          (nextPercent / 100) * totalNotional,
        )
      })
    })
  }

  const effectiveTotalNotional = createMemo(() => {
    return Object.values(targetPortfolio).reduce(
      (sum, pos) => sum + (pos?.notional ?? 0),
      0,
    )
  })

  const hasCurrentPositions = createMemo(() =>
    Object.values(currentPortfolio).some(position => position !== undefined),
  )

  const isClosingAllPositions = createMemo(() => {
    if (!hasCurrentPositions()) return false

    const symbols = new Set([
      ...Object.keys(currentPortfolio),
      ...Object.keys(targetPortfolio),
    ])

    return [...symbols].every(symbol => {
      const targetPosition = targetPortfolio[symbol]
      return (
        targetPosition === undefined ||
        targetPosition.notional <= POSITION_CLOSE_EPSILON
      )
    })
  })

  const symbolsBelowMinimum = createMemo(() => {
    if (isClosingAllPositions()) return []

    // HL perp minimum-notional gate only; Derive option rules come later.
    return Object.keys(targetPortfolio).filter(symbol => {
      const targetPosition = targetPortfolio[symbol]
      if (!targetPosition || !isPerpPosition(targetPosition)) return false
      if (targetPosition.venue !== "hyperliquid") return false
      if (targetPosition.notional >= MIN_USD) return false

      const currentNotional = currentPortfolio[symbol]?.notional ?? 0
      const unchanged =
        currentNotional < MIN_USD &&
        Math.abs(targetPosition.notional - currentNotional) < 0.01

      return !unchanged
    })
  })

  const symbolsDeltaBelowMinimum = createMemo(() => {
    if (isClosingAllPositions()) return []

    return Object.keys(targetPortfolio).filter(symbol => {
      const target = targetPortfolio[symbol]
      if (!target || !isPerpPosition(target)) return false
      if (target.venue !== "hyperliquid") return false

      const targetSignedNotional =
        target.side === "sell" ? -target.notional : target.notional
      const currentPosition = currentPortfolio[symbol]
      const currentSignedNotional =
        currentPosition === undefined
          ? 0
          : currentPosition.side === "sell"
            ? -currentPosition.notional
            : currentPosition.notional
      const delta = Math.abs(targetSignedNotional - currentSignedNotional)

      return delta < MIN_USD && delta !== 0
    })
  })

  // Keep displayed target leverage in sync with planned target notional.
  createEffect(() => {
    setTargetCrossAccountLeverage(
      calcLeverage(targetTotalNotional(), accountValue()),
    )
  })

  // Keep displayed current leverage in sync with current notional on the exchange.
  createEffect(() => {
    setCurrentCrossAccountLeverage(
      calcLeverage(currentTotalNotional(), accountValue()),
    )
  })

  // createEffect: disconnect cleanup - detect falling edge from connected to disconnected
  createEffect(() => {
    const currentlyConnected = isConnected()
    const previouslyConnected = wasConnected
    wasConnected = currentlyConnected

    if (!previouslyConnected || currentlyConnected) {
      return
    }

    handleDisconnect()
  })

  // Combined equity for cross-account leverage sizing. HL + selected Derive
  // subaccount; split per-venue sizing later if staged math diverges.
  const accountValue = createMemo(() => {
    const hyperliquidValue = isHyperliquidConnected()
      ? (accountSummaryQuery.data?.accountValue ?? 0)
      : 0
    const deriveValue =
      isDeriveConnected() && !isDeriveLocked()
        ? (deriveBalanceQuery.data?.accountValue ?? 0)
        : 0
    return hyperliquidValue + deriveValue
  })

  const readonlyPortfolio = useReadonlyPortfolioState()

  const applyCurrentFromExchange = (
    portfolioMap: Record<string, PortfolioInterface | undefined>,
    totalNotional: number,
  ) => {
    const syncedArchive = syncDeletedArchiveWithCurrent(
      untrack(() => ({ ...deletedArchive })),
      portfolioMap,
    )

    batch(() => {
      setCurrentPortfolio(reconcile(portfolioMap))
      setCurrentTotalNotional(totalNotional)
      setDeletedArchive(reconcile(syncedArchive))
    })
  }

  const finalizeRebalance = async (
    orders: OrderResult[],
    actions: RebalanceAction[],
  ) => {
    if (orders.length === 0) {
      setIsRebalancingUi(false)
      return
    }

    try {
      const hyperliquidWanted = isHyperliquidConnected()
      const deriveWanted = isDeriveConnected() && !isDeriveLocked()

      // Prefer allSettled so a Derive refresh failure cannot skip HL settle.
      const [positionsRefresh, , deriveAccountRefresh] =
        await Promise.allSettled([
          hyperliquidWanted
            ? positionsQuery.refetch()
            : Promise.resolve(undefined),
          hyperliquidWanted
            ? accountSummaryQuery.refetch()
            : Promise.resolve(undefined),
          deriveWanted
            ? deriveAccountQuery.refetch()
            : Promise.resolve(undefined),
          deriveWanted
            ? deriveBalanceQuery.refetch()
            : Promise.resolve(undefined),
        ])

      if (positionsRefresh.status === "rejected") {
        console.error(
          "rebalance finalize: hyperliquid positions refresh failed",
          positionsRefresh.reason,
        )
      }
      if (deriveAccountRefresh.status === "rejected") {
        console.error(
          "rebalance finalize: derive account refresh failed",
          deriveAccountRefresh.reason,
        )
      }

      const hyperliquidPositions =
        positionsRefresh.status === "fulfilled"
          ? positionsRefresh.value?.data?.positions
          : positionsQuery.data?.positions

      if (hyperliquidWanted && hyperliquidPositions === undefined) {
        console.error(
          "rebalance finalize: hyperliquid positions unavailable after refresh",
        )
        toast.error(
          "Orders submitted, but portfolio refresh failed. Reload or wait a moment.",
        )
        return
      }

      const hyperliquidSnapshot =
        hyperliquidPositions !== undefined
          ? portfolioMapFromExchangePositions(hyperliquidPositions)
          : { map: {}, totalNotional: 0 }

      const derivePositions =
        deriveWanted && deriveAccountQuery.data !== undefined
          ? selectedDerivePositions()
          : []
      const deriveSnapshot = portfolioMapFromDerivePositions(derivePositions)
      const exchangeSnapshot = mergePortfolioMaps(
        hyperliquidSnapshot.map,
        deriveSnapshot.map,
      )

      const {
        nextTarget,
        nextDeletedArchive,
        errorsBySymbol: nextErrors,
      } = targetAndArchiveAfterRebalance(
        untrack(() => targetPortfolio),
        untrack(() => deletedArchive),
        exchangeSnapshot.map,
        actions,
        orders,
      )

      const nextTargetTotalNotional = Object.values(nextTarget).reduce(
        (sum, position) => sum + (position?.notional ?? 0),
        0,
      )

      batch(() => {
        applyCurrentFromExchange(
          exchangeSnapshot.map,
          exchangeSnapshot.totalNotional,
        )
        setTargetPortfolio(reconcile(nextTarget))
        setTargetTotalNotional(nextTargetTotalNotional)
        setDeletedArchive(reconcile(nextDeletedArchive))
        setErrorsBySymbol(reconcile(nextErrors))
      })

      if (
        orders.some(
          order => order.status === "timed_out" || order.status === "working",
        )
      ) {
        console.warn(
          "rebalance orders accepted on exchange; open orders left resting, staged cleared",
        )
      }

      const failedOrders = orders.filter(
        order =>
          order.status !== "filled" &&
          order.status !== "timed_out" &&
          order.status !== "working",
      )
      if (failedOrders.length > 0) {
        console.warn(
          "rebalance finalize: non-filled orders kept staged target",
          failedOrders,
        )
      }
    } finally {
      setIsRebalancingUi(false)
    }
  }

  // Seed / refresh portfolio from connected exchange venues (HL + Derive).
  createEffect(() => {
    // finalizeRebalance owns the post-trade snapshot; do not race it.
    if (isRebalancingUi()) {
      return
    }

    const exchangeSnapshot = buildExchangePortfolioSnapshot()
    if (exchangeSnapshot === null) {
      return
    }

    if (!positionsLoadedFromExchange()) {
      if (accountValue() <= 0) {
        return
      }

      applyCurrentFromExchange(
        exchangeSnapshot.map,
        exchangeSnapshot.totalNotional,
      )
      setTargetPortfolio(reconcile(structuredClone(exchangeSnapshot.map)))

      const initialLeverage = calcLeverage(
        exchangeSnapshot.totalNotional,
        accountValue(),
      )
      setTargetTotalNotional(exchangeSnapshot.totalNotional)
      setTargetCrossAccountLeverage(initialLeverage)
      setCurrentCrossAccountLeverage(initialLeverage)
      setPositionsLoadedFromExchange(true)
      return
    }

    const beforeCurrent = untrack(() => ({ ...currentPortfolio }))
    const beforeTarget = untrack(() => ({ ...targetPortfolio }))
    const beforeArchive = untrack(() => ({ ...deletedArchive }))
    const beforeTargetSum = Object.values(beforeTarget).reduce(
      (sum, position) => sum + (position?.notional ?? 0),
      0,
    )
    const beforeTargetTotal = untrack(targetTotalNotional)
    const stagedOverlay = captureStagedPortfolioOverlay(
      beforeCurrent,
      beforeTarget,
      beforeArchive,
    )

    // Always: current = exchange; target follows exchange except intentional
    // staged overrides / closes; archive marks refresh with live current.
    applyCurrentFromExchange(
      exchangeSnapshot.map,
      exchangeSnapshot.totalNotional,
    )

    const mergedTarget = mergeExchangeTargetWithStagedOverlay(
      exchangeSnapshot.map,
      stagedOverlay,
    )
    const syncedArchive = syncDeletedArchiveWithCurrent(
      stagedOverlay.deletedArchive,
      exchangeSnapshot.map,
    )
    const nextTargetTotal = targetTotalAfterExchangeMerge(
      beforeTargetSum,
      beforeTargetTotal,
      mergedTarget.totalNotional,
    )

    batch(() => {
      setTargetPortfolio(reconcile(mergedTarget.map))
      setTargetTotalNotional(nextTargetTotal)
      setDeletedArchive(reconcile(syncedArchive))
    })
  })

  const actions = createMemo(() =>
    diffPortfolios(currentPortfolio, targetPortfolio, isPrecise()),
  )

  const getSignedNotional = (side: OrderSide, notional: number): number => {
    return side === "buy" ? notional : -notional
  }

  //Get staged trades directly for actions we will perform
  const stagedTrades = createMemo<StagedTradeItem[]>(() => {
    const totalCurrent = currentTotalNotional()
    const totalTarget = targetTotalNotional()

    return actions().map(action => {
      const symbol = action.symbol
      const currentPosition = currentPortfolio[symbol]
      const targetPosition = targetPortfolio[symbol]

      let delta = 0

      switch (action.kind) {
        case "close":
          if (!currentPosition) {
            throw new Error(
              `Close action for ${symbol} without current position`,
            )
          }
          delta = -getSignedNotional(
            currentPosition.side,
            currentPosition.notional,
          )
          break
        case "rebalance":
          delta = action.signedNotionalDelta
          break
        case "preciseRebalance":
          if (!currentPosition || !targetPosition) {
            throw new Error(
              `Precise rebalance for ${symbol} requires current and target`,
            )
          }
          delta =
            getSignedNotional(targetPosition.side, targetPosition.notional) -
            getSignedNotional(currentPosition.side, currentPosition.notional)
          break
      }

      return {
        underlying: symbol,
        side: (delta > 0 ? "buy" : "sell") as OrderSide,
        notional: Math.abs(delta),
        kind: action.positionKind,
        venue: action.venue,
        previousWeight: totalCurrent
          ? (currentPosition?.notional ?? 0) / totalCurrent
          : 0,
        newWeight: totalTarget
          ? (targetPosition?.notional ?? 0) / totalTarget
          : 0,
        orderError: errorsBySymbol[symbol],
      }
    })
  })

  const leverageLimitsMap = createMemo(() => {
    const map: Record<string, number> = {}
    const limitsData = leverageLimitsQuery.data
    if (!limitsData) return map
    for (const item of limitsData) {
      map[item.symbol] = item.maxLeverage
    }
    return map
  })

  const hasPositionsBelowMinimum = () => symbolsBelowMinimum().length > 0
  const targetAllocationPercent = createMemo(() => {
    const total = targetTotalNotional()
    if (total <= 0) return 0
    return (100 * effectiveTotalNotional()) / total
  })

  const hasUnderAllocation = createMemo(() => {
    if (isClosingAllPositions()) {
      return false
    }
    return targetAllocationPercent() < ALLOCATION_MIN_PERCENT
  })

  const hasTotalWeightExceeded = createMemo(() => {
    return targetAllocationPercent() > ALLOCATION_MAX_PERCENT
  })

  const hasSymbolsDeltaBelowMinimum = () =>
    symbolsDeltaBelowMinimum().length > 0

  const handleAddToken = (
    symbol: string,
    kind: PortfolioPositionKind,
    venue: PortfolioVenue,
    options?: { side?: OrderSide; notional?: number },
  ) => {
    if (!isConnected()) return

    if (kind === "perp") {
      if (symbol in targetPortfolio) return
      if (deletedArchive[symbol] !== undefined) return
      if (venue !== "hyperliquid" || !isHyperliquidConnected()) {
        return
      }

      batch(() => {
        setTargetPortfolio(symbol, {
          kind: "perp",
          venue: "hyperliquid",
          symbol,
          side: "buy",
          leverage: leverageLimitsMap()[symbol] || 1,
          notional: MIN_USD,
        })

        setTargetTotalNotional(prev => prev + MIN_USD)
      })
      return
    }

    if (venue !== "derive") {
      return
    }

    if (!isDeriveConnected()) {
      return
    }

    const side = options?.side ?? "buy"
    const notional = options?.notional ?? MIN_USD
    if (!(notional >= MIN_USD)) {
      return
    }

    const existing = targetPortfolio[symbol]
    if (existing !== undefined) {
      if (!isOptionPosition(existing)) {
        return
      }
      batch(() => {
        setTargetTotalNotional(prev => prev - existing.notional + notional)
        setTargetPortfolio(symbol, {
          kind: "option",
          venue: "derive",
          symbol,
          side,
          notional,
        })
      })
      return
    }

    if (deletedArchive[symbol] !== undefined) return

    batch(() => {
      setTargetPortfolio(symbol, {
        kind: "option",
        venue: "derive",
        symbol,
        side,
        notional,
      })

      setTargetTotalNotional(prev => prev + notional)
    })
  }

  const handleRemoveToken = (symbol: string) => {
    const targetPosition = targetPortfolio[symbol]
    if (!targetPosition) return

    const currentPosition = currentPortfolio[symbol]

    batch(() => {
      if (currentPosition !== undefined) {
        setDeletedArchive(symbol, { ...currentPosition })
      }

      setTargetPortfolio(symbol, undefined)

      setTargetTotalNotional(prev =>
        Math.max(0, prev - targetPosition.notional),
      )
    })
  }

  const handleUndoRemoveToken = (symbol: string) => {
    const archivedPosition = deletedArchive[symbol]
    const currentPosition = currentPortfolio[symbol]

    // Archive is kept in sync with live current on exchange refreshes, so undo
    // restores an up-to-date close snapshot (fallback to current if needed).
    const positionToRestore = archivedPosition ?? currentPosition

    if (!positionToRestore) return

    batch(() => {
      setTargetPortfolio(symbol, { ...positionToRestore })

      setTargetTotalNotional(prev => prev + positionToRestore.notional)

      setDeletedArchive(symbol, undefined)
    })
  }

  const handleSideChange = (symbol: string, side: OrderSide) => {
    clearRebalanceErrorForSymbol(symbol)
    setTargetPortfolio(symbol, "side", side)
  }

  const handleLeverageChange = (symbol: string, leverage: number) => {
    clearRebalanceErrorForSymbol(symbol)
    const target = targetPortfolio[symbol]
    if (target === undefined || !isPerpPosition(target)) {
      return
    }

    const maxLeverage = leverageLimitsMap()[symbol] || 1
    const newLeverage = Math.max(1, Math.min(leverage, maxLeverage))

    setTargetPortfolio(symbol, "leverage", newLeverage)
  }

  const handleNotionalChange = (symbol: string, newNotional: number) => {
    clearRebalanceErrorForSymbol(symbol)
    if (targetPortfolio[symbol] === undefined) {
      return
    }

    // Absolute total write (not `prev => prev + diff`) so an exchange-refresh
    // effect cannot land between the row update and a deferred functional bump
    // and double-count the same notional delta into targetTotalNotional.
    batch(() => {
      const oldNotional = targetPortfolio[symbol]?.notional ?? 0
      const nextTotal = targetTotalNotional() - oldNotional + newNotional

      setTargetPortfolio(symbol, "notional", newNotional)

      if (!deletedArchive[symbol]) {
        setTargetTotalNotional(nextTotal)
      }
    })
  }

  const handleWeightChange = (changedSymbol: string, newPercentage: number) => {
    clearRebalanceErrorForSymbol(changedSymbol)
    if (!isManualWeightEntry()) {
      redistributeWeights(changedSymbol, newPercentage)
      return
    }

    const totalNotional = targetTotalNotional()
    if (totalNotional <= 0) return

    const clampedPercentage = Math.max(0, Math.min(100, newPercentage))
    const newTargetNotional = (clampedPercentage / 100) * totalNotional

    setTargetPortfolio(changedSymbol, "notional", newTargetNotional)
  }

  // When leverage changes: totalNotional = leverage * accountValue
  // Weights stay fixed, notionals are recalculated from weights and new total
  const handleCrossAccountLeverageChange = (newLeverage: number) => {
    const newTotal = accountValue() * newLeverage
    const oldTotal = targetTotalNotional()

    if (oldTotal === 0) {
      setTargetTotalNotional(newTotal)
      return
    }

    const multiplier = newTotal / oldTotal

    setTargetPortfolio(
      produce(state => {
        for (const [symbol, pos] of Object.entries(state)) {
          if (pos && !deletedArchive[symbol]) {
            pos.notional *= multiplier
          }
        }
      }),
    )

    setTargetTotalNotional(newTotal)
  }

  const handleResetToCurrent = () => {
    const currentTokens = Object.values(currentPortfolio).filter(
      (token): token is PortfolioInterface => !!token,
    )

    const nextTarget = Object.fromEntries(
      currentTokens.map(token => [token.symbol, { ...token }]),
    )

    batch(() => {
      setTargetPortfolio(reconcile(nextTarget))
      setTargetTotalNotional(currentTotalNotional())
      setDeletedArchive(reconcile({}))
      setErrorsBySymbol(reconcile({}))
    })
  }

  const handleRebalancePositions = () => {
    if (
      isRebalancingUi() ||
      rebalanceHyperliquidMutation.isPending ||
      rebalanceDeriveMutation.isPending
    ) {
      return
    }

    const allActions = diffPortfolios(
      currentPortfolio,
      targetPortfolio,
      isPrecise(),
    )
    const hyperliquidActions = allActions.filter(
      action => action.venue === "hyperliquid",
    )
    const deriveActions = allActions.filter(
      (action): action is DeriveRebalanceAction =>
        action.venue === "derive" && action.kind !== "preciseRebalance",
    )

    if (hyperliquidActions.length === 0 && deriveActions.length === 0) {
      return
    }

    if (deriveActions.length > 0) {
      const credentials = deriveSession()
      if (credentials === null) {
        toast.error("Unlock Derive before rebalancing Derive positions")
        return
      }
      if (credentials.subaccountId === null) {
        toast.error("Select a Derive subaccount before rebalancing")
        return
      }
    }

    const currentSnapshot = untrack(() => ({ ...currentPortfolio }))

    setIsRebalancingUi(true)

    const mutationEffect = <Value>(run: () => Promise<Value>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause: unknown) => cause,
      })

    void Effect.runPromise(
      Effect.gen(function* () {
        const submittedOrders: OrderResult[] = []
        const submittedActions: RebalanceAction[] = []
        let failureMessage: string | undefined

        if (hyperliquidActions.length > 0) {
          const hyperliquidResult = yield* Effect.either(
            mutationEffect(() =>
              rebalanceHyperliquidMutation.mutateAsync({
                actions: hyperliquidActions,
              }),
            ),
          )
          if (Either.isRight(hyperliquidResult)) {
            submittedOrders.push(...hyperliquidResult.right)
            submittedActions.push(...hyperliquidActions)
          } else {
            console.error(
              "hyperliquid rebalance failed",
              getExchangeErrorDetail(hyperliquidResult.left),
            )
            failureMessage = getErrorMessage(hyperliquidResult.left)
          }
        }

        if (deriveActions.length > 0 && failureMessage === undefined) {
          const credentials = deriveSession()
          const symbols = [
            ...new Set(deriveActions.map(action => action.symbol)),
          ]
          const deriveResult = yield* Effect.either(
            Effect.gen(function* () {
              const tickers = yield* fetchDeriveTickers(credentials, symbols)
              const requests = yield* deriveActionsToOrderRequests(
                deriveActions,
                currentSnapshot,
                tickers,
              )
              return yield* mutationEffect(() =>
                rebalanceDeriveMutation.mutateAsync({
                  requests,
                }),
              )
            }),
          )
          if (Either.isRight(deriveResult)) {
            submittedOrders.push(...deriveResult.right)
            submittedActions.push(...deriveActions)
          } else {
            console.error(
              "derive rebalance failed",
              getExchangeErrorDetail(deriveResult.left),
            )
            failureMessage = getErrorMessage(deriveResult.left)
          }
        } else if (deriveActions.length > 0 && failureMessage !== undefined) {
          toast.message(
            `${String(deriveActions.length)} Derive action(s) skipped after Hyperliquid failure`,
          )
        }

        if (submittedOrders.length === 0) {
          if (failureMessage !== undefined) {
            toast.error(failureMessage)
          }
          setIsRebalancingUi(false)
          return
        }

        if (failureMessage !== undefined) {
          toast.error(failureMessage)
        }

        // Continues the rebalance click-handler Effect after venue submissions.
        // eslint-disable-next-line solid/reactivity
        yield* mutationEffect(() =>
          finalizeRebalance(submittedOrders, submittedActions),
        )
      }),
    )
  }

  const canSubmit = () => {
    const isPortfolioValid =
      Object.keys(targetPortfolio).length + Object.keys(deletedArchive).length >
      0

    return (
      isPortfolioValid &&
      !hasPositionsBelowMinimum() &&
      (isPrecise() || !hasSymbolsDeltaBelowMinimum()) &&
      !hasTotalWeightExceeded() &&
      !hasUnderAllocation()
    )
  }

  const resetPortfolioStateForNetworkChange = () => {
    batch(() => {
      setCurrentPortfolio(reconcile({}))
      setTargetPortfolio(reconcile({}))
      setDeletedArchive(reconcile({}))
      setErrorsBySymbol(reconcile({}))
      readonlyPortfolio.clearAddresses()
      setCurrentCrossAccountLeverage(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
      setTargetCrossAccountLeverage(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
      setCurrentTotalNotional(0)
      setTargetTotalNotional(0)
    })
    setPositionsLoadedFromExchange(false)
    setIsRebalancingUi(false)
  }

  return {
    get accountValue() {
      return accountValue()
    },
    get targetCrossAccountLeverage() {
      return targetCrossAccountLeverage()
    },
    get currentCrossAccountLeverage() {
      return currentCrossAccountLeverage()
    },
    get currentTotalNotional() {
      return currentTotalNotional()
    },
    get targetTotalNotional() {
      return targetTotalNotional()
    },
    get currentPortfolio() {
      return currentPortfolio
    },
    get targetPortfolio() {
      return targetPortfolio
    },
    get deletedArchive() {
      return deletedArchive
    },
    get errorsBySymbol() {
      return errorsBySymbol
    },
    get leverageLimitsMap() {
      return leverageLimitsMap()
    },
    get stagedTrades() {
      return stagedTrades()
    },
    get isRebalancing() {
      return isRebalancingUi()
    },

    get isPrecise() {
      return isPrecise()
    },

    setIsPrecise(value: boolean) {
      setPreciseSignal(value)
    },

    get isManualWeightEntry() {
      return isManualWeightEntry()
    },

    setManualWeightEntry(value: boolean) {
      setManualWeightEntrySignal(value)
    },

    get canSubmit() {
      return canSubmit()
    },

    get readonlyBtcRows(): ReadonlyBtcRow[] {
      return readonlyPortfolio.rows
    },

    get readonlyBetaPositions(): ReadonlyBetaPosition[] {
      return readonlyPortfolio.betaPositions
    },

    get isReadonlyBtcLoading() {
      return readonlyPortfolio.isLoading
    },

    get readonlyBtcError() {
      return readonlyPortfolio.error
    },

    get readonlyBtcValidationError() {
      return readonlyPortfolio.validationError
    },

    get symbolsBelowMinimum() {
      return symbolsBelowMinimum()
    },

    get symbolsDeltaBelowMinimum() {
      return symbolsDeltaBelowMinimum()
    },

    // Loading states
    get isBalanceLoading() {
      return (
        accountSummaryQuery.isLoading ||
        (isDeriveConnected() &&
          !isDeriveLocked() &&
          deriveBalanceQuery.isLoading)
      )
    },
    get isPositionsLoading() {
      return (
        positionsQuery.isLoading ||
        (isDeriveConnected() &&
          !isDeriveLocked() &&
          deriveAccountQuery.isLoading)
      )
    },
    get isLeverageLimitsLoading() {
      return leverageLimitsQuery.isLoading
    },
    get hasTotalWeightExceeded() {
      return hasTotalWeightExceeded()
    },
    get hasUnderAllocation() {
      return hasUnderAllocation()
    },
    get isClosingAllPositions() {
      return isClosingAllPositions()
    },
    get targetAllocationPercent() {
      return targetAllocationPercent()
    },
    // Actions
    handleAddToken,
    handleRemoveToken,
    handleUndoRemoveToken,
    handleSideChange,
    handleLeverageChange,
    handleNotionalChange,
    handleWeightChange,
    handleCrossAccountLeverageChange,
    handleRebalancePositions,
    handleResetToCurrent,
    addReadonlyBtcAddress: readonlyPortfolio.addAddress,
    removeReadonlyBtcAddress: readonlyPortfolio.removeAddress,
    setReadonlyBtcIncludeInBeta: readonlyPortfolio.setIncludeInBeta,
    handleDisconnect,
    handleDisconnectDerive,
    resetPortfolioStateForNetworkChange,
  }
}
