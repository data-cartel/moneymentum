import { For, Show, createSignal, type Accessor, type JSX } from "solid-js"
import {
  Orientation,
  SplitviewSolid,
  loadSplitRatio,
  type ISplitviewPanelProps,
} from "@arminmajerie/dockview-solid"

import type { NetworkMode } from "@/contexts/wallet-context"
import { cn } from "@/lib/cn"
import { DERIVE_CHAIN_GREEKS_SPLIT_STORAGE_KEY } from "./deriveChromeStorage"

import type { DeriveOrderTicketAddRequest } from "./DeriveOrderTicket"
import { ExpiryTabButtons } from "./ExpiryTabButtons"
import { OptionsChainTable } from "./OptionsChainTable"
import { OptionsDetailPanel, type OptionsDetailTab } from "./OptionsDetailPanel"
import { useDeriveOrderSelection } from "./useDeriveOrderSelection"
import { useOptionsStream } from "./useOptionsStream"
import "./derive-options.css"

export type OptionsTradingViewProps = {
  /** When false, EventSource is closed (callers debounce panel hide). */
  streamEnabled: Accessor<boolean>
  /** Which Derive deployment to stream (follows the Testnet toggle). */
  networkMode: Accessor<NetworkMode>
  /** Toggle + SplitviewSolid resize for the greeks/order panel. */
  greeksLayout: {
    visible: Accessor<boolean>
    setVisible: (visible: boolean) => void
  }
  /** Stage an option into the portfolio target (Portfolio Derive tab). */
  onAddOption?: (request: DeriveOrderTicketAddRequest) => void
  /** Minimum premium USD for Add (matches portfolio MIN_USD). */
  minNotional?: number
  class?: string
}

export const OptionsTradingView = (
  props: OptionsTradingViewProps,
): JSX.Element => {
  const [detailTab, setDetailTab] = createSignal<OptionsDetailTab>("greeks")
  const minNotional = () => props.minNotional ?? 11

  const selectionBridge = { clear: () => {} }

  const stream = useOptionsStream(
    () => props.networkMode(),
    () => props.streamEnabled(),
    selectionBridge,
  )

  const order = useDeriveOrderSelection({
    book: stream.book,
    onOpenOrderPanel: () => {
      setDetailTab("order")
      props.greeksLayout.setVisible(true)
    },
  })

  selectionBridge.clear = order.clearSelection

  const splitviewComponents: Record<
    string,
    (_panelProps: ISplitviewPanelProps) => JSX.Element
  > = {
    chain: () => (
      <div class="d-chain-scroll h-full min-h-0 overflow-auto">
        <OptionsChainTable
          book={stream.book}
          selectedAsset={stream.selectedAsset}
          selectedExpiryUnix={stream.selectedExpiryUnix}
          selection={order.selection}
          onQuoteSelect={order.handleQuoteSelect}
        />
      </div>
    ),
    greeks: () => (
      <OptionsDetailPanel
        book={stream.book}
        selection={order.selection}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        minNotional={minNotional()}
        onSideChange={order.handleTicketSideChange}
        onQuoteSelect={order.handleQuoteSelect}
        onAddOption={props.onAddOption}
        onClose={() => {
          props.greeksLayout.setVisible(false)
        }}
      />
    ),
  }

  return (
    <div
      class={cn(
        // overflow-hidden (not auto): outer scrollports paint-flash the whole panel
        // in dockview; chain/greeks keep their own overflow-auto regions.
        "derive-options flex h-full min-h-0 flex-col overflow-hidden pt-3 text-[11px]",
        props.class,
      )}
    >
      <div class="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 flex-col gap-3">
        <header class="flex shrink-0 items-center gap-2 px-3">
          <div class="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
            <div class="flex w-max gap-1">
              <For each={stream.assetTabList()}>
                {asset => (
                  <button
                    type="button"
                    class={`d-chip shrink-0 ${stream.selectedAsset() === asset ? "d-chip-active" : ""}`}
                    onMouseDown={() => {
                      stream.switchAssetTab(asset)
                    }}
                    onClick={(
                      event: MouseEvent & {
                        currentTarget: HTMLButtonElement
                        target: Element
                      },
                    ) => {
                      if (event.detail === 0) {
                        stream.switchAssetTab(asset)
                      }
                    }}
                  >
                    {asset}
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={stream.isLoading()}>
            <span class="shrink-0 text-[var(--d-muted)]">Loading chain...</span>
          </Show>
        </header>

        <Show when={stream.errorMessage()}>
          <div class="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            {stream.errorMessage()}
          </div>
        </Show>

        <div class="d-board flex min-h-0 flex-1 flex-col">
          <div class="shrink-0 overflow-x-auto border-b border-[var(--d-border)] px-2 scrollbar-hide">
            <div class="flex w-max">
              <ExpiryTabButtons
                tabs={stream.expiryTabList}
                selectedUnix={stream.selectedExpiryUnix}
                onSelect={stream.switchExpiryTab}
              />
            </div>
          </div>

          <Show
            when={props.greeksLayout.visible()}
            fallback={
              <div class="d-chain-scroll min-h-0 flex-1 overflow-auto">
                <OptionsChainTable
                  book={stream.book}
                  selectedAsset={stream.selectedAsset}
                  selectedExpiryUnix={stream.selectedExpiryUnix}
                  selection={order.selection}
                  onQuoteSelect={order.handleQuoteSelect}
                />
              </div>
            }
          >
            <div class="d-options-split min-h-0 flex-1">
              <SplitviewSolid
                class="h-full w-full"
                orientation={Orientation.VERTICAL}
                persistRatio={true}
                storageKey={DERIVE_CHAIN_GREEKS_SPLIT_STORAGE_KEY}
                components={splitviewComponents}
                onReady={({ api }) => {
                  const hostHeight = Math.max(api.height, 240)
                  const savedRatio = loadSplitRatio(
                    DERIVE_CHAIN_GREEKS_SPLIT_STORAGE_KEY,
                  )
                  const chainSize =
                    savedRatio !== null
                      ? Math.round(hostHeight * savedRatio)
                      : Math.round(hostHeight * 0.62)
                  api.addPanel({
                    id: "chain",
                    component: "chain",
                    minimumSize: 120,
                    size: chainSize,
                  })
                  api.addPanel({
                    id: "greeks",
                    component: "greeks",
                    minimumSize: 96,
                  })
                }}
              />
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
