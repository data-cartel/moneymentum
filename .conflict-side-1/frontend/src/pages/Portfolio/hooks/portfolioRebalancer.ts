import { type OrderSide, type RebalanceParams } from "@/hooks/useTrading"

import type { PortfolioInterface } from "@/pages/Portfolio/hooks/usePortfolioState"

import { MIN_USD } from "@/pages/Portfolio/hooks/usePortfolioState"

export type RebalanceAction =
  | {
      kind: "close"
      symbol: string
      side: OrderSide
    }
  | {
      kind: "rebalance"
      symbol: string
      signedNotionalDelta: number
      leverage: number
      leverageChanged: boolean
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
    }

export const buildApiPayload = (
  current: Record<string, PortfolioInterface | undefined>,
  target: Record<string, PortfolioInterface | undefined>,
  precise: boolean,
): RebalanceParams => {
  const actions = diffPortfolios(current, target, precise)
  return { actions }
}

const NOTIONAL_EPSILON = 0.1

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

const getSignedNotional = (side: OrderSide, notional: number) =>
  side === "buy" ? notional : -notional

/**
 * Compute minimal set of actions needed to transform current portfolio into target.
 * Pure function: does not know about UI status flags or external APIs.
 */
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
      })
      continue
    }

    if (!targetPosition) {
      continue
    }

    if (currentPosition && targetPosition.notional <= NOTIONAL_EPSILON) {
      actions.push({
        kind: "close",
        symbol,
        side: currentPosition.side,
      })
      continue
    }

    const leverageChanged =
      currentPosition?.leverage !== targetPosition.leverage
    const hasSignificantDelta = deltaAbs > NOTIONAL_EPSILON

    if (!hasSignificantDelta && !leverageChanged) {
      continue
    }

    if (
      precise &&
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
        leverage: targetPosition.leverage,
        leverageChanged,
        closeNotional,
        openNotional,
      })
      continue
    }

    actions.push({
      kind: "rebalance",
      symbol,
      signedNotionalDelta: delta,
      leverage: targetPosition.leverage,
      leverageChanged,
    })
  }

  return actions
}
