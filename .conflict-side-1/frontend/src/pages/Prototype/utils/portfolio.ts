import type {
  CorrelationEntry,
  Greeks,
  FactorAttribution,
  StagedTrade,
  MockPosition,
  ComputedTrade,
} from "../mockData"
import type { PositionsByUnderlying } from "../hooks/usePrototypeData"

export interface AggregatedGreeks {
  delta: number
  gamma: number
  theta: number
}

export const aggregateGreeks = (greeks: Greeks[]): AggregatedGreeks =>
  greeks.reduce(
    (acc, g) => ({
      delta: acc.delta + g.delta,
      gamma: acc.gamma + g.gamma,
      theta: acc.theta + g.theta,
    }),
    { delta: 0, gamma: 0, theta: 0 },
  )

export const calculateTotalNotional = (
  groups: PositionsByUnderlying[],
): number =>
  groups.reduce(
    (sum, group) => sum + group.positions.reduce((s, p) => s + p.notional, 0),
    0,
  )

export const calculateGroupNotional = (
  positions: PositionsByUnderlying["positions"],
): number => positions.reduce((sum, p) => sum + p.notional, 0)

export const calculateGroupWeight = (
  positions: PositionsByUnderlying["positions"],
): number => positions.reduce((sum, p) => sum + p.weight, 0)

export const calculateNetSide = (
  positions: PositionsByUnderlying["positions"],
): "long" | "short" | "neutral" => {
  const totalLong = positions
    .filter(p => p.side === "long")
    .reduce((sum, p) => sum + p.notional, 0)
  const totalShort = positions
    .filter(p => p.side === "short")
    .reduce((sum, p) => sum + p.notional, 0)

  const netExposure = totalLong - totalShort
  const grossExposure = totalLong + totalShort

  // Consider neutral if net exposure is <10% of gross exposure (delta-neutral strategies)
  if (grossExposure > 0 && Math.abs(netExposure) / grossExposure < 0.1) {
    return "neutral"
  }

  return netExposure >= 0 ? "long" : "short"
}

export const calculatePositionWeight = (
  posNotional: number,
  groupNotional: number,
): number => (groupNotional === 0 ? 0 : posNotional / groupNotional)

interface AssetWithSharpe {
  ticker: string
  sharpe: number
}

export const filterAssetsByQuery = <T extends AssetWithSharpe>(
  assets: T[],
  query: string,
): T[] => {
  if (!query) return assets
  const q = query.toLowerCase()
  return assets.filter(a => a.ticker.toLowerCase().includes(q))
}

export const sortAssetsBySharpe = <T extends AssetWithSharpe>(
  assets: T[],
): T[] => [...assets].sort((a, b) => b.sharpe - a.sharpe)

export const lookupCorrelation = (
  matrix: CorrelationEntry[],
  asset1: string,
  asset2: string,
): number => {
  const entry = matrix.find(
    e =>
      (e.asset1 === asset1 && e.asset2 === asset2) ||
      (e.asset1 === asset2 && e.asset2 === asset1),
  )
  return entry?.correlation ?? 0
}

export const getCorrelationColor = (correlation: number): string => {
  if (correlation >= 0.7) return "bg-green-600"
  if (correlation >= 0.3) return "bg-green-500/60"
  if (correlation >= 0) return "bg-green-500/30"
  if (correlation >= -0.3) return "bg-red-500/30"
  if (correlation >= -0.7) return "bg-red-500/60"
  return "bg-red-600"
}

export const calculateTotalAttribution = (
  attributions: FactorAttribution[],
): number => attributions.reduce((sum, f) => sum + f.contribution, 0)

export const FACTOR_COLORS: Record<string, string> = {
  "β to BTC": "#3b82f6",
  "β to SPY": "#22c55e",
  "Momentum": "#f59e0b",
  "Carry": "#ef4444",
  "Volatility": "#8b5cf6",
  "Idiosyncratic": "#888888",
}

interface WeightChange {
  current: number
  projected: number
}

interface FactorChange {
  current: number
  projected: number
  delta: number
}

export interface ProjectedExposures {
  currentNotional: number
  projectedNotional: number
  notionalChange: number
  currentEffectiveLeverage: number
  projectedEffectiveLeverage: number
  effectiveLeverageChange: number
  weightChanges: Record<string, WeightChange>
  currentBeta: number
  projectedBeta: number
  betaChange: number
  factorChanges: {
    btcBeta: FactorChange
    spyBeta: FactorChange
    momentum: FactorChange
    volatility: FactorChange
    carry: FactorChange
  }
}

interface AssetFactors {
  ticker: string
  beta: number
  momentum?: number
  volatility?: number
  spyBeta?: number
  carry?: number
}

interface ComputeProjectedExposuresInput {
  positions: PositionsByUnderlying[]
  stagedTrades: StagedTrade[]
  nav: number
  leverage: number
  assetFactors?: AssetFactors[]
}

