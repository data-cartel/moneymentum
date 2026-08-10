import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Accessor,
  type JSX,
} from "solid-js"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import type { OrderSide } from "@/services/hyperliquid-client"

import {
  amountFromNotionalAndPrice,
  amountStepFromPremium,
  defaultContractsForPremium,
  limitPriceStepFromPremium,
  notionalFromAmountAndPrice,
  type DeriveOrderTicketSelection,
} from "./orderTicket"

export type DeriveOrderTicketAddRequest = {
  symbol: string
  side: OrderSide
  notional: number
}

const formatPriceInput = (value: number): string =>
  Number.isFinite(value) ? String(value) : ""

const defaultTicketAmount = (
  limitPrice: number,
  minNotional: number,
): number => {
  if (limitPrice > 0) {
    return defaultContractsForPremium(limitPrice, minNotional)
  }
  return 1
}

/**
 * Order ticket for a single Derive option: side, limit, contracts, notional USD.
 * Add stages into the portfolio target (caller wires `onAdd`).
 */
export const DeriveOrderTicket = (props: {
  selection: Accessor<DeriveOrderTicketSelection | null>
  minNotional: number
  onSideChange?: (side: OrderSide) => void
  onAdd?: (request: DeriveOrderTicketAddRequest) => void
  class?: string
}): JSX.Element => {
  const [side, setSide] = createSignal<OrderSide>("buy")
  const [limitPriceInput, setLimitPriceInput] = createSignal("")
  const [amountInput, setAmountInput] = createSignal("")
  const [notionalInput, setNotionalInput] = createSignal("")
  const previousInstrumentRef: { name: string | null } = { name: null }

  // createEffect: sync ticket fields from chain selection; keep amount when
  // only side/quote flips on the same instrument.
  createEffect(() => {
    const selection = props.selection()
    if (selection === null) {
      previousInstrumentRef.name = null
      return
    }

    const instrumentChanged =
      previousInstrumentRef.name !== selection.instrumentName
    previousInstrumentRef.name = selection.instrumentName

    setSide(selection.side)
    setLimitPriceInput(formatPriceInput(selection.limitPrice))

    if (instrumentChanged) {
      const amount = defaultTicketAmount(
        selection.limitPrice,
        props.minNotional,
      )
      setAmountInput(formatPriceInput(amount))
      setNotionalInput(
        formatPriceInput(
          notionalFromAmountAndPrice(amount, selection.limitPrice),
        ),
      )
      return
    }

    const existingAmount = Number.parseFloat(amountInput())
    const amount =
      Number.isFinite(existingAmount) && existingAmount > 0
        ? existingAmount
        : defaultTicketAmount(selection.limitPrice, props.minNotional)
    setAmountInput(formatPriceInput(amount))
    setNotionalInput(
      formatPriceInput(
        notionalFromAmountAndPrice(amount, selection.limitPrice),
      ),
    )
  })

  const parsedLimitPrice = createMemo(() => {
    const parsed = Number.parseFloat(limitPriceInput())
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  })

  const premiumForSteps = createMemo(() => {
    const parsed = parsedLimitPrice()
    if (parsed !== null && parsed > 0) {
      return parsed
    }
    return props.selection()?.limitPrice ?? 0
  })

  const amountStep = createMemo(() => amountStepFromPremium(premiumForSteps()))
  const limitPriceStep = createMemo(() =>
    limitPriceStepFromPremium(premiumForSteps()),
  )

  const parsedAmount = createMemo(() => {
    const parsed = Number.parseFloat(amountInput())
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  })

  const parsedNotional = createMemo(() => {
    const parsed = Number.parseFloat(notionalInput())
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  })

  const canAdd = createMemo(() => {
    if (props.onAdd === undefined) {
      return false
    }
    if (props.selection() === null) {
      return false
    }
    const notional = parsedNotional()
    const amount = parsedAmount()
    const limitPrice = parsedLimitPrice()
    return (
      notional !== null &&
      notional >= props.minNotional &&
      amount !== null &&
      limitPrice !== null
    )
  })

  const syncNotionalFromAmount = (nextAmountRaw: string) => {
    setAmountInput(nextAmountRaw)
    const amount = Number.parseFloat(nextAmountRaw)
    const limitPrice = parsedLimitPrice()
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      limitPrice === null ||
      limitPrice <= 0
    ) {
      return
    }
    setNotionalInput(
      formatPriceInput(notionalFromAmountAndPrice(amount, limitPrice)),
    )
  }

  const syncAmountFromNotional = (nextNotionalRaw: string) => {
    setNotionalInput(nextNotionalRaw)
    const notional = Number.parseFloat(nextNotionalRaw)
    const limitPrice = parsedLimitPrice()
    if (
      !Number.isFinite(notional) ||
      notional <= 0 ||
      limitPrice === null ||
      limitPrice <= 0
    ) {
      return
    }
    setAmountInput(
      formatPriceInput(amountFromNotionalAndPrice(notional, limitPrice)),
    )
  }

  const syncNotionalFromPrice = (nextPriceRaw: string) => {
    setLimitPriceInput(nextPriceRaw)
    const limitPrice = Number.parseFloat(nextPriceRaw)
    const amount = parsedAmount()
    if (!Number.isFinite(limitPrice) || limitPrice <= 0 || amount === null) {
      return
    }
    setNotionalInput(
      formatPriceInput(notionalFromAmountAndPrice(amount, limitPrice)),
    )
  }

  const chooseSide = (nextSide: OrderSide) => {
    if (side() === nextSide) {
      return
    }
    setSide(nextSide)
    props.onSideChange?.(nextSide)
  }

  return (
    <div class={cn("flex min-h-0 flex-col gap-3 p-3", props.class)}>
      <Show
        when={props.selection()}
        fallback={
          <p class="text-[12px] text-[var(--d-muted)]">
            Select an instrument to view
          </p>
        }
      >
        {selection => (
          <>
            <div class="min-w-0 text-[13px] font-semibold text-[var(--d-text)]">
              {selection.displayLabel}
            </div>

            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                  Side
                </span>
                <div class="d-side-toggle flex h-8 overflow-hidden rounded-md border border-[var(--d-border)]">
                  <button
                    type="button"
                    classList={{
                      "d-side-buy": true,
                      "d-side-active": side() === "buy",
                    }}
                    onClick={() => {
                      chooseSide("buy")
                    }}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    classList={{
                      "d-side-sell": true,
                      "d-side-active": side() === "sell",
                    }}
                    onClick={() => {
                      chooseSide("sell")
                    }}
                  >
                    Sell
                  </button>
                </div>
              </div>

              <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                  Limit price
                </span>
                <Input
                  type="number"
                  min={0}
                  step={limitPriceStep()}
                  class="h-8 border-[var(--d-border)] bg-[var(--d-elevated)] font-mono text-[12px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={limitPriceInput()}
                  onInput={event => {
                    syncNotionalFromPrice(event.currentTarget.value)
                  }}
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                  Amount
                </span>
                <Input
                  type="number"
                  min={0}
                  step={amountStep()}
                  class="h-8 border-[var(--d-border)] bg-[var(--d-elevated)] font-mono text-[12px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={amountInput()}
                  onInput={event => {
                    syncNotionalFromAmount(event.currentTarget.value)
                  }}
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                  Notional USD
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  class="h-8 border-[var(--d-border)] bg-[var(--d-elevated)] font-mono text-[12px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={notionalInput()}
                  onInput={event => {
                    syncAmountFromNotional(event.currentTarget.value)
                  }}
                />
              </label>
            </div>

            <div class="flex items-center gap-2">
              <Button
                type="button"
                class="h-8"
                disabled={!canAdd()}
                onClick={() => {
                  const notional = parsedNotional()
                  const instrument = props.selection()?.instrumentName
                  if (
                    props.onAdd === undefined ||
                    notional === null ||
                    instrument === undefined
                  ) {
                    return
                  }
                  props.onAdd({
                    symbol: instrument,
                    side: side(),
                    notional,
                  })
                }}
              >
                Add to portfolio
              </Button>
              <Show
                when={(() => {
                  const notional = parsedNotional()
                  return notional !== null && notional < props.minNotional
                })()}
              >
                <span class="text-[11px] text-[var(--d-sell)]">
                  Minimum notional is ${props.minNotional}.
                </span>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
