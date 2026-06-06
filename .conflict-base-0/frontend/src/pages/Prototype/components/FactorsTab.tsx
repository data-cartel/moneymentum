import {
  createSignal,
  createEffect,
  createMemo,
  Show,
  For,
  onCleanup,
  untrack,
} from "solid-js"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import { createChart, LineSeries, type Time } from "lightweight-charts"
import type {
  FactorExposure,
  FactorHistoricalReturn,
  FactorAttribution,
} from "../mockData"
import { CHART_COLORS } from "../colors"

type ViewMode = "exposures" | "performance" | "attribution"

interface FactorsTabProps {
  factorExposures: FactorExposure[]
  factorHistoricalReturns: FactorHistoricalReturn[]
  factorAttribution: FactorAttribution[]
}

const FACTOR_CHART_COLORS: Record<string, string> = {
  "Market Beta": CHART_COLORS.factorBtcBeta,
  "Momentum": CHART_COLORS.factorSpyBeta,
  "Carry": CHART_COLORS.factorMomentum,
  "Volatility": CHART_COLORS.factorCarry,
  "Size": CHART_COLORS.factorVolatility,
}

export const FactorsTab = (props: FactorsTabProps) => {
  let chartRef: HTMLDivElement | undefined
  const [viewMode, setViewMode] = createSignal<ViewMode>("exposures")
  const availableFactors = createMemo(() =>
    Array.from(new Set(props.factorExposures.map(exposure => exposure.name))),
  )

  const [selectedFactors, setSelectedFactors] = createSignal<string[]>(
    untrack(() => availableFactors().slice(0, 2)),
  )
  const [simulationFactor, setSimulationFactor] = createSignal<string | null>(
    null,
  )
  const simulationAmount = 10

  const toggleFactor = (factor: string) => {
    setSelectedFactors(prev => {
      if (prev.includes(factor)) {
        return prev.filter(selectedFactor => selectedFactor !== factor)
      }
      if (prev.length >= 2) {
        return [prev[1], factor]
      }
      return [...prev, factor]
    })
  }

  createEffect(() => {
    const container = chartRef
    if (!container || viewMode() !== "performance") return

    const factors = selectedFactors()

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { color: "transparent" }, textColor: "#888" },
      grid: { vertLines: { color: "#222" }, horzLines: { color: "#222" } },
      timeScale: { borderColor: "#333", timeVisible: false },
      rightPriceScale: { borderColor: "#333" },
      crosshair: { mode: 0 },
    })

    for (const factor of factors) {
      const factorData = props.factorHistoricalReturns.filter(
        r => r.factor === factor,
      )
      const series = chart.addSeries(LineSeries, {
        color: FACTOR_CHART_COLORS[factor] ?? "#888",
        lineWidth: 2,
        title: factor,
      })
      series.setData(
        factorData.map(d => ({ time: d.date as Time, value: d.value })),
      )
    }

    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    resizeObserver.observe(container)

    onCleanup(() => {
      resizeObserver.disconnect()
      chart.remove()
    })
  })

  const totalContribution = () =>
    props.factorAttribution.reduce((sum, f) => sum + f.contribution, 0)

  const absoluteTotal = createMemo(() =>
    props.factorAttribution.reduce(
      (sum, f) => sum + Math.abs(f.contribution),
      0,
    ),
  )

  const simulatedExposures = createMemo(() => {
    const simFactor = simulationFactor()
    if (!simFactor) return props.factorExposures
    return props.factorExposures.map(f => ({
      ...f,
      value: f.name === simFactor ? f.value + simulationAmount / 100 : f.value,
    }))
  })

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center justify-between px-2 py-1 border-b border-border/50 shrink-0">
        <div class="flex gap-1">
          <For each={["exposures", "performance", "attribution"] as const}>
            {mode => (
              <button
                type="button"
                onClick={() => {
                  setViewMode(mode)
                }}
                class={twMerge(
                  clsx(
                    "px-2 py-0.5 text-[9px] rounded transition-colors capitalize",
                    viewMode() === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  ),
                )}
              >
                {mode}
              </button>
            )}
          </For>
        </div>
        <Show when={viewMode() === "exposures"}>
          <div class="flex items-center gap-1">
            <span class="text-[9px] text-muted-foreground">Simulate:</span>
            <select
              value={simulationFactor() ?? ""}
              onInput={e => {
                setSimulationFactor(e.currentTarget.value || null)
              }}
              class="text-[9px] bg-muted border border-border rounded px-1 py-0.5"
            >
              <option value="">None</option>
              <For each={availableFactors()}>
                {f => (
                  <option value={f}>
                    +{simulationAmount}% {f}
                  </option>
                )}
              </For>
            </select>
          </div>
        </Show>
      </div>

      <Show when={viewMode() === "exposures"}>
        <div class="flex-1 overflow-auto p-2">
          <div class="space-y-2">
            <For each={simulatedExposures()}>
              {f => {
                const original = () =>
                  props.factorExposures.find(e => e.name === f.name)
                const delta = () => {
                  const orig = original()
                  return orig ? f.value - orig.value : 0
                }
                return (
                  <div class="flex items-center gap-2">
                    <span class="w-20 text-[10px] text-muted-foreground truncate">
                      {f.name}
                    </span>
                    <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden relative">
                      <div class="absolute left-1/2 w-px h-full bg-border" />
                      <div
                        class={twMerge(
                          clsx(
                            "absolute h-full rounded-full transition-all",
                            f.value >= 0
                              ? "left-1/2 bg-green-500"
                              : "right-1/2 bg-red-500",
                          ),
                        )}
                        style={{
                          width: `${Math.min(Math.abs(f.value) * 50, 50)}%`,
                        }}
                      />
                    </div>
                    <span class="w-12 text-right font-mono text-[10px]">
                      {f.value >= 0 ? "+" : ""}
                      {f.value.toFixed(2)}
                    </span>
                    <Show when={delta() !== 0}>
                      <span class="w-10 text-right font-mono text-[9px] text-blue-400">
                        ({delta() >= 0 ? "+" : ""}
                        {delta().toFixed(2)})
                      </span>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
          <Show when={simulationFactor()}>
            <div class="mt-3 p-2 bg-muted/30 rounded border border-border/50">
              <div class="text-[9px] text-muted-foreground mb-1">
                Projected Impact
              </div>
              <div class="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span class="text-muted-foreground">&#916; Sharpe:</span>
                  <span class="text-green-400 ml-1">+0.08</span>
                </div>
                <div>
                  <span class="text-muted-foreground">&#916; Return:</span>
                  <span class="text-green-400 ml-1">+1.2%</span>
                </div>
                <div>
                  <span class="text-muted-foreground">&#916; Vol:</span>
                  <span class="text-red-400 ml-1">+0.5%</span>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={viewMode() === "performance"}>
        <div class="flex-1 flex flex-col">
          <div class="flex gap-1 px-2 py-1 border-b border-border/30 flex-wrap">
            <For each={availableFactors()}>
              {factor => (
                <button
                  type="button"
                  onClick={() => {
                    toggleFactor(factor)
                  }}
                  class={twMerge(
                    clsx(
                      "px-1.5 py-0.5 text-[9px] rounded transition-colors",
                      selectedFactors().includes(factor)
                        ? "text-white"
                        : "text-muted-foreground hover:bg-muted",
                    ),
                  )}
                  style={{
                    "background-color": selectedFactors().includes(factor)
                      ? FACTOR_CHART_COLORS[factor]
                      : undefined,
                  }}
                >
                  {factor.replace("Market ", "")}
                </button>
              )}
            </For>
          </div>
          <div ref={chartRef} class="flex-1 min-h-[120px]" />
        </div>
      </Show>

      <Show when={viewMode() === "attribution"}>
        <div class="flex-1 overflow-auto p-2">
          <div class="space-y-1.5">
            <For each={props.factorAttribution}>
              {f => {
                const pctOfTotal = () => {
                  const absTotal = absoluteTotal()
                  return absTotal === 0
                    ? 0
                    : (Math.abs(f.contribution) / absTotal) * 100
                }
                return (
                  <div class="flex items-center gap-2">
                    <span class="w-24 text-[10px] text-muted-foreground truncate">
                      {f.factor}
                    </span>
                    <div class="flex-1 h-3 bg-muted rounded overflow-hidden">
                      <div
                        class="h-full rounded transition-all"
                        style={{
                          "width": `${Math.abs(pctOfTotal())}%`,
                          "background-color": f.color,
                          "opacity": f.contribution >= 0 ? 1 : 0.5,
                        }}
                      />
                    </div>
                    <span
                      class={twMerge(
                        clsx(
                          "w-14 text-right font-mono text-[10px]",
                          f.contribution >= 0
                            ? "text-green-500"
                            : "text-red-500",
                        ),
                      )}
                    >
                      {f.contribution >= 0 ? "+" : ""}
                      {(f.contribution * 100).toFixed(1)}%
                    </span>
                  </div>
                )
              }}
            </For>
          </div>
          <div class="mt-3 pt-2 border-t border-border/50 flex justify-between text-[10px]">
            <span class="text-muted-foreground">Total Return Explained</span>
            <span
              class={twMerge(
                clsx(
                  "font-mono",
                  totalContribution() >= 0 ? "text-green-500" : "text-red-500",
                ),
              )}
            >
              {totalContribution() >= 0 ? "+" : ""}
              {(totalContribution() * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </Show>
    </div>
  )
}
