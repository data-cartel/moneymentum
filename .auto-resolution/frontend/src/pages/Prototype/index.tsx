import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  For,
  Show,
} from "solid-js"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import {
  Search,
  ChevronDown,
  ChevronRight,
  Settings,
  Columns2,
} from "lucide-solid"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HelpOverlay } from "./components/HelpOverlay"
import { StagedTradesPanel } from "./components/StagedTradesPanel"
import { FactorConfigPanel } from "./components/FactorConfigPanel"
import { EditableCell } from "./components/EditableCell"
import { AddPositionModal } from "./components/AddPositionModal"
import type { FactorExposure } from "./mockData"
import { MOCK_INSTRUMENT_COSTS, getInstrumentsForAsset } from "./mockData"
import { usePrototypeData } from "./hooks/usePrototypeData"
import { useListSelection } from "./hooks/useListSelection"
import { getDirection } from "./utils/keys"
import {
  useScreenerConfig,
  SCREENER_COLUMN_LABELS,
  ALL_SCREENER_COLUMNS,
} from "./hooks/useScreenerConfig"
import { MetricSelector } from "./components/MetricSelector"
import { getMetricById, WINDOW_OPTIONS } from "./metrics/registry"
import { formatNum, formatPct, formatUsd } from "./utils/formatters"
import {
  aggregateGreeks,
  calculateTotalNotional,
  calculateGroupNotional,
  calculateNetSide,
  calculatePositionWeight,
  lookupCorrelation,
  getCorrelationColor,
  calculateTotalAttribution,
  FACTOR_COLORS,
} from "./utils/portfolio"
import {
  createChart,
  AreaSeries,
  HistogramSeries,
  LineSeries,
  type Time,
} from "lightweight-charts"

type SecondaryFocus = "performance" | "staged" | "none"

