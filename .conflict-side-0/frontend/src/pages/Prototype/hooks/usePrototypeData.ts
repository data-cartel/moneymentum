import { createMemo, createSignal } from "solid-js"
import {
  MOCK_GREEKS,
  MOCK_FACTOR_EXPOSURES,
  MOCK_CORRELATION_MATRIX,
  CORRELATION_ASSETS_LIST,
  MOCK_FACTOR_DECOMPOSITION,
  MOCK_FACTOR_TARGETS,
  MOCK_RISK_METRICS,
  MOCK_STRESS_TESTS,
  MOCK_BACKTEST_DATA,
  MOCK_MONTE_CARLO,
  MOCK_PERFORMANCE_STATS,
  MOCK_ASSET_ANALYSIS,
  MOCK_POSITIONS,
  MOCK_INSTRUMENT_COSTS,
  MOCK_FACTOR_HISTORICAL_RETURNS,
  MOCK_FACTOR_ATTRIBUTION,
  MOCK_CONCENTRATION_METRICS,
  MOCK_DRAWDOWN_DATA,
  MOCK_RETURN_DISTRIBUTION,
  type MockPosition,
  type ComputedTrade,
} from "../mockData"
import {
  rebalanceWeights,
  computeStagedTradesFromDiff,
} from "../utils/portfolio"

export interface PositionsByUnderlying {
  underlying: string
  positions: Array<{
    symbol: string
    side: "long" | "short"
    weight: number
    notional: number
    percentage: number
    fundingRate?: number
    carryRate?: number
    theta?: number
  }>
}

const buildWeightsMap = (positions: MockPosition[]): Map<string, number> =>
  new Map(positions.map(p => [p.symbol, p.weight]))

const mergeWeights = (
  positions: MockPosition[],
  overrides: Map<string, number>,
): Map<string, number> => {
  const base = buildWeightsMap(positions)
  for (const [symbol, weight] of overrides) {
    base.set(symbol, weight)
  }
  return base
}

