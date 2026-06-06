import {
  createEffect,
  createMemo,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/cn"

interface LeverageEditorTriggerProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  symbol: string
  leverage: number
  maxLeverage?: number
  leverageLimitsIsLoading: boolean
  disabled: boolean
}

interface LeverageSliderEditorProps {
  symbol: string
  leverage: number
  maxLeverage?: number
  onLeverageChange: (symbol: string, leverage: number) => void
}

export const LeverageEditorTrigger = (
  props: LeverageEditorTriggerProps,
): JSX.Element => {
  const isLeverageLoading = () =>
    props.leverageLimitsIsLoading || props.maxLeverage === undefined

  // Intentional imperative keyboard listener:
  // the inline editor needs to close on `Escape`, so we subscribe while it is
  // open and remove the handler via `onCleanup`.
  createEffect(() => {
    if (props.isOpen) {
      const handleEsc = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          props.onClose()
        }
      }
      window.addEventListener("keydown", handleEsc)
      onCleanup(() => {
        window.removeEventListener("keydown", handleEsc)
      })
    }
  })

  return (
    <div class="relative inline-flex flex-col items-start gap-1">
      <TooltipProvider>
        <Tooltip openDelay={0}>
          <TooltipTrigger
            as="span"
            class="inline-flex shrink-0"
            title={
              isLeverageLoading()
                ? "Loading max leverages for tokens"
                : undefined
            }
          >
            <Button
              variant="ghost"
              size="sm"
              class={cn(
                "h-auto w-10 justify-center px-2 py-0.5 text-[10px] font-mono border border-border rounded pointer-events-auto",
                isLeverageLoading() && "opacity-60",
              )}
              disabled={props.disabled || isLeverageLoading()}
              onPointerDown={event => {
                if (!props.isOpen) return

                event.stopPropagation()
              }}
              onClick={() => {
                if (props.isOpen) {
                  props.onClose()
                } else {
                  props.onOpen()
                }
              }}
            >
              {props.leverage}x
            </Button>
          </TooltipTrigger>
          <Show when={isLeverageLoading()}>
            <TooltipContent>Loading max leverages for tokens</TooltipContent>
          </Show>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export const LeverageSliderEditor = (
  props: LeverageSliderEditorProps,
): JSX.Element => {
  const maxLeverage = () => props.maxLeverage ?? 1
  const leverageMarks = createMemo(() =>
    Array.from(
      { length: Math.max(1, Math.floor(maxLeverage())) },
      (_, markIndex) => markIndex + 1,
    ),
  )
  const markLeft = (leverage: number) => {
    const leverageRange = maxLeverage() - 1
    if (leverageRange <= 0) return "0%"
    return `${String(((leverage - 1) / leverageRange) * 100)}%`
  }

  return (
    <div class="h-2 w-full relative">
      <Slider
        value={[props.leverage]}
        onChange={selectedLeverages => {
          const selectedLeverage = selectedLeverages[0]
          props.onLeverageChange(props.symbol, selectedLeverage)
        }}
        minValue={1}
        maxValue={maxLeverage()}
        step={1}
        class="w-full"
        aria-label={`Leverage for ${props.symbol}`}
      />
      <div class="relative mt-1 h-4">
        <For each={leverageMarks()}>
          {leverageMark => (
            <div
              class="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5"
              style={{ left: markLeft(leverageMark) }}
            >
              <div class="h-1.5 w-px bg-muted-foreground/60" />
              <Show
                when={
                  leverageMark === 1 ||
                  leverageMark === props.leverage ||
                  leverageMark === Math.floor(maxLeverage())
                }
              >
                <span class="font-mono text-[9px] leading-none text-muted-foreground">
                  {leverageMark}x
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
