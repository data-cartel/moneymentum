import {
  createSignal,
  createEffect,
  Show,
  For,
  createMemo,
  onCleanup,
} from "solid-js"
import type { JSX } from "solid-js"
import Decimal from "decimal.js"
import { Trash2, Undo2, CircleAlert, X } from "lucide-solid"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/cn"
import type { OrderSide } from "@/hooks/useTrading"
import { MIN_USD, type PortfolioInterface } from "../../hooks/usePortfolioState"
import {
  betaClassName,
  formatDecimal,
  formatPercent,
  fundingRateClassName,
  riskAdjustedReturnClassName,
  signedMetricClassName,
  volatilityClassName,
} from "./allSymbolRowModel"
import {
  LeverageEditorTrigger,
  LeverageSliderEditor,
} from "./LeverageInlineEditor"
import {
  positionBodyCellClass,
  positionBodyCellInnerClass,
  positionStickyBodyClass,
  positionStickyLeverageCloseClass,
  SIDE_BADGE_CLASS,
} from "./positionColumnLayout"
import {
  leverageEditorColumnSpan,
  type PortfolioMetricColumnId,
} from "./portfolioMetricVisibility"
import { positionCellInputProps } from "./positionCellInput"

export interface PositionRowMetrics {
  signedFundingRate: number | null
  beta: number | null
  volatility: number | null
  sharpe: number | null
  sortino: number | null
  momentum: number | null
  carry: number | null
}
const LEVERAGE_KEYBOARD_ENTRY_TIMEOUT_MS = 1_000

const getSideBadgeClass = (side: OrderSide) =>
  side === "buy"
    ? "bg-green-500/20 text-green-500"
    : "bg-red-500/20 text-red-500"