export const usePrototypeData = () => {
  const [committedPositions, setCommittedPositions] =
    createSignal<MockPosition[]>(MOCK_POSITIONS)
  const [committedLeverage, setCommittedLeverage] = createSignal(1.0)

  const [targetWeightOverrides, setTargetWeightOverrides] = createSignal<
    Map<string, number>
  >(new Map())
  const [targetLeverage, setTargetLeverage] = createSignal(1.0)

  const nav = 250000

  const currentWeights = createMemo(() =>
    mergeWeights(committedPositions(), targetWeightOverrides()),
  )

  const stagedTrades = createMemo((): ComputedTrade[] =>
    computeStagedTradesFromDiff({
      committedPositions: committedPositions(),
      targetWeights: currentWeights(),
      committedLeverage: committedLeverage(),
      targetLeverage: targetLeverage(),
      nav,
    }),
  )

  const adjustPositionWeight = (symbol: string, delta: number) => {
    const weights = currentWeights()
    const current = weights.get(symbol) ?? 0
    const newWeight = Math.max(0, Math.min(1, current + delta))
    const rebalanced = rebalanceWeights(weights, symbol, newWeight)
    setTargetWeightOverrides(rebalanced)
  }

  const updateInstrumentWeight = (symbol: string, newWeight: number) => {
    const clampedWeight = Math.max(0, Math.min(1, newWeight))
    const rebalanced = rebalanceWeights(currentWeights(), symbol, clampedWeight)
    setTargetWeightOverrides(rebalanced)
  }

  const updateInstrumentNotional = (symbol: string, newNotional: number) => {
    const effectiveLev = targetLeverage() || 1
    const newWeight = newNotional / (nav * effectiveLev)
    const clampedWeight = Math.max(0, Math.min(1, newWeight))
    const rebalanced = rebalanceWeights(currentWeights(), symbol, clampedWeight)
    setTargetWeightOverrides(rebalanced)
  }

  const setLeverage = (
    newLeverageOrCallback: number | ((prev: number) => number),
  ) => {
    setTargetLeverage(newLeverageOrCallback)
  }

  const instrumentCostsMap = createMemo(() => {
    const map = new Map<
      string,
      { fundingRate?: number; carryRate?: number; theta?: number }
    >()
    for (const cost of MOCK_INSTRUMENT_COSTS) {
      map.set(cost.symbol, {
        fundingRate: cost.fundingRate,
        carryRate: cost.carryRate,
        theta: cost.theta,
      })
    }
    return map
  })

  const positionsByUnderlying = createMemo((): PositionsByUnderlying[] => {
    const grouped = new Map<string, PositionsByUnderlying["positions"]>()
    const positions = committedPositions()
    const weights = currentWeights()
    const lev = targetLeverage()
    const costsMap = instrumentCostsMap()

    const totalWeight = positions.reduce((sum, p) => {
      const weight = weights.get(p.symbol) ?? p.weight
      return sum + weight
    }, 0)

    for (const position of positions) {
      if (!grouped.has(position.underlying)) {
        grouped.set(position.underlying, [])
      }

      const weight = weights.get(position.symbol) ?? position.weight
      const notional = nav * weight * lev
      const percentage = totalWeight > 0 ? (weight / totalWeight) * 100 : 0
      const costs = costsMap.get(position.symbol)

      grouped.get(position.underlying)?.push({
        symbol: position.symbol,
        side: position.side,
        weight,
        notional,
        percentage,
        fundingRate: costs?.fundingRate,
        carryRate: costs?.carryRate,
        theta: costs?.theta,
      })
    }

    return Array.from(grouped.entries())
      .map(([underlying, positionsInGroup]) => ({
        underlying,
        positions: positionsInGroup,
      }))
      .sort((a, b) => {
        const aTotal = a.positions.reduce((sum, p) => sum + p.notional, 0)
        const bTotal = b.positions.reduce((sum, p) => sum + p.notional, 0)
        return bTotal - aTotal
      })
  })

  const totalNotional = createMemo(() => {
    const positions = committedPositions()
    const weights = currentWeights()
    const lev = targetLeverage()
    const totalWeight = positions.reduce((sum, p) => {
      const weight = weights.get(p.symbol) ?? p.weight
      return sum + weight
    }, 0)
    return nav * totalWeight * lev
  })

  const effectiveLeverage = createMemo(() => totalNotional() / nav)

  const executeStagedTrades = () => {
    if (stagedTrades().length === 0) return

    const weights = currentWeights()
    const updatedPositions = committedPositions().map(p => ({
      ...p,
      weight: weights.get(p.symbol) ?? p.weight,
    }))

    setCommittedPositions(updatedPositions)
    setCommittedLeverage(targetLeverage())
    setTargetWeightOverrides(new Map())
  }

  const clearStagedTrades = () => {
    setTargetWeightOverrides(new Map())
    setTargetLeverage(committedLeverage())
  }

  const addStagedTrade = (_symbol: string, _side: "buy" | "sell") => {
    // Manual trade staging is deprecated in favor of computed trades
  }

  const removeStagedTrade = (_id: string) => {
    // Manual trade removal is deprecated
  }

  return {
    nav,
    leverage: targetLeverage,
    setLeverage,
    effectiveLeverage,
    isLoading: false,

    positionsByUnderlying,
    totalNotional,
    adjustPositionWeight,
    updateInstrumentWeight,
    updateInstrumentNotional,
    greeks: MOCK_GREEKS,
    factorExposures: MOCK_FACTOR_EXPOSURES,
    assetAnalysis: MOCK_ASSET_ANALYSIS,

    stagedTrades,
    addStagedTrade,
    removeStagedTrade,
    clearStagedTrades,
    executeStagedTrades,

    committedPositions,
    committedLeverage,
    targetLeverage,
    hasUnsavedChanges: () => stagedTrades().length > 0,

    correlationMatrix: MOCK_CORRELATION_MATRIX,
    correlationAssets: CORRELATION_ASSETS_LIST,
    factorDecomposition: MOCK_FACTOR_DECOMPOSITION,
    factorTargets: MOCK_FACTOR_TARGETS,
    riskMetrics: MOCK_RISK_METRICS,

    backtestData: MOCK_BACKTEST_DATA,
    performanceStats: MOCK_PERFORMANCE_STATS,
    monteCarloData: MOCK_MONTE_CARLO,
    stressTests: MOCK_STRESS_TESTS,

    factorHistoricalReturns: MOCK_FACTOR_HISTORICAL_RETURNS,
    factorAttribution: MOCK_FACTOR_ATTRIBUTION,
    concentrationMetrics: MOCK_CONCENTRATION_METRICS,
    drawdownData: MOCK_DRAWDOWN_DATA,
    returnDistribution: MOCK_RETURN_DISTRIBUTION,
  }
}
