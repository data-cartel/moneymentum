import type { ColumnDef } from "@tanstack/solid-table"

import type { PositionRowData } from "./positionRowModel"
import {
  PORTFOLIO_METRIC_COLUMN_LABELS,
  type PortfolioMetricColumnId,
} from "./portfolioMetricVisibility"
import {
  createNullableNumberSortFn,
  createSortableHeader,
} from "./sortableTableHeader"

const baseColumns: ColumnDef<PositionRowData>[] = [
  {
    id: "asset",
    accessorFn: row => row.symbol.split("/")[0] ?? row.symbol,
    header: createSortableHeader<PositionRowData>("Asset", "left"),
    sortUndefined: "last",
  },
  {
    id: "side",
    accessorKey: "side",
    header: createSortableHeader<PositionRowData>("Side"),
  },
  {
    id: "weight",
    accessorKey: "weightPercent",
    header: createSortableHeader<PositionRowData>("Weight"),
  },
  {
    id: "notional",
    accessorKey: "notional",
    header: createSortableHeader<PositionRowData>("Notional"),
  },
]

const metricColumnDefs: Record<
  PortfolioMetricColumnId,
  ColumnDef<PositionRowData>
> = {
  rate: {
    id: "rate",
    accessorKey: "signedFundingRate",
    header: createSortableHeader<PositionRowData>("Rate", "right", {
      title: "Annualized funding rate (signed by position direction)",
    }),
    sortingFn: createNullableNumberSortFn(row => row.signedFundingRate),
  },
  beta: {
    id: "beta",
    accessorKey: "beta",
    header: createSortableHeader<PositionRowData>("Beta"),
    sortingFn: createNullableNumberSortFn(row => row.beta),
  },
  vol: {
    id: "vol",
    accessorKey: "volatility",
    header: createSortableHeader<PositionRowData>("Vol"),
    sortingFn: createNullableNumberSortFn(row => row.volatility),
  },
  sharpe: {
    id: "sharpe",
    accessorKey: "sharpe",
    header: createSortableHeader<PositionRowData>("Sharpe"),
    sortingFn: createNullableNumberSortFn(row => row.sharpe),
  },
  sortino: {
    id: "sortino",
    accessorKey: "sortino",
    header: createSortableHeader<PositionRowData>("Sortino"),
    sortingFn: createNullableNumberSortFn(row => row.sortino),
  },
  momentum: {
    id: "momentum",
    accessorKey: "momentum",
    header: createSortableHeader<PositionRowData>("Mom"),
    sortingFn: createNullableNumberSortFn(row => row.momentum),
  },
  carry: {
    id: "carry",
    accessorKey: "carry",
    header: createSortableHeader<PositionRowData>("Carry"),
    sortingFn: createNullableNumberSortFn(row => row.carry),
  },
}

export const buildPositionsColumns = (
  visibleMetricColumns: PortfolioMetricColumnId[],
): ColumnDef<PositionRowData>[] => [
  ...baseColumns,
  ...visibleMetricColumns.map(columnId => metricColumnDefs[columnId]),
  {
    id: "actions",
    enableSorting: false,
    header: () => null,
  },
]

export const portfolioMetricColumnLabel = (
  columnId: PortfolioMetricColumnId,
): string => PORTFOLIO_METRIC_COLUMN_LABELS[columnId]

export const DEFAULT_POSITIONS_SORTING = [
  { id: "notional", desc: true },
] as const
