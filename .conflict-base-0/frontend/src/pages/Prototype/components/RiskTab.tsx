import { createSignal, Show, For } from "solid-js"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import type {
  RiskMetricsData,
  StressTest,
  MonteCarloDistribution,
  ConcentrationMetric,
  CorrelationEntry,
} from "../mockData"
import { getCorrelationColorClass, CHART_COLORS } from "../colors"

type ViewMode =
  | "var"
  | "stress"
  | "concentration"
  | "correlation"
  | "montecarlo"

interface RiskTabProps {
  riskMetrics: RiskMetricsData
  stressTests: StressTest[]
  monteCarloData: MonteCarloDistribution[]
  concentrationMetrics: ConcentrationMetric[]
  correlationMatrix: CorrelationEntry[]
  correlationAssets: string[]
}

const formatPct = (n: number): string =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`

export const RiskTab = (props: RiskTabProps) => {
  const [viewMode, setViewMode] = createSignal<ViewMode>("var")
  const [mcSimulations, setMcSimulations] = createSignal(1000)
  const [mcHorizon, setMcHorizon] = createSignal(252)

  const maxFreq = () => Math.max(...props.monteCarloData.map(d => d.frequency))

  const getCorrelation = (a1: string, a2: string): number => {
    const entry = props.correlationMatrix.find(
      e =>
        (e.asset1 === a1 && e.asset2 === a2) ||
        (e.asset1 === a2 && e.asset2 === a1),
    )
    return entry?.correlation ?? 0
  }

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center justify-between px-2 py-1 border-b border-border/50 shrink-0">
        <div class="flex gap-1">
          <For
            each={
              [
                "var",
                "stress",
                "concentration",
                "correlation",
                "montecarlo",
              ] as const
            }
          >
            {mode => (
              <button
                type="button"
                onClick={() => {
                  setViewMode(mode)
                }}
                class={twMerge(
                  clsx(
                    "px-2 py-0.5 text-[9px] rounded transition-colors",
                    viewMode() === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  ),
                )}
              >
                {mode === "var"
                  ? "VaR"
                  : mode === "montecarlo"
                    ? "Monte Carlo"
                    : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={viewMode() === "var"}>
        <div class="flex-1 overflow-auto p-2">
          <div class="grid grid-cols-2 gap-3">
            <div class="p-2 bg-muted/30 rounded border border-border/50">
              <div class="text-[9px] text-muted-foreground">
                Value at Risk (95%)
              </div>
              <div class="text-lg font-mono text-red-400">
                {formatPct(props.riskMetrics.var95)}
              </div>
              <div class="text-[9px] text-muted-foreground mt-1">
                95% confidence daily loss limit
              </div>
            </div>
            <div class="p-2 bg-muted/30 rounded border border-border/50">
              <div class="text-[9px] text-muted-foreground">
                Value at Risk (99%)
              </div>
              <div class="text-lg font-mono text-red-400">
                {formatPct(props.riskMetrics.var99)}
              </div>
              <div class="text-[9px] text-muted-foreground mt-1">
                99% confidence daily loss limit
              </div>
            </div>
            <div class="p-2 bg-muted/30 rounded border border-border/50">
              <div class="text-[9px] text-muted-foreground">
                Diversification Ratio
              </div>
              <div class="text-lg font-mono">
                {props.riskMetrics.diversificationRatio.toFixed(2)}x
              </div>
              <div class="text-[9px] text-muted-foreground mt-1">
                Portfolio vol / weighted avg vol
              </div>
            </div>
            <div class="p-2 bg-muted/30 rounded border border-border/50">
              <div class="text-[9px] text-muted-foreground">Effective Bets</div>
              <div class="text-lg font-mono">
                {props.riskMetrics.effectiveBets.toFixed(1)}
              </div>
              <div class="text-[9px] text-muted-foreground mt-1">
                Independent risk sources
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={viewMode() === "stress"}>
        <div class="flex-1 overflow-auto p-2">
          <table class="w-full text-[10px]">
            <thead>
              <tr class="text-muted-foreground border-b border-border/50">
                <th class="text-left py-1 font-medium">Scenario</th>
                <th class="text-right py-1 font-medium">Portfolio</th>
                <th class="text-right py-1 font-medium">BTC</th>
                <th class="text-right py-1 font-medium">ETH</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.stressTests}>
                {test => (
                  <tr class="border-b border-border/30">
                    <td class="py-1.5 text-muted-foreground">
                      {test.scenario}
                    </td>
                    <td
                      class={twMerge(
                        clsx(
                          "py-1.5 text-right font-mono",
                          test.portfolioImpact < 0
                            ? "text-red-400"
                            : "text-green-400",
                        ),
                      )}
                    >
                      {formatPct(test.portfolioImpact)}
                    </td>
                    <td
                      class={twMerge(
                        clsx(
                          "py-1.5 text-right font-mono",
                          test.btcImpact < 0
                            ? "text-red-400"
                            : "text-green-400",
                        ),
                      )}
                    >
                      {formatPct(test.btcImpact)}
                    </td>
                    <td
                      class={twMerge(
                        clsx(
                          "py-1.5 text-right font-mono",
                          test.ethImpact < 0
                            ? "text-red-400"
                            : "text-green-400",
                        ),
                      )}
                    >
                      {formatPct(test.ethImpact)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={viewMode() === "concentration"}>
        <div class="flex-1 overflow-auto p-2">
          <div class="space-y-2">
            <For each={props.concentrationMetrics}>
              {metric => (
                <div class="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50">
                  <div>
                    <div class="text-[10px] font-medium">{metric.metric}</div>
                    <div class="text-[9px] text-muted-foreground">
                      {metric.description}
                    </div>
                  </div>
                  <div class="text-right font-mono text-[11px]">
                    {typeof metric.value === "number" && metric.value <= 1
                      ? `${(metric.value * 100).toFixed(1)}%`
                      : metric.value.toFixed(1)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={viewMode() === "correlation"}>
        <div class="flex-1 overflow-auto p-2">
          <div class="overflow-auto">
            <table class="text-[9px]">
              <thead>
                <tr>
                  <th class="p-1" />
                  <For each={props.correlationAssets}>
                    {asset => (
                      <th class="p-1 text-muted-foreground font-medium">
                        {asset}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={props.correlationAssets}>
                  {asset1 => (
                    <tr>
                      <td class="p-1 text-muted-foreground font-medium">
                        {asset1}
                      </td>
                      <For each={props.correlationAssets}>
                        {asset2 => {
                          const corr = getCorrelation(asset1, asset2)
                          return (
                            <td class="p-0.5">
                              <div
                                class={twMerge(
                                  clsx(
                                    "w-8 h-6 flex items-center justify-center rounded text-[8px] font-mono",
                                    getCorrelationColorClass(corr),
                                    asset1 === asset2 ? "opacity-50" : "",
                                  ),
                                )}
                              >
                                {corr.toFixed(2)}
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
      </Show>

      <Show when={viewMode() === "montecarlo"}>
        <div class="flex-1 flex flex-col">
          <div class="flex items-center gap-3 px-2 py-1 border-b border-border/30">
            <div class="flex items-center gap-1">
              <span class="text-[9px] text-muted-foreground">Sims:</span>
              {/* TODO: Wire mcSimulations into Monte Carlo compute pipeline */}
              <select
                disabled
                value={String(mcSimulations())}
                onChange={event => {
                  setMcSimulations(Number(event.target.value))
                }}
                class="text-[9px] bg-muted border border-border rounded px-1 py-0.5 opacity-50 cursor-not-allowed"
              >
                <option value="100">100</option>
                <option value="1000">1,000</option>
                <option value="10000">10,000</option>
              </select>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-[9px] text-muted-foreground">Horizon:</span>
              {/* TODO: Wire mcHorizon into Monte Carlo compute pipeline */}
              <select
                disabled
                value={String(mcHorizon())}
                onChange={event => {
                  setMcHorizon(Number(event.target.value))
                }}
                class="text-[9px] bg-muted border border-border rounded px-1 py-0.5 opacity-50 cursor-not-allowed"
              >
                <option value="21">1M</option>
                <option value="63">3M</option>
                <option value="126">6M</option>
                <option value="252">1Y</option>
              </select>
            </div>
          </div>
          <div class="flex-1 p-2 flex flex-col">
            <div class="flex-1 flex items-end gap-px min-h-[80px]">
              <For each={props.monteCarloData}>
                {d => (
                  <div
                    class="flex-1 transition-all"
                    style={{
                      "height": `${(d.frequency / maxFreq()) * 100}%`,
                      "background-color":
                        d.bucket >= 0
                          ? CHART_COLORS.positive
                          : CHART_COLORS.negative,
                    }}
                  />
                )}
              </For>
            </div>
            <div class="flex justify-between text-[9px] text-muted-foreground mt-1">
              <span>-40%</span>
              <span>0</span>
              <span>+40%</span>
            </div>
            {/* TODO: Compute percentiles from Monte Carlo simulation results */}
            <div class="grid grid-cols-3 gap-2 mt-2 text-[10px]">
              <div class="text-center">
                <div class="text-muted-foreground">5th %ile</div>
                <div class="font-mono text-red-400">-22.5%</div>
              </div>
              <div class="text-center">
                <div class="text-muted-foreground">Median</div>
                <div class="font-mono text-green-400">+8.2%</div>
              </div>
              <div class="text-center">
                <div class="text-muted-foreground">95th %ile</div>
                <div class="font-mono text-green-400">+38.5%</div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
