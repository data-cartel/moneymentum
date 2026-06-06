import { createSignal, createEffect, For, onCleanup, untrack } from "solid-js"
import { X } from "lucide-solid"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"
import type { FactorExposure } from "../mockData"

interface FactorConfigPanelProps {
  factors: FactorExposure[]
  onClose: () => void
  onSave: (factors: FactorExposure[]) => void
}

const DEFAULT_BENCHMARKS = ["BTC", "ETH", "SPY", "QQQ", "DXY", "Gold"]

export const FactorConfigPanel = (props: FactorConfigPanelProps) => {
  const [editedFactors, setEditedFactors] = createSignal<FactorExposure[]>(
    untrack(() => props.factors),
  )
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [focusMode, setFocusMode] = createSignal<"factors" | "benchmarks">(
    "factors",
  )

  const handleRemove = (index: number) => {
    setEditedFactors(prevFactors => prevFactors.filter((_, i) => i !== index))
  }

  const handleAdd = (benchmark: string) => {
    setEditedFactors(prevFactors => {
      const newFactor: FactorExposure = {
        name: `β to ${benchmark}`,
        value: 0,
        color: `hsl(var(--chart-${(prevFactors.length % 5) + 1}))`,
      }
      return [...prevFactors, newFactor]
    })
  }

  const handleSave = () => {
    props.onSave(editedFactors())
    props.onClose()
  }

  const existingBenchmarks = () =>
    editedFactors()
      .filter(factor => factor.name.startsWith("β to "))
      .map(factor => factor.name.replace("β to ", ""))

  const availableBenchmarks = () =>
    DEFAULT_BENCHMARKS.filter(
      benchmark => !existingBenchmarks().includes(benchmark),
    )

  const toggleBenchmark = (benchmark: string) => {
    setEditedFactors(prevFactors => {
      const matchingFactor = prevFactors.find(
        factor => factor.name === `β to ${benchmark}`,
      )
      if (matchingFactor) {
        return prevFactors.filter(factor => factor.name !== `β to ${benchmark}`)
      } else {
        const newFactor: FactorExposure = {
          name: `β to ${benchmark}`,
          value: 0,
          color: `hsl(var(--chart-${(prevFactors.length % 5) + 1}))`,
        }
        return [...prevFactors, newFactor]
      }
    })
  }

  createEffect(() => {
    const factors = editedFactors()
    const available = availableBenchmarks()

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if (key === "escape" || key === "f") {
        event.preventDefault()
        handleSave()
        return
      }

      if (key === "enter") {
        event.preventDefault()
        if (focusMode() === "factors" && factors.length > 0) {
          handleSave()
        } else if (focusMode() === "benchmarks" && available.length > 0) {
          handleAdd(available[selectedIndex()])
          setFocusMode("factors")
          setSelectedIndex(factors.length)
        }
        return
      }

      const numKey = parseInt(event.key)
      if (numKey >= 1 && numKey <= DEFAULT_BENCHMARKS.length) {
        event.preventDefault()
        toggleBenchmark(DEFAULT_BENCHMARKS[numKey - 1])
        return
      }

      if (key === "j" || key === "arrowdown") {
        event.preventDefault()
        const maxIndex =
          focusMode() === "factors" ? factors.length - 1 : available.length - 1
        setSelectedIndex(prev => Math.min(prev + 1, maxIndex))
        return
      }

      if (key === "k" || key === "arrowup") {
        event.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        return
      }

      if (key === "d" || key === "backspace") {
        event.preventDefault()
        if (focusMode() === "factors" && factors.length > 0) {
          handleRemove(selectedIndex())
          if (selectedIndex() >= factors.length - 1) {
            setSelectedIndex(Math.max(0, factors.length - 2))
          }
        }
        return
      }

      if (key === "tab") {
        event.preventDefault()
        if (focusMode() === "factors" && available.length > 0) {
          setFocusMode("benchmarks")
          setSelectedIndex(0)
        } else if (focusMode() === "benchmarks") {
          setFocusMode("factors")
          setSelectedIndex(0)
        }
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  createEffect(() => {
    const factors = editedFactors()
    if (selectedIndex() >= factors.length && factors.length > 0) {
      setSelectedIndex(factors.length - 1)
    }
  })

  return (
    <div class="absolute inset-0 bg-background/95 z-10 flex flex-col p-2">
      <div class="flex items-center justify-between mb-2">
        <span class="font-medium">Configure Factors</span>
        <button
          type="button"
          onClick={() => {
            props.onClose()
          }}
          class="text-muted-foreground hover:text-foreground"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="flex-1 overflow-auto space-y-1.5">
        <div class="text-[10px] text-muted-foreground font-medium mb-1">
          Active Factors
        </div>
        <For each={editedFactors()}>
          {(factor, index) => (
            <div
              class={twMerge(
                clsx(
                  "flex items-center justify-between px-2 py-1 rounded",
                  focusMode() === "factors" && selectedIndex() === index()
                    ? "bg-primary/20 ring-1 ring-primary/50"
                    : "bg-muted/30",
                ),
              )}
            >
              <span class="text-[11px]">{factor.name}</span>
              <button
                type="button"
                onClick={() => {
                  handleRemove(index())
                }}
                class="text-muted-foreground hover:text-destructive"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
          )}
        </For>

        <div class="text-[10px] text-muted-foreground font-medium mt-3 mb-1">
          Quick Toggle Benchmarks
        </div>
        <div class="flex flex-wrap gap-1">
          <For each={DEFAULT_BENCHMARKS}>
            {(benchmark, index) => {
              const isActive = () => existingBenchmarks().includes(benchmark)
              return (
                <button
                  type="button"
                  onClick={() => {
                    toggleBenchmark(benchmark)
                  }}
                  class={twMerge(
                    clsx(
                      "flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors",
                      isActive()
                        ? "bg-primary/20 border-primary/50 text-primary"
                        : "bg-muted/50 border-transparent hover:bg-muted",
                    ),
                  )}
                >
                  <span class="text-[8px] opacity-60">{index() + 1}</span>
                  {benchmark}
                  {isActive() && <span class="text-[8px]">&#10003;</span>}
                </button>
              )
            }}
          </For>
        </div>
      </div>

      <div class="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <span class="text-[9px] text-muted-foreground">
          <kbd class="px-1 py-0.5 bg-muted rounded text-[8px]">1-6</kbd> toggle
          {" · "}
          <kbd class="px-1 py-0.5 bg-muted rounded text-[8px]">f</kbd> close
        </span>
        <button
          type="button"
          onClick={handleSave}
          class="px-3 py-1 text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 rounded"
        >
          Done
        </button>
      </div>
    </div>
  )
}
