import { For, Show } from "solid-js"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface FactorExposure {
  name: string
  value: string
}

interface FactorAttribution {
  factor: string
  contribution: string
}

interface ConcentrationMetric {
  metric: string
  value: string
}

const PLACEHOLDER = "--"

const defaultExposures = (betaExposureLabel: string): FactorExposure[] => [
  { name: betaExposureLabel, value: PLACEHOLDER },
  { name: "Momentum", value: PLACEHOLDER },
  { name: "Carry", value: PLACEHOLDER },
  { name: "Volatility", value: PLACEHOLDER },
]

const defaultAttribution = (betaExposureLabel: string): FactorAttribution[] =>
  [
    { factor: betaExposureLabel, contribution: PLACEHOLDER },
    { factor: "B to SPY", contribution: PLACEHOLDER },
    { factor: "Momentum", contribution: PLACEHOLDER },
    { factor: "Carry", contribution: PLACEHOLDER },
    { factor: "Volatility", contribution: PLACEHOLDER },
    { factor: "Idiosyncratic", contribution: PLACEHOLDER },
  ].filter(
    (attribution, index) =>
      index === 0 || attribution.factor !== betaExposureLabel,
  )

const defaultConcentration: ConcentrationMetric[] = [
  { metric: "Top Position", value: PLACEHOLDER },
  { metric: "Top 3 Positions", value: PLACEHOLDER },
  { metric: "Top 5 Positions", value: PLACEHOLDER },
  { metric: "Herfindahl Index", value: PLACEHOLDER },
  { metric: "Effective Positions", value: PLACEHOLDER },
]

interface FactorsPanelProps {
  beta: number | null
  isBetaLoading: boolean
  betaError: unknown
  excludedBetaSymbols: string[]
  betaDataAgeHours: number | null
  isBetaDataStale: boolean
  betaMethodology: {
    exposureLabel: string
    benchmark: string
    interval: string
    lookback: string
  }
  exposures?: FactorExposure[]
  attribution?: FactorAttribution[]
  concentration?: ConcentrationMetric[]
}

export const FactorsPanel = (props: FactorsPanelProps) => {
  const exposures = () =>
    props.exposures ?? defaultExposures(props.betaMethodology.exposureLabel)
  const attribution = () =>
    props.attribution ?? defaultAttribution(props.betaMethodology.exposureLabel)
  const concentration = () => props.concentration ?? defaultConcentration
  const betaHasError = () =>
    props.betaError !== null && props.betaError !== undefined
  const betaHasKnownAge = () => props.betaDataAgeHours !== null
  const betaCanRender = () =>
    !props.isBetaLoading && !betaHasError() && betaHasKnownAge()

  return (
    <div class="shrink-0 border border-border rounded flex flex-col min-w-[25%] relative">
      <div class="px-2 py-1 border-b border-border bg-muted/30 font-medium flex items-center justify-between">
        <span>FACTORS</span>
        <kbd class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
          f
        </kbd>
      </div>
      <div class="flex-1 flex flex-col p-2 gap-3 overflow-auto scrollbar-hide">
        {/* Exposures */}
        <div class="space-y-1.5">
          <div class="text-[10px] text-muted-foreground font-medium">
            Exposures
          </div>
          <div class="flex items-center justify-between">
            <TooltipProvider>
              <Tooltip openDelay={0}>
                <TooltipTrigger class="text-muted-foreground truncate">
                  {props.betaMethodology.exposureLabel}
                </TooltipTrigger>
                <TooltipContent class="max-w-[260px]">
                  <div>Benchmark: {props.betaMethodology.benchmark}</div>
                  <div>Interval: {props.betaMethodology.interval}</div>
                  <div>Lookback: {props.betaMethodology.lookback}</div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span class="font-mono">
              <Show
                when={betaCanRender()}
                fallback={
                  <Show
                    when={betaHasError()}
                    fallback={
                      <Show
                        when={props.isBetaLoading}
                        fallback={<span class="text-muted-foreground">--</span>}
                      >
                        <Skeleton class="inline-block h-3 w-10 align-middle" />
                      </Show>
                    }
                  >
                    <span class="text-[10px] text-rose-500">unavailable</span>
                  </Show>
                }
              >
                <Show
                  when={props.beta !== null && betaHasKnownAge()}
                  fallback={<span class="text-muted-foreground">--</span>}
                >
                  <span
                    class={twMerge(
                      clsx(
                        (props.beta ?? 0) > 0 && "text-green-500",
                        (props.beta ?? 0) < 0 && "text-red-500",
                      ),
                    )}
                  >
                    {(props.beta ?? 0) >= 0 ? "+" : ""}
                    {(props.beta ?? 0).toFixed(2)}
                  </span>
                </Show>
              </Show>
            </span>
          </div>
          <Show when={props.excludedBetaSymbols.length > 0}>
            <div class="text-[10px] text-amber-500">
              Renormalized without {props.excludedBetaSymbols.join(", ")}
            </div>
          </Show>
          <Show when={props.isBetaDataStale && props.betaDataAgeHours !== null}>
            <div class="text-[10px] text-amber-500">
              Beta data is {props.betaDataAgeHours}h old
            </div>
          </Show>
          <For each={exposures()}>
            {exposure => (
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground truncate">
                  {exposure.name}
                </span>
                <span class="font-mono">{exposure.value}</span>
              </div>
            )}
          </For>
        </div>

        {/* Attribution */}
        <div class="border-t border-border/50 pt-2">
          <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
            Attribution
          </div>
          <For each={attribution()}>
            {attribution => (
              <div class="flex items-center justify-between mb-1">
                <span class="text-muted-foreground truncate">
                  {attribution.factor}
                </span>
                <span class={twMerge(clsx("w-14 text-right font-mono"))}>
                  {attribution.contribution}
                </span>
              </div>
            )}
          </For>
        </div>

        {/* Concentration */}
        <div class="border-t border-border/50 pt-2">
          <div class="text-[10px] text-muted-foreground font-medium mb-1.5">
            Concentration
          </div>
          <div class="space-y-1">
            <For each={concentration()}>
              {metric => (
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">{metric.metric}</span>
                  <span class="font-mono">{metric.value}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}
