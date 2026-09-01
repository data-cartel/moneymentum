import type { QuoteBookSide } from "./orderTicket"
import type { OptionQuote } from "./optionsSnapshot"
import { formatIvPercent, formatNumber } from "./optionChainFormat"

export const OPTION_CHAIN_COLUMN_COUNT = 17

/** Call side left-to-right; put side is the reverse (mirrored chain). */
export type ChainTextColumnId = "size" | "iv" | "mark" | "delta"

export type ChainLegColumn =
  | {
      kind: "text"
      /** CSS class hook: `.d-size` / `.d-iv` / `.d-mark` / `.d-delta`. */
      column: ChainTextColumnId
      read: (quote: OptionQuote) => number | null
      format: (value: number | null) => string
    }
  | {
      kind: "quote"
      side: QuoteBookSide
    }

/**
 * `<col>` class for fixed `ch` widths in CSS.
 * Sized from BTC 2026-08-27 mainnet snapshot max rendered lengths.
 */
export const chainLegColClass = (column: ChainLegColumn): string =>
  column.kind === "quote" ? "d-col-quote" : `d-col-${column.column}`

export const CALL_LEG_COLUMNS: readonly ChainLegColumn[] = [
  {
    kind: "text",
    column: "size",
    read: quote => quote.bid_size,
    format: value => formatNumber(value, 2),
  },
  {
    kind: "text",
    column: "iv",
    read: quote => quote.greeks.bid_iv,
    format: formatIvPercent,
  },
  { kind: "quote", side: "bid" },
  {
    kind: "text",
    column: "mark",
    read: quote => quote.mark,
    format: value => formatNumber(value),
  },
  { kind: "quote", side: "ask" },
  {
    kind: "text",
    column: "iv",
    read: quote => quote.greeks.ask_iv,
    format: formatIvPercent,
  },
  {
    kind: "text",
    column: "size",
    read: quote => quote.ask_size,
    format: value => formatNumber(value, 2),
  },
  {
    kind: "text",
    column: "delta",
    read: quote => quote.greeks.delta,
    format: value => formatNumber(value, 3),
  },
]

export const PUT_LEG_COLUMNS: readonly ChainLegColumn[] = [
  ...CALL_LEG_COLUMNS,
].reverse()
