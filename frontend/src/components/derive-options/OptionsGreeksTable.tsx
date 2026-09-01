import { For, type Accessor, type JSX } from "solid-js"

import type { DeriveOrderTicketSelection, QuoteBookSide } from "./orderTicket"
import type { OptionQuote } from "./optionsSnapshot"
import {
  formatIvPercent,
  formatMoneyness,
  formatNumber,
} from "./optionChainFormat"
import { QuotePrice } from "./QuotePrice"
import type { QuoteBook } from "./quoteBook"

const GreeksQuoteRow = (props: {
  instrumentName: string
  book: QuoteBook
  selection: Accessor<DeriveOrderTicketSelection | null>
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
}) => {
  const quote = (): OptionQuote | undefined =>
    props.book.byInstrument[props.instrumentName]
  const itmClass = (): string =>
    quote()?.moneyness === "in_the_money" ? "d-itm" : ""

  const isSelected = (quoteSide: QuoteBookSide): boolean => {
    const selection = props.selection()
    return (
      selection !== null &&
      selection.instrumentName === props.instrumentName &&
      selection.quoteSide === quoteSide
    )
  }

  return (
    <tr>
      <td
        class={`max-w-[10.5rem] truncate text-left ${itmClass()}`}
        title={props.instrumentName}
      >
        {props.instrumentName}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.strike ?? null, 0)}
      </td>
      <td class={`text-left ${itmClass()}`}>{quote()?.kind ?? "—"}</td>
      <td class={`text-left ${itmClass()}`}>
        {(() => {
          const moneyness = quote()?.moneyness
          return moneyness === undefined ? "—" : formatMoneyness(moneyness)
        })()}
      </td>
      <td class={`text-right ${itmClass()}`}>
        <QuotePrice
          side="bid"
          value={() => quote()?.bid ?? null}
          isSelected={() => isSelected("bid")}
          onSelect={() => {
            props.onQuoteSelect(props.instrumentName, "bid")
          }}
        />
      </td>
      <td class={`text-right ${itmClass()}`}>
        <QuotePrice
          side="ask"
          value={() => quote()?.ask ?? null}
          isSelected={() => isSelected("ask")}
          onSelect={() => {
            props.onQuoteSelect(props.instrumentName, "ask")
          }}
        />
      </td>
      <td class={`text-right d-iv ${itmClass()}`}>
        {formatIvPercent(quote()?.greeks.iv ?? null)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.delta ?? null, 4)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.gamma ?? null, 6)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.vega ?? null, 4)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.theta ?? null, 4)}
      </td>
      <td class={`text-right d-iv ${itmClass()}`}>
        {formatIvPercent(quote()?.greeks.bid_iv ?? null)}
      </td>
      <td class={`text-right d-iv ${itmClass()}`}>
        {formatIvPercent(quote()?.greeks.ask_iv ?? null)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.rho ?? null, 2)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.forward_price ?? null, 0)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.discount_factor ?? null, 4)}
      </td>
      <td class={`text-right ${itmClass()}`}>
        {formatNumber(quote()?.greeks.option_model_mark ?? null, 0)}
      </td>
    </tr>
  )
}

export const OptionsGreeksTable = (props: {
  book: QuoteBook
  selection: Accessor<DeriveOrderTicketSelection | null>
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
}): JSX.Element => (
  <table class="d-chain d-greeks-chain">
    <colgroup>
      <col class="d-g-col-instrument" />
      <col class="d-g-col-strike" />
      <col class="d-g-col-type" />
      <col class="d-g-col-money" />
      <col class="d-g-col-quote" />
      <col class="d-g-col-quote" />
      <col class="d-g-col-iv" />
      <col class="d-g-col-delta" />
      <col class="d-g-col-gamma" />
      <col class="d-g-col-vega" />
      <col class="d-g-col-theta" />
      <col class="d-g-col-side-iv" />
      <col class="d-g-col-side-iv" />
      <col class="d-g-col-rho" />
      <col class="d-g-col-forward" />
      <col class="d-g-col-df" />
      <col class="d-g-col-mdl" />
    </colgroup>
    <thead>
      <tr>
        <th class="text-left">Instrument</th>
        <th class="text-right">Strike</th>
        <th class="text-left">Type</th>
        <th class="text-left">Money</th>
        <th class="text-right">Bid</th>
        <th class="text-right">Ask</th>
        <th class="text-right">IV</th>
        <th class="text-right">Delta</th>
        <th class="text-right">Gamma</th>
        <th class="text-right">Vega</th>
        <th class="text-right">Theta</th>
        <th class="text-right">Bid IV</th>
        <th class="text-right">Ask IV</th>
        <th class="text-right">Rho</th>
        <th class="text-right">Forward</th>
        <th class="text-right">DF</th>
        <th class="text-right">Mdl M</th>
      </tr>
    </thead>
    <tbody>
      <For each={props.book.instrumentNamesAsc}>
        {name => (
          <GreeksQuoteRow
            instrumentName={name}
            book={props.book}
            selection={props.selection}
            onQuoteSelect={props.onQuoteSelect}
          />
        )}
      </For>
    </tbody>
  </table>
)
