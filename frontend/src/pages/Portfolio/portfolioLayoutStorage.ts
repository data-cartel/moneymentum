import type { SerializedDockview } from "@arminmajerie/dockview-solid"

export const PORTFOLIO_DOCKVIEW_LAYOUT_STORAGE_KEY = "portfolio-dockview-layout"

export const readPortfolioDockviewLayout = (): SerializedDockview | null => {
  try {
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

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return null
    }
    return parsed as SerializedDockview
  } catch {
    return null
  }
}

export const writePortfolioDockviewLayout = (
  layout: SerializedDockview,
): void => {
  try {
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
  } catch {
    return
  }
}

/** Panels the workspace cannot operate without; their absence forces a repair. */
export const REQUIRED_PORTFOLIO_PANEL_IDS = [
  "portfolio",
  "allSymbols",
  "staged",
] as const

/** The slice of the Dockview API that layout restoration drives. */
export interface PortfolioLayoutHost {
  fromJSON: (layout: SerializedDockview) => void
  clear: () => void
  toJSON: () => SerializedDockview
  hasPanel: (panelId: string) => boolean
}

export type PortfolioLayoutRestoration = "restored" | "requires-default-layout"

/**
 * Restores the persisted workspace. Reports `requires-default-layout` -- with
 * the dockview left empty -- when no layout is stored, when Dockview rejects
 * the stored one, or when the stored one predates a required panel. The caller
 * then builds the default layout and persists it so the repair survives the
 * next reload.
 */
export const restorePortfolioDockviewLayout = (
  host: PortfolioLayoutHost,
): PortfolioLayoutRestoration => {
  const savedLayout = readPortfolioDockviewLayout()
  if (savedLayout === null) {
    return "requires-default-layout"
  }

  if (restoreSavedLayout(host, savedLayout)) {
    return "restored"
  }

  host.clear()
  return "requires-default-layout"
}

/** Snapshots the live workspace so a repaired layout survives a reload. */
export const persistPortfolioDockviewLayout = (
  host: PortfolioLayoutHost,
): void => {
  try {
    writePortfolioDockviewLayout(host.toJSON())
  } catch {
    // Serializing a half-built dockview: keep trading; drop persistence.
  }
}

/** `true` when Dockview accepted the layout and every required panel exists. */
const restoreSavedLayout = (
  host: PortfolioLayoutHost,
  layout: SerializedDockview,
): boolean => {
  try {
    host.fromJSON(layout)
  } catch {
    return false
  }

  return REQUIRED_PORTFOLIO_PANEL_IDS.every(panelId => host.hasPanel(panelId))
}
