/**
 * Mock data for prototype UI development.
 * This file provides static data for UI iteration without backend dependencies.
 * Will be replaced with real API calls when backend is ready.
 */

export type InstrumentType = "perp" | "spot" | "call" | "put"

export interface Instrument {
  symbol: string
  underlying: string
  type: InstrumentType
  strike?: number
  expiry?: number
}

export interface InstrumentCosts {
  symbol: string
  fundingRate?: number // Perps: annualized 8h funding
  carryRate?: number // Spots: opportunity cost
  theta?: number // Options: daily decay
}

export interface Greeks {
  symbol: string
  delta: number
  gamma: number
  theta: number
}

export interface FactorExposure {
  name: string
  value: number
  color: string
}

export interface CorrelationEntry {
  asset1: string
  asset2: string
  correlation: number
}

export interface FactorDecompositionEntry {
  factor: string
  percentage: number
  color: string
}

export interface FactorTarget {
  factor: string
  current: number
  target: number
}

export interface RiskMetricsData {
  var95: number
  var99: number
  diversificationRatio: number
  effectiveBets: number
}

export interface StressTest {
  scenario: string
  portfolioImpact: number
  btcImpact: number
  ethImpact: number
}

export interface BacktestPoint {
  time: number
  value: number
}

export interface MonteCarloDistribution {
  bucket: number
  frequency: number
}

export interface PerformanceStats {
  totalReturn: number
  sharpeRatio: number
  maxDrawdown: number
  sortinoRatio: number
  winRate: number
  profitFactor: number
}

export interface StagedTrade {
  id: string
  symbol: string
  side: "buy" | "sell"
  notional: number
  leverage: number
}

export interface ComputedTrade {
  id: string
  symbol: string
  underlying: string
  side: "buy" | "sell"
  notional: number
  previousWeight?: number
  newWeight?: number
}

export interface MockPosition {
  symbol: string
  underlying: string
  side: "long" | "short"
  weight: number // Portfolio weight (0-1), notional derived from NAV * weight * leverage
}

// Realistic portfolio with multiple instruments per underlying
// Weights are designed for ~0.8x leverage at NAV=250000
export const MOCK_POSITIONS: MockPosition[] = [
  // BTC - perp + spot (core long)
  { symbol: "BTC/USDC:USDC", underlying: "BTC", side: "long", weight: 0.175 },
  { symbol: "BTC-SPOT", underlying: "BTC", side: "long", weight: 0.05 },

  // ETH - perp + spot + put hedge
  { symbol: "ETH/USDC:USDC", underlying: "ETH", side: "long", weight: 0.11 },
  { symbol: "ETH-SPOT", underlying: "ETH", side: "long", weight: 0.04 },
  { symbol: "ETH-PUT-2800", underlying: "ETH", side: "long", weight: 0.01 },

  // SOL - perp + spot
  { symbol: "SOL/USDC:USDC", underlying: "SOL", side: "long", weight: 0.06 },
  { symbol: "SOL-SPOT", underlying: "SOL", side: "long", weight: 0.03 },

  // DOGE - short perp + spot
  { symbol: "DOGE/USDC:USDC", underlying: "DOGE", side: "short", weight: 0.05 },
  { symbol: "DOGE-SPOT", underlying: "DOGE", side: "short", weight: 0.025 },

  // XRP - short perp + spot
  { symbol: "XRP/USDC:USDC", underlying: "XRP", side: "short", weight: 0.04 },
  { symbol: "XRP-SPOT", underlying: "XRP", side: "short", weight: 0.02 },

  // Basis trade (delta-neutral): long spot + short perp to collect funding
  { symbol: "AAVE-SPOT", underlying: "AAVE", side: "long", weight: 0.04 },
  { symbol: "AAVE/USDC:USDC", underlying: "AAVE", side: "short", weight: 0.04 },

  // Single-instrument positions
  { symbol: "HYPE/USDC:USDC", underlying: "HYPE", side: "long", weight: 0.06 },
  { symbol: "ARB/USDC:USDC", underlying: "ARB", side: "long", weight: 0.04 },
  { symbol: "LTC/USDC:USDC", underlying: "LTC", side: "short", weight: 0.03 },
  { symbol: "LINK/USDC:USDC", underlying: "LINK", side: "long", weight: 0.025 },
  { symbol: "AVAX/USDC:USDC", underlying: "AVAX", side: "long", weight: 0.02 },
  { symbol: "BCH/USDC:USDC", underlying: "BCH", side: "short", weight: 0.0175 },
  { symbol: "APE/USDC:USDC", underlying: "APE", side: "short", weight: 0.015 },
]

