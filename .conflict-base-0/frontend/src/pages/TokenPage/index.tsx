import { createSignal, createMemo, Show, untrack } from "solid-js"
import { A, useParams } from "@solidjs/router"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useNetwork } from "@/hooks/useNetwork"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  TimeframeSelect,
  type Timeframe,
} from "@/components/ui/timeframe-select"
import { buttonVariants } from "@/lib/button-variants"
import { AVAILABLE_METRICS } from "./constants"
import ChartComponent, { type MetricSelection } from "./ChartComponent"
import { useTokenData } from "@/hooks/useApi"

const TokenPage = (props: { timeframe: Timeframe }) => {
  const params = useParams<{ ticker: string }>()
  const [selectedMetric, setSelectedMetric] =
    createSignal<MetricSelection>("price")
  const [timeframe, setTimeframe] = createSignal<Timeframe>(
    untrack(() => props.timeframe),
  )
  const { isNetworkSwitching } = useNetwork()

  const tokenQuery = useTokenData(() => params.ticker, timeframe)

  const data = () => tokenQuery.data?.data ?? []

  const selectedMetricLabel = createMemo(() => {
    return (
      AVAILABLE_METRICS.find(m => m.value === selectedMetric())?.label ??
      selectedMetric()
    )
  })

  return (
    <>
      <Show when={tokenQuery.isLoading}>
        <div class="flex items-center justify-center flex-1">
          <Card class="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <p>Loading data for {params.ticker}...</p>
            </CardContent>
          </Card>
        </div>
      </Show>
      <Show when={tokenQuery.error}>
        <div class="flex items-center justify-center flex-1">
          <Card class="w-full max-w-sm border-destructive">
            <CardHeader>
              <CardTitle class="text-destructive">Error</CardTitle>
            </CardHeader>
            <CardContent>
              <p>{tokenQuery.error?.message}</p>
              <A
                class={buttonVariants({
                  variant: "link",
                  className: "p-0 mt-4 h-auto",
                })}
                href="/"
              >
                ← Back to Main Page
              </A>
            </CardContent>
          </Card>
        </div>
      </Show>
      <Show when={!tokenQuery.isLoading && !tokenQuery.error}>
        <Card
          class={twMerge(
            clsx(
              "w-screen h-screen rounded-none border-none px-[2%] pt-[10px] flex flex-col",
              isNetworkSwitching() && "pointer-events-none opacity-50",
            ),
          )}
        >
          <CardHeader>
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-4">
                <A class={buttonVariants({ variant: "ghost" })} href="/">
                  ←&nbsp;Back
                </A>
                <CardTitle class="text-2xl font-bold">
                  {params.ticker} - {selectedMetricLabel()}
                </CardTitle>
              </div>
              <div class="flex items-center gap-4">
                <TimeframeSelect
                  value={timeframe()}
                  onValueChange={setTimeframe}
                  class="w-48"
                />
                <div class="w-48">
                  <Select<(typeof AVAILABLE_METRICS)[number]>
                    options={AVAILABLE_METRICS}
                    optionValue="value"
                    optionTextValue="label"
                    value={AVAILABLE_METRICS.find(
                      m => m.value === selectedMetric(),
                    )}
                    onChange={option => {
                      if (option) {
                        setSelectedMetric(option.value as MetricSelection)
                      }
                    }}
                    itemComponent={itemProps => (
                      <SelectItem item={itemProps.item}>
                        {itemProps.item.rawValue.label}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger>
                      <SelectValue<(typeof AVAILABLE_METRICS)[number]>>
                        {state => state.selectedOption().label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent class="flex-1 p-1">
            <Show
              when={data().length > 0}
              fallback={
                <div class="flex items-center justify-center h-full text-gray-400">
                  No data available for {selectedMetricLabel()}
                </div>
              }
            >
              <ChartComponent
                data={data()}
                selectedMetric={selectedMetric()}
                timeframe={timeframe()}
              />
            </Show>
          </CardContent>
        </Card>
      </Show>
    </>
  )
}

export default TokenPage
