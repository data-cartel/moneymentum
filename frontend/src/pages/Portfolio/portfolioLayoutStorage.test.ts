import type { SerializedDockview } from "@arminmajerie/dockview-solid"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY,
  REQUIRED_PORTFOLIO_PANEL_IDS,
  persistPortfolioDockviewLayout,
  readPortfolioDockviewLayout,
  restorePortfolioDockviewLayout,
  writePortfolioDockviewLayout,
  type PortfolioLayoutHost,
} from "./portfolioLayoutStorage"

const layoutWithPanels = (panelIds: readonly string[]): SerializedDockview =>
  ({ panels: [...panelIds] }) as unknown as SerializedDockview

const defaultLayoutPanelIds = [...REQUIRED_PORTFOLIO_PANEL_IDS, "performance"]

/** Stands in for Dockview: either it accepts a layout, or it rejects it. */
type SavedLayoutHandling =
  | { readonly outcome: "restores"; readonly panelIds: readonly string[] }
  | { readonly outcome: "throws" }

const stubDockviewHost = (handling: SavedLayoutHandling) => {
  const restoreAttempts: SerializedDockview[] = []
  const calls = { cleared: 0, defaultsApplied: 0 }
  let openPanelIds: string[] = []

  const host: PortfolioLayoutHost = {
    fromJSON: layout => {
      restoreAttempts.push(layout)
      if (handling.outcome === "throws") {
        throw new Error("dockview rejected the serialized layout")
      }
      openPanelIds = [...handling.panelIds]
    },
    clear: () => {
      calls.cleared += 1
      openPanelIds = []
    },
    toJSON: () => layoutWithPanels(openPanelIds),
    hasPanel: panelId => openPanelIds.includes(panelId),
  }

  /** Mirrors how the Portfolio page wires restoration to its default layout. */
  const restoreWorkspace = () => {
    if (restorePortfolioDockviewLayout(host) === "requires-default-layout") {
      calls.defaultsApplied += 1
      openPanelIds = [...defaultLayoutPanelIds]
      persistPortfolioDockviewLayout(host)
    }
  }

  return { restoreWorkspace, calls, restoreAttempts }
}

const storedLayout = (): unknown =>
  JSON.parse(
    localStorage.getItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY) ?? "null",
  )

describe("portfolio dockview layout storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("reads back a layout it wrote", () => {
    const layout = layoutWithPanels(defaultLayoutPanelIds)

    writePortfolioDockviewLayout(layout)

    expect(readPortfolioDockviewLayout()).toEqual(layout)
  })

  it("reads nothing when no layout was ever stored", () => {
    expect(readPortfolioDockviewLayout()).toBeNull()
  })

  it("discards a stored layout that is not valid json", () => {
    localStorage.setItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY, "{not json")

    expect(readPortfolioDockviewLayout()).toBeNull()
  })

  it("discards a stored layout that is not an object", () => {
    localStorage.setItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY, '"portfolio"')

    expect(readPortfolioDockviewLayout()).toBeNull()
  })
})

describe("restorePortfolioDockviewLayout", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("applies and persists the default layout on a first visit", () => {
    const { restoreWorkspace, calls, restoreAttempts } = stubDockviewHost({
      outcome: "restores",
      panelIds: [],
    })

    restoreWorkspace()

    expect(restoreAttempts).toHaveLength(0)
    expect(calls.cleared).toBe(0)
    expect(calls.defaultsApplied).toBe(1)
    expect(storedLayout()).toEqual(layoutWithPanels(defaultLayoutPanelIds))
  })

  it("keeps a saved layout that still has every required panel", () => {
    const savedLayout = layoutWithPanels([
      ...REQUIRED_PORTFOLIO_PANEL_IDS,
      "risk",
    ])
    writePortfolioDockviewLayout(savedLayout)
    const { restoreWorkspace, calls, restoreAttempts } = stubDockviewHost({
      outcome: "restores",
      panelIds: [...REQUIRED_PORTFOLIO_PANEL_IDS, "risk"],
    })

    restoreWorkspace()

    expect(restoreAttempts).toEqual([savedLayout])
    expect(calls.cleared).toBe(0)
    expect(calls.defaultsApplied).toBe(0)
    expect(storedLayout()).toEqual(savedLayout)
  })

  it("repairs an older layout that predates a required panel", () => {
    writePortfolioDockviewLayout(layoutWithPanels(["portfolio", "allSymbols"]))
    const { restoreWorkspace, calls } = stubDockviewHost({
      outcome: "restores",
      panelIds: ["portfolio", "allSymbols"],
    })

    restoreWorkspace()

    expect(calls.cleared).toBe(1)
    expect(calls.defaultsApplied).toBe(1)
    expect(storedLayout()).toEqual(layoutWithPanels(defaultLayoutPanelIds))
  })

  it("repairs an empty layout that restores no panels at all", () => {
    localStorage.setItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY, "{}")
    const { restoreWorkspace, calls } = stubDockviewHost({
      outcome: "restores",
      panelIds: [],
    })

    restoreWorkspace()

    expect(calls.cleared).toBe(1)
    expect(calls.defaultsApplied).toBe(1)
    expect(storedLayout()).toEqual(layoutWithPanels(defaultLayoutPanelIds))
  })

  it("repairs a layout that dockview refuses to deserialize", () => {
    writePortfolioDockviewLayout(layoutWithPanels(["portfolio"]))
    const { restoreWorkspace, calls } = stubDockviewHost({
      outcome: "throws",
    })

    restoreWorkspace()

    expect(calls.cleared).toBe(1)
    expect(calls.defaultsApplied).toBe(1)
    expect(storedLayout()).toEqual(layoutWithPanels(defaultLayoutPanelIds))
  })

  it("falls back to the default layout when a malformed layout cannot be read", () => {
    localStorage.setItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY, "{not json")
    const { restoreWorkspace, calls, restoreAttempts } = stubDockviewHost({
      outcome: "restores",
      panelIds: [],
    })

    restoreWorkspace()

    expect(restoreAttempts).toHaveLength(0)
    expect(calls.cleared).toBe(0)
    expect(calls.defaultsApplied).toBe(1)
    expect(storedLayout()).toEqual(layoutWithPanels(defaultLayoutPanelIds))
  })
})
