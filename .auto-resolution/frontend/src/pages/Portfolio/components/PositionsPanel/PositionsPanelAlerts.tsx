import { Show, For, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { CircleAlert, TriangleAlert } from "lucide-solid"

import { MIN_USD, type PortfolioInterface } from "../../hooks/usePortfolioState"

export interface PositionsPanelAlertsProps {
  isLoading: boolean
  isConnected: boolean
  hasPositions: boolean
  hasTotalWeightExceeded: boolean
  targetAllocationPercent: number
  symbolsBelowMinimum: string[]
  symbolsDeltaBelowMinimum: string[]
  isPrecise: boolean
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  currentPortfolio: Record<string, PortfolioInterface | undefined>
}

/** Below this (vs target notional) we warn that allocation is not full. */
const ALLOCATION_FULL_MIN_PERCENT = 99.95

export const PositionsPanelAlerts = (
  props: PositionsPanelAlertsProps,
): JSX.Element => {
  const isClosingAllPositions = createMemo(
    () =>
      Object.values(props.currentPortfolio).some(
        position => position !== undefined,
      ) &&
      Object.values(props.targetPortfolio).every(
        position => position === undefined || position.notional <= 0.01,
      ),
  )

  const hasUnderAllocation = createMemo(
    () =>
      !isClosingAllPositions() &&
      !props.hasTotalWeightExceeded &&
      props.targetAllocationPercent < ALLOCATION_FULL_MIN_PERCENT,
  )

  const visible = createMemo(
    () =>
      !props.isLoading &&
      props.isConnected &&
      props.hasPositions &&
      (props.hasTotalWeightExceeded ||
        hasUnderAllocation() ||
        props.symbolsBelowMinimum.length > 0 ||
        (!props.isPrecise && props.symbolsDeltaBelowMinimum.length > 0)),
  )

  const belowMinimumDetail = (symbol: string) => {
    const notional = props.targetPortfolio[symbol]?.notional ?? 0
    return `${symbol} ($${notional.toFixed(2)})`
  }

  const deltaDetail = (symbol: string) => {
    const targetN = props.targetPortfolio[symbol]?.notional ?? 0
    const currentN = props.currentPortfolio[symbol]?.notional ?? 0
    const delta = Math.abs(targetN - currentN)
    return `${symbol} (delta $${delta.toFixed(2)})`
  }

  return (
    <Show when={visible()}>
      <div
        class="shrink-0 space-y-2 border-t border-border bg-muted/20 px-2.5 py-2"
        role="region"
        aria-label="Portfolio validation messages"
      >
        <Show when={props.hasTotalWeightExceeded}>
          <div
            class="flex items-start gap-2 rounded border border-destructive/35 bg-destructive/10 px-2 py-1.5"
            role="alert"
          >
            <TriangleAlert
              class="size-4 shrink-0 text-destructive mt-px"
              aria-hidden
            />
            <div class="min-w-0 flex-1 space-y-0.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11px] font-medium leading-tight text-destructive">
                  Allocation over 100%
                </span>
                <span class="font-mono text-[11px] font-semibold tabular-nums text-destructive">
                  {props.targetAllocationPercent.toFixed(1)}%
                </span>
              </div>
              <p class="text-[10px] leading-snug text-muted-foreground">
                Sum of target weights exceeds the portfolio notional. Lower
                weights.
              </p>
            </div>
          </div>
        </Show>

        <Show when={hasUnderAllocation()}>
          <div
            class="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 dark:border-amber-400/35 dark:bg-amber-500/10"
            role="status"
          >
            <CircleAlert
              class="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-px"
              aria-hidden
            />
            <div class="min-w-0 flex-1 space-y-0.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11px] font-medium leading-tight text-amber-700 dark:text-amber-300">
                  Allocation under 100%
                </span>
                <span class="font-mono text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                  {props.targetAllocationPercent.toFixed(1)}%
                </span>
              </div>
              <p class="text-[10px] leading-snug text-muted-foreground">
                Target weights sum to less than 100% of portfolio notional.
                Increase weights, or remove unused capacity.
              </p>
            </div>
          </div>
        </Show>

        <Show when={props.symbolsBelowMinimum.length > 0}>
          <div
            class="flex items-start gap-2 rounded border border-destructive/35 bg-destructive/10 px-2 py-1.5"
            role="alert"
          >
            <TriangleAlert
              class="size-4 shrink-0 text-destructive mt-px"
              aria-hidden
            />
            <div class="min-w-0 flex-1 space-y-0.5">
              <p class="text-[11px] font-medium leading-tight text-destructive">
                Target below ${MIN_USD} notional
              </p>
              <p class="text-[10px] leading-snug text-muted-foreground">
                Each open target position must be at least ${MIN_USD}. Adjust
                these symbols:
              </p>
              <ul class="mt-1 list-inside list-disc text-[10px] text-muted-foreground">
                <For each={props.symbolsBelowMinimum}>
                  {symbol => <li>{belowMinimumDetail(symbol)}</li>}
                </For>
              </ul>
            </div>
          </div>
        </Show>

        <Show
          when={!props.isPrecise && props.symbolsDeltaBelowMinimum.length > 0}
        >
          <div
            class="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 dark:border-amber-400/35 dark:bg-amber-500/10"
            role="status"
          >
            <CircleAlert
              class="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-px"
              aria-hidden
            />
            <div class="min-w-0 flex-1 space-y-0.5">
              <p class="text-[11px] font-medium leading-tight text-amber-700 dark:text-amber-300">
                Rebalance delta below ${MIN_USD} (non-precise mode)
              </p>
              <p class="text-[10px] leading-snug text-muted-foreground">
                Turn on Precise or increase each trade to at least ${MIN_USD}:
              </p>
              <ul class="mt-1 list-inside list-disc text-[10px] text-muted-foreground">
                <For each={props.symbolsDeltaBelowMinimum}>
                  {symbol => <li>{deltaDetail(symbol)}</li>}
                </For>
              </ul>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
