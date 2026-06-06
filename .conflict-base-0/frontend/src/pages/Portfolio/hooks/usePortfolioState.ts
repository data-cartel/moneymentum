import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from "solid-js"
import Decimal from "decimal.js"
import {
  useHyperliquidAccountSummary,
  useHyperliquidPositions,
  useHyperliquidLeverageLimits,
  useRebalanceHyperliquidPositions,
  type OrderSide,
} from "@/hooks/useTrading"
import { buildApiPayload, diffPortfolios } from "./portfolioRebalancer"
import {
  useReadonlyPortfolioState,
  type ReadonlyBetaPosition,
  type ReadonlyBtcRow,
} from "./useReadonlyPortfolioState"
import { useWallet } from "@/hooks/useWallet"
import { createStore, produce, reconcile } from "solid-js/store"

export const MIN_USD = 11

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

export interface PortfolioInterface {
  symbol: string
  side: OrderSide
  leverage: number
  notional: number
}

export interface StagedTradeItem {
  underlying: string
  side: OrderSide
  notional: number
  previousWeight?: number
  newWeight?: number
}

const calcLeverage = (totalNotional: number, accountValue: number): number => {
  if (accountValue <= 0) return 1
  const leverage = new Decimal(totalNotional)
    .div(accountValue)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toNumber()
  return Math.min(MAX_CROSS_ACCOUNT_LEVERAGE, leverage)
}

