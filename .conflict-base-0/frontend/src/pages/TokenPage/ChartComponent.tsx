import { onMount, onCleanup, createEffect } from "solid-js"
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type Time,
} from "lightweight-charts"
import type {
  IChartApi,
  ISeriesApi,
  CandlestickSeriesOptions,
  HistogramSeriesOptions,
  LineSeriesOptions,
} from "lightweight-charts"
import type { TradingData } from "@/hooks/useApi"
import { transformToLineData, transformToOHLC } from "./utils"

// "price" is a special case for OHLC chart, other metrics are keys of TradingData
export type MetricSelection = "price" | keyof TradingData

type AnySeries =
  | ISeriesApi<"Candlestick", Time, unknown, CandlestickSeriesOptions, unknown>
  | ISeriesApi<"Histogram", Time, unknown, HistogramSeriesOptions, unknown>
  | ISeriesApi<"Line", Time, unknown, LineSeriesOptions, unknown>

// Chart Component using TradingView Lightweight Charts
interface ChartComponentProps {
  data: TradingData[]
  selectedMetric: MetricSelection
  timeframe: string
}

const ChartComponent = (props: ChartComponentProps) => {
  let chartContainerRef: HTMLDivElement | undefined
  let chartRef: IChartApi | null = null
  let seriesRef: AnySeries | null = null
  let volumeSeriesRef: AnySeries | null = null

  onMount(() => {
    if (!chartContainerRef) return

    try {
      // Create chart
      const chart = createChart(chartContainerRef, {
        layout: {
          background: { type: ColorType.Solid, color: "#000" },
          textColor: "#fff",
        },
        grid: {
          vertLines: { color: "#374151" },
          horzLines: { color: "#374151" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: "#485563",
        },
        timeScale: {
          borderColor: "#485563",
          timeVisible: true,
          secondsVisible: props.timeframe === "15m",
        },
        width: chartContainerRef.clientWidth,
        height: chartContainerRef.clientHeight,
      })

      chartRef = chart

      // Handle resize
      const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          chart.applyOptions({ width, height })
        }
      })

      resizeObserver.observe(chartContainerRef)

      onCleanup(() => {
        resizeObserver.disconnect()

        // Clean up series references first
        seriesRef = null
        volumeSeriesRef = null

        // Then remove the chart
        if (chartRef) {
          chartRef.remove()
          chartRef = null
        }
      })
    } catch (error) {
      console.error("Error creating chart:", error)
    }
  })

  createEffect(() => {
    const currentData = props.data
    const currentSelectedMetric = props.selectedMetric
    if (!chartRef || !currentData.length) return

    try {
      const chart = chartRef
      // Remove existing series safely
      if (seriesRef) {
        try {
          // Type assertion needed as the library's removeSeries typing is overly restrictive
          chart.removeSeries(
            seriesRef as Parameters<typeof chart.removeSeries>[0],
          )
        } catch {
          // Series may already be removed
        }
        seriesRef = null
      }
      if (volumeSeriesRef) {
        try {
          chart.removeSeries(
            volumeSeriesRef as Parameters<typeof chart.removeSeries>[0],
          )
        } catch {
          // Series may already be removed
        }
        volumeSeriesRef = null
      }

      if (currentSelectedMetric === "price") {
        // Create candlestick series for price data
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: "#26a69a",
          downColor: "#ef5350",
          borderVisible: false,
          wickUpColor: "#26a69a",
          wickDownColor: "#ef5350",
        })

        const ohlcData = transformToOHLC(currentData)
        const chartData = ohlcData.map(item => ({
          time: (item.date.getTime() / 1000) as Time,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
        }))

        // Validate data doesn't have duplicates
        const times = chartData.map(d => d.time)
        const uniqueTimes = new Set(times)
        if (times.length !== uniqueTimes.size) {
          console.warn("Duplicate timestamps detected in chart data")
          // Remove duplicates again as a safety measure
          const uniqueChartData = chartData.filter((item, index, array) => {
            return index === 0 || item.time !== array[index - 1].time
          })
          candlestickSeries.setData(uniqueChartData)
        } else {
          candlestickSeries.setData(chartData)
        }

        seriesRef = candlestickSeries

        // Add volume series only if we have volume data
        if (ohlcData.some(item => item.volume > 0)) {
          const volumeSeries = chart.addSeries(HistogramSeries, {
            color: "#26a69a",
            priceFormat: {
              type: "volume",
            },
            priceScaleId: "", // Set as an overlay
          })

          const volumeData = ohlcData.map(item => ({
            time: (item.date.getTime() / 1000) as Time,
            value: item.volume,
            color: item.close >= item.open ? "#26a69a80" : "#ef535080",
          }))

          // Validate volume data
          const volumeTimes = volumeData.map(d => d.time)
          const uniqueVolumeTimes = new Set(volumeTimes)
          if (volumeTimes.length !== uniqueVolumeTimes.size) {
            console.warn("Duplicate timestamps detected in volume data")
            const uniqueVolumeData = volumeData.filter((item, index, array) => {
              return index === 0 || item.time !== array[index - 1].time
            })
            volumeSeries.setData(uniqueVolumeData)
          } else {
            volumeSeries.setData(volumeData)
          }

          volumeSeriesRef = volumeSeries
        }
      } else {
        // Create line series for metrics (currentSelectedMetric is narrowed to keyof TradingData here)
        const lineData = transformToLineData(currentData, currentSelectedMetric)

        // Calculate the range of values to determine appropriate precision
        const values = lineData.map(d => d.value)
        const minValue = Math.min(...values)
        const maxValue = Math.max(...values)
        const range = Math.abs(maxValue - minValue)
        const avgAbsValue =
          values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length

        // Determine precision and format based on the metric type
        let precision = 2
        const isReturnMetric =
          currentSelectedMetric.includes("return") ||
          currentSelectedMetric === "sharpe" ||
          currentSelectedMetric === "sortino"
        const isVolatilityMetric =
          currentSelectedMetric.includes("volatility") ||
          currentSelectedMetric.includes("stddev")

        // Handle edge case where all values are very close to zero
        if (range < 0.0000001 && avgAbsValue < 0.000001) {
          precision = 8
        } else if (isReturnMetric) {
          // For returns and ratios, use more precision
          if (range < 0.0001) {
            precision = 6
          } else if (range < 0.001) {
            precision = 5
          } else if (range < 0.01) {
            precision = 4
          } else if (range < 0.1) {
            precision = 3
          }
        } else if (isVolatilityMetric) {
          // For volatility metrics
          precision = range < 0.001 ? 5 : range < 0.01 ? 4 : 3
        } else {
          // General case
          if (range < 0.001) {
            precision = 6
          } else if (range < 0.01) {
            precision = 5
          } else if (range < 0.1) {
            precision = 4
          } else if (range < 1) {
            precision = 3
          }
        }

        const priceFormat = {
          type: "price" as const,
          precision: precision,
          minMove: Math.pow(10, -precision),
        }

        const lineSeries = chart.addSeries(LineSeries, {
          color: "#2563eb",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 6,
          crosshairMarkerBorderColor: "#2563eb",
          crosshairMarkerBackgroundColor: "#2563eb",
          priceFormat: priceFormat,
        })

        const chartData = lineData.map(d => ({
          time: (new Date(d.time).getTime() / 1000) as Time,
          value: d.value,
        }))

        lineSeries.setData(chartData)
        seriesRef = lineSeries

        // Set visible range to show data properly
        if (lineData.length > 0) {
          chart.priceScale("right").applyOptions({
            autoScale: true,
          })
        }
      }

      // Fit content to show all data
      chart.timeScale().fitContent()
    } catch (error) {
      console.error("Error updating chart data:", error)
    }
  })

  return (
    <div
      ref={chartContainerRef}
      style={{
        width: "100%",
        height: "100%",
      }}
    />
  )
}

export default ChartComponent
