import { createSignal, createEffect, Show, For, onCleanup } from "solid-js"
import { ChevronDown, Check } from "lucide-solid"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import { METRIC_OPTIONS, WINDOW_OPTIONS } from "../metrics/registry"

interface MetricSelectorProps {
  selectedMetricIds: string[]
  selectedWindowId: string
  onMetricToggle: (metricId: string) => void
  onWindowChange: (windowId: string) => void
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  isFocused?: boolean
}

export const MetricSelector = (props: MetricSelectorProps) => {
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)

  createEffect(() => {
    if (props.isOpen) {
      setHighlightedIndex(0)
    }
  })

  const needsWindow = () =>
    props.selectedMetricIds.some(id =>
      ["sharpe", "sortino", "volatility"].includes(id),
    )

  createEffect(() => {
    const isFocused = props.isFocused ?? false
    if (!isFocused) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (props.isOpen) {
        if (event.key === "ArrowDown" || event.key === "j") {
          event.preventDefault()
          setHighlightedIndex(prev =>
            prev < METRIC_OPTIONS.length - 1 ? prev + 1 : prev,
          )
          return
        }
        if (event.key === "ArrowUp" || event.key === "k") {
          event.preventDefault()
          setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev))
          return
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          const metric = METRIC_OPTIONS[highlightedIndex()]
          props.onMetricToggle(metric.id)
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          props.onOpenChange?.(false)
          return
        }
      }

      if (event.key === "m") {
        event.preventDefault()
        props.onOpenChange?.(!props.isOpen)
        return
      }

      if (!props.isOpen && needsWindow()) {
        const currentIndex = WINDOW_OPTIONS.findIndex(
          w => w.id === props.selectedWindowId,
        )
        if (event.key === "ArrowLeft" || event.key === "h") {
          event.preventDefault()
          if (currentIndex > 0) {
            props.onWindowChange(WINDOW_OPTIONS[currentIndex - 1].id)
          }
          return
        }
        if (event.key === "ArrowRight" || event.key === "l") {
          event.preventDefault()
          if (currentIndex < WINDOW_OPTIONS.length - 1) {
            props.onWindowChange(WINDOW_OPTIONS[currentIndex + 1].id)
          }
          return
        }

        if (event.key >= "1" && event.key <= String(WINDOW_OPTIONS.length)) {
          event.preventDefault()
          const index = parseInt(event.key) - 1
          if (index < WINDOW_OPTIONS.length) {
            props.onWindowChange(WINDOW_OPTIONS[index].id)
          }
          return
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  const selectedNames = () =>
    props.selectedMetricIds
      .map(id => METRIC_OPTIONS.find(m => m.id === id)?.name)
      .filter(Boolean)

  const displayText = () => {
    const names = selectedNames()
    return names.length === 0
      ? "Select metrics"
      : names.length === 1
        ? names[0]
        : `${names.length} metrics`
  }

  const isFocused = () => props.isFocused ?? false

  return (
    <div
      class={twMerge(
        clsx(
          "flex items-center gap-2 relative",
          isFocused() && "ring-1 ring-primary/50 rounded px-1 -mx-1",
        ),
      )}
      data-testid="metric-selector"
    >
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1 bg-muted/50 border border-border rounded px-2 py-0.5 text-[10px] hover:bg-muted/70"
          onClick={() => props.onOpenChange?.(!props.isOpen)}
          aria-expanded={props.isOpen}
          aria-controls="metric-selector-popup"
        >
          <Show when={isFocused()}>
            <span class="text-[8px] opacity-60">m</span>
          </Show>
          <span class="truncate max-w-[100px]">{displayText()}</span>
          <ChevronDown
            class={twMerge(
              clsx(
                "h-3 w-3 transition-transform",
                props.isOpen && "rotate-180",
              ),
            )}
          />
        </button>
        <Show when={props.isOpen}>
          <div
            id="metric-selector-popup"
            role="listbox"
            aria-label="Select metrics"
            class="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md min-w-[140px] py-1"
          >
            <For each={METRIC_OPTIONS}>
              {(metric, index) => {
                const isSelected = () =>
                  props.selectedMetricIds.includes(metric.id)
                const isHighlighted = () => highlightedIndex() === index()
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={props.selectedMetricIds.includes(metric.id)}
                    onClick={() => {
                      props.onMetricToggle(metric.id)
                    }}
                    class={twMerge(
                      clsx(
                        "w-full flex items-center gap-2 px-2 py-1 text-[10px] text-left hover:bg-muted/50",
                        isHighlighted() && "bg-muted/70",
                      ),
                    )}
                  >
                    <span
                      class={twMerge(
                        clsx(
                          "w-3.5 h-3.5 rounded-sm border border-border flex items-center justify-center",
                          isSelected() && "bg-primary border-primary",
                        ),
                      )}
                    >
                      <Show when={isSelected()}>
                        <Check class="h-2.5 w-2.5 text-primary-foreground" />
                      </Show>
                    </span>
                    {metric.name}
                  </button>
                )
              }}
            </For>
            <Show when={isFocused()}>
              <div class="border-t border-border mt-1 pt-1 px-2 text-[8px] text-muted-foreground">
                <kbd class="px-0.5 bg-muted rounded">j</kbd>/
                <kbd class="px-0.5 bg-muted rounded">k</kbd> navigate,{" "}
                <kbd class="px-0.5 bg-muted rounded">Enter</kbd> toggle
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={needsWindow()}>
        <div class="flex items-center gap-0.5">
          <Show when={isFocused()}>
            <span class="text-[8px] text-muted-foreground mr-0.5">
              &#8592;&#8594;
            </span>
          </Show>
          <For each={WINDOW_OPTIONS}>
            {(windowOpt, index) => (
              <button
                type="button"
                onClick={() => {
                  props.onWindowChange(windowOpt.id)
                }}
                class={twMerge(
                  clsx(
                    "px-1 py-0.5 text-[9px] rounded transition-colors",
                    props.selectedWindowId === windowOpt.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  ),
                )}
              >
                <Show when={isFocused()}>
                  <span class="text-[8px] opacity-60 mr-0.5">
                    {index() + 1}
                  </span>
                </Show>
                {windowOpt.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