// Instrument costs: funding rates (perps), carry rates (spots), theta (options)
// Funding rates are annualized based on 8h funding
// Spots have 0% rate (no funding cost)
export const MOCK_INSTRUMENT_COSTS: InstrumentCosts[] = [
  // BTC instruments
  { symbol: "BTC/USDC:USDC", fundingRate: 0.12 }, // 12% annualized funding
  { symbol: "BTC-SPOT", carryRate: 0 }, // Spots: 0% rate

  // ETH instruments
  { symbol: "ETH/USDC:USDC", fundingRate: 0.15 },
  { symbol: "ETH-SPOT", carryRate: 0 },
  { symbol: "ETH-PUT-2800", theta: -0.002 }, // Daily theta decay

  // SOL instruments
  { symbol: "SOL/USDC:USDC", fundingRate: 0.18 },
  { symbol: "SOL-SPOT", carryRate: 0 },

  // DOGE instruments
  { symbol: "DOGE/USDC:USDC", fundingRate: 0.08 },
  { symbol: "DOGE-SPOT", carryRate: 0 },

  // XRP instruments
  { symbol: "XRP/USDC:USDC", fundingRate: 0.06 },
  { symbol: "XRP-SPOT", carryRate: 0 },

  // AAVE instruments (basis trade)
  { symbol: "AAVE-SPOT", carryRate: 0 },
  { symbol: "AAVE/USDC:USDC", fundingRate: 0.22 },

  // Single-instrument positions
  { symbol: "HYPE/USDC:USDC", fundingRate: 0.35 },
  { symbol: "ARB/USDC:USDC", fundingRate: 0.14 },
  { symbol: "LTC/USDC:USDC", fundingRate: 0.04 },
  { symbol: "LINK/USDC:USDC", fundingRate: 0.1 },
  { symbol: "AVAX/USDC:USDC", fundingRate: 0.12 },
  { symbol: "BCH/USDC:USDC", fundingRate: 0.05 },
  { symbol: "APE/USDC:USDC", fundingRate: 0.08 },
]

