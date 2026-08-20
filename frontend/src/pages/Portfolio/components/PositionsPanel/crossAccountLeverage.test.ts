import { describe, expect, it } from "vitest"

import {
  CROSS_ACCOUNT_LEVERAGE_MAX,
  CROSS_ACCOUNT_LEVERAGE_MIN,
  CROSS_ACCOUNT_LEVERAGE_STEP,
  steppedCrossAccountLeverage,
} from "./crossAccountLeverage"

describe("steppedCrossAccountLeverage", () => {
  it("steps by 0.1 and clamps to the account range", () => {
    expect(steppedCrossAccountLeverage(1, 1)).toBeCloseTo(1.101)
    expect(steppedCrossAccountLeverage(1.101, -1)).toBeCloseTo(1.001)
    expect(steppedCrossAccountLeverage(CROSS_ACCOUNT_LEVERAGE_MAX, 1)).toBe(
      CROSS_ACCOUNT_LEVERAGE_MAX,
    )
    expect(steppedCrossAccountLeverage(CROSS_ACCOUNT_LEVERAGE_MIN, -1)).toBe(
      CROSS_ACCOUNT_LEVERAGE_MIN,
    )
  })

  it("advances exactly one step from the minimum grid anchor", () => {
    expect(steppedCrossAccountLeverage(CROSS_ACCOUNT_LEVERAGE_MIN, 1)).toBe(
      CROSS_ACCOUNT_LEVERAGE_MIN + CROSS_ACCOUNT_LEVERAGE_STEP,
    )
  })
})
