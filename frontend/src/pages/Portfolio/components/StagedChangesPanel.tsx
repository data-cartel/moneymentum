import { For, Show } from "solid-js"
import { cn } from "@/lib/cn"
import { Send } from "lucide-solid"
import { Button } from "@/components/ui/button"
import type { StagedTradeItem } from "@/pages/Portfolio/hooks/usePortfolioState"

interface StagedChangesPanelProps {
  stagedTrades: StagedTradeItem[]
  currentTotalNotional: number
  targetTotalNotional: number
  currentCrossAccountLeverage: number
  targetCrossAccountLeverage: number
  onRebalance?: () => void
  isRebalancing?: boolean
  canSubmit: boolean
  onClearAll?: () => void
}

// Grid template for staged-change rows:
// [0] Side badge (6ch) | [1] Symbol (~JELLYJELLY width + padding) | [2] Weight change (auto) | [3] Notional (= "$2000.00")
const STAGED_ROW_GRID_TEMPLATE =
  "grid grid-cols-[6ch_13ch_auto_8ch] items-center px-2 py-1.5 border-b border-border/30 text-[10px]"

const formatUnsignedPct = (weightFraction: number): string =>
  `${(weightFraction * 100).toFixed(2)}%`

const formatUsdPrecise = (value: number): string => `$${value.toFixed(2)}`

const NOTIONAL_EPSILON_USD = 0.1
const LEVERAGE_EPSILON = 0.001