export const MOCK_GREEKS: Greeks[] = [
  { symbol: "BTC", delta: 0.85, gamma: 0.02, theta: -0.015 },
  { symbol: "ETH", delta: 1.2, gamma: 0.03, theta: -0.02 },
  { symbol: "SOL", delta: 1.5, gamma: 0.04, theta: -0.025 },
  { symbol: "DOGE", delta: 0.6, gamma: 0.01, theta: -0.01 },
  { symbol: "AVAX", delta: 1.1, gamma: 0.025, theta: -0.018 },
  { symbol: "XRP", delta: 0.9, gamma: 0.015, theta: -0.012 },
  { symbol: "DOT", delta: 1.3, gamma: 0.028, theta: -0.019 },
  { symbol: "LINK", delta: 1.15, gamma: 0.022, theta: -0.016 },
  { symbol: "MATIC", delta: 1.4, gamma: 0.032, theta: -0.021 },
  { symbol: "UNI", delta: 1.25, gamma: 0.026, theta: -0.017 },
  { symbol: "ATOM", delta: 1.05, gamma: 0.02, theta: -0.014 },
  { symbol: "LTC", delta: 0.8, gamma: 0.012, theta: -0.009 },
  { symbol: "BCH", delta: 0.88, gamma: 0.014, theta: -0.011 },
  { symbol: "ARB", delta: 1.6, gamma: 0.038, theta: -0.024 },
  { symbol: "OP", delta: 1.55, gamma: 0.035, theta: -0.023 },
  { symbol: "APE", delta: 1.45, gamma: 0.033, theta: -0.022 },
  { symbol: "CRV", delta: 1.35, gamma: 0.029, theta: -0.02 },
  { symbol: "AERO", delta: 1.28, gamma: 0.027, theta: -0.018 },
  { symbol: "EIGEN", delta: 1.22, gamma: 0.024, theta: -0.017 },
  { symbol: "IOTA", delta: 0.95, gamma: 0.018, theta: -0.013 },
  { symbol: "ENA", delta: 1.18, gamma: 0.023, theta: -0.016 },
  { symbol: "APT", delta: 1.42, gamma: 0.031, theta: -0.021 },
  { symbol: "DYDX", delta: 1.32, gamma: 0.028, theta: -0.019 },
  { symbol: "XMR", delta: 0.75, gamma: 0.011, theta: -0.008 },
  { symbol: "MORPHO", delta: 1.48, gamma: 0.034, theta: -0.022 },
  { symbol: "SKY", delta: 1.38, gamma: 0.03, theta: -0.02 },
  { symbol: "JTO", delta: 1.52, gamma: 0.036, theta: -0.023 },
  { symbol: "JUP", delta: 1.58, gamma: 0.037, theta: -0.024 },
  { symbol: "SUI", delta: 1.62, gamma: 0.039, theta: -0.025 },
  { symbol: "TON", delta: 1.12, gamma: 0.021, theta: -0.015 },
  { symbol: "GMX", delta: 1.25, gamma: 0.025, theta: -0.017 },
  { symbol: "HYPE", delta: 1.68, gamma: 0.042, theta: -0.027 },
  { symbol: "MON", delta: 1.45, gamma: 0.033, theta: -0.022 },
  { symbol: "PUMP", delta: 1.72, gamma: 0.044, theta: -0.028 },
  { symbol: "ASTER", delta: 1.5, gamma: 0.034, theta: -0.023 },
  { symbol: "PENDLE", delta: 1.35, gamma: 0.029, theta: -0.019 },
  { symbol: "AAVE", delta: 1.08, gamma: 0.019, theta: -0.014 },
  { symbol: "ZEC", delta: 0.82, gamma: 0.013, theta: -0.01 },
  { symbol: "ETC", delta: 0.78, gamma: 0.012, theta: -0.009 },
]

export const MOCK_FACTOR_EXPOSURES: FactorExposure[] = [
  { name: "β to BTC", value: 0.85, color: "hsl(var(--chart-1))" },
  { name: "β to SPY", value: 0.42, color: "hsl(var(--chart-2))" },
  { name: "Momentum", value: 0.28, color: "hsl(var(--chart-3))" },
  { name: "Carry", value: -0.15, color: "hsl(var(--chart-4))" },
  { name: "Volatility", value: 0.12, color: "hsl(var(--chart-5))" },
]

const CORRELATION_ASSETS = ["BTC", "ETH", "SOL", "SPY", "USD"]

export const MOCK_CORRELATION_MATRIX: CorrelationEntry[] = (() => {
  const correlationValues: Record<string, Record<string, number>> = {
    BTC: { BTC: 1.0, ETH: 0.85, SOL: 0.72, SPY: 0.45, USD: -0.3 },
    ETH: { BTC: 0.85, ETH: 1.0, SOL: 0.78, SPY: 0.42, USD: -0.25 },
    SOL: { BTC: 0.72, ETH: 0.78, SOL: 1.0, SPY: 0.38, USD: -0.2 },
    SPY: { BTC: 0.45, ETH: 0.42, SOL: 0.38, SPY: 1.0, USD: -0.55 },
    USD: { BTC: -0.3, ETH: -0.25, SOL: -0.2, SPY: -0.55, USD: 1.0 },
  }

  const entries: CorrelationEntry[] = []
  for (const asset1 of CORRELATION_ASSETS) {
    for (const asset2 of CORRELATION_ASSETS) {
      entries.push({
        asset1,
        asset2,
        correlation: correlationValues[asset1][asset2],
      })
    }
  }
  return entries
})()

