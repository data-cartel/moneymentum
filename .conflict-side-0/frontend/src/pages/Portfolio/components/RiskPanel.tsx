import { For } from "solid-js"

const COMING_SOON = "coming soon..."

const mockRiskMetrics = {
  var95: COMING_SOON,
  var99: COMING_SOON,
  diversificationRatio: COMING_SOON,
  effectiveBets: COMING_SOON,
}

const mockStressTests = [
  { scenario: "BTC -20%", portfolioImpact: COMING_SOON },
  { scenario: "SPX -10%", portfolioImpact: COMING_SOON },
  { scenario: "Rates +200bps", portfolioImpact: COMING_SOON },
]

const mockMonteCarlo = [
  { bucket: -0.3, frequency: 2 },
  { bucket: -0.2, frequency: 5 },
  { bucket: -0.1, frequency: 9 },
  { bucket: 0, frequency: 12 },
  { bucket: 0.1, frequency: 8 },
  { bucket: 0.2, frequency: 4 },
]

const monteCarloMaxFreq = Math.max(
  ...mockMonteCarlo.map(monteCarloPoint => monteCarloPoint.frequency),
)

const correlationAssets = ["BTC", "ETH", "SPX", "GLD"]

const correlationValues: Record<string, number> = {
  "BTC|BTC": 1,
  "BTC|ETH": 0.8,
  "BTC|SPX": 0.3,
  "BTC|GLD": 0.1,
  "ETH|BTC": 0.8,
  "ETH|ETH": 1,
  "ETH|SPX": 0.25,
  "ETH|GLD": 0.05,
  "SPX|BTC": 0.3,
  "SPX|ETH": 0.25,
  "SPX|SPX": 1,
  "SPX|GLD": -0.2,
  "GLD|BTC": 0.1,
  "GLD|ETH": 0.05,
  "GLD|SPX": -0.2,
  "GLD|GLD": 1,
}

const getCorrelation = (a1: string, a2: string): number =>
  correlationValues[`${a1}|${a2}`] ?? 0

const getCorrelationColor = (value: number): string => {
  if (value >= 0.75) return "bg-emerald-500/70 text-emerald-50"
  if (value >= 0.5) return "bg-emerald-500/40 text-emerald-50"
  if (value >= 0.25) return "bg-emerald-500/20 text-emerald-900"
  if (value <= -0.75) return "bg-red-500/70 text-red-50"
  if (value <= -0.5) return "bg-red-500/40 text-red-50"
  if (value <= -0.25) return "bg-red-500/20 text-red-900"
  return "bg-muted text-foreground"
}

export const RiskPanel = () => {
  return (
    <div class="flex-1 border border-border rounded flex flex-col min-w-0">
      <div class="px-2 py-1 border-b border-border bg-muted/30 font-medium">
        RISK
      </div>
      <div class="flex-1 flex flex-col p-2 gap-3 overflow-auto scrollbar-hide">
        {/* Top metrics */}
        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
          <div class="flex justify-between">
            <span class="text-muted-foreground">VaR 95%</span>
            <span class="text-red-400 font-mono">{mockRiskMetrics.var95}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">VaR 99%</span>
            <span class="text-red-400 font-mono">{mockRiskMetrics.var99}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Diversification</span>
            <span class="font-mono">
              {mockRiskMetrics.diversificationRatio}
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Effective Bets</span>
            <span class="font-mono">{mockRiskMetrics.effectiveBets}</span>
          </div>
        </div>

        {/* Stress tests */}
        <div class="border-t border-border/50 pt-2">
          <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
            Stress Tests
          </div>
          <div class="space-y-1">
            <For each={mockStressTests}>
              {stressTest => (
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground truncate">
                    {stressTest.scenario}
                  </span>
                  <span class="text-foreground font-mono">
                    {stressTest.portfolioImpact}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Monte Carlo */}
        <div class="border-t border-border/50 pt-2">
          <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
            Monte Carlo (1 Year) — coming soon...
          </div>
          <div class="flex items-end gap-px h-12">
            <For each={mockMonteCarlo}>
              {monteCarloPoint => (
                <div
                  class="flex-1"
                  style={{
                    "height": `${
                      (monteCarloPoint.frequency / monteCarloMaxFreq) * 100
                    }%`,
                    "background-color":
                      monteCarloPoint.bucket >= 0 ? "#22c55e" : "#ef4444",
                  }}
                />
              )}
            </For>
          </div>
        </div>

        {/* Correlation heatmap */}
        <div class="border-t border-border/50 pt-2">
          <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
            Correlation — coming soon...
          </div>
          <table class="w-full">
            <thead>
              <tr>
                <th class="p-0.5" />
                <For each={correlationAssets}>
                  {columnAsset => (
                    <th class="p-0.5 text-[10px] text-muted-foreground font-medium text-center">
                      {columnAsset}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={correlationAssets}>
                {rowAsset => (
                  <tr>
                    <td class="p-0.5 text-[10px] text-muted-foreground font-medium">
                      {rowAsset}
                    </td>
                    <For each={correlationAssets}>
                      {colAsset => {
                        const corr = getCorrelation(rowAsset, colAsset)
                        return (
                          <td class="p-0.5 text-center">
                            <div
                              class={`w-full h-4 flex items-center justify-center rounded text-[9px] font-mono ${getCorrelationColor(
                                corr,
                              )} ${rowAsset === colAsset ? "opacity-40" : ""}`}
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
  )
}