export const usePortfolioState = () => {
  const { isConnected } = useWallet()

  const [isPrecise, setPreciseSignal] = createSignal(
    initialPreciseFromStorage(),
  )
  const [isManualWeightEntry, setManualWeightEntrySignal] = createSignal(
    initialManualWeightEntryFromStorage(),
  )

  // Exchange data queries
  const accountSummaryQuery = useHyperliquidAccountSummary()
  const positionsQuery = useHyperliquidPositions()
  const leverageLimitsQuery = useHyperliquidLeverageLimits()
  // Mutations
  const rebalancePositionsMutation = useRebalanceHyperliquidPositions()

  const [currentPortfolio, setCurrentPortfolio] = createStore<
    Record<string, PortfolioInterface | undefined>
  >({})

  const [targetPortfolio, setTargetPortfolio] = createStore<
    Record<string, PortfolioInterface | undefined>
  >({})

  const [deletedArchive, setDeletedArchive] = createStore<
    Record<string, PortfolioInterface | undefined>
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

  const handleDisconnect = () => {
    batch(() => {
      setCurrentPortfolio(reconcile({}))
      setTargetPortfolio(reconcile({}))
      setDeletedArchive(reconcile({}))
      readonlyPortfolio.clearAddresses()
      setCurrentCrossAccountLeverage(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
      setTargetCrossAccountLeverage(DEFAULT_CROSS_ACCOUNT_LEVERAGE)
      setCurrentTotalNotional(0)
      setTargetTotalNotional(0)
      setPositionsLoadedFromExchange(false)
    })
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

    return Object.keys(targetPortfolio).filter(symbol => {
      const targetPosition = targetPortfolio[symbol]
      const currentNotional = currentPortfolio[symbol]?.notional ?? 0

      if (!targetPosition || targetPosition.notional >= MIN_USD) return false

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
      if (!target) return false

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

  // Derive accountValue from account summary
  const accountValue = createMemo(
    () => accountSummaryQuery.data?.accountValue ?? 0,
  )

  // Compute targetNotional = accountValue * targetCrossAccountLeverage (used for percentage calculations)
  const targetNotional = createMemo(() =>
    new Decimal(accountValue())
      .mul(targetCrossAccountLeverage())
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber(),
  )

  const readonlyPortfolio = useReadonlyPortfolioState()

  // Wait for positionsQuery data and positive accountValue, then initialize from exchange positions
  createEffect(() => {
    if (positionsLoadedFromExchange()) {
      return
    }
    const positionsData = positionsQuery.data
    const isPositionsLoading = positionsQuery.isLoading
    if (isPositionsLoading || !positionsData?.positions) {
      return
    }
    // Wait for accountValue to be loaded so we can calculate correct percentages
    if (accountValue() <= 0) {
      return
    }

    // Calculate total notional from all exchange positions first
    const totalExchangeNotional = positionsData.positions.reduce(
      (sum, pos) => sum + pos.notional,
      0,
    )

    const exchangeTokens: PortfolioInterface[] = positionsData.positions.map(
      pos => ({
        symbol: pos.symbol,
        side: pos.side,
        leverage: pos.leverage || 1,
        notional: pos.notional,
      }),
    )

    const portfolioMap = Object.fromEntries(
      exchangeTokens.map(token => [token.symbol, token]),
    ) as Record<string, PortfolioInterface>

    setCurrentPortfolio(reconcile(portfolioMap))

    // Create a FULLY independent copy for the target
    setTargetPortfolio(reconcile(structuredClone(portfolioMap)))

    // Calculate leverage from the formula: leverage = totalNotional / accountValue
    const initialLeverage = calcLeverage(totalExchangeNotional, accountValue())
    setTargetTotalNotional(totalExchangeNotional)
    setCurrentTotalNotional(totalExchangeNotional)
    setTargetCrossAccountLeverage(initialLeverage)
    setCurrentCrossAccountLeverage(initialLeverage)

    setPositionsLoadedFromExchange(true)
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
        side: delta > 0 ? "buy" : "sell",
        notional: Math.abs(delta),
        previousWeight: totalCurrent
          ? (currentPosition?.notional ?? 0) / totalCurrent
          : 0,
        newWeight: totalTarget
          ? (targetPosition?.notional ?? 0) / totalTarget
          : 0,
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

  const hasTotalWeightExceeded = createMemo(() => {
    return targetAllocationPercent() > 100.01
  })

  const hasSymbolsDeltaBelowMinimum = () =>
    symbolsDeltaBelowMinimum().length > 0

  const handleAddToken = (symbol: string) => {
    if (symbol in targetPortfolio) return
    if (deletedArchive[symbol] !== undefined) return

    batch(() => {
      setTargetPortfolio(symbol, {
        symbol,
        side: "buy",
        leverage: leverageLimitsMap()[symbol] || 1,
        notional: MIN_USD,
      })

      setTargetTotalNotional(prev => prev + MIN_USD)
    })
  }

  const handleRemoveToken = (symbol: string) => {
    const targetPosition = targetPortfolio[symbol]
    if (!targetPosition) return

    const isPresentInCurrentPortfolio = !!currentPortfolio[symbol]

    batch(() => {
      if (isPresentInCurrentPortfolio) {
        setDeletedArchive(symbol, { ...targetPosition })
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

    const positionToRestore = archivedPosition ?? currentPosition

    if (!positionToRestore) return

    batch(() => {
      setTargetPortfolio(symbol, { ...positionToRestore })

      setTargetTotalNotional(prev => prev + positionToRestore.notional)

      setDeletedArchive(symbol, undefined)
    })
  }

  const handleSideChange = (symbol: string, side: OrderSide) => {
    setTargetPortfolio(symbol, "side", side)
  }

  const handleLeverageChange = (symbol: string, leverage: number) => {
    const maxLeverage = leverageLimitsMap()[symbol] || 1
    const newLeverage = Math.max(1, Math.min(leverage, maxLeverage))

    setTargetPortfolio(symbol, "leverage", newLeverage)
  }

  const handleNotionalChange = (symbol: string, newNotional: number) => {
    const oldNotional = targetPortfolio[symbol]?.notional ?? 0
    const diff = newNotional - oldNotional

    setTargetPortfolio(symbol, "notional", newNotional)

    if (!deletedArchive[symbol]) {
      setTargetTotalNotional(prev => prev + diff)
    }
  }

  const handleWeightChange = (changedSymbol: string, newPercentage: number) => {
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
    })
  }

  const handleRebalancePositions = () => {
    const apiPayload = buildApiPayload(
      currentPortfolio,
      targetPortfolio,
      isPrecise(),
    )

    rebalancePositionsMutation.mutate(apiPayload)

    setIsRebalancingUi(true)
  }

  const canSubmit = () => {
    const isPortfolioValid =
      Object.keys(targetPortfolio).length + Object.keys(deletedArchive).length >
      0

    return (
      isPortfolioValid &&
      !hasPositionsBelowMinimum() &&
      (isPrecise() || !hasSymbolsDeltaBelowMinimum()) &&
      !hasTotalWeightExceeded()
    )
  }

  const resetPortfolioStateForNetworkChange = () => {
    batch(() => {
      setCurrentPortfolio(reconcile({}))
      setTargetPortfolio(reconcile({}))
      setDeletedArchive(reconcile({}))
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
    get targetNotional() {
      return targetNotional()
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
      return accountSummaryQuery.isLoading
    },
    get isPositionsLoading() {
      return positionsQuery.isLoading
    },
    get isLeverageLimitsLoading() {
      return leverageLimitsQuery.isLoading
    },
    get hasTotalWeightExceeded() {
      return hasTotalWeightExceeded()
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
    resetPortfolioStateForNetworkChange,
  }
}