export const CORRELATION_ASSETS_LIST = CORRELATION_ASSETS

export const MOCK_FACTOR_DECOMPOSITION: FactorDecompositionEntry[] = [
  { factor: "Market", percentage: 45, color: "hsl(var(--chart-1))" },
  { factor: "Momentum", percentage: 25, color: "hsl(var(--chart-2))" },
  { factor: "Carry", percentage: 15, color: "hsl(var(--chart-3))" },
  { factor: "Idiosyncratic", percentage: 10, color: "hsl(var(--chart-4))" },
  { factor: "Volatility", percentage: 5, color: "hsl(var(--chart-5))" },
]

export const MOCK_FACTOR_TARGETS: FactorTarget[] = [
  { factor: "Market Beta", current: 0.85, target: 0.7 },
  { factor: "Momentum", current: 0.42, target: 0.5 },
  { factor: "Carry", current: -0.15, target: 0.0 },
  { factor: "Volatility", current: 0.28, target: 0.2 },
]

export const MOCK_RISK_METRICS: RiskMetricsData = {
  var95: -0.032,
  var99: -0.058,
  diversificationRatio: 1.45,
  effectiveBets: 3.2,
}

export const MOCK_STRESS_TESTS: StressTest[] = [
  {
    scenario: "COVID March 2020",
    portfolioImpact: -0.35,
    btcImpact: -0.5,
    ethImpact: -0.6,
  },
  {
    scenario: "FTX Collapse",
    portfolioImpact: -0.22,
    btcImpact: -0.25,
    ethImpact: -0.3,
  },
  {
    scenario: "BTC -50%",
    portfolioImpact: -0.28,
    btcImpact: -0.5,
    ethImpact: -0.45,
  },
  {
    scenario: "ETH -60%",
    portfolioImpact: -0.25,
    btcImpact: -0.35,
    ethImpact: -0.6,
  },
  {
    scenario: "Rate Shock +200bp",
    portfolioImpact: -0.18,
    btcImpact: -0.2,
    ethImpact: -0.22,
  },
]

const generateBacktestData = (): BacktestPoint[] => {
  const now = Date.now()
  const points: BacktestPoint[] = []
  let value = 10000

  for (let i = 365; i >= 0; i--) {
    const dayMs = 24 * 60 * 60 * 1000
    const time = Math.floor((now - i * dayMs) / 1000)
    const dailyReturn = (Math.random() - 0.48) * 0.03
    value = value * (1 + dailyReturn)
    points.push({ time, value })
  }

  return points
}

export const MOCK_BACKTEST_DATA: BacktestPoint[] = generateBacktestData()

export const MOCK_MONTE_CARLO: MonteCarloDistribution[] = [
  { bucket: -0.4, frequency: 2 },
  { bucket: -0.35, frequency: 5 },
  { bucket: -0.3, frequency: 12 },
  { bucket: -0.25, frequency: 25 },
  { bucket: -0.2, frequency: 45 },
  { bucket: -0.15, frequency: 78 },
  { bucket: -0.1, frequency: 120 },
  { bucket: -0.05, frequency: 180 },
  { bucket: 0, frequency: 210 },
  { bucket: 0.05, frequency: 195 },
  { bucket: 0.1, frequency: 155 },
  { bucket: 0.15, frequency: 98 },
  { bucket: 0.2, frequency: 55 },
  { bucket: 0.25, frequency: 28 },
  { bucket: 0.3, frequency: 12 },
  { bucket: 0.35, frequency: 5 },
  { bucket: 0.4, frequency: 2 },
]

export const MOCK_PERFORMANCE_STATS: PerformanceStats = {
  totalReturn: 0.342,
  sharpeRatio: 1.85,
  maxDrawdown: -0.182,
  sortinoRatio: 2.4,
  winRate: 0.58,
  profitFactor: 1.72,
}

export interface MockAssetAnalysis {
  ticker: string
  beta: number
  sharpe: number
  sortino: number
  volatility: number
  momentum: number
}

