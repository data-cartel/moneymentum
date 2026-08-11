import { cn } from "@/lib/cn"

import {
  isPortfolioMetricColumnId,
  type PortfolioMetricColumnId,
} from "./portfolioMetricVisibility"

export type AllSymbolColumnId = "asset" | PortfolioMetricColumnId

const bodyBase = "px-2 py-1 align-middle"

const columnWidthClass: Record<AllSymbolColumnId, string> = {
  asset: "w-[8.5rem]",
  rate: "w-[5rem]",
  beta: "w-[3.5rem]",
  vol: "w-[4.25rem]",
  sharpe: "w-[3.75rem]",
  sortino: "w-[4rem]",
  momentum: "w-[4.5rem]",
  carry: "w-[4.25rem]",
}

export const allSymbolTableColumnIds = (
  visibleMetricColumns: PortfolioMetricColumnId[],
): AllSymbolColumnId[] => ["asset", ...visibleMetricColumns]

export const allSymbolColumnWidthClass = (
  columnId: AllSymbolColumnId,
): string => columnWidthClass[columnId]

export const allSymbolHeaderClass = (columnId: AllSymbolColumnId): string => {
  const base = cn(
    "px-2 py-1 font-medium text-muted-foreground text-[10px] overflow-visible",
    columnWidthClass[columnId],
  )

  if (columnId === "asset") {
    return cn(base, "text-left pr-3")
  }

  return cn(base, "text-right pl-3")
}

export const allSymbolBodyCellClass = (columnId: AllSymbolColumnId): string => {
  const width = columnWidthClass[columnId]

  if (columnId === "asset") {
    return cn(bodyBase, width, "text-left font-medium truncate")
  }

  return cn(bodyBase, width, "text-right font-mono text-[11px] truncate")
}

export const isAllSymbolColumnId = (
  value: string,
): value is AllSymbolColumnId =>
  value === "asset" || isPortfolioMetricColumnId(value)
