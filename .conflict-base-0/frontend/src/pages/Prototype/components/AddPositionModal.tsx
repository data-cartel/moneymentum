import { createSignal, createEffect, Show, For, onCleanup } from "solid-js"
import { cn } from "@/lib/cn"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface Instrument {
  symbol: string
  type: "perp" | "spot" | "call" | "put"
  rate: number
  rateLabel: string
}

interface AddPositionModalProps {
  isOpen: boolean
  underlying: string
  instruments: Instrument[]
  nav: number
  currentLeverage: number
  onClose: () => void
  onAddPosition: (params: {
    symbol: string
    direction: "long" | "short"
    weight: number
  }) => void
}

type Step = "instrument" | "configure"
type Direction = "long" | "short"
type SizeMode = "weight" | "notional"

export const AddPositionModal = (props: AddPositionModalProps) => {
  const [step, setStep] = createSignal<Step>("instrument")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [selectedInstrument, setSelectedInstrument] =
    createSignal<Instrument | null>(null)
  const [direction, setDirection] = createSignal<Direction>("long")
  const [sizeMode, setSizeMode] = createSignal<SizeMode>("notional")
  const [sizeValue, setSizeValue] = createSignal("5000")
  const [validationError, setValidationError] = createSignal<string | null>(
    null,
  )

  createEffect(() => {
    if (props.isOpen) {
      setStep("instrument")
      setSelectedIndex(0)
      setSelectedInstrument(null)
      setDirection("long")
      setSizeMode("notional")
      setSizeValue("5000")
      setValidationError(null)
    }
  })

  const handleSelectInstrument = () => {
    const inst = props.instruments[selectedIndex()]
    setSelectedInstrument(inst)
    setStep("configure")
  }

  const handleBack = () => {
    setStep("instrument")
    setSelectedInstrument(null)
  }

  const handleConfirm = () => {
    const inst = selectedInstrument()
    if (!inst) return

    const numericValue = parseFloat(sizeValue())
    if (!isFinite(numericValue) || numericValue <= 0) {
      setValidationError("Size must be a positive number.")
      return
    }

    const denominator =
      sizeMode() === "notional" ? props.nav * props.currentLeverage : 100
    if (denominator <= 0) {
      setValidationError(
        "Cannot compute weight: portfolio NAV or leverage is zero.",
      )
      return
    }

    props.onAddPosition({
      symbol: inst.symbol,
      direction: direction(),
      weight: computedWeight(),
    })
    props.onClose()
  }

  // Custom j/k/Enter navigation for instrument selection step
  createEffect(() => {
    if (!props.isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        if (step() === "configure") {
          handleBack()
        } else {
          props.onClose()
        }
        return
      }

      if (step() === "instrument") {
        if (event.key === "j" || event.key === "ArrowDown") {
          event.preventDefault()
          setSelectedIndex(prev =>
            Math.min(prev + 1, props.instruments.length - 1),
          )
        } else if (event.key === "k" || event.key === "ArrowUp") {
          event.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
        } else if (event.key === "Enter") {
          event.preventDefault()
          handleSelectInstrument()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  const portfolioDenominator = () => props.nav * props.currentLeverage

  const rawWeight = () => {
    if (sizeMode() === "weight") {
      return (parseFloat(sizeValue()) || 0) / 100
    }

    const denominator = portfolioDenominator()
    if (denominator <= 0) {
      return 0
    }

    return (parseFloat(sizeValue()) || 0) / denominator
  }

  const computedWeight = () => Math.max(0, Math.min(1, rawWeight()))

  const computedNotional = () => {
    if (sizeMode() === "notional") {
      return parseFloat(sizeValue()) || 0
    }

    const denominator = portfolioDenominator()
    if (denominator <= 0) {
      return 0
    }

    return ((parseFloat(sizeValue()) || 0) / 100) * denominator
  }

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent class="w-[400px] max-h-[80vh] overflow-hidden p-0">
        <DialogHeader class="px-4 py-3 border-b border-border bg-muted/30">
          <DialogTitle>
            {step() === "instrument"
              ? `Add ${props.underlying} Position`
              : `Configure: ${selectedInstrument()?.symbol}`}
          </DialogTitle>
        </DialogHeader>

        <div class="p-4">
          <Show
            when={step() === "instrument"}
            fallback={
              <div class="space-y-4">
                {/* Direction */}
                <div>
                  <div class="text-sm text-muted-foreground mb-2">
                    Direction
                  </div>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDirection("long")
                      }}
                      class={cn(
                        "flex-1 py-2 rounded font-medium transition-colors",
                        direction() === "long"
                          ? "bg-green-500/20 text-green-500 border border-green-500"
                          : "bg-muted text-muted-foreground border border-border hover:border-muted-foreground",
                      )}
                    >
                      LONG
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDirection("short")
                      }}
                      class={cn(
                        "flex-1 py-2 rounded font-medium transition-colors",
                        direction() === "short"
                          ? "bg-red-500/20 text-red-500 border border-red-500"
                          : "bg-muted text-muted-foreground border border-border hover:border-muted-foreground",
                      )}
                    >
                      SHORT
                    </button>
                  </div>
                </div>

                {/* Size */}
                <div>
                  <div class="text-sm text-muted-foreground mb-2">Size</div>
                  <div class="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSizeMode("weight")
                      }}
                      class={cn(
                        "px-3 py-1 rounded text-sm transition-colors",
                        sizeMode() === "weight"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Weight %
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSizeMode("notional")
                      }}
                      class={cn(
                        "px-3 py-1 rounded text-sm transition-colors",
                        sizeMode() === "notional"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Notional $
                    </button>
                  </div>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {sizeMode() === "weight" ? "%" : "$"}
                    </span>
                    <input
                      type="text"
                      value={sizeValue()}
                      onInput={event => {
                        setSizeValue(event.currentTarget.value)
                        setValidationError(null)
                      }}
                      class="w-full pl-8 pr-3 py-2 bg-muted border border-border rounded focus:outline-none focus:border-primary font-mono"
                      placeholder={sizeMode() === "weight" ? "2.0" : "5000"}
                    />
                  </div>
                </div>

                <Show when={validationError()}>
                  <p class="text-sm text-red-500" role="alert">
                    {validationError()}
                  </p>
                </Show>

                {/* Preview */}
                <div class="p-3 bg-muted/50 rounded border border-border">
                  <div class="text-sm text-muted-foreground mb-2">Preview</div>
                  <div class="space-y-1 text-sm">
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">
                        Portfolio weight
                      </span>
                      <span class="font-mono">
                        0% → {(computedWeight() * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">Notional</span>
                      <span class="font-mono">
                        ${computedNotional().toLocaleString()}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted-foreground">
                        Rate ({selectedInstrument()?.rateLabel})
                      </span>
                      <span
                        class={cn(
                          "font-mono",
                          (selectedInstrument()?.rate ?? 0) > 0
                            ? "text-green-500"
                            : (selectedInstrument()?.rate ?? 0) < 0
                              ? "text-red-500"
                              : "",
                        )}
                      >
                        {(selectedInstrument()?.rate ?? 0) > 0 ? "+" : ""}
                        {((selectedInstrument()?.rate ?? 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div class="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    class="flex-1 py-2 bg-muted text-muted-foreground rounded hover:text-foreground transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    class="flex-1 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors font-medium"
                  >
                    Add Position
                  </button>
                </div>

                <div class="text-xs text-muted-foreground pt-2 border-t border-border">
                  <kbd class="px-1 py-0.5 bg-muted rounded text-[10px]">
                    Tab
                  </kbd>{" "}
                  to switch fields,{" "}
                  <kbd class="px-1 py-0.5 bg-muted rounded text-[10px]">
                    Enter
                  </kbd>{" "}
                  to confirm,{" "}
                  <kbd class="px-1 py-0.5 bg-muted rounded text-[10px]">
                    Esc
                  </kbd>{" "}
                  to go back
                </div>
              </div>
            }
          >
            <div class="space-y-2">
              <div class="text-sm text-muted-foreground mb-3">
                Select instrument:
              </div>
              <For each={props.instruments}>
                {(inst, index) => (
                  <div
                    onClick={() => {
                      setSelectedIndex(index())
                      handleSelectInstrument()
                    }}
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        setSelectedIndex(index())
                        handleSelectInstrument()
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    class={cn(
                      "p-3 rounded border cursor-pointer transition-colors",
                      selectedIndex() === index()
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground",
                    )}
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <div
                          class={cn(
                            "w-2 h-2 rounded-full",
                            selectedIndex() === index()
                              ? "bg-primary"
                              : "bg-muted-foreground/30",
                          )}
                        />
                        <span class="font-medium">{inst.symbol}</span>
                        <span class="text-xs text-muted-foreground uppercase">
                          ({inst.type})
                        </span>
                      </div>
                      <span
                        class={cn(
                          "font-mono text-sm",
                          inst.rate > 0
                            ? "text-green-500"
                            : inst.rate < 0
                              ? "text-red-500"
                              : "text-muted-foreground",
                        )}
                      >
                        {inst.rate > 0 ? "+" : ""}
                        {(inst.rate * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div class="text-xs text-muted-foreground mt-1 ml-4">
                      {inst.rateLabel}
                    </div>
                  </div>
                )}
              </For>
              <div class="text-xs text-muted-foreground mt-4 pt-2 border-t border-border">
                <kbd class="px-1 py-0.5 bg-muted rounded text-[10px]">j</kbd>/
                <kbd class="px-1 py-0.5 bg-muted rounded text-[10px]">k</kbd> to
                navigate,{" "}
                <kbd class="px-1 py-0.5 bg-muted rounded text-[10px]">
                  Enter
                </kbd>{" "}
                to select
              </div>
            </div>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  )
}
