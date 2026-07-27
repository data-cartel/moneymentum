import { describe, expect, it } from "vitest"

import {
  CROSS_ACCOUNT_LEVERAGE_MAX,
  CROSS_ACCOUNT_LEVERAGE_MIN,
  steppedCrossAccountLeverage,
} from "./crossAccountLeverage"

describe("steppedCrossAccountLeverage", () => {
  it("steps by 0.1 and clamps to the account range", () => {
    expect(steppedCrossAccountLeverage(1, 1)).toBe(1.1)
    expect(steppedCrossAccountLeverage(1.1, -1)).toBe(1)
    expect(steppedCrossAccountLeverage(CROSS_ACCOUNT_LEVERAGE_MAX, 1)).toBe(
      CROSS_ACCOUNT_LEVERAGE_MAX,
    )
    expect(steppedCrossAccountLeverage(CROSS_ACCOUNT_LEVERAGE_MIN, -1)).toBe(
      CROSS_ACCOUNT_LEVERAGE_MIN,
    )
  })
})
