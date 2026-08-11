import { cn } from "@/lib/cn"

import type { PortfolioMetricColumnId } from "./portfolioMetricVisibility"

export type PositionColumnId =
  | "asset"
  | "side"
  | "weight"
  | "notional"
  | PortfolioMetricColumnId
  | "actions"

const bodyBase = "px-2 py-1 align-middle pointer-events-auto"

/** Matches the CircleAlert slot in notional rows (h-3 icon + gap-0.5). */
export const NOTIONAL_ALERT_GUTTER_CLASS = "pr-[22px]"

export const SIDE_BADGE_CLASS =
  "inline-flex w-[2.625rem] items-center justify-center px-2 py-0.5 text-center text-[10px] font-medium rounded"

export const positionBodyCellInnerClass =
  "flex items-center justify-end gap-0.5"

const stickyLeftClass = "sticky left-0 z-10"
const stickyRightClass = "sticky right-0 z-10"
const stickyHeaderLeftClass = "sticky left-0 z-30"
const stickyHeaderRightClass = "sticky right-0 z-30"
const stickyEdgeBorderLeft = "border-r border-border/50"
const stickyEdgeBorderRight = "border-l border-border/50"
const stickyHeaderBackground = "bg-muted/90 backdrop-blur-sm"

export type PositionRowHighlight = "new" | "unchanged" | "changed" | "closing"

export const positionStickyRowBackground = (
  status: PositionRowHighlight,
): string => {
  if (status === "new") return "bg-green-500/5"
  if (status === "closing") return "bg-red-500/5"
  return "bg-background"
}

export const positionStickyBodyClass = (
  columnId: "asset" | "actions",
  status: PositionRowHighlight,
): string =>
  cn(
    positionBodyCellClass(columnId),
    columnId === "asset" ? stickyLeftClass : stickyRightClass,
    columnId === "asset" ? stickyEdgeBorderLeft : stickyEdgeBorderRight,
    positionStickyRowBackground(status),
  )

export const positionStickyLeverageCloseClass = (
  status: PositionRowHighlight,
): string =>
  cn(
    "px-2 align-middle text-right pointer-events-auto",
    positionColumnWidthClass("actions"),
    stickyRightClass,
    stickyEdgeBorderRight,
    positionStickyRowBackground(status),
  )

const columnWidthClass: Record<PositionColumnId, string> = {
  asset: "w-[7.5rem]",
  side: "w-[2.875rem]",
  weight: "w-[4.25rem]",
  notional: "w-[6.75rem]",
  rate: "w-[5rem]",
  beta: "w-[3.5rem]",
  vol: "w-[4.25rem]",
  sharpe: "w-[3.75rem]",
  sortino: "w-[4rem]",
  momentum: "w-[4.5rem]",
  carry: "w-[4.25rem]",
  actions: "w-9",
}

export const positionColumnWidthClass = (columnId: PositionColumnId): string =>
  columnWidthClass[columnId]

export const positionHeaderClass = (columnId: PositionColumnId): string => {
  const base = cn(
    "px-2 py-1 font-medium text-muted-foreground text-[10px] overflow-visible",
    columnWidthClass[columnId],
  )

  if (columnId === "asset") {
    return cn(
      base,
      "text-left pr-3",
      stickyHeaderLeftClass,
      stickyEdgeBorderLeft,
      stickyHeaderBackground,
    )
  }
  if (columnId === "notional") {
    return `${base} text-right pl-3 ${NOTIONAL_ALERT_GUTTER_CLASS}`
  }
  if (columnId === "actions") {
    return cn(
      base,
      "text-right",
      stickyHeaderRightClass,
      stickyEdgeBorderRight,
      stickyHeaderBackground,
    )
  }
  return `${base} text-right pl-3`
}

export const positionBodyCellClass = (columnId: PositionColumnId): string => {
  const width = columnWidthClass[columnId]

  switch (columnId) {
    case "asset":
      return `${bodyBase} ${width} text-left font-medium`
    case "side":
      return `${bodyBase} ${width} text-right`
    case "notional":
      return `${bodyBase} ${width} text-right font-mono text-[11px]`
    case "actions":
      return `${bodyBase} ${width} text-right`
    case "weight":
      return `${bodyBase} ${width} text-right font-mono text-[11px]`
    default:
      return `${bodyBase} ${width} text-right font-mono text-[11px] truncate`
  }
}

export const positionTableColumnIds = (
  visibleMetricColumns: PortfolioMetricColumnId[],
): PositionColumnId[] => [
  "asset",
  "side",
  "weight",
  "notional",
  ...visibleMetricColumns,
  "actions",
]
