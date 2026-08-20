import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import type { JSX } from "solid-js"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

import { prefetchBitcoinAddressValidator } from "../../hooks/bitcoinAddress"
import type { ReadonlyBtcRow } from "../../hooks/useReadonlyPortfolioState"

class ReadonlyBtcAddressAddFailed extends Data.TaggedError(
  "ReadonlyBtcAddressAddFailed",
)<{
  readonly cause: unknown
}> {}

interface ReadonlyBtcPanelProps {
  rows: ReadonlyBtcRow[]
  isLoading: boolean
  error: string | null
  validationError: string | null
  onAddAddress: (address: string) => boolean | Promise<boolean>
  onRemoveAddress: (address: string) => void
  onIncludeInBetaChange: (address: string, includeInBeta: boolean) => void
}

export const ReadonlyBtcPanel = (props: ReadonlyBtcPanelProps): JSX.Element => {
  const [addressInput, setAddressInput] = createSignal("")
  const [isAddingAddress, setIsAddingAddress] = createSignal(false)
  const rowCount = createMemo(() => props.rows.length)

  onMount(() => {
    prefetchBitcoinAddressValidator()
  })

  const submitAddress = async () => {
    if (isAddingAddress()) {
      return
    }
    setIsAddingAddress(true)

    const addResult = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => Promise.resolve(props.onAddAddress(addressInput())),
          catch: cause => new ReadonlyBtcAddressAddFailed({ cause }),
        }),
      ),
    )

    if (Either.isLeft(addResult)) {
      console.error("Failed to add readonly BTC address:", addResult.left)
      setIsAddingAddress(false)
      return
    }

    if (addResult.right) {
      setAddressInput("")
    }
    setIsAddingAddress(false)
  }

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
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault()
                void submitAddress()
              }
            }}
            placeholder="BTC address"
            class="h-7 w-[260px] rounded border border-border bg-transparent px-2 text-[11px]"
            disabled={isAddingAddress()}
          />
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-2 text-[11px] transition-opacity"
            classList={{ "opacity-50": isAddingAddress() }}
            disabled={isAddingAddress()}
            onClick={() => {
              void submitAddress()
            }}
          >
            {isAddingAddress() ? "…" : "+"}
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
                  fallback={<Skeleton class="h-3 w-24" />}
                >
                  <span class="font-mono text-muted-foreground">
                    {row.quantityBtc.toFixed(6)} BTC
                  </span>
                </Show>
                <Show
                  when={!props.isLoading}
                  fallback={<Skeleton class="h-3 w-16" />}
                >
                  <span class="font-mono">
                    $
                    {row.notionalUsd.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </Show>
                <div class="flex items-center gap-1">
                  <span class="text-muted-foreground">Beta</span>
                  <Switch
                    checked={row.includeInBeta}
                    onChange={checked => {
                      props.onIncludeInBetaChange(row.address, checked)
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-2 text-[11px] text-rose-500"
                  onClick={() => {
                    props.onRemoveAddress(row.address)
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