export const StagedChangesPanel = (props: StagedChangesPanelProps) => {
  const stagedTrades = () => props.stagedTrades
  const hasStaged = () => stagedTrades().length > 0

  const isRebalanceButtonDisabled = () =>
    !props.canSubmit || // outside reasons (validation errors)
    !hasStaged() || // no trades - nothing to rebalance
    props.isRebalancing

  const isRebalancing = () => props.isRebalancing ?? false

  const currentTotalNotional = () => props.currentTotalNotional
  const targetTotalNotional = () => props.targetTotalNotional
  const currentLeverage = () => props.currentCrossAccountLeverage
  const targetLeverage = () => props.targetCrossAccountLeverage

  const shouldShowNotionalArrow = () => {
    return (
      Math.abs(targetTotalNotional() - currentTotalNotional()) >=
      NOTIONAL_EPSILON_USD
    )
  }

  const shouldShowLeverageArrow = () => {
    return Math.abs(currentLeverage() - targetLeverage()) > LEVERAGE_EPSILON
  }

  return (
    <div class="flex-1 border border-border rounded flex flex-col min-w-0">
      <div class="px-2 py-1.5 bg-muted/30 flex items-center justify-between border-b border-border">
        <div class="flex items-center gap-2">
          <span class="font-medium">STAGED CHANGES</span>
        </div>
        <Show when={hasStaged() && props.onClearAll}>
          <button
            type="button"
            class="text-muted-foreground hover:text-destructive text-[10px]"
            onClick={() => {
              props.onClearAll?.()
            }}
          >
            Clear all
          </button>
        </Show>
      </div>

      <Show
        when={hasStaged()}
        fallback={
          <div class="px-2 py-3 text-muted-foreground text-center text-[10px] h-full">
            No pending trades. Edit weights or adjust leverage to stage trades.
          </div>
        }
      >
        <div class="overflow-auto scrollbar-hide h-full">
          <For each={stagedTrades()}>
            {stagedTrade => {
              const baseSymbol = stagedTrade.underlying.split("/")[0] || "???"
              const orderError = stagedTrade.orderError

              const prevWeight = stagedTrade.previousWeight ?? 0
              const nextWeight = stagedTrade.newWeight ?? prevWeight
              const weightDelta = nextWeight - prevWeight

              const arrow = weightDelta > 0 ? "↑" : weightDelta < 0 ? "↓" : "→"
              const deltaClass =
                weightDelta > 0
                  ? "text-emerald-500"
                  : weightDelta < 0
                    ? "text-rose-500"
                    : "text-muted-foreground"

              return (
                <div class="border-b border-border/30">
                  <div class={cn(STAGED_ROW_GRID_TEMPLATE)}>
                    <span
                      class={cn(
                        "text-[10px] font-medium px-1 py-0.5 rounded w-[5ch] text-center",
                        stagedTrade.side === "buy"
                          ? "bg-green-500/20 text-green-500"
                          : "bg-red-500/20 text-red-500",
                      )}
                    >
                      {stagedTrade.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span
                      class={cn(
                        "px-1 truncate font-medium text-[11px] text-left",
                        orderError && "text-destructive",
                      )}
                    >
                      {baseSymbol}
                    </span>
                    <div
                      class={cn(
                        "font-mono mr-2 justify-self-center grid grid-cols-[max-content_2ch_max-content] items-baseline gap-x-1",
                        deltaClass,
                      )}
                    >
                      <span class="w-[6ch] text-right">
                        {formatUnsignedPct(prevWeight)}
                      </span>
                      <span class="w-[2ch] text-center">{arrow}</span>
                      <span class="w-[6ch] text-right">
                        {formatUnsignedPct(nextWeight)}
                      </span>
                    </div>
                    <span class="font-mono text-muted-foreground justify-self-end w-full text-right">
                      {formatUsdPrecise(stagedTrade.notional)}
                    </span>
                  </div>
                  <Show when={orderError}>
                    <p
                      role="alert"
                      class="px-2 pb-1.5 text-[10px] leading-snug text-destructive"
                    >
                      {orderError}
                    </p>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>

      {/* Impact preview + primary rebalance action pinned to bottom */}
      <div class="px-2 py-1.5 border-t border-border/30 bg-muted/20 space-y-2">
        <div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
            <div class="flex justify-between flex-col">
              <span class="text-muted-foreground">Notional</span>
              <span class="font-mono">
                <Show
                  when={shouldShowNotionalArrow()}
                  fallback={formatUsdPrecise(targetTotalNotional())}
                >
                  {formatUsdPrecise(currentTotalNotional())}{" "}
                  <span class="text-muted-foreground">→</span>{" "}
                  <span
                    class={
                      targetTotalNotional() >= currentTotalNotional()
                        ? "text-green-500"
                        : "text-red-500"
                    }
                  >
                    {formatUsdPrecise(targetTotalNotional())}
                  </span>
                </Show>
              </span>
            </div>
            <div class="flex justify-between flex-col">
              <span class="text-muted-foreground">Leverage</span>
              <span class="font-mono">
                <Show
                  when={shouldShowLeverageArrow()}
                  fallback={`${targetLeverage().toFixed(2)}x`}
                >
                  {currentLeverage().toFixed(2)}x{" "}
                  <span class="text-muted-foreground">→</span>{" "}
                  <span class="text-yellow-500">
                    {targetLeverage().toFixed(2)}x
                  </span>
                </Show>
              </span>
            </div>
          </div>
        </div>
        <Button
          size="sm"
          class="w-full h-8 text-[11px] gap-1"
          onClick={() => {
            if (
              !props.onRebalance ||
              !hasStaged() ||
              isRebalanceButtonDisabled() ||
              isRebalancing()
            ) {
              return
            }
            props.onRebalance()
          }}
          disabled={
            // !props.onRebalance ||
            isRebalanceButtonDisabled()
            // ||
            // isRebalancing() ||
            // !hasStaged()
          }
          aria-disabled={
            // !props.onRebalance ||
            isRebalanceButtonDisabled()
            // ||
            // isRebalancing() ||
            // !hasStaged()
          }
        >
          <Send class="h-3 w-3" />
          {isRebalancing() ? "Sending..." : "Rebalance"}
        </Button>
      </div>
    </div>
  )
}