export interface ScreenerInstrument {
  symbol: string
  type: "perp" | "spot" | "call" | "put"
  rate: number
  rateLabel: string
}

export const MOCK_ASSET_ANALYSIS: MockAssetAnalysis[] = [
  {
    ticker: "BTC",
    beta: 1.0,
    sharpe: 1.2,
    sortino: 1.8,
    momentum: 0.12,
    volatility: 0.65,
  },
  {
    ticker: "ETH",
    beta: 1.25,
    sharpe: 0.95,
    sortino: 1.4,
    momentum: 0.08,
    volatility: 0.78,
  },
  {
    ticker: "SOL",
    beta: 1.8,
    sharpe: 1.45,
    sortino: 2.1,
    momentum: 0.15,
    volatility: 0.92,
  },
  {
    ticker: "AVAX",
    beta: 1.5,
    sharpe: 0.72,
    sortino: 1.1,
    momentum: 0.05,
    volatility: 0.85,
  },
  {
    ticker: "DOGE",
    beta: 1.3,
    sharpe: 0.35,
    sortino: 0.5,
    momentum: -0.02,
    volatility: 1.1,
  },
  {
    ticker: "XRP",
    beta: 0.9,
    sharpe: 0.55,
    sortino: 0.8,
    momentum: 0.03,
    volatility: 0.72,
  },
  {
    ticker: "DOT",
    beta: 1.4,
    sharpe: 0.42,
    sortino: 0.6,
    momentum: 0.01,
    volatility: 0.88,
  },
  {
    ticker: "LINK",
    beta: 1.2,
    sharpe: 0.85,
    sortino: 1.2,
    momentum: 0.09,
    volatility: 0.82,
  },
  {
    ticker: "MATIC",
    beta: 1.6,
    sharpe: 0.62,
    sortino: 0.9,
    momentum: 0.04,
    volatility: 0.95,
  },
  {
    ticker: "UNI",
    beta: 1.35,
    sharpe: 0.48,
    sortino: 0.7,
    momentum: 0.02,
    volatility: 0.88,
  },
  {
    ticker: "ATOM",
    beta: 1.1,
    sharpe: 0.78,
    sortino: 1.1,
    momentum: 0.07,
    volatility: 0.75,
  },
  {
    ticker: "LTC",
    beta: 0.85,
    sharpe: 0.38,
    sortino: 0.55,
    momentum: 0.01,
    volatility: 0.68,
  },
  {
    ticker: "BCH",
    beta: 0.92,
    sharpe: 0.25,
    sortino: 0.35,
    momentum: -0.01,
    volatility: 0.7,
  },
  {
    ticker: "ARB",
    beta: 1.7,
    sharpe: 1.1,
    sortino: 1.6,
    momentum: 0.11,
    volatility: 0.98,
  },
  {
    ticker: "OP",
    beta: 1.65,
    sharpe: 0.92,
    sortino: 1.35,
    momentum: 0.08,
    volatility: 0.95,
  },
  {
    ticker: "APE",
    beta: 1.55,
    sharpe: 0.32,
    sortino: 0.45,
    momentum: -0.03,
    volatility: 1.05,
  },
  {
    ticker: "CRV",
    beta: 1.45,
    sharpe: 0.28,
    sortino: 0.4,
    momentum: 0.02,
    volatility: 0.98,
  },
  {
    ticker: "AERO",
    beta: 1.38,
    sharpe: 0.65,
    sortino: 0.92,
    momentum: 0.06,
    volatility: 0.88,
  },
  {
    ticker: "EIGEN",
    beta: 1.32,
    sharpe: 0.58,
    sortino: 0.82,
    momentum: 0.04,
    volatility: 0.85,
  },
  {
    ticker: "IOTA",
    beta: 1.05,
    sharpe: 0.42,
    sortino: 0.6,
    momentum: 0.01,
    volatility: 0.75,
  },
  {
    ticker: "ENA",
    beta: 1.28,
    sharpe: 0.52,
    sortino: 0.75,
    momentum: 0.03,
    volatility: 0.82,
  },
  {
    ticker: "APT",
    beta: 1.52,
    sharpe: 0.68,
    sortino: 0.98,
    momentum: 0.07,
    volatility: 0.92,
  },
  {
    ticker: "DYDX",
    beta: 1.42,
    sharpe: 0.55,
    sortino: 0.78,
    momentum: 0.05,
    volatility: 0.88,
  },
  {
    ticker: "XMR",
    beta: 0.85,
    sharpe: 0.75,
    sortino: 1.05,
    momentum: 0.08,
    volatility: 0.62,
  },
  {
    ticker: "MORPHO",
    beta: 1.58,
    sharpe: 0.72,
    sortino: 1.02,
    momentum: 0.06,
    volatility: 0.95,
  },
  {
    ticker: "SKY",
    beta: 1.48,
    sharpe: 0.45,
    sortino: 0.65,
    momentum: 0.02,
    volatility: 0.9,
  },
  {
    ticker: "JTO",
    beta: 1.62,
    sharpe: 0.82,
    sortino: 1.15,
    momentum: 0.09,
    volatility: 0.98,
  },
  {
    ticker: "JUP",
    beta: 1.68,
    sharpe: 0.88,
    sortino: 1.25,
    momentum: 0.1,
    volatility: 1.02,
  },
  {
    ticker: "SUI",
    beta: 1.72,
    sharpe: 0.95,
    sortino: 1.35,
    momentum: 0.11,
    volatility: 1.05,
  },
  {
    ticker: "TON",
    beta: 1.22,
    sharpe: 0.62,
    sortino: 0.88,
    momentum: 0.05,
    volatility: 0.78,
  },
  {
    ticker: "GMX",
    beta: 1.35,
    sharpe: 0.58,
    sortino: 0.82,
    momentum: 0.04,
    volatility: 0.85,
  },
  {
    ticker: "HYPE",
    beta: 1.78,
    sharpe: 1.02,
    sortino: 1.45,
    momentum: 0.12,
    volatility: 1.1,
  },
  {
    ticker: "MON",
    beta: 1.55,
    sharpe: 0.68,
    sortino: 0.95,
    momentum: 0.06,
    volatility: 0.92,
  },
  {
    ticker: "PUMP",
    beta: 1.82,
    sharpe: 0.35,
    sortino: 0.5,
    momentum: -0.02,
    volatility: 1.15,
  },
  {
    ticker: "ASTER",
    beta: 1.6,
    sharpe: 0.52,
    sortino: 0.72,
    momentum: 0.03,
    volatility: 0.95,
  },
  {
    ticker: "PENDLE",
    beta: 1.45,
    sharpe: 0.78,
    sortino: 1.1,
    momentum: 0.08,
    volatility: 0.88,
  },
  {
    ticker: "AAVE",
    beta: 1.18,
    sharpe: 0.85,
    sortino: 1.2,
    momentum: 0.09,
    volatility: 0.75,
  },
  {
    ticker: "ZEC",
    beta: 0.92,
    sharpe: 0.45,
    sortino: 0.65,
    momentum: 0.02,
    volatility: 0.68,
  },
  {
    ticker: "ETC",
    beta: 0.88,
    sharpe: 0.38,
    sortino: 0.55,
    momentum: 0.01,
    volatility: 0.65,
  },
]

