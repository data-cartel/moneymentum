import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  MANUAL_WEIGHT_ENTRY_STORAGE_KEY,
  PRECISE_TOGGLE_STORAGE_KEY,
  writeManualWeightEntry,
  writePreciseToggle,
} from "./usePortfolioState"

describe("writePreciseToggle", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("persists the precise toggle value", () => {
    writePreciseToggle(true)

    expect(localStorage.getItem(PRECISE_TOGGLE_STORAGE_KEY)).toBe("true")
  })
})

describe("writeManualWeightEntry", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("persists the manual weight entry toggle value", () => {
    writeManualWeightEntry(true)

    expect(localStorage.getItem(MANUAL_WEIGHT_ENTRY_STORAGE_KEY)).toBe("true")
  })
})
