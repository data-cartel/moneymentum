import { createMemo, Show, For } from "solid-js"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import { Send } from "lucide-solid"
import { Button } from "@/components/ui/button"
import { LeverageControl } from "./LeverageControl"
import { formatUsd, formatPct } from "../utils/formatters"
import { computeProjectedExposures } from "../utils/portfolio"
import type { ComputedTrade } from "../mockData"
import type { PositionsByUnderlying } from "../hooks/usePrototypeData"

interface AssetFactors {
  ticker: string
  beta: number
  momentum?: number
  volatility?: number
  spyBeta?: number
  carry?: number
}

interface StagedTradesPanelProps {
  stagedTrades: ComputedTrade[]
  leverage: number
  effectiveLeverage: number
  nav: number
  positions: PositionsByUnderlying[]
  assetFactors: AssetFactors[]
  isFocused?: boolean
  onLeverageChange: (value: number) => void
  onRemoveTrade?: (id: string) => void
  onClearAll: () => void
  onExecute: () => void
}

export const StagedTradesPanel = (props: StagedTradesPanelProps) => {
  const hasStaged = () => props.stagedTrades.length > 0

  const legacyStagedTrades = createMemo(() =>
    props.stagedTrades.map(t => ({
      id: t.id,
      symbol: t.underlying,
      side: t.side,
      notional: t.notional,
      leverage: 1,
    })),
  )

  const projected = createMemo(() =>
    computeProjectedExposures({
      positions: props.positions,
      stagedTrades: legacyStagedTrades(),
      nav: props.nav,
      leverage: props.leverage,
      assetFactors: props.assetFactors,
    }),
  )

  const significantWeightChanges = createMemo(() => {
    return Object.entries(projected().weightChanges)
      .filter(
        ([, change]) => Math.abs(change.projected - change.current) > 0.005,
      )
      .sort(
        (a, b) =>
          Math.abs(b[1].projected - b[1].current) -
          Math.abs(a[1].projected - a[1].current),
      )
      .slice(0, 4)
  })

  return (
    <div
      class={twMerge(
        clsx(
          "border-t border-border shrink-0",
          (props.isFocused ?? false) && "ring-1 ring-primary/50 bg-primary/5",
        ),
      )}
    >
      <div class="px-2 py-1.5 bg-muted/30 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="font-medium">STAGED CHANGES</span>
          <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
            4
          </kbd>
        </div>
        <Show when={hasStaged()}>
          <button
            class="text-muted-foreground hover:text-destructive"
            onClick={e => {
              e.stopPropagation()
              props.onClearAll()
            }}
          >
            Clear all
          </button>
        </Show>
      </div>

      <LeverageControl
        leverage={props.leverage}
        effectiveLeverage={props.effectiveLeverage}
        onLeverageChange={props.onLeverageChange}
        isActive={props.isFocused}
      />

      <Show
        when={hasStaged()}
        fallback={
          <div class="px-2 py-3 text-muted-foreground text-center text-[10px]">
            No pending trades. Edit weights or adjust leverage to stage trades.
          </div>
        }
      >
        <div class="max-h-[200px] overflow-auto scrollbar-hide">
          <For each={props.stagedTrades}>
            {t => {
              return (
                <div class="flex items-center px-2 py-1.5 border-b border-border/30">
                  <span
                    class={twMerge(
                      clsx(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded",
                        t.side === "buy"
                          ? "bg-green-500/20 text-green-500"
                          : "bg-red-500/20 text-red-500",
                      ),
                    )}
                  >
                    {t.side === "buy" ? "BUY" : "SELL"}
                  </span>
                  <span class="flex-1 px-2 truncate font-medium">
                    {t.underlying}
                  </span>
                  <Show
                    when={
                      t.previousWeight !== undefined &&
                      t.newWeight !== undefined
                    }
                  >
                    <span class="text-[9px] text-muted-foreground font-mono mr-2">
                      {formatPct(t.previousWeight ?? 0)} -&gt;{" "}
                      {formatPct(t.newWeight ?? 0)}
                    </span>
                  </Show>
                  <span class="text-muted-foreground font-mono">
                    {formatUsd(t.notional)}
                  </span>
                </div>
              )
            }}
          </For>

          {/* Exposure Impact Preview */}
          <div class="px-2 py-1.5 border-b border-border/30 bg-muted/20">
            <div class="text-[10px] text-muted-foreground font-medium mb-1">
              IMPACT PREVIEW
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Notional</span>
                <span class="font-mono">
                  {formatUsd(projected().currentNotional)} -&gt;{" "}
                  <span
                    class={
                      projected().notionalChange >= 0
                        ? "text-green-500"
                        : "text-red-500"
                    }
                  >
                    {formatUsd(projected().projectedNotional)}
                  </span>
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Leverage</span>
                <span class="font-mono">
                  {projected().currentEffectiveLeverage.toFixed(2)}x -&gt;{" "}
                  <span
                    class={
                      projected().effectiveLeverageChange >= 0
                        ? "text-yellow-500"
                        : "text-blue-500"
                    }
                  >
                    {projected().projectedEffectiveLeverage.toFixed(2)}x
                  </span>
                </span>
              </div>
            </div>
            {/* Factor Exposures */}
            <div class="mt-1.5 pt-1 border-t border-border/20">
              <div class="text-[9px] text-muted-foreground mb-0.5">
                Factor Exposures
              </div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">&#946; BTC</span>
                  <span class="font-mono">
                    {projected().factorChanges.btcBeta.current.toFixed(2)} -&gt;{" "}
                    <span
                      class={
                        Math.abs(projected().factorChanges.btcBeta.delta) > 0.01
                          ? projected().factorChanges.btcBeta.delta > 0
                            ? "text-green-500"
                            : "text-red-500"
                          : "text-muted-foreground"
                      }
                    >
                      {projected().factorChanges.btcBeta.projected.toFixed(2)}
                    </span>
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">&#946; SPY</span>
                  <span class="font-mono">
                    {projected().factorChanges.spyBeta.current.toFixed(2)} -&gt;{" "}
                    <span
                      class={
                        Math.abs(projected().factorChanges.spyBeta.delta) > 0.01
                          ? projected().factorChanges.spyBeta.delta > 0
                            ? "text-green-500"
                            : "text-red-500"
                          : "text-muted-foreground"
                      }
                    >
                      {projected().factorChanges.spyBeta.projected.toFixed(2)}
                    </span>
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Momentum</span>
                  <span class="font-mono">
                    {projected().factorChanges.momentum.current.toFixed(2)}{" "}
                    -&gt;{" "}
                    <span
                      class={
                        Math.abs(projected().factorChanges.momentum.delta) >
                        0.01
                          ? projected().factorChanges.momentum.delta > 0
                            ? "text-green-500"
                            : "text-red-500"
                          : "text-muted-foreground"
                      }
                    >
                      {projected().factorChanges.momentum.projected.toFixed(2)}
                    </span>
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Volatility</span>
                  <span class="font-mono">
                    {projected().factorChanges.volatility.current.toFixed(2)}{" "}
                    -&gt;{" "}
                    <span
                      class={
                        Math.abs(projected().factorChanges.volatility.delta) >
                        0.01
                          ? projected().factorChanges.volatility.delta > 0
                            ? "text-yellow-500"
                            : "text-blue-500"
                          : "text-muted-foreground"
                      }
                    >
                      {projected().factorChanges.volatility.projected.toFixed(
                        2,
                      )}
                    </span>
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Carry</span>
                  <span class="font-mono">
                    {formatPct(projected().factorChanges.carry.current)} -&gt;{" "}
                    <span
                      class={
                        Math.abs(projected().factorChanges.carry.delta) > 0.001
                          ? projected().factorChanges.carry.delta > 0
                            ? "text-green-500"
                            : "text-red-500"
                          : "text-muted-foreground"
                      }
                    >
                      {formatPct(projected().factorChanges.carry.projected)}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <Show when={significantWeightChanges().length > 0}>
              <div class="mt-1 pt-1 border-t border-border/20">
                <div class="text-[9px] text-muted-foreground mb-0.5">
                  Weight &#916;
                </div>
                <div class="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
                  <For each={significantWeightChanges()}>
                    {([symbol, change]) => (
                      <span class="font-mono">
                        {symbol}{" "}
                        <span
                          class={
                            change.projected > change.current
                              ? "text-green-500"
                              : "text-red-500"
                          }
                        >
                          {formatPct(change.current)} -&gt;{" "}
                          {formatPct(change.projected)}
                        </span>
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          <div class="p-2">
            <Button size="sm" class="w-full h-7" onClick={props.onExecute}>
              <Send class="h-3 w-3 mr-1.5" />
              Execute {props.stagedTrades.length} trade
              {props.stagedTrades.length > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}
