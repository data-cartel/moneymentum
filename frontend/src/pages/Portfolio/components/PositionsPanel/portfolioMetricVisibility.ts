import { createEffect, createSignal, type Accessor } from "solid-js"

export const PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY =
  "portfolio-metric-columns-visibility"

export type PortfolioMetricColumnId =
  | "rate"
  | "beta"
  | "vol"
  | "sharpe"
  | "sortino"
  | "momentum"
  | "carry"

export type PortfolioMetricVisibility = Record<PortfolioMetricColumnId, boolean>

export const PORTFOLIO_METRIC_COLUMN_ORDER: PortfolioMetricColumnId[] = [
  "rate",
  "beta",
  "vol",
  "sharpe",
  "sortino",
  "momentum",
  "carry",
]

export const PORTFOLIO_METRIC_COLUMN_LABELS: Record<
  PortfolioMetricColumnId,
  string
> = {
  rate: "Rate",
  beta: "Beta",
  vol: "Vol",
  sharpe: "Sharpe",
  sortino: "Sortino",
  momentum: "Mom",
  carry: "Carry",
}

export const DEFAULT_PORTFOLIO_METRIC_VISIBILITY: PortfolioMetricVisibility = {
  rate: true,
  beta: true,
  vol: true,
  sharpe: false,
  sortino: false,
  momentum: false,
  carry: false,
}

const portfolioMetricColumnIds = new Set<string>(PORTFOLIO_METRIC_COLUMN_ORDER)

export const isPortfolioMetricColumnId = (
  value: string,
): value is PortfolioMetricColumnId => portfolioMetricColumnIds.has(value)

export const readPortfolioMetricVisibility = (): PortfolioMetricVisibility => {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.getItem !== "function"
  ) {
    return { ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY }
  }

  const raw = localStorage.getItem(PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY)
  if (raw === null) {
    return { ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY }
    }

    return PORTFOLIO_METRIC_COLUMN_ORDER.reduce<PortfolioMetricVisibility>(
      (visibility, columnId) => {
        const stored = (parsed as Record<string, unknown>)[columnId]
        visibility[columnId] =
          typeof stored === "boolean"
            ? stored
            : DEFAULT_PORTFOLIO_METRIC_VISIBILITY[columnId]
        return visibility
      },
      { ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY },
    )
  } catch {
    return { ...DEFAULT_PORTFOLIO_METRIC_VISIBILITY }
  }
}

export const writePortfolioMetricVisibility = (
  visibility: PortfolioMetricVisibility,
): void => {
  if (
    typeof localStorage === "undefined" ||
    typeof localStorage.setItem !== "function"
  ) {
    return
  }

  try {
    localStorage.setItem(
      PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
      JSON.stringify(visibility),
    )
  } catch {
    return
  }
}

/**
 * Restores the persisted metric column visibility and keeps localStorage in
 * sync with every gear-menu toggle for the lifetime of the owning component.
 */
export const usePortfolioMetricVisibility = (): {
  metricVisibility: Accessor<PortfolioMetricVisibility>
  setMetricColumnVisible: (
    columnId: PortfolioMetricColumnId,
    visible: boolean,
  ) => void
} => {
  const [metricVisibility, setMetricVisibility] =
    createSignal<PortfolioMetricVisibility>(readPortfolioMetricVisibility())

  // createEffect: persist metric visibility when gear toggles change
  createEffect(() => {
    writePortfolioMetricVisibility(metricVisibility())
  })

  const setMetricColumnVisible = (
    columnId: PortfolioMetricColumnId,
    visible: boolean,
  ) => {
    setMetricVisibility(previous => ({
      ...previous,
      [columnId]: visible,
    }))
  }

  return { metricVisibility, setMetricColumnVisible }
}

export const visiblePortfolioMetricColumns = (
  visibility: PortfolioMetricVisibility,
): PortfolioMetricColumnId[] =>
  PORTFOLIO_METRIC_COLUMN_ORDER.filter(columnId => visibility[columnId])

export const leverageEditorColumnSpan = (
  visibleMetricColumns: PortfolioMetricColumnId[],
): number => 3 + visibleMetricColumns.length