export const getInstrumentsForAsset = (
  ticker: string,
): ScreenerInstrument[] => {
  const perpSymbol = `${ticker}/USDC:USDC`
  const spotSymbol = `${ticker}-SPOT`
  const perpCost = MOCK_INSTRUMENT_COSTS.find(c => c.symbol === perpSymbol)

  return [
    {
      symbol: perpSymbol,
      type: "perp",
      rate: perpCost?.fundingRate ?? 0.1,
      rateLabel: "funding",
    },
    {
      symbol: spotSymbol,
      type: "spot",
      rate: 0,
      rateLabel: "carry",
    },
  ]
}

export interface FactorHistoricalReturn {
  factor: string
  date: number
  value: number
}

export interface FactorAttribution {
  factor: string
  contribution: number
  color: string
}

export interface ConcentrationMetric {
  metric: string
  value: number
  description: string
}

export interface DrawdownPoint {
  time: number
  drawdown: number
}

export interface ReturnDistributionBucket {
  bucket: number
  frequency: number
}

const generateFactorHistoricalReturns = (): FactorHistoricalReturn[] => {
  const factors = ["Market Beta", "Momentum", "Carry", "Volatility", "Size"]
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const results: FactorHistoricalReturn[] = []

  const factorDrifts: Record<string, number> = {
    "Market Beta": 0.0003,
    "Momentum": 0.0004,
    "Carry": 0.0001,
    "Volatility": -0.0001,
    "Size": 0.0002,
  }

  const factorVolatilities: Record<string, number> = {
    "Market Beta": 0.015,
    "Momentum": 0.02,
    "Carry": 0.008,
    "Volatility": 0.025,
    "Size": 0.012,
  }

  for (const factor of factors) {
    let cumulativeReturn = 1
    for (let i = 365; i >= 0; i--) {
      const time = Math.floor((now - i * dayMs) / 1000)
      const dailyReturn =
        factorDrifts[factor] +
        (Math.random() - 0.5) * factorVolatilities[factor]
      cumulativeReturn *= 1 + dailyReturn
      results.push({ factor, date: time, value: cumulativeReturn })
    }
  }

  return results
}

