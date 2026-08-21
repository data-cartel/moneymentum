import { createSignal } from "solid-js"
import { MetricSelector } from "../../Prototype/components/MetricSelector"

export const PerformancePanel = () => {
  const [selectedMetricIds, setSelectedMetricIds] = createSignal<string[]>([])
  const [selectedWindowId, setSelectedWindowId] = createSignal<string>("1m")
  const [isMetricSelectorOpen, setIsMetricSelectorOpen] = createSignal(false)

  return (
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div class="flex min-h-0 flex-1">
        {/* Metrics column */}
        <div class="w-[180px] shrink-0 border-r border-border/30 p-3 overflow-auto scrollbar-hide flex flex-col gap-2">
          <MetricSelector
            selectedMetricIds={selectedMetricIds()}
            selectedWindowId={selectedWindowId()}
            onMetricToggle={id => {
              setSelectedMetricIds(previousSelectedMetricIds =>
                previousSelectedMetricIds.includes(id)
                  ? previousSelectedMetricIds.filter(
                      removedMetricId => removedMetricId !== id,
                    )
                  : [...previousSelectedMetricIds, id],
              )
            }}
            onWindowChange={setSelectedWindowId}
            isOpen={isMetricSelectorOpen()}
            onOpenChange={setIsMetricSelectorOpen}
            isFocused={false}
          />
          <div class="flex justify-between pb-2 border-b border-border/30">
            <span class="text-muted-foreground">Total Return</span>
            <span class="font-mono text-muted-foreground">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Sharpe</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Sortino</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Calmar</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Max Drawdown</span>
            <span class="text-red-400 font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Win Rate</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Profit Factor</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Volatility</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Beta</span>
            <span class="font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">VaR 95%</span>
            <span class="text-red-400 font-mono">coming soon...</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">VaR 99%</span>
            <span class="text-red-400 font-mono">coming soon...</span>
          </div>
        </div>
        {/* Chart placeholder */}
        <div class="flex-1 min-w-0 p-2">
          <div class="w-full h-full border border-dashed border-border/50 rounded flex items-center justify-center text-[10px] text-muted-foreground">
            coming soon...
          </div>
        </div>
      </div>
    </div>
  )
}
