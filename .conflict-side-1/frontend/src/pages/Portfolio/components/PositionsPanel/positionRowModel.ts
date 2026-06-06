import type { OrderSide } from "@/hooks/useTrading"

import type { PortfolioInterface } from "../../hooks/usePortfolioState"

export type PositionRowStatus = "new" | "unchanged" | "changed" | "closing"

export interface PositionRowData {
  symbol: string
  status: PositionRowStatus
  position: PortfolioInterface
  symbolDelta: number
  side: OrderSide
  weightPercent: number
  notional: number
  signedFundingRate: number | null
  beta: number | null
  volatility: number | null
  sharpe: number | null
  sortino: number | null
  momentum: number | null
  carry: number | null
}

export const positionStatus = (
  symbol: string,
  currentPortfolio: Record<string, PortfolioInterface | undefined>,
  targetPortfolio: Record<string, PortfolioInterface | undefined>,
): PositionRowStatus => {
  const target = targetPortfolio[symbol]
  const current = currentPortfolio[symbol]

  if (!current && target) return "new"
  if (current && !target) return "closing"
  if (current && target) {
    const isChanged =
      current.notional !== target.notional ||
      current.side !== target.side ||
      current.leverage !== target.leverage
    return isChanged ? "changed" : "unchanged"
  }
  return "unchanged"
}

export const positionDelta = (
  symbol: string,
  currentPortfolio: Record<string, PortfolioInterface | undefined>,
  targetPortfolio: Record<string, PortfolioInterface | undefined>,
): number => {
  const targetPosition = targetPortfolio[symbol]
  const currentPosition = currentPortfolio[symbol]
  const signedTargetNotional =
    targetPosition === undefined
      ? 0
      : targetPosition.side === "sell"
        ? -targetPosition.notional
        : targetPosition.notional
  const signedCurrentNotional =
    currentPosition === undefined
      ? 0
      : currentPosition.side === "sell"
        ? -currentPosition.notional
        : currentPosition.notional
  return Math.abs(signedTargetNotional - signedCurrentNotional)
}

export const displayPosition = (
  symbol: string,
  currentPortfolio: Record<string, PortfolioInterface | undefined>,
  targetPortfolio: Record<string, PortfolioInterface | undefined>,
  deletedArchive: Record<string, PortfolioInterface | undefined>,
): PortfolioInterface => {
  const target = targetPortfolio[symbol]
  if (target) return target

  const archived = deletedArchive[symbol]
  if (archived) return archived

  const current = currentPortfolio[symbol]
  if (!current) {
    throw new Error(`Symbol ${symbol} not found in any portfolio`)
  }
  return current
}

export const signedFundingRateForPosition = (
  position: PortfolioInterface,
  fundingRatesByBaseSymbol?: Record<string, number>,
): number | null => {
  const baseSymbol = position.symbol.split("/")[0] ?? position.symbol
  const hourlyRate = fundingRatesByBaseSymbol?.[baseSymbol]
  if (hourlyRate === undefined) return null
  const annualizedRate = hourlyRate * 24 * 365
  return position.side === "buy" ? -annualizedRate : annualizedRate
}

export const weightPercentForPosition = (
  position: PortfolioInterface,
  targetTotalNotional: number,
): number => {
  if (targetTotalNotional === 0) return 0
  return (position.notional / targetTotalNotional) * 100
}
