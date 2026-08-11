import type { ColumnDef } from "@tanstack/solid-table"

import {
  createNullableNumberSortFn,
  createSortableHeader,
} from "./sortableTableHeader"
import type { PortfolioMetricColumnId } from "./portfolioMetricVisibility"
import type { AllSymbolRowData } from "./allSymbolRowModel"

const baseColumns: ColumnDef<AllSymbolRowData>[] = [
  {
    id: "asset",
    accessorKey: "baseSymbol",
    header: createSortableHeader<AllSymbolRowData>("Asset", "left"),
    sortUndefined: "last",
  },
]

const metricColumnDefs: Record<
  PortfolioMetricColumnId,
  ColumnDef<AllSymbolRowData>
> = {
  rate: {
    id: "rate",
    accessorKey: "fundingRateAnnualized",
    header: createSortableHeader<AllSymbolRowData>("Rate", "right", {
      title: "Annualized funding rate",
    }),
    sortingFn: createNullableNumberSortFn(row => row.fundingRateAnnualized),
  },
  beta: {
    id: "beta",
    accessorKey: "beta",
    header: createSortableHeader<AllSymbolRowData>("Beta"),
    sortingFn: createNullableNumberSortFn(row => row.beta),
  },
  vol: {
    id: "vol",
    accessorKey: "volatility",
    header: createSortableHeader<AllSymbolRowData>("Vol"),
    sortingFn: createNullableNumberSortFn(row => row.volatility),
  },
  sharpe: {
    id: "sharpe",
    accessorKey: "sharpe",
    header: createSortableHeader<AllSymbolRowData>("Sharpe"),
    sortingFn: createNullableNumberSortFn(row => row.sharpe),
  },
  sortino: {
    id: "sortino",
    accessorKey: "sortino",
    header: createSortableHeader<AllSymbolRowData>("Sortino"),
    sortingFn: createNullableNumberSortFn(row => row.sortino),
  },
  momentum: {
    id: "momentum",
    accessorKey: "momentum",
    header: createSortableHeader<AllSymbolRowData>("Mom"),
    sortingFn: createNullableNumberSortFn(row => row.momentum),
  },
  carry: {
    id: "carry",
    accessorKey: "carry",
    header: createSortableHeader<AllSymbolRowData>("Carry"),
    sortingFn: createNullableNumberSortFn(row => row.carry),
  },
}

export const buildAllSymbolsColumns = (
  visibleMetricColumns: PortfolioMetricColumnId[],
): ColumnDef<AllSymbolRowData>[] => [
  ...baseColumns,
  ...visibleMetricColumns.map(columnId => metricColumnDefs[columnId]),
]

export const DEFAULT_ALL_SYMBOLS_SORTING = [
  { id: "asset", desc: false },
] as const
