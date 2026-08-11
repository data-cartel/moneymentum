import { For, Show, createMemo, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

import type { ReadonlyBtcRow } from "../../hooks/useReadonlyPortfolioState"

interface ReadonlyBtcPanelProps {
  rows: ReadonlyBtcRow[]
  isLoading: boolean
  error: string | null
  validationError: string | null
  onAddAddress: (address: string) => boolean
  onRemoveAddress: (address: string) => void
  onIncludeInBetaChange: (address: string, includeInBeta: boolean) => void
}

export const ReadonlyBtcPanel = (props: ReadonlyBtcPanelProps): JSX.Element => {
  const [addressInput, setAddressInput] = createSignal("")
  const rowCount = createMemo(() => props.rows.length)

  return (
    <div class="border-t border-border/30 p-2 space-y-2 shrink-0">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-medium text-muted-foreground">
          READ-ONLY BTC ({rowCount()})
        </span>
        <div class="flex items-center gap-1">
          <input
            type="text"
            value={addressInput()}
            onInput={inputEvent => {
              setAddressInput(inputEvent.currentTarget.value)
            }}
            placeholder="BTC address"
            class="h-7 w-[260px] rounded border border-border bg-transparent px-2 text-[11px]"
          />
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2 text-[11px]"
            onClick={() => {
              if (props.onAddAddress(addressInput())) {
                setAddressInput("")
              }
            }}
          >
            +
          </Button>
        </div>
      </div>
      <div class="space-y-1">
        <Show when={props.validationError}>
          {message => <div class="text-[11px] text-rose-500">{message()}</div>}
        </Show>
        <Show when={props.error}>
          {message => <div class="text-[11px] text-rose-500">{message()}</div>}
        </Show>
      </div>
      <Show
        when={props.rows.length > 0}
        fallback={
          <Show
            when={props.isLoading}
            fallback={
              <div class="text-[11px] text-muted-foreground">
                Add BTC addresses to include read-only exposure.
              </div>
            }
          >
            <Skeleton class="h-6 w-full" />
          </Show>
        }
      >
        <div class="max-h-[126px] overflow-y-auto pr-1 space-y-1">
          <For each={props.rows}>
            {row => (
              <div class="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded border border-border/40 px-2 py-1 text-[11px]">
                <span class="font-mono truncate" title={row.address}>
                  {row.address}
                </span>
                <Show
                  when={!props.isLoading}
                  fallback={<Skeleton class="h-4 w-[108px] justify-self-end" />}
                >
                  <span class="inline-grid grid-cols-[10ch_auto] items-baseline justify-self-end font-mono text-muted-foreground tabular-nums">
                    <span class="text-right">{row.quantityBtc.toFixed(6)}</span>
                    <span class="pl-1">BTC</span>
                  </span>
                </Show>
                <Show
                  when={!props.isLoading}
                  fallback={<Skeleton class="h-4 w-[72px] justify-self-end" />}
                >
                  <span class="font-mono text-right">
                    ${row.notionalUsd.toFixed(2)}
                  </span>
                </Show>
                <label class="flex items-center gap-1 text-muted-foreground">
                  beta
                  <Switch
                    checked={row.includeInBeta}
                    onChange={value => {
                      props.onIncludeInBetaChange(row.address, value)
                    }}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-2"
                  onClick={() => {
                    props.onRemoveAddress(row.address)
                  }}
                >
                  x
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
