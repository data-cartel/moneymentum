import type { ColumnDef } from "@tanstack/solid-table"

import {
  createNullableNumberSortFn,
  createSortableHeader,
} from "./sortableTableHeader"
import type { AllSymbolRowData } from "./allSymbolRowModel"

export const allSymbolsColumns: ColumnDef<AllSymbolRowData>[] = [
  {
    id: "asset",
    accessorKey: "baseSymbol",
    header: createSortableHeader<AllSymbolRowData>("Asset", "left"),
    sortUndefined: "last",
  },
  {
    id: "rate",
    accessorKey: "fundingRateAnnualized",
    header: createSortableHeader<AllSymbolRowData>("Rate", "right", {
      title: "Annualized funding rate",
    }),
    sortingFn: createNullableNumberSortFn(row => row.fundingRateAnnualized),
  },
  {
    id: "beta",
    accessorKey: "beta",
    header: createSortableHeader<AllSymbolRowData>("Beta"),
    sortingFn: createNullableNumberSortFn(row => row.beta),
  },
  {
    id: "vol",
    accessorKey: "volatility",
    header: createSortableHeader<AllSymbolRowData>("Vol"),
    sortingFn: createNullableNumberSortFn(row => row.volatility),
  },
  {
    id: "sharpe",
    accessorKey: "sharpe",
    header: createSortableHeader<AllSymbolRowData>("Sharpe"),
    sortingFn: createNullableNumberSortFn(row => row.sharpe),
  },
  {
    id: "sortino",
    accessorKey: "sortino",
    header: createSortableHeader<AllSymbolRowData>("Sortino"),
    sortingFn: createNullableNumberSortFn(row => row.sortino),
  },
  {
    id: "momentum",
    accessorKey: "momentum",
    header: createSortableHeader<AllSymbolRowData>("Mom"),
    sortingFn: createNullableNumberSortFn(row => row.momentum),
  },
  {
    id: "carry",
    accessorKey: "carry",
    header: createSortableHeader<AllSymbolRowData>("Carry"),
    sortingFn: createNullableNumberSortFn(row => row.carry),
  },
]

export const DEFAULT_ALL_SYMBOLS_SORTING = [
  { id: "asset", desc: false },
] as const
