export const CROSS_ACCOUNT_LEVERAGE_MIN = 0.001
export const CROSS_ACCOUNT_LEVERAGE_MAX = 5
export const CROSS_ACCOUNT_LEVERAGE_STEP = 0.1

/** Step account leverage by `deltaSteps` * STEP, clamped and rounded to the step grid. */
export const steppedCrossAccountLeverage = (
  current: number,
  deltaSteps: number,
): number => {
  const stepsFromMin = Math.round(
    (current - CROSS_ACCOUNT_LEVERAGE_MIN) / CROSS_ACCOUNT_LEVERAGE_STEP,
  )
  const unclamped =
    CROSS_ACCOUNT_LEVERAGE_MIN +
    (stepsFromMin + deltaSteps) * CROSS_ACCOUNT_LEVERAGE_STEP

  return Math.min(
    CROSS_ACCOUNT_LEVERAGE_MAX,
    Math.max(CROSS_ACCOUNT_LEVERAGE_MIN, unclamped),
  )
}
