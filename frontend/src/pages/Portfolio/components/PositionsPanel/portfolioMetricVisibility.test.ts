import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
  PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
  readPortfolioMetricVisibility,
  writePortfolioMetricVisibility,
} from "./portfolioMetricVisibility"

describe("readPortfolioMetricVisibility", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("returns defaults when the storage key is missing", () => {
    expect(readPortfolioMetricVisibility()).toEqual(
      DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
    )
  })

  it("reads valid stored visibility", () => {
    const stored = {
      ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
      sharpe: true,
      carry: true,
    }
    localStorage.setItem(
      PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
      JSON.stringify(stored),
    )

    expect(readPortfolioMetricVisibility()).toEqual(stored)
  })

  it("returns defaults when stored JSON is malformed", () => {
    localStorage.setItem(PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY, "{not json")

    expect(readPortfolioMetricVisibility()).toEqual(
      DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
    )
  })

  it("returns defaults when parsed JSON is not an object", () => {
    localStorage.setItem(
      PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
      JSON.stringify(["rate"]),
    )

    expect(readPortfolioMetricVisibility()).toEqual(
      DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
    )
  })

  it("falls back to defaults for columns with invalid stored types", () => {
    localStorage.setItem(
      PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
        beta: "yes",
        sharpe: true,
      }),
    )

    expect(readPortfolioMetricVisibility()).toEqual({
      ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
      sharpe: true,
    })
  })
})

describe("writePortfolioMetricVisibility", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("persists visibility for readPortfolioMetricVisibility to load", () => {
    const stored = {
      ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
      sharpe: true,
      momentum: true,
    }

    writePortfolioMetricVisibility(stored)

    expect(readPortfolioMetricVisibility()).toEqual(stored)
  })

  it("does not throw when localStorage.setItem fails", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota exceeded", "QuotaExceededError")
      })

    expect(() => {
      writePortfolioMetricVisibility(DEFAULT_PORTFOLIO_METRIC_VISIBILITY)
    }).not.toThrow()

    setItem.mockRestore()
  })
})
