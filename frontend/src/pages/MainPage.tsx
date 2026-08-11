import { createSignal, createMemo, Show } from "solid-js"
import { columns } from "@/components/ui/columns"
import { VirtualizedDataTable } from "@/components/ui/virtualized-data-table"
import { Calendar22 as DatePicker } from "@/components/ui/date-picker"
import {
  TimeframeSelect,
  type Timeframe,
} from "@/components/ui/timeframe-select"
import { cn } from "@/lib/cn"
import { getErrorMessage } from "@/lib/error-message"
import { Button } from "@/components/ui/button"
import {
  useDateRange,
  useAnalysisData,
  useReloadData,
  useStopReload,
} from "@/hooks/useApi"
import { useNetwork } from "@/hooks/useNetwork"

interface ManualDateSelection {
  timeframe: Timeframe
  startDate: Date | null
  endDate: Date | null
}

const MainPage = () => {
  const { isNetworkSwitching } = useNetwork()
  const [timeframe, setTimeframe] = createSignal<Timeframe>("1h")
  const [manualDateSelection, setManualDateSelection] =
    createSignal<ManualDateSelection | null>(null)

  const dateRangeQuery = useDateRange(timeframe)

  const dateAvailability = createMemo(() => {
    const rangeData = dateRangeQuery.data
    if (!rangeData) {
      return { maxAvailableDate: null, minAvailableDate: null }
    }
    return {
      maxAvailableDate: new Date(
        `${rangeData.max_date.split("T")[0]}T00:00:00Z`,
      ),
      minAvailableDate: new Date(
        `${rangeData.min_date.split("T")[0]}T00:00:00Z`,
      ),
    }
  })

  const dateRange = createMemo(() => {
    const manual = manualDateSelection()
    const { maxAvailableDate } = dateAvailability()
    const isManualSelectionForCurrentTimeframe =
      manual?.timeframe === timeframe()
    if (isManualSelectionForCurrentTimeframe) {
      return {
        startDate: manual.startDate,
        endDate: manual.endDate,
      }
    }
    return { startDate: maxAvailableDate, endDate: maxAvailableDate }
  })

  const handleDateChange = (
    field: "startDate" | "endDate",
    date: Date | null,
  ) => {
    const { maxAvailableDate } = dateAvailability()
    setManualDateSelection(prev => {
      const sameTimeframe = prev?.timeframe === timeframe()
      const newStartDate =
        field === "startDate"
          ? date
          : sameTimeframe
            ? prev.startDate
            : maxAvailableDate
      const newEndDate =
        field === "endDate"
          ? date
          : sameTimeframe
            ? prev.endDate
            : maxAvailableDate

      return {
        timeframe: timeframe(),
        startDate: newStartDate,
        endDate: newEndDate,
      }
    })
  }

  const analysisQuery = useAnalysisData(() => ({
    startDate: dateRange().startDate?.toISOString().split("T")[0] ?? "",
    endDate: dateRange().endDate?.toISOString().split("T")[0] ?? "",
    timeframe: timeframe(),
  }))

  const reloadMutation = useReloadData()
  const stopReloadMutation = useStopReload()

  const handleReload = (mode = "analysis_only") => {
    reloadMutation.mutate({ mode })
  }

  const handleStopReload = () => {
    stopReloadMutation.mutate()
  }

  const loading = () =>
    dateRangeQuery.isLoading ||
    analysisQuery.isLoading ||
    reloadMutation.isPending
  const error = () => {
    const failure = dateRangeQuery.error ?? analysisQuery.error
    return failure ? getErrorMessage(failure) : null
  }
  const data = () => analysisQuery.data?.data ?? []
  const message = () => analysisQuery.data?.message ?? null

  return (
    <>
      <Show when={loading()}>
        <div class="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap rounded p-4 text-sm">
          <div class="flex items-center gap-1">
            <span>Loading data</span>
            <span class="inline-flex">
              <span class="animate-bounce [animation-delay:-0.3s]">.</span>
              <span class="animate-bounce [animation-delay:-0.15s]">.</span>
              <span class="animate-bounce">.</span>
            </span>
          </div>
          <Show when={reloadMutation.isPending}>
            <button
              type="button"
              onClick={handleStopReload}
              class="mt-4 rounded-md border px-3 py-2"
            >
              Stop reloading
            </button>
          </Show>
        </div>
      </Show>
      <Show when={!loading() && error()}>
        <div class="container mx-auto py-10 flex flex-col items-center gap-3">
          <div class="text-destructive text-lg font-medium">
            Unable to load data
          </div>
          <div class="text-sm text-muted-foreground max-w-md text-center">
            The analytics server is not responding. Start the backend or check
            the connection.
          </div>
          <button
            type="button"
            onClick={() => {
              void dateRangeQuery.refetch()
            }}
            class="mt-2 rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
          >
            Retry
          </button>
        </div>
      </Show>
      <Show when={!loading() && !error()}>
        <div
          class={cn(
            "container mx-auto py-2",
            isNetworkSwitching() && "pointer-events-none opacity-80",
          )}
        >
          <div class="mb-4 flex items-end justify-start gap-4">
            <TimeframeSelect
              value={timeframe()}
              onValueChange={setTimeframe}
              class="w-[180px]"
            />
            <DatePicker
              label="Start Date"
              selected={dateRange().startDate}
              onChange={date => {
                handleDateChange("startDate", date)
              }}
              minDate={dateAvailability().minAvailableDate ?? undefined}
              maxDate={dateAvailability().maxAvailableDate ?? undefined}
            />
            <DatePicker
              label="End Date"
              selected={dateRange().endDate}
              onChange={date => {
                handleDateChange("endDate", date)
              }}
              minDate={dateAvailability().minAvailableDate ?? undefined}
              maxDate={dateAvailability().maxAvailableDate ?? undefined}
            />
            <div>
              <Button
                onClick={() => {
                  handleReload("analysis_only")
                }}
                disabled={isNetworkSwitching()}
              >
                Reload Data
              </Button>
            </div>
          </div>
          <Show when={isNetworkSwitching()}>
            <div class="mb-4 text-center text-sm text-muted-foreground">
              Switching network... Please wait
            </div>
          </Show>
          <Show when={message()}>
            <div class="mb-4 text-center">{message()}</div>
          </Show>
          <VirtualizedDataTable columns={columns} data={data()} />
        </div>
      </Show>
    </>
  )
}

export default MainPage
