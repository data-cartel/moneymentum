import { describe, it, expect } from "vitest"
import { formatNum, formatPct, formatUsd } from "./formatters"

describe("formatNum", () => {
  it("returns placeholder '—' for null", () => {
    expect(formatNum(null)).toBe("—")
  })

  it("returns placeholder '—' for undefined", () => {
    expect(formatNum(undefined)).toBe("—")
  })

  it("formats positive numbers with default 2 decimals", () => {
    expect(formatNum(123.456)).toBe("123.46")
  })

  it("formats negative numbers", () => {
    expect(formatNum(-45.678)).toBe("-45.68")
  })

  it("formats zero", () => {
    expect(formatNum(0)).toBe("0.00")
  })

  it("uses custom decimal places", () => {
    expect(formatNum(1.23456, 3)).toBe("1.235")
    expect(formatNum(1.23456, 0)).toBe("1")
    expect(formatNum(1.23456, 4)).toBe("1.2346")
  })

  it("handles small numbers", () => {
    expect(formatNum(0.001)).toBe("0.00")
    expect(formatNum(0.001, 3)).toBe("0.001")
  })

  it("handles large numbers", () => {
    expect(formatNum(1234567.89)).toBe("1234567.89")
  })
})

describe("formatPct", () => {
  it("formats positive percentages with + prefix", () => {
    expect(formatPct(0.15)).toBe("+15.0%")
  })

  it("formats negative percentages without + prefix", () => {
    expect(formatPct(-0.25)).toBe("-25.0%")
  })

  it("formats zero with + prefix", () => {
    expect(formatPct(0)).toBe("+0.0%")
  })

  it("handles small percentages", () => {
    expect(formatPct(0.001)).toBe("+0.1%")
    expect(formatPct(-0.001)).toBe("-0.1%")
  })

  it("handles large percentages", () => {
    expect(formatPct(1.5)).toBe("+150.0%")
    expect(formatPct(-2.0)).toBe("-200.0%")
  })

  it("rounds to one decimal place", () => {
    expect(formatPct(0.1234)).toBe("+12.3%")
    expect(formatPct(0.1256)).toBe("+12.6%")
  })
})

describe("formatUsd", () => {
  it("formats small amounts without suffix", () => {
    expect(formatUsd(500)).toBe("$500")
    expect(formatUsd(999)).toBe("$999")
  })

  it("formats thousands with k suffix", () => {
    expect(formatUsd(1000)).toBe("$1.0k")
    expect(formatUsd(1500)).toBe("$1.5k")
    expect(formatUsd(12345)).toBe("$12.3k")
    expect(formatUsd(999999)).toBe("$1000.0k")
  })

  it("formats millions with M suffix", () => {
    expect(formatUsd(1000000)).toBe("$1.00M")
    expect(formatUsd(1500000)).toBe("$1.50M")
    expect(formatUsd(12345678)).toBe("$12.35M")
  })

  it("formats negative amounts correctly", () => {
    expect(formatUsd(-500)).toBe("$-500")
    expect(formatUsd(-1500)).toBe("$-1.5k")
    expect(formatUsd(-1500000)).toBe("$-1.50M")
  })

  it("formats zero", () => {
    expect(formatUsd(0)).toBe("$0")
  })

  it("rounds appropriately based on magnitude", () => {
    expect(formatUsd(123.7)).toBe("$124")
    expect(formatUsd(1234.56)).toBe("$1.2k")
    expect(formatUsd(1234567.89)).toBe("$1.23M")
  })
})
