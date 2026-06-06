import { describe, it, expect } from "vitest"
import {
  getFactorColor,
  getFactorCssVar,
  getCorrelationColorClass,
  getValueTextClass,
  getValueBackgroundClass,
} from "./colors"

describe("getFactorColor", () => {
  it("returns correct hex color for known factors", () => {
    expect(getFactorColor("β to BTC")).toBe("#3b82f6")
    expect(getFactorColor("β to SPY")).toBe("#22c55e")
    expect(getFactorColor("Momentum")).toBe("#f59e0b")
    expect(getFactorColor("Carry")).toBe("#ef4444")
    expect(getFactorColor("Volatility")).toBe("#8b5cf6")
    expect(getFactorColor("Idiosyncratic")).toBe("#888888")
  })

  it("returns fallback for unknown factors", () => {
    expect(getFactorColor("Unknown Factor")).toBe("#888888")
    expect(getFactorColor("")).toBe("#888888")
  })
})

describe("getFactorCssVar", () => {
  it("returns correct CSS variable for known factors", () => {
    expect(getFactorCssVar("β to BTC")).toBe("var(--factor-btc-beta)")
    expect(getFactorCssVar("Momentum")).toBe("var(--factor-momentum)")
  })

  it("returns fallback for unknown factors", () => {
    expect(getFactorCssVar("Unknown")).toBe("var(--factor-idiosyncratic)")
  })
})

describe("getCorrelationColorClass", () => {
  it("returns positive classes for positive correlations", () => {
    expect(getCorrelationColorClass(1.0)).toBe("bg-positive")
    expect(getCorrelationColorClass(0.8)).toBe("bg-positive")
    expect(getCorrelationColorClass(0.7)).toBe("bg-positive")
    expect(getCorrelationColorClass(0.5)).toBe("bg-positive/60")
    expect(getCorrelationColorClass(0.3)).toBe("bg-positive/60")
    expect(getCorrelationColorClass(0.1)).toBe("bg-positive/30")
    expect(getCorrelationColorClass(0)).toBe("bg-positive/30")
  })

  it("returns negative classes for negative correlations", () => {
    expect(getCorrelationColorClass(-0.1)).toBe("bg-negative/30")
    expect(getCorrelationColorClass(-0.3)).toBe("bg-negative/30")
    expect(getCorrelationColorClass(-0.5)).toBe("bg-negative/60")
    expect(getCorrelationColorClass(-0.7)).toBe("bg-negative/60")
    expect(getCorrelationColorClass(-0.8)).toBe("bg-negative")
    expect(getCorrelationColorClass(-1.0)).toBe("bg-negative")
  })
})

describe("getValueTextClass", () => {
  it("returns text-positive for positive values", () => {
    expect(getValueTextClass(0.5)).toBe("text-positive")
    expect(getValueTextClass(100)).toBe("text-positive")
    expect(getValueTextClass(0.001)).toBe("text-positive")
  })

  it("returns text-negative for negative values", () => {
    expect(getValueTextClass(-0.5)).toBe("text-negative")
    expect(getValueTextClass(-100)).toBe("text-negative")
    expect(getValueTextClass(-0.001)).toBe("text-negative")
  })

  it("returns text-muted-foreground for zero", () => {
    expect(getValueTextClass(0)).toBe("text-muted-foreground")
  })
})

describe("getValueBackgroundClass", () => {
  it("returns bg-positive for positive values", () => {
    expect(getValueBackgroundClass(0.5)).toBe("bg-positive")
  })

  it("returns bg-negative for negative values", () => {
    expect(getValueBackgroundClass(-0.5)).toBe("bg-negative")
  })

  it("returns bg-muted for zero", () => {
    expect(getValueBackgroundClass(0)).toBe("bg-muted")
  })
})
