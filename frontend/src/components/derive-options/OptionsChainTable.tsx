import {
  For,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js"

import type { DeriveOrderTicketSelection, QuoteBookSide } from "./orderTicket"
import type { ExpiryUnix, Moneyness, OptionQuote } from "./optionsSnapshot"
import {
  CALL_LEG_COLUMNS,
  OPTION_CHAIN_COLUMN_COUNT,
  PUT_LEG_COLUMNS,
  chainLegColClass,
  type ChainLegColumn,
  type ChainTextColumnId,
} from "./optionChainColumns"
import {
  formatExpiryCountdown,
  formatNumber,
  formatSpotBadge,
} from "./optionChainFormat"
import { QuotePrice } from "./QuotePrice"
import { boardKeysEqual, buildBoardKeys, type QuoteBook } from "./quoteBook"

const SpotDividerRow = (props: {
  asset: Accessor<string>
  spot: Accessor<number>
}) => (
  <tr class="d-spot-divider-row">
    <td colspan={OPTION_CHAIN_COLUMN_COUNT}>
      <div class="d-spot-divider">
        <div class="d-spot-divider-line" />
        <div class="d-spot-badge">
          {/* Only the badge text tracks spot -- the dashed line stays static. */}
          {() => formatSpotBadge(props.asset(), props.spot())}
        </div>
      </div>
    </td>
  </tr>
)

const ExpiryCountdownHeader = (props: {
  expiryUnix: Accessor<ExpiryUnix | null>
}) => {
  const [nowMs, setNowMs] = createSignal(Date.now())

  onMount(() => {
    const tickId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    onCleanup(() => {
      window.clearInterval(tickId)
    })
  })

  return (
    <th class="d-strike-col d-expiry-countdown">
      <div class="d-expiry-countdown-label">
        {(() => {
          const expiryUnix = props.expiryUnix()
          if (expiryUnix === null) {
            return "—"
          }
          return formatExpiryCountdown(expiryUnix, nowMs())
        })()}
      </div>
    </th>
  )
}

const ChainTextCell = (props: {
  column: ChainTextColumnId
  moneyness: Accessor<Moneyness | undefined>
  label: Accessor<string>
}) => (
  <td
    classList={{
      [`d-${props.column}`]: true,
      "d-itm": props.moneyness() === "in_the_money",
    }}
  >
    {props.label()}
  </td>
)

const ChainQuoteCell = (props: {
  side: QuoteBookSide
  moneyness: Accessor<Moneyness | undefined>
  value: Accessor<number | null>
  isSelected: Accessor<boolean>
  onSelect: () => void
}) => (
  <td
    classList={{
      "d-itm": props.moneyness() === "in_the_money",
    }}
  >
    <QuotePrice
      side={props.side}
      value={props.value}
      isSelected={props.isSelected}
      onSelect={props.onSelect}
    />
  </td>
)

const ChainLegCells = (props: {
  columns: readonly ChainLegColumn[]
  book: QuoteBook
  instrumentName: () => string | undefined
  selection: Accessor<DeriveOrderTicketSelection | null>
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
}) => {
  const quote = (): OptionQuote | undefined => {
    const name = props.instrumentName()
    if (name === undefined) {
      return undefined
    }
    return props.book.byInstrument[name]
  }

  const moneyness = (): Moneyness | undefined => quote()?.moneyness

  const isSelected = (quoteSide: QuoteBookSide): boolean => {
    const selection = props.selection()
    const name = props.instrumentName()
    return (
      selection !== null &&
      name !== undefined &&
      selection.instrumentName === name &&
      selection.quoteSide === quoteSide
    )
  }

  return (
    <For each={props.columns as ChainLegColumn[]}>
      {column =>
        column.kind === "quote" ? (
          <ChainQuoteCell
            side={column.side}
            moneyness={moneyness}
            value={() => {
              const current = quote()
              if (current === undefined) {
                return null
              }
              return column.side === "ask" ? current.ask : current.bid
            }}
            isSelected={() => isSelected(column.side)}
            onSelect={() => {
              const name = props.instrumentName()
              if (name !== undefined) {
                props.onQuoteSelect(name, column.side)
              }
            }}
          />
        ) : (
          <ChainTextCell
            column={column.column}
            moneyness={moneyness}
            label={() => {
              const current = quote()
              return column.format(
                current === undefined ? null : column.read(current),
              )
            }}
          />
        )
      }
    </For>
  )
}

const ChainStrikeRow = (props: {
  strike: number
  book: QuoteBook
  selection: Accessor<DeriveOrderTicketSelection | null>
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
}) => (
  <tr>
    <ChainLegCells
      columns={CALL_LEG_COLUMNS}
      book={props.book}
      instrumentName={() => props.book.callByStrike[props.strike]}
      selection={props.selection}
      onQuoteSelect={props.onQuoteSelect}
    />
    <td class="d-strike-col">{formatNumber(props.strike, 0)}</td>
    <ChainLegCells
      columns={PUT_LEG_COLUMNS}
      book={props.book}
      instrumentName={() => props.book.putByStrike[props.strike]}
      selection={props.selection}
      onQuoteSelect={props.onQuoteSelect}
    />
  </tr>
)

export const OptionsChainTable = (props: {
  book: QuoteBook
  selectedAsset: Accessor<string | null>
  selectedExpiryUnix: Accessor<ExpiryUnix | null>
  selection: Accessor<DeriveOrderTicketSelection | null>
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
}): JSX.Element => {
  const boardKeys = createMemo(
    (previous: ReturnType<typeof buildBoardKeys> | undefined) => {
      const next = buildBoardKeys(props.book.strikesAsc, props.book.spot_price)
      if (previous !== undefined && boardKeysEqual(previous, next)) {
        return previous
      }
      return next
    },
  )

  const spotAsset = createMemo(() =>
    props.book.loaded ? props.book.asset : (props.selectedAsset() ?? ""),
  )
  const spotPrice = createMemo(() =>
    props.book.loaded ? props.book.spot_price : 0,
  )
  const expiryCountdownUnix = createMemo(
    (): ExpiryUnix | null =>
      props.selectedExpiryUnix() ?? props.book.active_expiry_unix ?? null,
  )

  return (
    <table class="d-chain d-options-chain">
      <colgroup>
        <For each={CALL_LEG_COLUMNS as ChainLegColumn[]}>
          {column => <col class={chainLegColClass(column)} />}
        </For>
        <col class="d-col-strike" />
        <For each={PUT_LEG_COLUMNS as ChainLegColumn[]}>
          {column => <col class={chainLegColClass(column)} />}
        </For>
      </colgroup>
      <thead>
        <tr>
          <th class="d-calls-label" colSpan={8}>
            Calls
          </th>
          <ExpiryCountdownHeader expiryUnix={expiryCountdownUnix} />
          <th class="d-puts-label" colSpan={8}>
            Puts
          </th>
        </tr>
        <tr>
          <th class="text-right">Size</th>
          <th class="text-right">Bid IV</th>
          <th class="text-right">Bid</th>
          <th class="text-right">Mark</th>
          <th class="text-right">Ask</th>
          <th class="text-right">Ask IV</th>
          <th class="text-right">Size</th>
          <th class="text-right">Delta</th>
          <th class="d-strike-col">Strike</th>
          <th class="text-right">Delta</th>
          <th class="text-right">Size</th>
          <th class="text-right">Ask IV</th>
          <th class="text-right">Ask</th>
          <th class="text-right">Mark</th>
          <th class="text-right">Bid</th>
          <th class="text-right">Bid IV</th>
          <th class="text-right">Size</th>
        </tr>
      </thead>
      <tbody>
        <For each={boardKeys()}>
          {key =>
            key === "spot" ? (
              <SpotDividerRow asset={spotAsset} spot={spotPrice} />
            ) : (
              <ChainStrikeRow
                strike={key}
                book={props.book}
                selection={props.selection}
                onQuoteSelect={props.onQuoteSelect}
              />
            )
          }
        </For>
      </tbody>
    </table>
  )
}
