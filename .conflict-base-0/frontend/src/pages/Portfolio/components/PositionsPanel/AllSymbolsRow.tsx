import { Show } from "solid-js"
import type { JSX } from "solid-js"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/cn"

import type {
  AllSymbolPortfolioState,
  AllSymbolRowData,
} from "./allSymbolRowModel"
import { allSymbolBodyCellClass } from "./allSymbolColumnLayout"
import {
  betaClassName,
  formatDecimal,
  formatPercent,
  fundingRateClassName,
  riskAdjustedReturnClassName,
  signedMetricClassName,
  volatilityClassName,
} from "./allSymbolRowModel"

export const AllSymbolsRow = (props: {
  row: AllSymbolRowData
  portfolioState: AllSymbolPortfolioState
  fundingIsLoading: boolean
  factorsIsLoading: boolean
  onSymbolClick: (symbol: string) => void
}): JSX.Element => {
  const fundingDisplay = () => formatPercent(props.row.fundingRateAnnualized)

  const handleActivate = () => {
    props.onSymbolClick(props.row.symbol)
  }

  const ariaLabel = () => {
    switch (props.portfolioState) {
      case "closing":
        return `Undo remove ${props.row.baseSymbol}`
      case "target":
        return `Remove ${props.row.baseSymbol} from portfolio`
      case "absent":
        return `Add ${props.row.baseSymbol} to portfolio`
    }
  }

  const rowClassName = () => {
    switch (props.portfolioState) {
      case "closing":
        return "opacity-50 bg-red-500/5"
      case "target":
        return "bg-muted/50"
      case "absent":
        return "hover:bg-muted/30 group-focus-within:bg-muted/30"
    }
  }

  return (
    <tr
      class={cn(
        "group border-b border-border/20 cursor-pointer transition-colors",
        rowClassName(),
      )}
      onClick={handleActivate}
    >
      <td class={allSymbolBodyCellClass("asset")}>
        <button
          type="button"
          aria-pressed={props.portfolioState !== "absent"}
          aria-label={ariaLabel()}
          class={cn(
            "w-full truncate rounded-sm border-0 bg-transparent p-0 text-left font-medium cursor-pointer",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0",
          )}
        >
          {props.row.baseSymbol}
        </button>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("rate"),
          fundingRateClassName(props.row.fundingRateAnnualized),
        )}
      >
        <Show
          when={!props.fundingIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-[64px] align-middle" />}
        >
          {fundingDisplay()}
        </Show>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("beta"),
          betaClassName(props.row.beta),
        )}
      >
        <Show
          when={!props.factorsIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-10 align-middle" />}
        >
          {formatDecimal(props.row.beta)}
        </Show>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("vol"),
          volatilityClassName(props.row.volatility),
        )}
      >
        <Show
          when={!props.factorsIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-10 align-middle" />}
        >
          {formatPercent(props.row.volatility)}
        </Show>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("sharpe"),
          riskAdjustedReturnClassName(props.row.sharpe),
        )}
      >
        <Show
          when={!props.factorsIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-10 align-middle" />}
        >
          {formatDecimal(props.row.sharpe)}
        </Show>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("sortino"),
          riskAdjustedReturnClassName(props.row.sortino),
        )}
      >
        <Show
          when={!props.factorsIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-10 align-middle" />}
        >
          {formatDecimal(props.row.sortino)}
        </Show>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("momentum"),
          signedMetricClassName(props.row.momentum),
        )}
      >
        <Show
          when={!props.factorsIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-10 align-middle" />}
        >
          {formatPercent(props.row.momentum)}
        </Show>
      </td>
      <td
        class={cn(
          allSymbolBodyCellClass("carry"),
          signedMetricClassName(props.row.carry),
        )}
      >
        <Show
          when={!props.factorsIsLoading}
          fallback={<Skeleton class="inline-block h-3 w-10 align-middle" />}
        >
          {formatPercent(props.row.carry)}
        </Show>
      </td>
    </tr>
  )
}
