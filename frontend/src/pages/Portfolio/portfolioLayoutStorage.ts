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
