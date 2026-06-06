import { createSignal, createEffect, Show, For, onCleanup } from "solid-js"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import {
  createChart,
  AreaSeries,
  HistogramSeries,
  type Time,
} from "lightweight-charts"
import type {
  BacktestPoint,
  DrawdownPoint,
  ReturnDistributionBucket,
  PerformanceStats,
} from "../mockData"

type ChartType = "equity" | "drawdown" | "distribution"
type Period = "1M" | "3M" | "6M" | "1Y" | "All"
type ComparisonMode = "current" | "target" | "compare"

const CHART_TYPES: ChartType[] = ["equity", "drawdown", "distribution"]
const PERIODS: Period[] = ["1M", "3M", "6M", "1Y", "All"]
const COMPARISON_MODES: ComparisonMode[] = ["current", "target", "compare"]

interface PerformanceTabProps {
  backtestData: BacktestPoint[]
  drawdownData: DrawdownPoint[]
  returnDistribution: ReturnDistributionBucket[]
  performanceStats: PerformanceStats
  hasStagedTrades: boolean
  isFocused?: boolean
}

const formatPct = (n: number): string =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`

const PERIOD_DAYS: Record<Period, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "All": Infinity,
}

export const PerformanceTab = (props: PerformanceTabProps) => {
  let chartRef: HTMLDivElement | undefined
  let containerRef: HTMLDivElement | undefined
  const [chartType, setChartType] = createSignal<ChartType>("equity")
  const [period, setPeriod] = createSignal<Period>("All")
  const [comparisonMode, setComparisonMode] =
    createSignal<ComparisonMode>("current")

  createEffect(() => {
    const isFocused = props.isFocused ?? false
    if (!isFocused) return

    const currentPeriod = period()
    const currentComparisonMode = comparisonMode()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key >= "1" && event.key <= "3") {
        const index = parseInt(event.key) - 1
        if (index < CHART_TYPES.length) {
          setChartType(CHART_TYPES[index])
        }
        return
      }

      // q/w/e for periods (first 3), r/t for last 2
      const periodKeyMap: Record<string, number> = {
        q: 0, // 1M
        w: 1, // 3M
        e: 2, // 6M
        r: 3, // 1Y
        t: 4, // All
      }
      if (event.key in periodKeyMap) {
        setPeriod(PERIODS[periodKeyMap[event.key]])
        return
      }

      if (event.key === "ArrowLeft" || event.key === "h") {
        const currentIndex = PERIODS.indexOf(currentPeriod)
        if (currentIndex > 0) {
          setPeriod(PERIODS[currentIndex - 1])
        }
        return
      }
      if (event.key === "ArrowRight" || event.key === "l") {
        const currentIndex = PERIODS.indexOf(currentPeriod)
        if (currentIndex < PERIODS.length - 1) {
          setPeriod(PERIODS[currentIndex + 1])
        }
        return
      }

      if (event.key === "c" && props.hasStagedTrades) {
        const currentIndex = COMPARISON_MODES.indexOf(currentComparisonMode)
        const nextIndex = (currentIndex + 1) % COMPARISON_MODES.length
        setComparisonMode(COMPARISON_MODES[nextIndex])
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  createEffect(() => {
    const container = chartRef
    if (!container) return

    const currentChartType = chartType()
    const currentPeriod = period()

    const filterDataByPeriod = <T extends { time: number }>(data: T[]): T[] => {
      if (currentPeriod === "All" || data.length === 0) return data
      const maxTime = Math.max(...data.map(d => d.time))
      const cutoff = maxTime - PERIOD_DAYS[currentPeriod] * 24 * 60 * 60
      return data.filter(d => d.time >= cutoff)
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { color: "transparent" }, textColor: "#888" },
      grid: { vertLines: { color: "#222" }, horzLines: { color: "#222" } },
      timeScale: { borderColor: "#333", timeVisible: false },
      rightPriceScale: { borderColor: "#333" },
      crosshair: { mode: 0 },
    })

    if (currentChartType === "equity") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#22c55e",
        topColor: "rgba(34, 197, 94, 0.3)",
        bottomColor: "rgba(34, 197, 94, 0)",
        lineWidth: 1,
      })
      const filteredData = filterDataByPeriod(props.backtestData)
      series.setData(
        filteredData.map(d => ({ time: d.time as Time, value: d.value })),
      )
    } else if (currentChartType === "drawdown") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#ef4444",
        topColor: "rgba(239, 68, 68, 0)",
        bottomColor: "rgba(239, 68, 68, 0.3)",
        lineWidth: 1,
      })
      const filteredData = filterDataByPeriod(props.drawdownData)
      series.setData(
        filteredData.map(d => ({ time: d.time as Time, value: d.drawdown })),
      )
    } else {
      const series = chart.addSeries(HistogramSeries, {
        color: "#22c55e",
      })
      series.setData(
        props.returnDistribution.map((d, i) => ({
          time: i as unknown as Time,
          value: d.frequency,
          color: d.bucket >= 0 ? "#22c55e" : "#ef4444",
        })),
      )
      chart.timeScale().applyOptions({ visible: false })
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

  const targetStats = (): PerformanceStats => ({
    totalReturn: props.performanceStats.totalReturn * 1.08,
    sharpeRatio: props.performanceStats.sharpeRatio * 1.05,
    maxDrawdown: props.performanceStats.maxDrawdown * 0.92,
    sortinoRatio: props.performanceStats.sortinoRatio * 1.06,
    winRate: props.performanceStats.winRate + 0.02,
    profitFactor: props.performanceStats.profitFactor * 1.04,
  })

  const displayStats = () =>
    comparisonMode() === "target" ? targetStats() : props.performanceStats
  const calmar = () =>
    Math.abs(displayStats().totalReturn / displayStats().maxDrawdown)

  const isFocused = () => props.isFocused ?? false

  return (
    <div
      ref={containerRef}
      class={twMerge(
        clsx(
          "flex flex-col h-full",
          isFocused() && "ring-1 ring-primary/50 ring-inset",
        ),
      )}
      data-testid="performance-tab"
    >
      <div class="flex items-center justify-between px-2 py-1 border-b border-border/50 shrink-0">
        <div class="flex gap-1">
          <For each={CHART_TYPES}>
            {(type, index) => (
              <button
                type="button"
                onClick={() => {
                  setChartType(type)
                }}
                class={twMerge(
                  clsx(
                    "px-2 py-0.5 text-[9px] rounded transition-colors",
                    chartType() === type
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  ),
                )}
              >
                <Show when={isFocused()}>
                  <span class="text-[8px] opacity-60 mr-0.5">
                    {index() + 1}
                  </span>
                </Show>
                {type === "equity"
                  ? "Equity"
                  : type === "drawdown"
                    ? "Drawdown"
                    : "Distribution"}
              </button>
            )}
          </For>
        </div>
        <div class="flex gap-1">
          <Show when={isFocused()}>
            <span class="text-[8px] text-muted-foreground self-center mr-0.5">
              &#8592;&#8594;
            </span>
          </Show>
          <For each={PERIODS}>
            {p => (
              <button
                type="button"
                onClick={() => {
                  setPeriod(p)
                }}
                class={twMerge(
                  clsx(
                    "px-1.5 py-0.5 text-[9px] rounded transition-colors",
                    period() === p
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  ),
                )}
              >
                {p}
              </button>
            )}
          </For>
        </div>
      </div>

      <div ref={chartRef} class="flex-1 min-h-[120px]" />

      <div class="grid grid-cols-7 gap-x-2 gap-y-1 p-2 border-t border-border/50 shrink-0">
        <div>
          <div class="text-muted-foreground text-[9px]">Return</div>
          <div
            class={twMerge(
              clsx(
                "font-mono text-[11px]",
                displayStats().totalReturn >= 0
                  ? "text-green-500"
                  : "text-red-500",
              ),
            )}
          >
            {formatPct(displayStats().totalReturn)}
            <Show when={comparisonMode() === "compare"}>
              <span class="text-[8px] text-green-400 ml-0.5">
                +
                {(
                  (targetStats().totalReturn -
                    props.performanceStats.totalReturn) *
                  100
                ).toFixed(1)}
              </span>
            </Show>
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[9px]">Sharpe</div>
          <div class="font-mono text-[11px]">
            {displayStats().sharpeRatio.toFixed(2)}
            <Show when={comparisonMode() === "compare"}>
              <span class="text-[8px] text-green-400 ml-0.5">
                +
                {(
                  targetStats().sharpeRatio - props.performanceStats.sharpeRatio
                ).toFixed(2)}
              </span>
            </Show>
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[9px]">Sortino</div>
          <div class="font-mono text-[11px]">
            {displayStats().sortinoRatio.toFixed(2)}
            <Show when={comparisonMode() === "compare"}>
              <span class="text-[8px] text-green-400 ml-0.5">
                +
                {(
                  targetStats().sortinoRatio -
                  props.performanceStats.sortinoRatio
                ).toFixed(2)}
              </span>
            </Show>
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[9px]">Max DD</div>
          <div class="font-mono text-[11px] text-red-400">
            {formatPct(displayStats().maxDrawdown)}
            <Show when={comparisonMode() === "compare"}>
              <span class="text-[8px] text-green-400 ml-0.5">
                {(
                  (targetStats().maxDrawdown -
                    props.performanceStats.maxDrawdown) *
                  100
                ).toFixed(1)}
              </span>
            </Show>
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[9px]">Win Rate</div>
          <div class="font-mono text-[11px]">
            {(displayStats().winRate * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[9px]">Profit</div>
          <div class="font-mono text-[11px]">
            {displayStats().profitFactor.toFixed(2)}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[9px]">Calmar</div>
          <div class="font-mono text-[11px]">{calmar().toFixed(2)}</div>
        </div>
      </div>

      <Show when={props.hasStagedTrades}>
        <div class="flex gap-1 px-2 py-1 border-t border-border/50 shrink-0">
          <Show when={isFocused()}>
            <span class="text-[8px] text-muted-foreground self-center mr-0.5">
              c
            </span>
          </Show>
          <For each={COMPARISON_MODES}>
            {mode => (
              <button
                type="button"
                onClick={() => {
                  setComparisonMode(mode)
                }}
                class={twMerge(
                  clsx(
                    "px-2 py-0.5 text-[9px] rounded transition-colors capitalize",
                    comparisonMode() === mode
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
      </Show>
    </div>
  )
}
