import type { SerializedDockview } from "@arminmajerie/dockview-solid"

export const PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY = "portfolio-dockview-layout"

const REQUIRED_PANEL_IDS = [
  "portfolio",
  "hyperliquid",
  "derive",
  "staged",
] as const

const layoutHasRequiredPanels = (layout: SerializedDockview): boolean => {
  const serialized = JSON.stringify(layout)
  return REQUIRED_PANEL_IDS.every(panelId =>
    serialized.includes(`"id":"${panelId}"`),
  )
}

/**
 * Loads the persisted dockview layout. Drops layouts that still use the
 * pre-multi-venue `allSymbols` panel id (or are missing `hyperliquid` /
 * `derive`) so the default layout can be applied instead.
 */
export const readPortfolioDockviewLayout = (): SerializedDockview | null => {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.getItem !== "function"
  ) {
    return null
  }

  const raw = localStorage.getItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY)
  if (raw === null) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return null
    }
    const layout = parsed as SerializedDockview
    if (!layoutHasRequiredPanels(layout)) {
      localStorage.removeItem(PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY)
      return null
    }
    return layout
  } catch {
    return null
  }
}

export const writePortfolioDockviewLayout = (
  layout: SerializedDockview,
): void => {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.setItem !== "function"
  ) {
    return
  }

  localStorage.setItem(
    PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY,
    JSON.stringify(layout),
  )
}
