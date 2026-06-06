import { createSignal, createMemo } from "solid-js"

type SortDirection = "asc" | "desc"

export type ScreenerColumn =
  | "sharpe"
  | "sortino"
  | "beta"
  | "volatility"
  | "momentum"

interface Asset {
  ticker: string
  sharpe: number
  sortino: number
  beta: number
  volatility: number
  momentum: number
}

interface UseScreenerConfigOptions<T extends Asset> {
  assets: () => T[]
}

const DEFAULT_VISIBLE_COLUMNS: ScreenerColumn[] = ["sharpe"]

export const SCREENER_COLUMN_LABELS: Record<ScreenerColumn, string> = {
  sharpe: "Sharpe",
  sortino: "Sortino",
  beta: "Beta",
  volatility: "Vol",
  momentum: "Mom",
}

export const ALL_SCREENER_COLUMNS: ScreenerColumn[] = [
  "sharpe",
  "sortino",
  "beta",
  "volatility",
  "momentum",
]

export const useScreenerConfig = <T extends Asset>({
  assets,
}: UseScreenerConfigOptions<T>) => {
  const [sortColumn, setSortColumnState] =
    createSignal<ScreenerColumn>("sharpe")
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [expandedUnderlyings, setExpandedUnderlyings] = createSignal<
    Set<string>
  >(new Set())
  const [visibleColumns, setVisibleColumns] = createSignal<ScreenerColumn[]>(
    DEFAULT_VISIBLE_COLUMNS,
  )

  const setSortColumn = (column: ScreenerColumn) => {
    if (column === sortColumn()) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortColumnState(column)
      setSortDirection("asc")
    }
  }

  const sortedAssets = createMemo(() => {
    const query = searchQuery().trim()
    const currentAssets = assets()
    const filtered =
      query === ""
        ? currentAssets
        : currentAssets.filter(a =>
            a.ticker.toLowerCase().includes(query.toLowerCase()),
          )

    const col = sortColumn()
    const multiplier = sortDirection() === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => (a[col] - b[col]) * multiplier)
  })

  const isExpanded = (underlying: string): boolean =>
    expandedUnderlyings().has(underlying)

  const toggleExpanded = (underlying: string) => {
    setExpandedUnderlyings(prev => {
      const hasUnderlying = prev.has(underlying)
      return hasUnderlying
        ? new Set([...prev].filter(u => u !== underlying))
        : new Set([...prev, underlying])
    })
  }

  const collapseAll = () => {
    setExpandedUnderlyings(() => new Set<string>())
  }

  const toggleColumn = (column: ScreenerColumn) => {
    setVisibleColumns(prev => {
      const hasColumn = prev.includes(column)
      if (hasColumn && prev.length === 1) {
        return prev
      }
      return hasColumn ? prev.filter(c => c !== column) : [...prev, column]
    })
  }

  return {
    get sortColumn() {
      return sortColumn()
    },
    get sortDirection() {
      return sortDirection()
    },
    setSortColumn,
    get searchQuery() {
      return searchQuery()
    },
    setSearchQuery,
    get sortedAssets() {
      return sortedAssets()
    },
    isExpanded,
    toggleExpanded,
    collapseAll,
    get visibleColumns() {
      return visibleColumns()
    },
    toggleColumn,
  }
}
