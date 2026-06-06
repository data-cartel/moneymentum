import type { ColumnDef, Column } from "@tanstack/solid-table"
import { ArrowUpDown } from "lucide-solid"
import { A } from "@solidjs/router"

import { Button } from "./button"
import type { TradingData } from "@/hooks/useApi"

const sortableHeader =
  (label: string) => (ctx: { column: Column<TradingData> }) => (
    <Button
      variant="ghost"
      onClick={() => {
        ctx.column.toggleSorting(ctx.column.getIsSorted() === "asc")
      }}
    >
      {label}
      <ArrowUpDown class="ml-2 h-4 w-4" />
    </Button>
  )

export const columns: ColumnDef<TradingData>[] = [
  { accessorKey: "timestamp", header: sortableHeader("Timestamp") },
  { accessorKey: "close", header: sortableHeader("Close") },
  { accessorKey: "volume", header: sortableHeader("Volume") },
  {
    accessorKey: "ticker",
    header: sortableHeader("Ticker"),
    cell: cellContext => {
      const ticker = String(cellContext.getValue())
      return (
        <A
          href={`/token/${ticker}`}
          class="underline text-blue-400 hover:text-blue-300"
        >
          {ticker}
        </A>
      )
    },
  },
  { accessorKey: "log_return", header: sortableHeader("Log Return") },
  { accessorKey: "cum_return", header: sortableHeader("Cum Return") },
  { accessorKey: "autocorrelation", header: sortableHeader("Autocorrelation") },
  { accessorKey: "stddev", header: sortableHeader("Stddev") },
  {
    accessorKey: "annualized_volatility",
    header: sortableHeader("Annualized Volatility"),
  },
  { accessorKey: "sma", header: sortableHeader("SMA") },
  { accessorKey: "mean_return", header: sortableHeader("Mean Return") },
  { accessorKey: "price_stddev", header: sortableHeader("Price Stddev") },
  { accessorKey: "return_stddev", header: sortableHeader("Return Stddev") },
  { accessorKey: "price_zscore", header: sortableHeader("Price Zscore") },
  { accessorKey: "covariance", header: sortableHeader("Covariance") },
  { accessorKey: "beta", header: sortableHeader("Beta") },
  {
    accessorKey: "information_discreteness",
    header: sortableHeader("Information Discreteness"),
  },
  { accessorKey: "sharpe", header: sortableHeader("Sharpe") },
  {
    accessorKey: "log_return_above_mar",
    header: sortableHeader("Log Return Above MAR"),
  },
  {
    accessorKey: "downside_deviation",
    header: sortableHeader("Downside Deviation"),
  },
  { accessorKey: "sortino", header: sortableHeader("Sortino") },
]