export const computeProjectedExposures = ({
  positions,
  stagedTrades,
  nav,
  leverage,
  assetFactors = [],
}: ComputeProjectedExposuresInput): ProjectedExposures => {
  const factorsMap = new Map(assetFactors.map(a => [a.ticker, a]))

  const currentNotional = positions.reduce(
    (sum, group) => sum + group.positions.reduce((s, p) => s + p.notional, 0),
    0,
  )

  const stagedNotionalChange = stagedTrades.reduce((sum, trade) => {
    const sign = trade.side === "buy" ? 1 : -1
    return sum + sign * trade.notional
  }, 0)

  const projectedNotional = currentNotional + stagedNotionalChange

  const currentEffectiveLeverage = (currentNotional * leverage) / nav
  const projectedEffectiveLeverage = (projectedNotional * leverage) / nav

  const notionalByUnderlying = new Map<string, number>()
  for (const group of positions) {
    const groupNotional = group.positions.reduce((s, p) => s + p.notional, 0)
    notionalByUnderlying.set(group.underlying, groupNotional)
  }

  for (const trade of stagedTrades) {
    const current = notionalByUnderlying.get(trade.symbol) ?? 0
    const sign = trade.side === "buy" ? 1 : -1
    notionalByUnderlying.set(trade.symbol, current + sign * trade.notional)
  }

  const weightChanges: Record<string, WeightChange> = {}
  for (const group of positions) {
    const currentGroupNotional = group.positions.reduce(
      (s, p) => s + p.notional,
      0,
    )
    const projectedGroupNotional =
      notionalByUnderlying.get(group.underlying) ?? 0

    weightChanges[group.underlying] = {
      current: currentNotional > 0 ? currentGroupNotional / currentNotional : 0,
      projected:
        projectedNotional > 0 ? projectedGroupNotional / projectedNotional : 0,
    }
  }

  // Calculate portfolio factor exposure (weighted average of asset factors)
  const calculatePortfolioFactor = (
    notionalMap: Map<string, number>,
    totalNotional: number,
    getFactor: (factors: AssetFactors) => number,
  ): number => {
    if (totalNotional === 0) return 0
    let weightedFactor = 0
    for (const [underlying, notional] of notionalMap) {
      const factors = factorsMap.get(underlying)
      const factorValue = factors ? getFactor(factors) : 0
      weightedFactor += (notional / totalNotional) * factorValue
    }
    return weightedFactor
  }

  const currentNotionalMap = new Map<string, number>()
  for (const group of positions) {
    const groupNotional = group.positions.reduce((s, p) => s + p.notional, 0)
    currentNotionalMap.set(group.underlying, groupNotional)
  }

  // Calculate all factor exposures
  const calculateFactorChange = (
    getFactor: (factors: AssetFactors) => number,
  ): FactorChange => {
    const current = calculatePortfolioFactor(
      currentNotionalMap,
      currentNotional,
      getFactor,
    )
    const projected = calculatePortfolioFactor(
      notionalByUnderlying,
      projectedNotional,
      getFactor,
    )
    return { current, projected, delta: projected - current }
  }

  const btcBeta = calculateFactorChange(f => f.beta)
  const spyBeta = calculateFactorChange(f => f.spyBeta ?? 0.4)
  const momentum = calculateFactorChange(f => f.momentum ?? 0)
  const volatility = calculateFactorChange(f => f.volatility ?? 0.8)
  const carry = calculateFactorChange(f => f.carry ?? 0)

  return {
    currentNotional,
    projectedNotional,
    notionalChange: stagedNotionalChange,
    currentEffectiveLeverage,
    projectedEffectiveLeverage,
    effectiveLeverageChange:
      projectedEffectiveLeverage - currentEffectiveLeverage,
    weightChanges,
    currentBeta: btcBeta.current,
    projectedBeta: btcBeta.projected,
    betaChange: btcBeta.delta,
    factorChanges: {
      btcBeta,
      spyBeta,
      momentum,
      volatility,
      carry,
    },
  }
}

export const rebalanceWeights = (
  currentWeights: Map<string, number>,
  changedSymbol: string,
  newWeight: number,
): Map<string, number> => {
  if (currentWeights.size === 0) return new Map()

  const result = new Map(currentWeights)
  const oldWeight = currentWeights.get(changedSymbol)

  if (oldWeight === undefined) {
    return result
  }

  const delta = newWeight - oldWeight
  if (Math.abs(delta) < 0.0001) {
    return result
  }

  result.set(changedSymbol, newWeight)

  const otherSymbols = Array.from(currentWeights.keys()).filter(
    s => s !== changedSymbol,
  )
  const otherWeightsTotal = otherSymbols.reduce(
    (sum, s) => sum + (currentWeights.get(s) ?? 0),
    0,
  )

  if (otherWeightsTotal <= 0) {
    return result
  }

  for (const symbol of otherSymbols) {
    const currentWeight = currentWeights.get(symbol) ?? 0
    const proportion = currentWeight / otherWeightsTotal
    const adjustment = delta * proportion
    const newSymbolWeight = Math.max(0, currentWeight - adjustment)
    result.set(symbol, newSymbolWeight)
  }

  return result
}

interface ComputeStagedTradesInput {
  committedPositions: MockPosition[]
  targetWeights: Map<string, number>
  committedLeverage: number
  targetLeverage: number
  nav: number
  minThreshold?: number
}

export const computeStagedTradesFromDiff = ({
  committedPositions,
  targetWeights,
  committedLeverage,
  targetLeverage,
  nav,
  minThreshold = 10,
}: ComputeStagedTradesInput): ComputedTrade[] => {
  const trades: ComputedTrade[] = []

  for (const position of committedPositions) {
    const committedWeight = position.weight
    const targetWeight = targetWeights.get(position.symbol) ?? committedWeight

    const committedNotional = committedWeight * nav * committedLeverage
    const targetNotional = targetWeight * nav * targetLeverage
    const delta = targetNotional - committedNotional

    if (Math.abs(delta) < minThreshold) {
      continue
    }

    trades.push({
      id: `${position.symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: position.symbol,
      underlying: position.underlying,
      side: delta > 0 ? "buy" : "sell",
      notional: Math.abs(delta),
      previousWeight: committedWeight,
      newWeight: targetWeight,
    })
  }

  return trades
}
