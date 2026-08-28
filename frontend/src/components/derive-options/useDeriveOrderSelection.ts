import { createSignal } from "solid-js"

import {
  quoteSideForOrderSide,
  selectionFromQuoteClick,
  selectionWithOrderSide,
  type DeriveOrderTicketSelection,
  type QuoteBookSide,
} from "./orderTicket"
import type { QuoteBook } from "./quoteBook"

export const useDeriveOrderSelection = (props: {
  book: QuoteBook
  onOpenOrderPanel: () => void
}) => {
  const [selection, setSelection] =
    createSignal<DeriveOrderTicketSelection | null>(null)

  const clearSelection = (): void => {
    setSelection(null)
  }

  const handleQuoteSelect = (
    instrumentName: string,
    quoteSide: QuoteBookSide,
  ): void => {
    if (!(instrumentName in props.book.byInstrument)) {
      return
    }
    const quote = props.book.byInstrument[instrumentName]
    const nextSelection = selectionFromQuoteClick(quote, quoteSide, selection())
    setSelection(nextSelection)
    if (nextSelection !== null) {
      props.onOpenOrderPanel()
    }
  }

  const handleTicketSideChange = (side: "buy" | "sell"): void => {
    const current = selection()
    if (current === null) {
      return
    }
    const quoteSide = quoteSideForOrderSide(side)
    const liveLimit =
      current.instrumentName in props.book.byInstrument
        ? (() => {
            const quote = props.book.byInstrument[current.instrumentName]
            return quoteSide === "ask" ? quote.ask : quote.bid
          })()
        : null
    setSelection(selectionWithOrderSide(current, side, liveLimit))
  }

  return {
    selection,
    clearSelection,
    handleQuoteSelect,
    handleTicketSideChange,
  }
}