export const MOCK_FACTOR_HISTORICAL_RETURNS: FactorHistoricalReturn[] =
  generateFactorHistoricalReturns()

export const MOCK_FACTOR_ATTRIBUTION: FactorAttribution[] = [
  { factor: "β to BTC", contribution: 0.156, color: "hsl(var(--chart-1))" },
  { factor: "β to SPY", contribution: 0.042, color: "hsl(var(--chart-2))" },
  { factor: "Momentum", contribution: 0.098, color: "hsl(var(--chart-3))" },
  { factor: "Carry", contribution: -0.023, color: "hsl(var(--chart-4))" },
  { factor: "Volatility", contribution: 0.025, color: "hsl(var(--chart-5))" },
  {
    factor: "Idiosyncratic",
    contribution: 0.044,
    color: "hsl(var(--muted-foreground))",
  },
]

export const MOCK_CONCENTRATION_METRICS: ConcentrationMetric[] = [
  { metric: "Top Position", value: 0.225, description: "BTC" },
  { metric: "Top 3 Positions", value: 0.455, description: "BTC, ETH, SOL" },
  { metric: "Top 5 Positions", value: 0.585, description: "5 assets" },
  {
    metric: "Herfindahl Index",
    value: 0.12,
    description: "Concentration score",
  },
  { metric: "Effective Positions", value: 8.3, description: "1/HHI" },
]

const generateDrawdownData = (): DrawdownPoint[] => {
  const points: DrawdownPoint[] = []
  let peak = MOCK_BACKTEST_DATA[0].value

  for (const point of MOCK_BACKTEST_DATA) {
    if (point.value > peak) {
      peak = point.value
    }
    const drawdown = (point.value - peak) / peak
    points.push({ time: point.time, drawdown })
  }

  return points
}

export const MOCK_DRAWDOWN_DATA: DrawdownPoint[] = generateDrawdownData()

const generateReturnDistribution = (): ReturnDistributionBucket[] => {
  const buckets: Map<number, number> = new Map()
  const bucketSize = 0.005

  for (let i = 1; i < MOCK_BACKTEST_DATA.length; i++) {
    const dailyReturn =
      (MOCK_BACKTEST_DATA[i].value - MOCK_BACKTEST_DATA[i - 1].value) /
      MOCK_BACKTEST_DATA[i - 1].value
    const bucket = Math.round(dailyReturn / bucketSize) * bucketSize
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  }

  return Array.from(buckets.entries())
    .map(([bucket, frequency]) => ({ bucket, frequency }))
    .sort((a, b) => a.bucket - b.bucket)
}

export const MOCK_RETURN_DISTRIBUTION: ReturnDistributionBucket[] =
  generateReturnDistribution()
