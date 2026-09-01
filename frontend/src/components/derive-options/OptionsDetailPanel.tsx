import { Show, type Accessor, type JSX } from "solid-js"
import { X } from "lucide-solid"

import { Button } from "@/components/ui/button"

import {
  DeriveOrderTicket,
  type DeriveOrderTicketAddRequest,
} from "./DeriveOrderTicket"
import type { DeriveOrderTicketSelection, QuoteBookSide } from "./orderTicket"
import { OptionsGreeksTable } from "./OptionsGreeksTable"
import type { QuoteBook } from "./quoteBook"

export type OptionsDetailTab = "greeks" | "order"

export const OptionsDetailPanel = (props: {
  book: QuoteBook
  selection: Accessor<DeriveOrderTicketSelection | null>
  detailTab: Accessor<OptionsDetailTab>
  setDetailTab: (tab: OptionsDetailTab) => void
  minNotional: number
  onSideChange: (side: "buy" | "sell") => void
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
  onAddOption?: (request: DeriveOrderTicketAddRequest) => void
  onClose: () => void
}): JSX.Element => (
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between border-t border-[var(--d-border)] px-2 py-1">
      <div class="flex items-center gap-1">
        <button
          type="button"
          classList={{
            "d-detail-tab": true,
            "d-detail-tab-active": props.detailTab() === "greeks",
          }}
          onClick={() => {
            props.setDetailTab("greeks")
          }}
        >
          Greeks
        </button>
        <button
          type="button"
          classList={{
            "d-detail-tab": true,
            "d-detail-tab-active": props.detailTab() === "order",
          }}
          onClick={() => {
            props.setDetailTab("order")
          }}
        >
          Order
        </button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="h-6 w-6 text-[var(--d-muted)]"
        aria-label="Hide detail panel"
        onClick={() => {
          props.onClose()
        }}
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>
    <Show
      when={props.detailTab() === "greeks"}
      fallback={
        <div class="d-greeks-scroll min-h-0 flex-1 overflow-auto">
          <DeriveOrderTicket
            selection={props.selection}
            minNotional={props.minNotional}
            onSideChange={props.onSideChange}
            onAdd={props.onAddOption}
          />
        </div>
      }
    >
      <div class="d-greeks-scroll min-h-0 flex-1 overflow-auto">
        <OptionsGreeksTable
          book={props.book}
          selection={props.selection}
          onQuoteSelect={props.onQuoteSelect}
        />
      </div>
    </Show>
  </div>
)
