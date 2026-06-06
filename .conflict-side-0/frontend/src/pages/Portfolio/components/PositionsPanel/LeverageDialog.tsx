import { createSignal, Show, type JSX } from "solid-js"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { createEffect, onCleanup } from "solid-js"

interface LeverageDialogProps {
  symbol: string
  leverage: number
  maxLeverage: number | undefined
  disabled: boolean
  onLeverageChange: (symbol: string, leverage: number) => void
}

export const LeverageDialog = (props: LeverageDialogProps): JSX.Element => {
  const [open, setOpen] = createSignal(false)

  // Intentional imperative keyboard listener:
  // when the dialog is open we attach a `window` `keydown` handler for `Escape`
  // (`handleEsc`) and remove it via `onCleanup`. This is not derived state and
  // alternatives like `createMemo` or `@tanstack/solid-query` were considered
  // but are not appropriate for event subscription lifecycle.
  createEffect(() => {
    if (open()) {
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setOpen(false)
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
      <Button
        variant="ghost"
        size="sm"
        class="h-auto px-1.5 py-0 text-[10px] font-mono border border-border rounded pointer-events-auto"
        disabled={props.disabled || props.maxLeverage === undefined}
        onClick={() => {
          setOpen(prev => !prev)
        }}
      >
        {props.leverage}x
      </Button>

      <Show when={open()}>
        <div class="fixed inset-0 z-[40] flex items-center justify-center">
          {/* backdrop */}
          <div
            class="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={e => {
              e.stopPropagation()
              setOpen(false)
            }}
          />
          {/* centered modal */}
          <div class="relative z-[50] w-[380px] max-w-[90vw] rounded-lg border border-border bg-background px-4 py-3 shadow-2xl">
            <div class="mb-3">
              <div class="text-xs font-semibold mb-1">
                Leverage {props.symbol}
              </div>
              <div class="text-[11px] text-muted-foreground">
                Max leverage{" "}
                {props.maxLeverage !== undefined
                  ? `${props.maxLeverage.toFixed(1)}x`
                  : "—"}
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11px] font-mono whitespace-nowrap">
                {props.leverage}x
              </span>
              <Slider
                value={[props.leverage]}
                onChange={([leverage]) => {
                  props.onLeverageChange(props.symbol, leverage)
                }}
                minValue={1}
                maxValue={props.maxLeverage ?? 1}
                step={1}
                class="w-full"
              />
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