const PrototypePage = () => {
  const data = usePrototypeData()
  const [showHelp, setShowHelp] = createSignal(false)
  // Single-instrument underlyings start collapsed, multi-instrument start expanded
  const [collapsedUnderlyings, setCollapsedUnderlyings] = createSignal<
    Set<string>
  >(
    new Set(
      data
        .positionsByUnderlying()
        .filter(group => group.positions.length === 1)
        .map(group => group.underlying),
    ),
  )
  const [selectedMetricIds, setSelectedMetricIds] = createSignal<string[]>([
    "equity",
  ])
  const [selectedWindowId, setSelectedWindowId] = createSignal("30d")
  const [isMetricSelectorOpen, setIsMetricSelectorOpen] = createSignal(false)
  const [showFactorConfig, setShowFactorConfig] = createSignal(false)
  const [customFactors, setCustomFactors] = createSignal<
    FactorExposure[] | null
  >(null)
  const [addPositionModal, setAddPositionModal] = createSignal<{
    isOpen: boolean
    underlying: string | null
  }>({ isOpen: false, underlying: null })
  const [columnConfigVisible, setColumnConfigVisible] = createSignal(false)
  const closeColumnConfig = () => {
    setColumnConfigVisible(false)
  }
  const toggleColumnConfig = () => {
    setColumnConfigVisible(prev => !prev)
  }
  const [secondaryFocus, setSecondaryFocus] =
    createSignal<SecondaryFocus>("none")
  let performanceChartRef: HTMLDivElement | undefined

  const {
    positionsByUnderlying,
    greeks,
    factorExposures: defaultFactorExposures,
    assetAnalysis,
    isLoading,
    leverage,
    setLeverage,
    effectiveLeverage,
    stagedTrades,
    addStagedTrade,
    removeStagedTrade,
    clearStagedTrades,
    executeStagedTrades,
    updateInstrumentWeight,
    updateInstrumentNotional,
    riskMetrics,
    stressTests,
    monteCarloData,
    backtestData,
    performanceStats,
    factorAttribution,
    concentrationMetrics,
    correlationMatrix,
    correlationAssets,
  } = data

  const factorExposures = createMemo(
    () => customFactors() ?? defaultFactorExposures,
  )

  const screenerConfig = useScreenerConfig({ assets: () => assetAnalysis })
  const {
    sortColumn,
    sortDirection,
    setSortColumn,
    searchQuery,
    setSearchQuery,
    sortedAssets,
    visibleColumns,
    toggleColumn,
    isExpanded: isScreenerExpanded,
    toggleExpanded: toggleScreenerExpanded,
  } = screenerConfig

  // Prepare items for keyboard selection
  const screenerItems = createMemo(() =>
    assetAnalysis.map(a => ({ symbol: a.ticker })),
  )

  // Extract asset factors for staged trades impact preview
  const assetFactors = createMemo(() =>
    assetAnalysis.map(a => ({
      ticker: a.ticker,
      beta: a.beta,
      momentum: a.momentum,
      volatility: a.volatility,
      spyBeta: a.beta * 0.4, // Approximate SPY beta from BTC beta
      carry: 0, // Would come from funding rates, approximated here
    })),
  )
  const positionItems = createMemo(() =>
    positionsByUnderlying().map(p => ({
      underlying: p.underlying,
      instruments: p.positions.map(pos => ({ symbol: pos.symbol })),
    })),
  )

  const listSelection = useListSelection({
    screenerItems,
    positionItems,
    onAddTrade: addStagedTrade,
    onAdjustWeight: data.adjustPositionWeight,
  })

  const {
    focusedPanel,
    focusPanel,
    getSelectedIndex,
    moveSelection,
    triggerTrade,
    handleEscape,
    toggleExpand,
    getSelectedInstrument,
    getSelectedSymbol,
    adjustWeight,
  } = listSelection

  // Compute chart data using metric registry
  const selectedMetrics = createMemo(() =>
    selectedMetricIds()
      .map(id => getMetricById(id))
      .filter(Boolean),
  )
  const selectedWindow = createMemo(() =>
    WINDOW_OPTIONS.find(w => w.id === selectedWindowId()),
  )

  type ChartPoint = { time: number; value: number }
  const chartDataByMetric = createMemo((): Map<string, ChartPoint[]> => {
    if (!backtestData.length) return new Map<string, ChartPoint[]>()

    const inputData = backtestData.map(d => ({ time: d.time, value: d.value }))
    const windowDays = selectedWindow()?.days ?? 30
    const result = new Map<string, ChartPoint[]>()

    for (const metric of selectedMetrics()) {
      if (metric) {
        result.set(metric.id, metric.compute(inputData, windowDays))
      }
    }
    return result
  })

  // createEffect justified: LightweightCharts requires imperative DOM manipulation
  // and cleanup. No Solid wrapper exists that provides equivalent functionality.
  createEffect(() => {
    const container = performanceChartRef
    const metrics = selectedMetrics()
    const chartData = chartDataByMetric()
    if (!container || !metrics.length) return

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { color: "transparent" }, textColor: "#888" },
      grid: { vertLines: { color: "#222" }, horzLines: { color: "#222" } },
      timeScale: { borderColor: "#333", timeVisible: false },
      rightPriceScale: { borderColor: "#333" },
      crosshair: { mode: 0 },
    })

    const hexToRgba = (hex: string, alpha: number) => {
      const red = parseInt(hex.slice(1, 3), 16)
      const green = parseInt(hex.slice(3, 5), 16)
      const blue = parseInt(hex.slice(5, 7), 16)
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`
    }

    for (const metric of metrics) {
      if (!metric) continue
      const metricData = chartData.get(metric.id)
      if (!metricData?.length) continue

      if (metric.chartType === "area") {
        const isNegativeMetric = metric.id === "drawdown"
        const series = chart.addSeries(AreaSeries, {
          lineColor: metric.color,
          topColor: isNegativeMetric
            ? hexToRgba(metric.color, 0)
            : hexToRgba(metric.color, 0.3),
          bottomColor: isNegativeMetric
            ? hexToRgba(metric.color, 0.3)
            : hexToRgba(metric.color, 0),
          lineWidth: 2,
        })
        series.setData(
          metricData.map(d => ({ time: d.time as Time, value: d.value })),
        )
      } else if (metric.chartType === "histogram") {
        const series = chart.addSeries(HistogramSeries, {
          color: metric.color,
        })
        series.setData(
          metricData.map(d => ({
            time: d.time as Time,
            value: d.value,
            color:
              d.value >= 0 ? metric.color : (metric.negativeColor ?? "#ef4444"),
          })),
        )
      } else {
        const series = chart.addSeries(LineSeries, {
          color: metric.color,
          lineWidth: 2,
        })
        series.setData(
          metricData.map(d => ({ time: d.time as Time, value: d.value })),
        )
      }
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

  const greeksMap = createMemo(() => {
    const map = new Map<string, (typeof greeks)[0]>()
    for (const greek of greeks) map.set(greek.symbol, greek)
    return map
  })

  const portfolioGreeks = createMemo(() => aggregateGreeks(greeks))

  const totalNotional = createMemo(() =>
    calculateTotalNotional(positionsByUnderlying()),
  )

  const toggleUnderlying = (underlying: string) => {
    setCollapsedUnderlyings(prev => {
      const next = new Set(prev)
      if (next.has(underlying)) next.delete(underlying)
      else next.add(underlying)
      return next
    })
  }

  const toggleHelp = () => {
    setShowHelp(prev => !prev)
  }

  const openAddPositionModal = (underlying: string) => {
    setAddPositionModal({ isOpen: true, underlying })
  }

  const closeAddPositionModal = () => {
    setAddPositionModal({ isOpen: false, underlying: null })
  }

  // Get instruments for the selected underlying in the modal
  const getInstrumentsForUnderlying = (underlying: string) => {
    const perpSymbol = `${underlying}/USDC:USDC`
    const spotSymbol = `${underlying}-SPOT`

    const instruments: Array<{
      symbol: string
      type: "perp" | "spot" | "call" | "put"
      rate: number
      rateLabel: string
    }> = []

    // Add perp if it has cost data
    const perpCost = MOCK_INSTRUMENT_COSTS.find(c => c.symbol === perpSymbol)
    if (perpCost) {
      instruments.push({
        symbol: perpSymbol,
        type: "perp",
        rate: perpCost.fundingRate ?? 0,
        rateLabel: "funding",
      })
    }

    // Add spot
    const spotCost = MOCK_INSTRUMENT_COSTS.find(c => c.symbol === spotSymbol)
    instruments.push({
      symbol: spotSymbol,
      type: "spot",
      rate: spotCost?.carryRate ?? 0,
      rateLabel: "carry",
    })

    return instruments
  }

  const handleAddPosition = (params: {
    symbol: string
    direction: "long" | "short"
    weight: number
  }) => {
    // For now, just add as a staged trade
    addStagedTrade(params.symbol, params.direction === "long" ? "buy" : "sell")
  }

  // createEffect justified: Global keyboard shortcuts must listen on window/document
  // since they work regardless of which element has focus. Cannot use component-level onKeyDown.
  createEffect(() => {
    const blurLeverageControl = () => {
      document
        .querySelector<HTMLElement>('[data-testid="leverage-control"]')
        ?.blur()
    }

    const currentFocusedPanel = focusedPanel()
    const currentSecondaryFocus = secondaryFocus()
    const currentShowHelp = showHelp()
    const currentColumnConfigVisible = columnConfigVisible()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === "?" || (event.key === "F1" && !event.ctrlKey)) {
        event.preventDefault()
        toggleHelp()
        return
      }

      if (key === "escape") {
        event.preventDefault()
        if (currentShowHelp) {
          setShowHelp(false)
        } else if (currentColumnConfigVisible) {
          closeColumnConfig()
        } else if (currentSecondaryFocus !== "none") {
          setSecondaryFocus("none")
        } else {
          handleEscape()
        }
        return
      }

      // Number keys for direct panel access
      // Use stopImmediatePropagation to prevent EditableCell's directEdit from capturing these
      if (event.key === "1") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (currentSecondaryFocus === "staged") blurLeverageControl()
        setSecondaryFocus("none")
        focusPanel("screener")
        return
      }
      if (event.key === "2") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (currentSecondaryFocus === "staged") blurLeverageControl()
        setSecondaryFocus("none")
        focusPanel("positions")
        return
      }
      if (event.key === "3") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (currentSecondaryFocus === "staged") blurLeverageControl()
        focusPanel(null) // unfocus screener/positions
        setSecondaryFocus("performance")
        return
      }
      if (event.key === "4") {
        event.preventDefault()
        event.stopImmediatePropagation()
        focusPanel(null) // unfocus screener/positions
        setSecondaryFocus("staged")
        // Focus the leverage control so keyboard events work in real browsers
        const leverageControl = document.querySelector<HTMLElement>(
          '[data-testid="leverage-control"]',
        )
        leverageControl?.focus()
        return
      }

      // Navigation using vim keys (h/j/k/l) or arrow keys
      const direction = getDirection(event.key)

      // Horizontal: switch between panels (h/l or left/right arrows)
      if (currentFocusedPanel && direction === "left") {
        event.preventDefault()
        focusPanel("screener")
        return
      }
      if (currentFocusedPanel && direction === "right") {
        event.preventDefault()
        focusPanel("positions")
        return
      }

      // Vertical: navigate within lists (j/k or up/down arrows)
      // When hitting boundary, navigate to adjacent panel
      if (currentFocusedPanel && direction === "down") {
        event.preventDefault()
        const result = moveSelection("down")
        if (result === "boundary" && currentFocusedPanel === "positions") {
          // At bottom of positions list, move to staged changes
          focusPanel(null)
          setSecondaryFocus("staged")
          const leverageControl = document.querySelector<HTMLElement>(
            '[data-testid="leverage-control"]',
          )
          leverageControl?.focus()
        }
        return
      }
      if (currentFocusedPanel && direction === "up") {
        event.preventDefault()
        moveSelection("up")
        return
      }

      // Navigate from staged changes back to positions with up
      if (currentSecondaryFocus === "staged" && direction === "up") {
        event.preventDefault()
        blurLeverageControl()
        setSecondaryFocus("none")
        focusPanel("positions")
        return
      }

      // o, Space, or Enter to toggle expand/collapse in positions panel
      if (
        currentFocusedPanel === "positions" &&
        (key === "o" || key === " " || key === "enter")
      ) {
        event.preventDefault()
        const selectedUnderlying = getSelectedSymbol()
        if (selectedUnderlying) {
          toggleUnderlying(selectedUnderlying)
        }
        toggleExpand()
        return
      }
      if (currentFocusedPanel === "screener" && key === "o") {
        event.preventDefault()
        const selectedIdx = getSelectedIndex("screener")
        if (selectedIdx !== null) {
          const asset = sortedAssets[selectedIdx] as
            | { ticker: string }
            | undefined
          if (asset) {
            toggleScreenerExpanded(asset.ticker)
          }
        }
        return
      }

      // Enter to open add position modal from screener
      if (currentFocusedPanel === "screener" && event.key === "Enter") {
        event.preventDefault()
        const selectedIdx = getSelectedIndex("screener")
        if (selectedIdx !== null) {
          const asset = sortedAssets[selectedIdx] as
            | { ticker: string }
            | undefined
          if (asset) {
            openAddPositionModal(asset.ticker)
          }
        }
        return
      }

      // +/- to stage trades (without shift) or adjust weight (with shift)
      if (currentFocusedPanel && (key === "+" || key === "=")) {
        event.preventDefault()
        if (event.shiftKey) {
          adjustWeight(0.05) // +5%
        } else {
          triggerTrade("buy")
        }
        return
      }
      if (currentFocusedPanel && key === "-") {
        event.preventDefault()
        if (event.shiftKey) {
          adjustWeight(-0.05) // -5%
        } else {
          triggerTrade("sell")
        }
        return
      }

      // m to open metric selector
      if (key === "m") {
        event.preventDefault()
        setIsMetricSelectorOpen(prev => !prev)
        return
      }

      // f to toggle factor config panel
      if (key === "f") {
        event.preventDefault()
        setShowFactorConfig(prev => !prev)
        return
      }

      // c to toggle screener column config
      if (key === "c") {
        event.preventDefault()
        toggleColumnConfig()
        return
      }

      // [ and ] for global leverage adjustment (works from any panel)
      if (event.key === "[") {
        event.preventDefault()
        setLeverage(prev => Math.max(0.1, Math.round((prev - 0.1) * 10) / 10))
        return
      }
      if (event.key === "]") {
        event.preventDefault()
        setLeverage(prev => Math.min(5, Math.round((prev + 0.1) * 10) / 10))
        return
      }

      // x to execute staged trades
      if (key === "x") {
        event.preventDefault()
        executeStagedTrades()
        return
      }

      // Start navigation from screener if nothing focused
      if (!currentFocusedPanel && ["h", "j", "k", "l"].includes(key)) {
        event.preventDefault()
        focusPanel("screener")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  const maxFreq = createMemo(() =>
    Math.max(...monteCarloData.map(d => d.frequency)),
  )
  const totalAttribution = createMemo(() =>
    calculateTotalAttribution(factorAttribution),
  )
  const selectedInstrumentSymbol = createMemo(() => getSelectedInstrument())

  const getCorrelation = (a1: string, a2: string): number =>
    lookupCorrelation(correlationMatrix, a1, a2)

  return (
    <TooltipProvider>
      <div class="h-screen flex flex-col bg-background overflow-hidden text-[11px]">
        <HelpOverlay open={showHelp()} onClose={toggleHelp} />

        <Show when={addPositionModal().underlying}>
          <AddPositionModal
            isOpen={addPositionModal().isOpen}
            underlying={addPositionModal().underlying ?? ""}
            instruments={getInstrumentsForUnderlying(
              addPositionModal().underlying ?? "",
            )}
            nav={data.nav}
            currentLeverage={leverage()}
            onClose={closeAddPositionModal}
            onAddPosition={handleAddPosition}
          />
        </Show>

        {/* Header */}
        <header class="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-muted/30">
          <div class="flex items-center gap-4">
            <span class="font-semibold">Moneymentum</span>
            <div class="h-4 border-l border-border" />
            <span class="text-muted-foreground">NAV</span>
            <span class="font-mono">${data.nav.toLocaleString()}</span>
            <span class="text-muted-foreground">Notional</span>
            <span class="font-mono">{formatUsd(totalNotional())}</span>
            <span class="text-muted-foreground">
              ({effectiveLeverage().toFixed(2)}x)
            </span>
          </div>
          <div class="flex items-center gap-4">
            <span class="text-muted-foreground">{"\u0394"}</span>
            <span class="font-mono">{portfolioGreeks().delta.toFixed(2)}</span>
            <span class="text-muted-foreground">{"\u0393"}</span>
            <span class="font-mono">{portfolioGreeks().gamma.toFixed(3)}</span>
            <span class="text-muted-foreground">{"\u0398"}</span>
            <span class="font-mono">{portfolioGreeks().theta.toFixed(3)}</span>
            <div class="h-4 border-l border-border" />
            <span class="text-muted-foreground">VaR 95%</span>
            <span class="font-mono text-red-400">
              {formatPct(riskMetrics.var95)}
            </span>
            <kbd
              class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded cursor-pointer hover:bg-muted/80"
              onClick={toggleHelp}
            >
              ?
            </kbd>
          </div>
        </header>

        {/* Main: 3 columns - Screener | Positions+Staged | Analysis */}
        <main class="flex-1 flex gap-1 p-1 min-h-0 overflow-hidden">
          {/* Left: Screener (narrow, for discovery - adjacent to positions for workflow) */}
          <div
            class={twMerge(
              clsx(
                "w-[180px] shrink-0 border rounded flex flex-col",
                focusedPanel() === "screener"
                  ? "border-primary ring-1 ring-primary/50"
                  : "border-border",
              ),
            )}
            onClick={() => {
              setSecondaryFocus("none")
              focusPanel("screener")
            }}
          >
            <div class="px-2 py-1.5 border-b border-border bg-muted/30 flex items-center justify-between relative">
              <div class="flex items-center gap-2">
                <span class="font-medium">SCREENER</span>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    toggleColumnConfig()
                  }}
                  class="text-muted-foreground hover:text-foreground"
                  title="Configure columns (c)"
                >
                  <Columns2 class="h-3 w-3" />
                </button>
              </div>
              <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
                1
              </kbd>
              <Show when={columnConfigVisible()}>
                <div class="absolute top-full left-0 mt-1 z-20 bg-background border border-border rounded shadow-lg p-2 min-w-[120px]">
                  <div class="text-[10px] text-muted-foreground font-medium mb-1">
                    Columns
                  </div>
                  <For each={ALL_SCREENER_COLUMNS}>
                    {col => (
                      <label class="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/30 px-1 rounded">
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(col)}
                          onInput={() => {
                            toggleColumn(col)
                          }}
                          class="h-3 w-3"
                        />
                        <span class="text-[11px]">
                          {SCREENER_COLUMN_LABELS[col]}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="p-1.5 border-b border-border">
              <div class="relative">
                <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onInput={e => {
                    setSearchQuery(e.currentTarget.value)
                  }}
                  class="w-full pl-7 pr-2 py-1 bg-muted/50 border border-border rounded focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            <div class="flex-1 overflow-auto scrollbar-hide">
              <table class="w-full">
                <thead class="sticky top-0 bg-muted/90 z-10">
                  <tr class="text-muted-foreground text-[10px]">
                    <th class="px-1 py-1 w-4" />
                    <th class="px-2 py-1 text-left font-medium">Symbol</th>
                    <For each={visibleColumns}>
                      {col => (
                        <th
                          class="px-2 py-1 text-right font-medium cursor-pointer hover:text-foreground"
                          onClick={() => {
                            setSortColumn(col)
                          }}
                        >
                          {SCREENER_COLUMN_LABELS[col]}
                          <Show when={sortColumn === col}>
                            <span class="ml-0.5">
                              {sortDirection === "asc" ? "\u2191" : "\u2193"}
                            </span>
                          </Show>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={sortedAssets}>
                    {(asset, index) => {
                      const isSelected = () =>
                        focusedPanel() === "screener" &&
                        getSelectedIndex("screener") === index()
                      const isExpanded = () => isScreenerExpanded(asset.ticker)
                      const instruments = getInstrumentsForAsset(asset.ticker)
                      return (
                        <>
                          <tr
                            class={twMerge(
                              clsx(
                                "border-b border-border/20 hover:bg-muted/30 cursor-pointer",
                                isSelected() &&
                                  "ring-1 ring-primary/50 bg-muted/40",
                              ),
                            )}
                          >
                            <td
                              class="px-1 py-1 text-muted-foreground"
                              onClick={e => {
                                e.stopPropagation()
                                toggleScreenerExpanded(asset.ticker)
                              }}
                            >
                              <Show
                                when={isExpanded()}
                                fallback={<ChevronRight class="h-3 w-3" />}
                              >
                                <ChevronDown class="h-3 w-3" />
                              </Show>
                            </td>
                            <td
                              class="px-2 py-1 font-medium"
                              onClick={() => {
                                openAddPositionModal(asset.ticker)
                              }}
                            >
                              {asset.ticker}
                            </td>
                            <For each={visibleColumns}>
                              {col => {
                                const value = asset[col]
                                return (
                                  <td
                                    class={twMerge(
                                      clsx(
                                        "px-2 py-1 text-right font-mono",
                                        value > 0
                                          ? "text-green-500"
                                          : value < 0
                                            ? "text-red-500"
                                            : "text-muted-foreground",
                                      ),
                                    )}
                                    onClick={() => {
                                      openAddPositionModal(asset.ticker)
                                    }}
                                  >
                                    {value.toFixed(2)}
                                  </td>
                                )
                              }}
                            </For>
                          </tr>
                          <Show when={isExpanded()}>
                            <For each={instruments}>
                              {inst => (
                                <tr
                                  class="border-b border-border/10 text-muted-foreground bg-muted/10 hover:bg-muted/20 cursor-pointer"
                                  onClick={() => {
                                    openAddPositionModal(asset.ticker)
                                  }}
                                >
                                  <td />
                                  <td class="px-2 py-0.5 pl-5">
                                    <span class="text-muted-foreground/60 mr-1">
                                      {"\u2514"}
                                    </span>
                                    {inst.type.toUpperCase()}
                                  </td>
                                  <For each={visibleColumns}>
                                    {() => (
                                      <td class="px-2 py-0.5 text-right font-mono text-muted-foreground/50">
                                        {"\u2014"}
                                      </td>
                                    )}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </Show>
                        </>
                      )
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </div>

          {/* Middle-left: Positions + Staged (full height) */}
          <div
            class={twMerge(
              clsx(
                "w-[540px] shrink-0 border rounded flex flex-col",
                focusedPanel() === "positions"
                  ? "border-primary ring-1 ring-primary/50"
                  : "border-border",
              ),
            )}
            onClick={() => {
              setSecondaryFocus("none")
              focusPanel("positions")
            }}
          >
            <div class="px-2 py-1.5 border-b border-border bg-muted/30 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-medium">POSITIONS</span>
                <span class="text-muted-foreground">
                  {positionsByUnderlying().length} underlying assets
                </span>
              </div>
              <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
                2
              </kbd>
            </div>

            {/* Positions table */}
            <div class="flex-1 overflow-auto scrollbar-hide min-h-0">
              <Show
                when={!isLoading}
                fallback={
                  <div class="p-2 space-y-1">
                    <For each={Array.from({ length: 10 })}>
                      {() => <Skeleton class="h-5 w-full" />}
                    </For>
                  </div>
                }
              >
                <table class="w-full">
                  <thead class="sticky top-0 bg-muted/90 z-10">
                    <tr class="text-muted-foreground text-[10px]">
                      <th class="px-1 py-1 w-5" />
                      <th class="px-2 py-1 text-left font-medium">Asset</th>
                      <th class="px-2 py-1 text-left font-medium">Side</th>
                      <th class="px-2 py-1 text-right font-medium">
                        <span class="inline-flex items-center gap-1">
                          Weight
                          <kbd class="px-1 py-0.5 text-[8px] bg-muted/60 rounded font-mono opacity-60">
                            w
                          </kbd>
                        </span>
                      </th>
                      <th class="px-2 py-1 text-right font-medium">
                        <span class="inline-flex items-center gap-1">
                          Notional
                          <kbd class="px-1 py-0.5 text-[8px] bg-muted/60 rounded font-mono opacity-60">
                            n
                          </kbd>
                        </span>
                      </th>
                      <th class="px-2 py-1 text-right font-medium">Rate</th>
                      <th class="px-2 py-1 text-right font-medium">
                        {"\u0394"}
                      </th>
                      <th class="px-2 py-1 text-right font-medium">
                        {"\u0393"}
                      </th>
                      <th class="px-2 py-1 text-right font-medium">
                        {"\u0398"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={positionsByUnderlying()}>
                      {(group, index) => {
                        const isExpanded = () =>
                          !collapsedUnderlyings().has(group.underlying)
                        const greekData = () =>
                          greeksMap().get(group.underlying)
                        const groupNotional = calculateGroupNotional(
                          group.positions,
                        )
                        const groupPct = group.positions.reduce(
                          (s, p) => s + p.percentage,
                          0,
                        )
                        const netSide = calculateNetSide(group.positions)

                        // Calculate weighted average rate for the underlying
                        const groupWeightedRate =
                          groupNotional > 0
                            ? group.positions.reduce((sum, pos) => {
                                let posRate = 0
                                if (pos.fundingRate !== undefined) {
                                  posRate =
                                    pos.side === "short"
                                      ? -pos.fundingRate
                                      : pos.fundingRate
                                } else if (pos.theta !== undefined) {
                                  posRate = pos.theta * 365
                                } else {
                                  posRate = pos.carryRate ?? 0
                                }
                                return (
                                  sum + posRate * (pos.notional / groupNotional)
                                )
                              }, 0)
                            : 0

                        const isSelected = () =>
                          focusedPanel() === "positions" &&
                          getSelectedIndex("positions") === index()

                        return (
                          <>
                            <tr
                              class={twMerge(
                                clsx(
                                  "border-b border-border/30 hover:bg-muted/20 cursor-pointer",
                                  isSelected() &&
                                    "ring-1 ring-primary/50 bg-muted/40",
                                ),
                              )}
                              onClick={() => {
                                toggleUnderlying(group.underlying)
                              }}
                            >
                              <td class="px-1 py-1 text-muted-foreground">
                                <Show
                                  when={isExpanded()}
                                  fallback={<ChevronRight class="h-3 w-3" />}
                                >
                                  <ChevronDown class="h-3 w-3" />
                                </Show>
                              </td>
                              <td class="px-2 py-1 font-medium">
                                {group.underlying}
                              </td>
                              <td class="px-2 py-1">
                                <span
                                  class={twMerge(
                                    clsx(
                                      "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                      netSide === "long"
                                        ? "bg-green-500/20 text-green-500"
                                        : netSide === "short"
                                          ? "bg-red-500/20 text-red-500"
                                          : "bg-yellow-500/20 text-yellow-500",
                                    ),
                                  )}
                                >
                                  {netSide === "long"
                                    ? "LONG"
                                    : netSide === "short"
                                      ? "SHORT"
                                      : "NEUTRAL"}
                                </span>
                              </td>
                              <td class="px-2 py-1 text-right font-mono font-medium">
                                {groupPct.toFixed(1)}%
                              </td>
                              <td class="px-2 py-1 text-right font-mono">
                                {formatUsd(groupNotional)}
                              </td>
                              <td
                                class={twMerge(
                                  clsx(
                                    "px-2 py-1 text-right font-mono",
                                    groupWeightedRate > 0
                                      ? "text-green-500"
                                      : groupWeightedRate < 0
                                        ? "text-red-500"
                                        : "text-muted-foreground",
                                  ),
                                )}
                              >
                                {`${groupWeightedRate > 0 ? "+" : ""}${(groupWeightedRate * 100).toFixed(1)}%`}
                              </td>
                              <td class="px-2 py-1 text-right font-mono">
                                {formatNum(greekData()?.delta, 2)}
                              </td>
                              <td class="px-2 py-1 text-right font-mono text-muted-foreground">
                                {formatNum(greekData()?.gamma, 3)}
                              </td>
                              <td class="px-2 py-1 text-right font-mono text-muted-foreground">
                                {formatNum(greekData()?.theta, 3)}
                              </td>
                            </tr>
                            <Show when={isExpanded()}>
                              <For each={group.positions}>
                                {pos => {
                                  const underlyingGreeks = () =>
                                    greeksMap().get(group.underlying)
                                  const posWeight = calculatePositionWeight(
                                    pos.notional,
                                    groupNotional,
                                  )
                                  const instrumentType = pos.symbol.includes(
                                    "/",
                                  )
                                    ? "PERP"
                                    : pos.symbol.includes("-PUT")
                                      ? "PUT"
                                      : pos.symbol.includes("-CALL")
                                        ? "CALL"
                                        : "SPOT"

                                  const isOption =
                                    instrumentType === "PUT" ||
                                    instrumentType === "CALL"
                                  const isLong = pos.side === "long"

                                  const getOptionHint = () => {
                                    if (!isOption) return null
                                    if (instrumentType === "CALL") {
                                      return isLong
                                        ? "Long call: Unlimited upside potential. Maximum loss is the premium paid. Profits when underlying rises above strike + premium."
                                        : "Short call: Collects premium upfront. Unlimited loss potential if underlying rises. Profits when underlying stays below strike."
                                    }
                                    return isLong
                                      ? "Long put: Profits when underlying falls below strike minus premium paid. Maximum loss is limited to the premium. Common uses: (1) Portfolio hedge against downside moves, (2) Bearish directional bet with limited risk, (3) Pairs with long stock for protective put strategy."
                                      : "Short put: Collects premium upfront in exchange for obligation to buy at strike. Maximum loss occurs if underlying goes to zero (strike \u00d7 contracts). Profits when underlying stays above strike. Common uses: (1) Generate income on assets you're willing to own, (2) Bullish bet that underlying won't fall, (3) Cash-secured put strategy for potential entry."
                                  }
                                  const optionHint = getOptionHint()

                                  // Get rate: funding for perps, 0 for spots, theta (annualized) for options
                                  const getRate = (): {
                                    value: number
                                    label: string
                                  } => {
                                    if (pos.fundingRate !== undefined) {
                                      // For shorts, you receive funding when rate is positive
                                      const effectiveRate =
                                        pos.side === "short"
                                          ? -pos.fundingRate
                                          : pos.fundingRate
                                      return {
                                        value: effectiveRate,
                                        label: "funding",
                                      }
                                    }
                                    if (pos.theta !== undefined) {
                                      return {
                                        value: pos.theta * 365,
                                        label: "theta",
                                      }
                                    }
                                    // Spots and any other instruments default to 0% rate
                                    return {
                                      value: pos.carryRate ?? 0,
                                      label: "carry",
                                    }
                                  }
                                  const rate = getRate()

                                  const isInstrumentSelected = () =>
                                    focusedPanel() === "positions" &&
                                    selectedInstrumentSymbol() === pos.symbol

                                  return (
                                    <tr
                                      class={twMerge(
                                        clsx(
                                          "border-b border-border/10 text-muted-foreground",
                                          isInstrumentSelected()
                                            ? "bg-primary/20 ring-1 ring-primary/50"
                                            : "bg-muted/10",
                                        ),
                                      )}
                                    >
                                      <td />
                                      <td class="px-2 py-0.5 pl-6 whitespace-nowrap">
                                        <span class="text-muted-foreground mr-1">
                                          {"\u2514"}
                                        </span>
                                        {instrumentType}
                                      </td>
                                      <td class="px-2 py-0.5">
                                        <span class="relative inline-flex items-center">
                                          <span
                                            class={twMerge(
                                              clsx(
                                                "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                                isLong
                                                  ? "bg-green-500/20 text-green-500"
                                                  : "bg-red-500/20 text-red-500",
                                              ),
                                            )}
                                          >
                                            {isLong ? "LONG" : "SHORT"}
                                          </span>
                                          <Show when={optionHint}>
                                            <Tooltip>
                                              <TooltipTrigger
                                                as="span"
                                                class="absolute -top-1 -right-2 text-[8px] text-muted-foreground/60 hover:text-muted-foreground cursor-help"
                                              >
                                                ?
                                              </TooltipTrigger>
                                              <TooltipContent class="max-w-[280px]">
                                                {optionHint}
                                              </TooltipContent>
                                            </Tooltip>
                                          </Show>
                                        </span>
                                      </td>
                                      <td class="px-2 py-0.5 text-right font-mono">
                                        <EditableCell
                                          value={pos.weight}
                                          format="percent"
                                          onCommit={newWeight => {
                                            updateInstrumentWeight(
                                              pos.symbol,
                                              newWeight,
                                            )
                                          }}
                                          isSelected={isInstrumentSelected()}
                                          editKey="w"
                                          directEdit
                                        />
                                      </td>
                                      <td class="px-2 py-0.5 text-right font-mono">
                                        <EditableCell
                                          value={pos.notional}
                                          format="currency"
                                          onCommit={newNotional => {
                                            updateInstrumentNotional(
                                              pos.symbol,
                                              newNotional,
                                            )
                                          }}
                                          isSelected={isInstrumentSelected()}
                                          editKey="n"
                                        />
                                      </td>
                                      <td
                                        class={twMerge(
                                          clsx(
                                            "px-2 py-0.5 text-right font-mono",
                                            rate.value > 0
                                              ? "text-green-500"
                                              : rate.value < 0
                                                ? "text-red-500"
                                                : "",
                                          ),
                                        )}
                                      >
                                        {`${rate.value > 0 ? "+" : ""}${(rate.value * 100).toFixed(1)}%`}
                                      </td>
                                      <td class="px-2 py-0.5 text-right font-mono">
                                        {(() => {
                                          const greeks = underlyingGreeks()
                                          return greeks
                                            ? formatNum(
                                                greeks.delta * posWeight,
                                                2,
                                              )
                                            : "\u2014"
                                        })()}
                                      </td>
                                      <td class="px-2 py-0.5 text-right font-mono">
                                        {(() => {
                                          const greeks = underlyingGreeks()
                                          return greeks
                                            ? formatNum(
                                                greeks.gamma * posWeight,
                                                3,
                                              )
                                            : "\u2014"
                                        })()}
                                      </td>
                                      <td class="px-2 py-0.5 text-right font-mono">
                                        {(() => {
                                          const greeks = underlyingGreeks()
                                          return greeks
                                            ? formatNum(
                                                greeks.theta * posWeight,
                                                3,
                                              )
                                            : "\u2014"
                                        })()}
                                      </td>
                                    </tr>
                                  )
                                }}
                              </For>
                            </Show>
                          </>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>

            <StagedTradesPanel
              stagedTrades={stagedTrades()}
              leverage={leverage()}
              effectiveLeverage={effectiveLeverage()}
              nav={data.nav}
              positions={positionsByUnderlying()}
              assetFactors={assetFactors()}
              isFocused={secondaryFocus() === "staged"}
              onLeverageChange={setLeverage}
              onRemoveTrade={removeStagedTrade}
              onClearAll={clearStagedTrades}
              onExecute={executeStagedTrades}
            />
          </div>

          {/* Center: Analysis panels */}
          <div class="flex-1 flex flex-col gap-1 min-w-0">
            {/* Top row: Performance */}
            <div
              class={twMerge(
                clsx(
                  "border border-border rounded flex flex-col",
                  secondaryFocus() === "performance" &&
                    "ring-1 ring-primary/50",
                ),
              )}
              style={{ height: "45%" }}
            >
              <div class="px-2 py-1 border-b border-border bg-muted/30 font-medium flex justify-between items-center">
                <span>PERFORMANCE</span>
                <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
                  3
                </kbd>
              </div>
              <div class="flex-1 flex min-h-0">
                {/* Metrics on the left - single column with breathing room */}
                <div class="w-[180px] shrink-0 border-r border-border/30 p-3 overflow-auto scrollbar-hide flex flex-col gap-2">
                  <MetricSelector
                    selectedMetricIds={selectedMetricIds()}
                    selectedWindowId={selectedWindowId()}
                    onMetricToggle={id => {
                      setSelectedMetricIds(prev =>
                        prev.includes(id)
                          ? prev.filter(x => x !== id)
                          : [...prev, id],
                      )
                    }}
                    onWindowChange={setSelectedWindowId}
                    isOpen={isMetricSelectorOpen()}
                    onOpenChange={setIsMetricSelectorOpen}
                    isFocused={secondaryFocus() === "performance"}
                  />
                  <div class="flex justify-between pb-2 border-b border-border/30">
                    <span class="text-muted-foreground">Total Return</span>
                    <span
                      class={
                        performanceStats.totalReturn >= 0
                          ? "text-green-500 font-mono"
                          : "text-red-500 font-mono"
                      }
                    >
                      {formatPct(performanceStats.totalReturn)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Sharpe</span>
                    <span class="font-mono">
                      {performanceStats.sharpeRatio.toFixed(2)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Sortino</span>
                    <span class="font-mono">
                      {performanceStats.sortinoRatio.toFixed(2)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Calmar</span>
                    <span class="font-mono">
                      {Math.abs(
                        performanceStats.totalReturn /
                          performanceStats.maxDrawdown,
                      ).toFixed(2)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Max Drawdown</span>
                    <span class="text-red-400 font-mono">
                      {formatPct(performanceStats.maxDrawdown)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Win Rate</span>
                    <span class="font-mono">
                      {(performanceStats.winRate * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Profit Factor</span>
                    <span class="font-mono">
                      {performanceStats.profitFactor.toFixed(2)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Volatility</span>
                    <span class="font-mono">
                      {formatPct(riskMetrics.var95 * 1.645)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Beta</span>
                    <span class="font-mono">1.05</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">VaR 95%</span>
                    <span class="text-red-400 font-mono">
                      {formatPct(riskMetrics.var95)}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">VaR 99%</span>
                    <span class="text-red-400 font-mono">
                      {formatPct(riskMetrics.var99)}
                    </span>
                  </div>
                </div>
                {/* Chart on the right */}
                <div class="flex-1 min-w-0 p-2">
                  <div
                    ref={el => (performanceChartRef = el)}
                    class="w-full h-full"
                  />
                </div>
              </div>
            </div>

            {/* Bottom row: Factors and Risk side by side */}
            <div class="flex-1 flex gap-1 min-h-0">
              {/* Factors */}
              <div class="flex-1 border border-border rounded flex flex-col min-w-0 relative">
                <div class="px-2 py-1 border-b border-border bg-muted/30 font-medium flex items-center justify-between">
                  <span>FACTORS</span>
                  <div class="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setShowFactorConfig(true)
                      }}
                      class="text-muted-foreground hover:text-foreground"
                      title="Configure factors (f)"
                    >
                      <Settings class="h-3 w-3" />
                    </button>
                    <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
                      f
                    </kbd>
                  </div>
                </div>
                <Show when={showFactorConfig()}>
                  <FactorConfigPanel
                    factors={factorExposures()}
                    onClose={() => {
                      setShowFactorConfig(false)
                    }}
                    onSave={setCustomFactors}
                  />
                </Show>
                <div class="flex-1 flex flex-col p-2 gap-3 overflow-auto scrollbar-hide">
                  <div class="space-y-1.5">
                    <div class="text-[10px] text-muted-foreground font-medium">
                      Exposures
                    </div>
                    <For each={factorExposures()}>
                      {f => (
                        <div class="flex items-center gap-2">
                          <span class="w-20 text-muted-foreground truncate">
                            {f.name}
                          </span>
                          <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden relative">
                            <div class="absolute left-1/2 w-px h-full bg-border" />
                            <div
                              class={twMerge(
                                clsx(
                                  "absolute h-full rounded-full",
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
                          <span class="w-12 text-right font-mono">
                            {f.value >= 0 ? "+" : ""}
                            {f.value.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="border-t border-border/50 pt-2">
                    <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
                      Attribution
                    </div>
                    <For each={factorAttribution}>
                      {f => (
                        <div class="flex items-center gap-2 mb-1">
                          <span class="w-20 text-muted-foreground truncate">
                            {f.factor}
                          </span>
                          <div class="flex-1 h-2 bg-muted rounded overflow-hidden">
                            <div
                              class="h-full rounded"
                              style={{
                                "width": `${Math.abs(f.contribution / totalAttribution()) * 100}%`,
                                "background-color":
                                  FACTOR_COLORS[f.factor] ?? "#888888",
                              }}
                            />
                          </div>
                          <span
                            class={twMerge(
                              clsx(
                                "w-14 text-right font-mono",
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
                      )}
                    </For>
                  </div>
                  <div class="border-t border-border/50 pt-2">
                    <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
                      Concentration
                    </div>
                    <div class="space-y-1">
                      <For each={concentrationMetrics}>
                        {m => (
                          <div class="flex items-center justify-between">
                            <span class="text-muted-foreground">
                              {m.metric}
                            </span>
                            <span class="font-mono">
                              {m.value <= 1
                                ? `${(m.value * 100).toFixed(0)}%`
                                : m.value.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk */}
              <div class="flex-1 border border-border rounded flex flex-col min-w-0">
                <div class="px-2 py-1 border-b border-border bg-muted/30 font-medium">
                  RISK
                </div>
                <div class="flex-1 flex flex-col p-2 gap-3 overflow-auto scrollbar-hide">
                  <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">VaR 95%</span>
                      <span class="text-red-400 font-mono">
                        {formatPct(riskMetrics.var95)}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">VaR 99%</span>
                      <span class="text-red-400 font-mono">
                        {formatPct(riskMetrics.var99)}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Diversification</span>
                      <span class="font-mono">
                        {riskMetrics.diversificationRatio.toFixed(2)}x
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Effective Bets</span>
                      <span class="font-mono">
                        {riskMetrics.effectiveBets.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div class="border-t border-border/50 pt-2">
                    <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
                      Stress Tests
                    </div>
                    <div class="space-y-1">
                      <For each={stressTests}>
                        {t => (
                          <div class="flex items-center justify-between">
                            <span class="text-muted-foreground truncate">
                              {t.scenario}
                            </span>
                            <span
                              class={
                                t.portfolioImpact < 0
                                  ? "text-red-400 font-mono"
                                  : "text-green-400 font-mono"
                              }
                            >
                              {formatPct(t.portfolioImpact)}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="border-t border-border/50 pt-2">
                    <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
                      Monte Carlo (1 Year)
                    </div>
                    <div class="flex items-end gap-px h-12">
                      <For each={monteCarloData}>
                        {d => (
                          <div
                            class="flex-1"
                            style={{
                              "height": `${(d.frequency / maxFreq()) * 100}%`,
                              "background-color":
                                d.bucket >= 0 ? "#22c55e" : "#ef4444",
                            }}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="border-t border-border/50 pt-2">
                    <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
                      Correlation
                    </div>
                    <table class="w-full">
                      <thead>
                        <tr>
                          <th class="p-0.5" />
                          <For each={correlationAssets}>
                            {a => (
                              <th class="p-0.5 text-[10px] text-muted-foreground font-medium text-center">
                                {a}
                              </th>
                            )}
                          </For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={correlationAssets}>
                          {a1 => (
                            <tr>
                              <td class="p-0.5 text-[10px] text-muted-foreground font-medium">
                                {a1}
                              </td>
                              <For each={correlationAssets}>
                                {a2 => {
                                  const corr = getCorrelation(a1, a2)
                                  return (
                                    <td class="p-0.5 text-center">
                                      <div
                                        class={twMerge(
                                          clsx(
                                            "w-full h-4 flex items-center justify-center rounded text-[9px] font-mono",
                                            getCorrelationColor(corr),
                                            a1 === a2 ? "opacity-40" : "",
                                          ),
                                        )}
                                      >
                                        {corr.toFixed(1)}
                                      </div>
                                    </td>
                                  )
                                }}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer class="px-3 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground flex justify-between items-center">
          <div class="flex gap-3">
            <span class={focusedPanel() === "screener" ? "text-primary" : ""}>
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">1</kbd>{" "}
              Screener
            </span>
            <span class={focusedPanel() === "positions" ? "text-primary" : ""}>
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">2</kbd>{" "}
              Positions
            </span>
            <span class="border-l border-border pl-3">
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">j</kbd>/
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">k</kbd>{" "}
              navigate
            </span>
            <span>
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">o</kbd>{" "}
              expand
            </span>
            <Show when={focusedPanel() === "positions"}>
              <span class="border-l border-border pl-3">
                <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">w</kbd>{" "}
                weight
              </span>
              <span>
                <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">n</kbd>{" "}
                notional
              </span>
            </Show>
            <span class="border-l border-border pl-3">
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">[</kbd>/
              <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">]</kbd>{" "}
              leverage
            </span>
            <Show when={stagedTrades().length > 0}>
              <span class="text-primary">
                <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">x</kbd>{" "}
                execute
              </span>
            </Show>
          </div>
          <span>
            <kbd class="px-1.5 py-0.5 bg-muted rounded font-mono">?</kbd> all
            shortcuts
          </span>
        </footer>
      </div>
    </TooltipProvider>
  )
}

export default PrototypePage
