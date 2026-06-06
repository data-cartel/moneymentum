import { Show, For } from "solid-js"
import { cn } from "@/lib/cn"
import { PerformanceTab } from "./PerformanceTab"
import { FactorsTab } from "./FactorsTab"
import { RiskTab } from "./RiskTab"
import type {
  BacktestPoint,
  DrawdownPoint,
  ReturnDistributionBucket,
  PerformanceStats,
  FactorExposure,
  FactorHistoricalReturn,
  FactorAttribution,
  RiskMetricsData,
  StressTest,
  MonteCarloDistribution,
  ConcentrationMetric,
  CorrelationEntry,
} from "../mockData"

export type AnalysisTab = "performance" | "factors" | "risk"

interface AnalysisPanelProps {
  backtestData: BacktestPoint[]
  drawdownData: DrawdownPoint[]
  returnDistribution: ReturnDistributionBucket[]
  performanceStats: PerformanceStats
  factorExposures: FactorExposure[]
  factorHistoricalReturns: FactorHistoricalReturn[]
  factorAttribution: FactorAttribution[]
  riskMetrics: RiskMetricsData
  stressTests: StressTest[]
  monteCarloData: MonteCarloDistribution[]
  concentrationMetrics: ConcentrationMetric[]
  correlationMatrix: CorrelationEntry[]
  correlationAssets: string[]
  hasStagedTrades: boolean
  activeTab: AnalysisTab
  onTabChange: (tab: AnalysisTab) => void
}

export const AnalysisPanel = (props: AnalysisPanelProps) => {
  return (
    <div class="flex flex-col h-full">
      <div
        role="tablist"
        class="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 bg-muted/30"
      >
        <For each={["performance", "factors", "risk"] as const}>
          {tab => (
            <button
              type="button"
              role="tab"
              id={`tab-${tab}`}
              aria-selected={props.activeTab === tab}
              onClick={() => {
                props.onTabChange(tab)
              }}
              class={cn(
                "px-3 py-1 text-[10px] font-medium rounded transition-colors capitalize",
                props.activeTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {tab}
            </button>
          )}
        </For>
        <div class="flex-1" />
        <div class="text-[9px] text-muted-foreground">
          <kbd class="px-1 py-px bg-muted rounded font-mono">P</kbd> Performance{" "}
          <kbd class="px-1 py-px bg-muted rounded font-mono ml-1">F</kbd>{" "}
          Factors{" "}
          <kbd class="px-1 py-px bg-muted rounded font-mono ml-1">R</kbd> Risk
        </div>
      </div>

      <div
        role="tabpanel"
        aria-labelledby={`tab-${props.activeTab}`}
        class="flex-1 min-h-0 overflow-hidden"
      >
        <Show when={props.activeTab === "performance"}>
          <PerformanceTab
            backtestData={props.backtestData}
            drawdownData={props.drawdownData}
            returnDistribution={props.returnDistribution}
            performanceStats={props.performanceStats}
            hasStagedTrades={props.hasStagedTrades}
          />
        </Show>
        <Show when={props.activeTab === "factors"}>
          <FactorsTab
            factorExposures={props.factorExposures}
            factorHistoricalReturns={props.factorHistoricalReturns}
            factorAttribution={props.factorAttribution}
          />
        </Show>
        <Show when={props.activeTab === "risk"}>
          <RiskTab
            riskMetrics={props.riskMetrics}
            stressTests={props.stressTests}
            monteCarloData={props.monteCarloData}
            concentrationMetrics={props.concentrationMetrics}
            correlationMatrix={props.correlationMatrix}
            correlationAssets={props.correlationAssets}
          />
        </Show>
      </div>
    </div>
  )
}