export const PositionsPanelRow = (props: {
  symbol: string
  position: () => PortfolioInterface
  status: "new" | "unchanged" | "changed" | "closing"
  visibleMetricColumns: PortfolioMetricColumnId[]
  rowMetrics: PositionRowMetrics
  maxLeverage?: number
  leverageLimitsIsLoading: boolean
  isPrecise: boolean
  fundingIsLoading: boolean
  factorsIsLoading: boolean
  onRemove: (symbol: string) => void
  onUndoRemove: (symbol: string) => void
  onSideChange: (symbol: string, side: OrderSide) => void
  onLeverageChange: (symbol: string, leverage: number) => void
  onNotionalChange: (symbol: string, notional: number) => void
  onWeightChange: (symbol: string, percentage: number) => void
  onCellEditFocus?: () => void
  onCellEditBlur?: (event: FocusEvent) => void
  totalNotional: number
  symbolsBelowMinimum: string[]
  symbolsDeltaBelowMinimum: string[]
  symbolDelta: number
}): JSX.Element => {
  const notional = () => props.position().notional
  const weight = createMemo(() => {
    if (props.totalNotional === 0) return "0.00"
    return new Decimal(notional()).div(props.totalNotional).mul(100).toFixed(2)
  })

  const [weightInput, setWeightInput] = createSignal("")
  const [isWeightFocused, setIsWeightFocused] = createSignal(false)

  // createEffect: sync external weight into local input when not focused
  createEffect(() => {
    if (!isWeightFocused()) {
      setWeightInput(weight())
    }
  })

  const [notionalInput, setNotionalInput] = createSignal(notional().toFixed(2))
  const [isNotionalFocused, setIsNotionalFocused] = createSignal(false)

  // createEffect: sync external notional into local input when not focused
  createEffect(() => {
    if (!isNotionalFocused()) {
      setNotionalInput(notional().toFixed(2))
    }
  })

  const isClosing = () => props.status === "closing"

  const isNew = () => props.status === "new"

  const baseSymbol = () =>
    props.position().symbol.split("/")[0] ?? props.position().symbol

  const leverageEditorSpan = () =>
    leverageEditorColumnSpan(props.visibleMetricColumns)

  const metricSkeleton = () => (
    <Skeleton class="ml-auto h-3 w-[3rem] inline-block align-middle" />
  )

  const renderMetricCell = (columnId: PortfolioMetricColumnId) => {
    switch (columnId) {
      case "rate":
        return (
          <td
            class={cn(
              positionBodyCellClass("rate"),
              fundingRateClassName(props.rowMetrics.signedFundingRate),
            )}
          >
            <Show when={!props.fundingIsLoading} fallback={metricSkeleton()}>
              {formatPercent(props.rowMetrics.signedFundingRate)}
            </Show>
          </td>
        )
      case "beta":
        return (
          <td
            class={cn(
              positionBodyCellClass("beta"),
              betaClassName(props.rowMetrics.beta),
            )}
          >
            <Show when={!props.factorsIsLoading} fallback={metricSkeleton()}>
              {formatDecimal(props.rowMetrics.beta)}
            </Show>
          </td>
        )
      case "vol":
        return (
          <td
            class={cn(
              positionBodyCellClass("vol"),
              volatilityClassName(props.rowMetrics.volatility),
            )}
          >
            <Show when={!props.factorsIsLoading} fallback={metricSkeleton()}>
              {formatPercent(props.rowMetrics.volatility)}
            </Show>
          </td>
        )
      case "sharpe":
        return (
          <td
            class={cn(
              positionBodyCellClass("sharpe"),
              riskAdjustedReturnClassName(props.rowMetrics.sharpe),
            )}
          >
            <Show when={!props.factorsIsLoading} fallback={metricSkeleton()}>
              {formatDecimal(props.rowMetrics.sharpe)}
            </Show>
          </td>
        )
      case "sortino":
        return (
          <td
            class={cn(
              positionBodyCellClass("sortino"),
              riskAdjustedReturnClassName(props.rowMetrics.sortino),
            )}
          >
            <Show when={!props.factorsIsLoading} fallback={metricSkeleton()}>
              {formatDecimal(props.rowMetrics.sortino)}
            </Show>
          </td>
        )
      case "momentum":
        return (
          <td
            class={cn(
              positionBodyCellClass("momentum"),
              signedMetricClassName(props.rowMetrics.momentum),
            )}
          >
            <Show when={!props.factorsIsLoading} fallback={metricSkeleton()}>
              {formatPercent(props.rowMetrics.momentum)}
            </Show>
          </td>
        )
      case "carry":
        return (
          <td
            class={cn(
              positionBodyCellClass("carry"),
              signedMetricClassName(props.rowMetrics.carry),
            )}
          >
            <Show when={!props.factorsIsLoading} fallback={metricSkeleton()}>
              {formatPercent(props.rowMetrics.carry)}
            </Show>
          </td>
        )
    }
  }

  const isBelowMinimum = () => props.symbolsBelowMinimum.includes(props.symbol)
  const isDeltaBelowMinimum = () =>
    props.symbolsDeltaBelowMinimum.includes(props.symbol)
  const showWarning = () =>
    isBelowMinimum() || (!props.isPrecise && isDeltaBelowMinimum())

  const [isLeverageEditorMounted, setIsLeverageEditorMounted] =
    createSignal(false)
  const [isLeverageEditorExpanded, setIsLeverageEditorExpanded] =
    createSignal(false)
  let leverageEditorAnimationFrame: number | undefined
  let leverageSliderEditorElement: HTMLTableCellElement | undefined
  let leverageKeyboardEntry = ""
  let leverageKeyboardEntryTimeout: ReturnType<typeof setTimeout> | undefined

  const clearLeverageEditorTimers = () => {
    if (leverageEditorAnimationFrame !== undefined) {
      cancelAnimationFrame(leverageEditorAnimationFrame)
      leverageEditorAnimationFrame = undefined
    }

    if (leverageKeyboardEntryTimeout !== undefined) {
      clearTimeout(leverageKeyboardEntryTimeout)
      leverageKeyboardEntryTimeout = undefined
    }
  }

  const resetLeverageKeyboardEntry = () => {
    leverageKeyboardEntry = ""
  }

  const openLeverageEditor = () => {
    clearLeverageEditorTimers()
    resetLeverageKeyboardEntry()
    setIsLeverageEditorMounted(true)
    leverageEditorAnimationFrame = requestAnimationFrame(() => {
      setIsLeverageEditorExpanded(true)
      leverageEditorAnimationFrame = undefined
    })
  }

  const closeLeverageEditor = () => {
    clearLeverageEditorTimers()
    resetLeverageKeyboardEntry()
    setIsLeverageEditorExpanded(false)
    setIsLeverageEditorMounted(false)
  }

  const applyLeverageKeyboardEntry = (digit: string) => {
    const maxLeverage = Math.floor(props.maxLeverage ?? 1)
    const candidateEntry = `${leverageKeyboardEntry}${digit}`
    const candidateLeverage = Number.parseInt(candidateEntry, 10)
    const fallbackLeverage = Number.parseInt(digit, 10)
    const candidateIsValid =
      Number.isFinite(candidateLeverage) &&
      candidateLeverage >= 1 &&
      candidateLeverage <= maxLeverage
    const fallbackIsValid =
      Number.isFinite(fallbackLeverage) &&
      fallbackLeverage >= 1 &&
      fallbackLeverage <= maxLeverage
    const nextLeverage = candidateIsValid
      ? candidateLeverage
      : leverageKeyboardEntry === "" && fallbackIsValid
        ? fallbackLeverage
        : null

    if (nextLeverage === null) return

    leverageKeyboardEntry = String(nextLeverage)
    props.onLeverageChange(props.position().symbol, nextLeverage)

    if (leverageKeyboardEntryTimeout !== undefined) {
      clearTimeout(leverageKeyboardEntryTimeout)
    }

    leverageKeyboardEntryTimeout = setTimeout(() => {
      resetLeverageKeyboardEntry()
      leverageKeyboardEntryTimeout = undefined
    }, LEVERAGE_KEYBOARD_ENTRY_TIMEOUT_MS)
  }

  onCleanup(() => {
    clearLeverageEditorTimers()
  })

  // createEffect: attach global pointerdown listener while leverage editor is open to close on outside click
  createEffect(() => {
    if (!isLeverageEditorMounted()) return

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (leverageSliderEditorElement?.contains(target)) return

      closeLeverageEditor()
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown)
    })
  })

  // createEffect: attach global keydown listener while leverage editor is open for keyboard leverage entry
  createEffect(() => {
    if (!isLeverageEditorMounted()) return

    const applyKeyboardLeverageOnDigit = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      if (!/^\d$/.test(event.key)) return

      event.preventDefault()
      applyLeverageKeyboardEntry(event.key)
    }

    document.addEventListener("keydown", applyKeyboardLeverageOnDigit)
    onCleanup(() => {
      document.removeEventListener("keydown", applyKeyboardLeverageOnDigit)
    })
  })

  return (
    <tr
      class={cn(
        "border-b border-border/30 position-row h-7 transition-[height,opacity] duration-200 ease-out",
        isLeverageEditorExpanded() && "h-14",
        isClosing() && "opacity-50 bg-red-500/5",
        isNew() && "bg-green-500/5",
      )}
    >
      <td
        class={cn(
          positionStickyBodyClass("asset", props.status),
          "transition-[padding] duration-200 ease-out",
          isLeverageEditorExpanded() && "py-2",
        )}
      >
        <div
          class={cn(
            "flex gap-[8px]",
            isLeverageEditorExpanded()
              ? "flex-col items-start"
              : "flex-row items-center",
          )}
        >
          <Show when={isLeverageEditorExpanded()}>
            <div class="text-[11px] leading-none text-muted-foreground">
              Edit leverage
            </div>
          </Show>
          <div class="flex min-w-0 flex-row items-center gap-[4px]">
            <span class="min-w-0 truncate font-medium">{baseSymbol()}</span>
            <LeverageEditorTrigger
              isOpen={isLeverageEditorMounted()}
              onOpen={openLeverageEditor}
              onClose={closeLeverageEditor}
              symbol={props.position().symbol}
              leverage={props.position().leverage}
              maxLeverage={props.maxLeverage}
              leverageLimitsIsLoading={props.leverageLimitsIsLoading}
              disabled={isClosing()}
            />
          </div>
        </div>
      </td>
      <Show
        when={isLeverageEditorMounted()}
        fallback={
          <>
            <td class={positionBodyCellClass("side")}>
              <div class={positionBodyCellInnerClass}>
                <button
                  type="button"
                  disabled={isClosing()}
                  aria-label={`Switch ${baseSymbol()} side`}
                  class={cn(
                    SIDE_BADGE_CLASS,
                    !isClosing() && "cursor-pointer",
                    getSideBadgeClass(props.position().side),
                    isClosing() && "grayscale opacity-50",
                  )}
                  onClick={() => {
                    const nextSide =
                      props.position().side === "buy" ? "sell" : "buy"
                    props.onSideChange(props.position().symbol, nextSide)
                  }}
                >
                  {props.position().side === "buy" ? "LONG" : "SHORT"}
                </button>
              </div>
            </td>
            <td class={positionBodyCellClass("weight")}>
              <div class={positionBodyCellInnerClass}>
                <Show
                  when={!isClosing()}
                  fallback={<span class="text-rose-500 text-[10px]">→ 0%</span>}
                >
                  <input
                    type="number"
                    {...positionCellInputProps}
                    value={weightInput()}
                    onFocus={() => {
                      setIsWeightFocused(true)
                      props.onCellEditFocus?.()
                    }}
                    onBlur={event => {
                      setIsWeightFocused(false)
                      setWeightInput(weight())
                      props.onCellEditBlur?.(event)
                    }}
                    onInput={inputEvent => {
                      const raw = inputEvent.currentTarget.value
                      setWeightInput(raw)
                      const parsed = raw === "" ? 0 : Number.parseFloat(raw)
                      const isValid =
                        Number.isFinite(parsed) && parsed >= 0 && parsed <= 100

                      if (!isValid) return

                      props.onWeightChange(props.position().symbol, parsed)
                    }}
                    step={0.5}
                    min={0}
                    max={100}
                    class="w-12 text-right font-mono text-[11px] rounded border border-border bg-transparent px-1 py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span class="text-muted-foreground text-[10px]">%</span>
                </Show>
              </div>
            </td>
            <td class={positionBodyCellClass("notional")}>
              <div class={positionBodyCellInnerClass}>
                <span class="text-muted-foreground text-[10px]">$</span>
                <input
                  type="number"
                  {...positionCellInputProps}
                  value={notionalInput()}
                  onFocus={() => {
                    setIsNotionalFocused(true)
                    props.onCellEditFocus?.()
                  }}
                  onBlur={event => {
                    setIsNotionalFocused(false)
                    setNotionalInput(notional().toFixed(2))
                    props.onCellEditBlur?.(event)
                  }}
                  onInput={inputEvent => {
                    const raw = inputEvent.currentTarget.value
                    setNotionalInput(raw)
                    const parsed = raw === "" ? 0 : Number.parseFloat(raw)
                    const isValid = Number.isFinite(parsed) && parsed >= 0

                    if (!isValid) return

                    props.onNotionalChange(props.position().symbol, parsed)
                  }}
                  disabled={isClosing()}
                  step={1}
                  min={0}
                  class="w-16 text-right font-mono text-[11px] rounded border border-border bg-transparent px-1 py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      class={cn(
                        "inline-flex h-3 w-3 shrink-0 items-center justify-center align-middle",
                        !showWarning() && "pointer-events-none opacity-0",
                      )}
                    >
                      <CircleAlert class="h-3 w-3 text-amber-500" />
                    </TooltipTrigger>
                    <TooltipContent class="text-xs">
                      <Show when={!props.isPrecise && isDeltaBelowMinimum()}>
                        <p>
                          Delta ${props.symbolDelta.toFixed(2)} is below $
                          {MIN_USD} minimum.
                        </p>
                      </Show>
                      <Show when={isBelowMinimum()}>
                        <p>
                          Position ${notional().toFixed(2)} below ${MIN_USD}{" "}
                          minimum.
                        </p>
                      </Show>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </td>
            <For each={props.visibleMetricColumns}>
              {columnId => renderMetricCell(columnId)}
            </For>
            <td class={positionStickyBodyClass("actions", props.status)}>
              <div class={positionBodyCellInnerClass}>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6"
                  aria-label={
                    isClosing()
                      ? `Undo remove ${props.position().symbol}`
                      : `Remove ${props.position().symbol}`
                  }
                  onClick={() => {
                    if (isClosing()) {
                      props.onUndoRemove(props.position().symbol)
                    } else {
                      props.onRemove(props.position().symbol)
                    }
                  }}
                >
                  <Show
                    when={isClosing()}
                    fallback={<Trash2 class="h-3 w-3" />}
                  >
                    <Undo2 class="h-3 w-3" />
                  </Show>
                </Button>
              </div>
            </td>
          </>
        }
      >
        <td
          ref={element => {
            leverageSliderEditorElement = element
          }}
          colSpan={leverageEditorSpan()}
          class={cn(
            "px-2 align-middle pointer-events-auto transition-[padding,opacity] duration-200 ease-out",
            isLeverageEditorExpanded() ? "py-2 opacity-100" : "py-0 opacity-0",
          )}
        >
          <Show when={isLeverageEditorExpanded()}>
            <LeverageSliderEditor
              symbol={props.position().symbol}
              leverage={props.position().leverage}
              maxLeverage={props.maxLeverage}
              onLeverageChange={props.onLeverageChange}
            />
          </Show>
        </td>
        <td
          class={cn(
            positionStickyLeverageCloseClass(props.status),
            "transition-[padding] duration-200 ease-out",
            isLeverageEditorExpanded() ? "py-2" : "py-0",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            class="h-6 w-6"
            aria-label={`Close leverage editor for ${props.position().symbol}`}
            onClick={() => {
              closeLeverageEditor()
            }}
          >
            <X class="h-3 w-3" />
          </Button>
        </td>
      </Show>
    </tr>
  )
}
