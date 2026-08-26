import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import * as Effect from "effect/Effect"
import { X } from "lucide-solid"
import {
  Orientation,
  SplitviewSolid,
  loadSplitRatio,
  type ISplitviewPanelProps,
} from "@arminmajerie/dockview-solid"

import { Button } from "@/components/ui/button"
import type { NetworkMode } from "@/contexts/wallet-context"
import { NetworkError } from "@/lib/http"
import { cn } from "@/lib/cn"
import { DERIVE_CHAIN_GREEKS_SPLIT_STORAGE_KEY } from "./deriveChromeStorage"
import * as deriveService from "@/services/derive"

import {
  DeriveOrderTicket,
  type DeriveOrderTicketAddRequest,
} from "./DeriveOrderTicket"
import { deriveOptionsBaseUrl } from "./deriveOptionsBaseUrl"
import {
  selectionFromQuoteClick,
  selectionWithOrderSide,
  quoteSideForOrderSide,
  type DeriveOrderTicketSelection,
  type QuoteBookSide,
} from "./orderTicket"
import {
  type ExpiryUnix,
  type Moneyness,
  type OptionQuote,
  type OptionsBootstrap,
  type OptionsSnapshot,
} from "./optionsSnapshot"
import {
  applyOptionsSnapshot,
  boardKeysEqual,
  buildBoardKeys,
  emptyQuoteBook,
  skeletonizeQuoteBook,
  type BoardKey,
  type QuoteBook,
} from "./quoteBook"
import "./derive-options.css"

/**
 * Effect wraps an aborted fetch as a `NetworkError` whose `cause` is the
 * underlying `AbortError`; unwrap it so cancelled requests are not surfaced as
 * real failures.
 */
const isAbortError = (error: unknown): boolean => {
  const candidate = error instanceof NetworkError ? error.cause : error
  return (
    (candidate instanceof DOMException || candidate instanceof Error) &&
    candidate.name === "AbortError"
  )
}

const formatNumber = (value: number | null, digits = 2): string =>
  value === null ? "—" : value.toFixed(digits)

const formatUsdPrice = (value: number | null, digits = 2): string =>
  value === null ? "+" : `$${value.toFixed(digits)}`

const formatIvPercent = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`

const formatSpotBadge = (asset: string, spot: number): string =>
  `${asset} $${spot.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

/** Derive-style expiry header: `Thu Aug 6 13h 12m 31s`. */
const formatExpiryCountdown = (expiryUnix: number, nowMs: number): string => {
  const expiryDate = new Date(expiryUnix * 1000)
  const weekday = expiryDate.toLocaleDateString("en-US", { weekday: "short" })
  const month = expiryDate.toLocaleDateString("en-US", { month: "short" })
  const day = expiryDate.getDate()

  const remainingSeconds = Math.max(0, Math.floor(expiryUnix - nowMs / 1000))
  const days = Math.floor(remainingSeconds / 86_400)
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600)
  const minutes = Math.floor((remainingSeconds % 3_600) / 60)
  const seconds = remainingSeconds % 60

  const remainingLabel =
    days > 0
      ? `${days}d ${hours}h ${minutes}m ${seconds}s`
      : `${hours}h ${minutes}m ${seconds}s`

  return `${weekday} ${month} ${day} ${remainingLabel}`
}

const OPTION_CHAIN_COLUMN_COUNT = 17

const formatMoneyness = (value: Moneyness): string =>
  value === "in_the_money" ? "ITM" : value === "at_the_money" ? "ATM" : "OTM"

const OPTION_CHAIN_LEG_COL_CLASSES = [
  "w-[3.25rem]",
  "w-[3.75rem]",
  "w-[4.5rem]",
  "w-[4rem]",
  "w-[4.5rem]",
  "w-[3.75rem]",
  "w-[3.25rem]",
  "w-[3.25rem]",
] as const

const OPTION_CHAIN_COL_CLASSES = [
  ...OPTION_CHAIN_LEG_COL_CLASSES,
  "w-[4.25rem]",
  ...OPTION_CHAIN_LEG_COL_CLASSES,
] as const

const legCellClass = (moneyness: Moneyness | undefined, extra = ""): string => {
  const itm = moneyness === "in_the_money" ? "d-itm" : ""
  return `text-right tabular-nums ${itm} ${extra}`.trim()
}

const GREEKS_CHAIN_COL_CLASSES = [
  "w-[10.5rem]",
  "w-[3.5rem]",
  "w-[2.25rem]",
  "w-[2.75rem]",
  "w-[4.25rem]",
  "w-[4.25rem]",
  "w-[3.5rem]",
  "w-[3.5rem]",
  "w-[4rem]",
  "w-[3.75rem]",
  "w-[3.75rem]",
  "w-[3.5rem]",
  "w-[3.5rem]",
  "w-[4rem]",
  "w-[4.25rem]",
  "w-[3.5rem]",
  "w-[4.25rem]",
] as const

const parseJsonUnknown = (text: string): unknown =>
  (JSON.parse as (input: string) => unknown)(text)

type QuotePriceFlash = "up" | "down"

type QuoteFlashEntry = {
  bid?: QuotePriceFlash
  ask?: QuotePriceFlash
}

const priceTickDirection = (
  before: number | null,
  after: number | null,
): QuotePriceFlash | undefined => {
  if (before === null || after === null) {
    return undefined
  }
  if (after > before) {
    return "up"
  }
  if (after < before) {
    return "down"
  }
  return undefined
}

const bidAskFlashClass = (
  side: "bid" | "ask",
  direction: QuotePriceFlash | undefined,
  empty: boolean,
): string => {
  const tone = side === "bid" ? "d-bid" : "d-ask"
  const align = empty ? "text-center" : "text-right"
  const base = `block w-full rounded-sm px-0.5 tabular-nums ${align} ${tone}`
  if (direction === "up") {
    return `${base} quote-flash-up`
  }
  if (direction === "down") {
    return `${base} quote-flash-down`
  }
  return base
}

const FlashingPrice = (props: {
  side: "bid" | "ask"
  value: Accessor<number | null>
  instrumentName: Accessor<string | undefined>
  flashStore: Partial<Record<string, QuoteFlashEntry>>
  isSelected: Accessor<boolean>
  onSelect?: () => void
}) => {
  const flashClass = (): string => {
    const selected = props.isSelected()
    const empty = props.value() === null
    const selectedClass =
      selected && props.side === "ask"
        ? "d-price-selected-ask"
        : selected && props.side === "bid"
          ? "d-price-selected-bid"
          : ""
    return cn(
      bidAskFlashClass(
        props.side,
        (() => {
          if (selected || empty) {
            return undefined
          }
          const instrumentName = props.instrumentName()
          if (instrumentName === undefined) {
            return undefined
          }
          // Leaf path only -- never scan the whole flash store (`in` would notify broadly).
          return props.flashStore[instrumentName]?.[props.side]
        })(),
        empty,
      ),
      "d-price-btn",
      selectedClass,
    )
  }

  return (
    <Show
      when={props.onSelect !== undefined}
      fallback={
        <span class={flashClass()}>{formatUsdPrice(props.value())}</span>
      }
    >
      <button
        type="button"
        class={flashClass()}
        onClick={() => {
          props.onSelect?.()
        }}
      >
        {formatUsdPrice(props.value())}
      </button>
    </Show>
  )
}

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

type ExpiryTab = {
  unix: ExpiryUnix
  iso: string
}

const formatExpiryTabLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  })

const expiryTabsEqual = (left: ExpiryTab[], right: ExpiryTab[]): boolean =>
  left.length === right.length &&
  left.every(
    (tab, index) =>
      tab.unix === right[index]?.unix && tab.iso === right[index]?.iso,
  )

const stabilizeExpiryTabs = (
  previous: ExpiryTab[] | undefined,
  next: ExpiryTab[],
): ExpiryTab[] => {
  if (previous !== undefined && expiryTabsEqual(previous, next)) {
    return previous
  }
  return next.map(tab => {
    const reused = previous?.find(
      entry => entry.unix === tab.unix && entry.iso === tab.iso,
    )
    return reused ?? tab
  })
}

const ExpiryTabButtons = (props: {
  tabs: Accessor<ExpiryTab[]>
  selectedUnix: Accessor<ExpiryUnix | null>
  onSelect: (unix: ExpiryUnix) => void
}) => (
  <For each={props.tabs()}>
    {tab => (
      <button
        type="button"
        classList={{
          "d-expiry": true,
          "d-expiry-active": props.selectedUnix() === tab.unix,
          "shrink-0": true,
        }}
        onMouseDown={() => {
          props.onSelect(tab.unix)
        }}
        onClick={(
          event: MouseEvent & {
            currentTarget: HTMLButtonElement
            target: Element
          },
        ) => {
          if (event.detail === 0) {
            props.onSelect(tab.unix)
          }
        }}
      >
        {formatExpiryTabLabel(tab.iso)}
      </button>
    )}
  </For>
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

const ChainStrikeRow = (props: {
  strike: number
  book: QuoteBook
  flashStore: Partial<Record<string, QuoteFlashEntry>>
  selection: Accessor<DeriveOrderTicketSelection | null>
  onQuoteSelect: (instrumentName: string, quoteSide: QuoteBookSide) => void
}) => {
  const callName = (): string | undefined =>
    props.book.callByStrike[props.strike]
  const putName = (): string | undefined => props.book.putByStrike[props.strike]

  const isSelected = (
    instrumentName: string | undefined,
    quoteSide: QuoteBookSide,
  ): boolean => {
    const selection = props.selection()
    return (
      selection !== null &&
      instrumentName !== undefined &&
      selection.instrumentName === instrumentName &&
      selection.quoteSide === quoteSide
    )
  }

  const callField = <Field,>(
    read: (quote: OptionQuote) => Field,
    fallback: Field,
  ): Field => {
    const name = callName()
    if (name === undefined) {
      return fallback
    }
    return read(props.book.byInstrument[name])
  }

  const putField = <Field,>(
    read: (quote: OptionQuote) => Field,
    fallback: Field,
  ): Field => {
    const name = putName()
    if (name === undefined) {
      return fallback
    }
    return read(props.book.byInstrument[name])
  }

  return (
    <tr>
      <td
        class={legCellClass(
          callField(quote => quote.moneyness, undefined),
          "d-size",
        )}
      >
        {formatNumber(
          callField(quote => quote.bid_size, null),
          2,
        )}
      </td>
      <td
        class={legCellClass(
          callField(quote => quote.moneyness, undefined),
          "d-iv",
        )}
      >
        {formatIvPercent(callField(quote => quote.greeks.bid_iv, null))}
      </td>
      <td class={legCellClass(callField(quote => quote.moneyness, undefined))}>
        <FlashingPrice
          side="bid"
          value={() => callField(quote => quote.bid, null)}
          instrumentName={callName}
          flashStore={props.flashStore}
          isSelected={() => isSelected(callName(), "bid")}
          onSelect={() => {
            const name = callName()
            if (name !== undefined) {
              props.onQuoteSelect(name, "bid")
            }
          }}
        />
      </td>
      <td
        class={legCellClass(
          callField(quote => quote.moneyness, undefined),
          "d-mark",
        )}
      >
        {formatNumber(callField(quote => quote.mark, null))}
      </td>
      <td class={legCellClass(callField(quote => quote.moneyness, undefined))}>
        <FlashingPrice
          side="ask"
          value={() => callField(quote => quote.ask, null)}
          instrumentName={callName}
          flashStore={props.flashStore}
          isSelected={() => isSelected(callName(), "ask")}
          onSelect={() => {
            const name = callName()
            if (name !== undefined) {
              props.onQuoteSelect(name, "ask")
            }
          }}
        />
      </td>
      <td
        class={legCellClass(
          callField(quote => quote.moneyness, undefined),
          "d-iv",
        )}
      >
        {formatIvPercent(callField(quote => quote.greeks.ask_iv, null))}
      </td>
      <td
        class={legCellClass(
          callField(quote => quote.moneyness, undefined),
          "d-size",
        )}
      >
        {formatNumber(
          callField(quote => quote.ask_size, null),
          2,
        )}
      </td>
      <td
        class={legCellClass(
          callField(quote => quote.moneyness, undefined),
          "d-delta",
        )}
      >
        {formatNumber(
          callField(quote => quote.greeks.delta, null),
          3,
        )}
      </td>

      <td class="d-strike-col">{formatNumber(props.strike, 0)}</td>

      <td
        class={legCellClass(
          putField(quote => quote.moneyness, undefined),
          "d-delta",
        )}
      >
        {formatNumber(
          putField(quote => quote.greeks.delta, null),
          3,
        )}
      </td>
      <td
        class={legCellClass(
          putField(quote => quote.moneyness, undefined),
          "d-size",
        )}
      >
        {formatNumber(
          putField(quote => quote.ask_size, null),
          2,
        )}
      </td>
      <td
        class={legCellClass(
          putField(quote => quote.moneyness, undefined),
          "d-iv",
        )}
      >
        {formatIvPercent(putField(quote => quote.greeks.ask_iv, null))}
      </td>
      <td class={legCellClass(putField(quote => quote.moneyness, undefined))}>
        <FlashingPrice
          side="ask"
          value={() => putField(quote => quote.ask, null)}
          instrumentName={putName}
          flashStore={props.flashStore}
          isSelected={() => isSelected(putName(), "ask")}
          onSelect={() => {
            const name = putName()
            if (name !== undefined) {
              props.onQuoteSelect(name, "ask")
            }
          }}
        />
      </td>
      <td
        class={legCellClass(
          putField(quote => quote.moneyness, undefined),
          "d-mark",
        )}
      >
        {formatNumber(putField(quote => quote.mark, null))}
      </td>
      <td class={legCellClass(putField(quote => quote.moneyness, undefined))}>
        <FlashingPrice
          side="bid"
          value={() => putField(quote => quote.bid, null)}
          instrumentName={putName}
          flashStore={props.flashStore}
          isSelected={() => isSelected(putName(), "bid")}
          onSelect={() => {
            const name = putName()
            if (name !== undefined) {
              props.onQuoteSelect(name, "bid")
            }
          }}
        />
      </td>
      <td
        class={legCellClass(
          putField(quote => quote.moneyness, undefined),
          "d-iv",
        )}
      >
        {formatIvPercent(putField(quote => quote.greeks.bid_iv, null))}
      </td>
      <td
        class={legCellClass(
          putField(quote => quote.moneyness, undefined),
          "d-size",
        )}
      >
        {formatNumber(
          putField(quote => quote.bid_size, null),
          2,
        )}
      </td>
    </tr>
  )
}

const GreeksQuoteRow = (props: {
  instrumentName: string
  book: QuoteBook
  flashStore: Partial<Record<string, QuoteFlashEntry>>
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
        <FlashingPrice
          side="bid"
          value={() => quote()?.bid ?? null}
          instrumentName={() => props.instrumentName}
          flashStore={props.flashStore}
          isSelected={() => isSelected("bid")}
          onSelect={() => {
            props.onQuoteSelect(props.instrumentName, "bid")
          }}
        />
      </td>
      <td class={`text-right ${itmClass()}`}>
        <FlashingPrice
          side="ask"
          value={() => quote()?.ask ?? null}
          instrumentName={() => props.instrumentName}
          flashStore={props.flashStore}
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

type DetailTab = "greeks" | "order"

export const OptionsTradingView = (
  props: OptionsTradingViewProps,
): JSX.Element => {
  const greeksVisible = () => props.greeksLayout.visible()
  const minNotional = () => props.minNotional ?? 11

  const [book, setBook] = createStore(emptyQuoteBook())
  const [bootstrap, setBootstrap] = createSignal<OptionsBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)
  const [selectedExpiryUnix, setSelectedExpiryUnix] =
    createSignal<ExpiryUnix | null>(null)
  const [selectedAsset, setSelectedAsset] = createSignal<string | null>(null)
  const [flashByInstrument, setFlashByInstrument] = createStore<
    Record<string, QuoteFlashEntry>
  >({})
  const [detailTab, setDetailTab] = createSignal<DetailTab>("greeks")
  const [orderSelection, setOrderSelection] =
    createSignal<DeriveOrderTicketSelection | null>(null)

  const clearQuoteFlash = (): void => {
    setFlashByInstrument(reconcile({}))
  }

  const quotePriceHistoryRef: {
    map: Map<string, { bid: number | null; ask: number | null }>
    activeExpiryUnix: ExpiryUnix | null
  } = { map: new Map(), activeExpiryUnix: null }

  const flashClearTimerRef: { id: number | undefined } = { id: undefined }
  const coldGreeksFlushAtRef: { ms: number } = { ms: 0 }
  const COLD_GREEKS_MIN_INTERVAL_MS = 250

  const pushOptionsSnapshot = (next: OptionsSnapshot): void => {
    const nowMs = Date.now()
    const applyColdGreeks =
      nowMs - coldGreeksFlushAtRef.ms >= COLD_GREEKS_MIN_INTERVAL_MS
    const applied = applyOptionsSnapshot(setBook, next, book.byInstrument, {
      applyColdGreeks,
    })
    if (applied.coldGreeksApplied) {
      coldGreeksFlushAtRef.ms = nowMs
    }
  }

  const deriveBaseUrl = deriveOptionsBaseUrl()
  let streamRef: EventSource | null = null

  const expirySwitchInFlightRef: {
    postAbort: AbortController | undefined
    blockStreamUntilExpiryUnix: ExpiryUnix | null
  } = { postAbort: undefined, blockStreamUntilExpiryUnix: null }

  const assetSwitchInFlightRef: {
    postAbort: AbortController | undefined
    blockStreamUntilAsset: string | null
  } = { postAbort: undefined, blockStreamUntilAsset: null }

  const assetTabList = createMemo(() => {
    const boot = bootstrap()
    if (boot !== null && boot.assets.length > 0) {
      return boot.assets
    }
    if (book.loaded && book.asset.length > 0) {
      return [book.asset]
    }
    return [] as string[]
  })

  const expiryTabList = createMemo(
    (previous: ExpiryTab[] | undefined): ExpiryTab[] => {
      let tabs: ExpiryTab[] = []
      if (book.loaded && book.expiry_unixes.length > 0) {
        tabs = book.expiry_unixes.map((unix, index) => ({
          unix,
          iso: book.expiry_dates[index] ?? new Date(unix * 1000).toISOString(),
        }))
      } else {
        const boot = bootstrap()
        if (boot !== null && boot.tabs.length > 0) {
          tabs = boot.tabs.map(tab => ({
            unix: tab.expiry_unix,
            iso: new Date(tab.expiry_unix * 1000).toISOString(),
          }))
        }
      }
      return stabilizeExpiryTabs(
        previous,
        [...tabs].sort((left, right) => left.unix - right.unix),
      )
    },
  )

  const expiryCountdownUnix = createMemo(
    (): ExpiryUnix | null =>
      selectedExpiryUnix() ?? book.active_expiry_unix ?? null,
  )

  const postActiveExpiry = (
    expiryUnix: ExpiryUnix,
    signal?: AbortSignal,
  ): Promise<void> =>
    Effect.runPromise(
      deriveService.postActiveExpiry(
        deriveBaseUrl,
        props.networkMode(),
        expiryUnix,
        signal,
      ),
    )

  const postActiveAsset = (
    asset: string,
    signal?: AbortSignal,
  ): Promise<void> =>
    Effect.runPromise(
      deriveService.postActiveAsset(
        deriveBaseUrl,
        props.networkMode(),
        asset,
        signal,
      ),
    )

  const clearQuotesForPendingSwitch = (
    nextExpiryUnix: ExpiryUnix | null,
    nextAsset: string | null,
  ): void => {
    if (!book.loaded) {
      return
    }
    // Keep previous strikes / instruments so the chain does not collapse;
    // prices show as em-dashes until the matching stream snapshot arrives.
    batch(() => {
      if (nextAsset !== null) {
        setBook("asset", nextAsset)
      }
      if (nextExpiryUnix !== null) {
        setBook("active_expiry_unix", nextExpiryUnix)
      }
      skeletonizeQuoteBook(setBook)
    })
    clearQuoteFlash()
  }

  const switchExpiryTab = (expiryUnix: ExpiryUnix): void => {
    if (assetSwitchInFlightRef.blockStreamUntilAsset !== null) {
      return
    }
    if (
      selectedExpiryUnix() === expiryUnix &&
      book.loaded &&
      book.active_expiry_unix === expiryUnix &&
      book.instrumentNamesAsc.length > 0
    ) {
      return
    }

    const previousExpiryUnix = selectedExpiryUnix()

    expirySwitchInFlightRef.postAbort?.abort()
    const controller = new AbortController()
    expirySwitchInFlightRef.postAbort = controller
    expirySwitchInFlightRef.blockStreamUntilExpiryUnix = expiryUnix

    setSelectedExpiryUnix(expiryUnix)
    clearQuotesForPendingSwitch(expiryUnix, null)
    setOrderSelection(null)

    void postActiveExpiry(expiryUnix, controller.signal)
      .then(() => {
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        const aborted = isAbortError(error)
        if (aborted) {
          return
        }
        expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
        setSelectedExpiryUnix(previousExpiryUnix)
        setErrorMessage(
          error instanceof Error ? error.message : "Expiry tab switch failed",
        )
      })
  }

  const switchAssetTab = (asset: string): void => {
    if (
      selectedAsset() === asset &&
      book.loaded &&
      book.asset === asset &&
      book.instrumentNamesAsc.length > 0
    ) {
      return
    }

    const previousAsset = selectedAsset()
    const previousExpiryUnix = selectedExpiryUnix()

    assetSwitchInFlightRef.postAbort?.abort()
    expirySwitchInFlightRef.postAbort?.abort()
    const controller = new AbortController()
    assetSwitchInFlightRef.postAbort = controller
    assetSwitchInFlightRef.blockStreamUntilAsset = asset
    expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null

    setSelectedAsset(asset)
    setSelectedExpiryUnix(null)
    setOrderSelection(null)
    quotePriceHistoryRef.map.clear()
    quotePriceHistoryRef.activeExpiryUnix = null
    clearQuotesForPendingSwitch(null, asset)
    setIsLoading(true)

    void postActiveAsset(asset, controller.signal)
      .then(() => {
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        const aborted = isAbortError(error)
        if (aborted) {
          return
        }
        assetSwitchInFlightRef.blockStreamUntilAsset = null
        setSelectedAsset(previousAsset)
        setSelectedExpiryUnix(previousExpiryUnix)
        setIsLoading(false)
        setErrorMessage(
          error instanceof Error ? error.message : "Asset switch failed",
        )
      })
  }

  const handleQuoteSelect = (
    instrumentName: string,
    quoteSide: QuoteBookSide,
  ): void => {
    if (!(instrumentName in book.byInstrument)) {
      return
    }
    const quote = book.byInstrument[instrumentName]
    const selection = selectionFromQuoteClick(
      quote,
      quoteSide,
      orderSelection(),
    )
    setOrderSelection(selection)
    setDetailTab("order")
    props.greeksLayout.setVisible(true)
  }

  const handleTicketSideChange = (side: "buy" | "sell"): void => {
    const current = orderSelection()
    if (current === null) {
      return
    }
    const quoteSide = quoteSideForOrderSide(side)
    const liveLimit =
      current.instrumentName in book.byInstrument
        ? (() => {
            const quote = book.byInstrument[current.instrumentName]
            return quoteSide === "ask" ? quote.ask : quote.bid
          })()
        : null
    setOrderSelection(selectionWithOrderSide(current, side, liveLimit))
  }

  const boardKeys = createMemo(
    (previous: BoardKey[] | undefined): BoardKey[] => {
      const next = buildBoardKeys(book.strikesAsc, book.spot_price)
      if (previous !== undefined && boardKeysEqual(previous, next)) {
        return previous
      }
      return next
    },
  )

  const spotAsset = createMemo(() =>
    book.loaded ? book.asset : (selectedAsset() ?? ""),
  )
  const spotPrice = createMemo(() => (book.loaded ? book.spot_price : 0))

  createEffect(() => {
    // Imperative previous-quote map + timeout; memo alone cannot express "flash then clear".
    if (!book.loaded) {
      return
    }

    onCleanup(() => {
      if (flashClearTimerRef.id !== undefined) {
        window.clearTimeout(flashClearTimerRef.id)
        flashClearTimerRef.id = undefined
      }
    })

    const activeExpiry = book.active_expiry_unix
    if (quotePriceHistoryRef.activeExpiryUnix !== activeExpiry) {
      quotePriceHistoryRef.map.clear()
      quotePriceHistoryRef.activeExpiryUnix = activeExpiry
      for (const name of book.instrumentNamesAsc) {
        const quote = book.byInstrument[name]
        quotePriceHistoryRef.map.set(name, {
          bid: quote.bid,
          ask: quote.ask,
        })
      }
      setFlashByInstrument(reconcile({}))
      return
    }

    const nextFlash: Partial<Record<string, QuoteFlashEntry>> = {}

    for (const name of book.instrumentNamesAsc) {
      const quote = book.byInstrument[name]
      const prev = quotePriceHistoryRef.map.get(name)
      if (prev !== undefined) {
        const bidTick = priceTickDirection(prev.bid, quote.bid)
        const askTick = priceTickDirection(prev.ask, quote.ask)
        if (bidTick !== undefined) {
          nextFlash[name] = {
            ...nextFlash[name],
            bid: bidTick,
          }
        }
        if (askTick !== undefined) {
          nextFlash[name] = {
            ...nextFlash[name],
            ask: askTick,
          }
        }
      }
      quotePriceHistoryRef.map.set(name, {
        bid: quote.bid,
        ask: quote.ask,
      })
    }

    if (Object.keys(nextFlash).length > 0) {
      if (flashClearTimerRef.id !== undefined) {
        window.clearTimeout(flashClearTimerRef.id)
      }
      for (const [instrumentName, tick] of Object.entries(nextFlash)) {
        setFlashByInstrument(instrumentName, previous => ({
          ...previous,
          ...tick,
        }))
      }
      const flashedNames = Object.keys(nextFlash)
      flashClearTimerRef.id = window.setTimeout(() => {
        // Clear only flashed instruments (empty entry) -- avoid rewriting the whole store.
        batch(() => {
          for (const instrumentName of flashedNames) {
            setFlashByInstrument(instrumentName, {})
          }
        })
        flashClearTimerRef.id = undefined
      }, 950)
    }
  })

  const loadSnapshot = (signal?: AbortSignal): Promise<OptionsSnapshot> =>
    Effect.runPromise(
      deriveService.fetchSnapshot(deriveBaseUrl, props.networkMode(), signal),
    )

  const startStream = (): void => {
    streamRef?.close()
    streamRef = new EventSource(
      deriveService.deriveOptionsStreamUrl(deriveBaseUrl, props.networkMode()),
    )
    streamRef.onmessage = event => {
      try {
        if (typeof event.data !== "string") {
          setErrorMessage("Stream parse error: expected string payload")
          return
        }
        const next = parseJsonUnknown(event.data) as OptionsSnapshot
        const pendingAsset = assetSwitchInFlightRef.blockStreamUntilAsset
        if (pendingAsset !== null) {
          if (next.asset !== pendingAsset) {
            return
          }
          assetSwitchInFlightRef.blockStreamUntilAsset = null
          setSelectedAsset(next.asset)
          setSelectedExpiryUnix(next.active_expiry_unix)
          quotePriceHistoryRef.map.clear()
          quotePriceHistoryRef.activeExpiryUnix = next.active_expiry_unix
          setFlashByInstrument(reconcile({}))
          setBootstrap(previous =>
            previous === null
              ? previous
              : {
                  ...previous,
                  asset: next.asset,
                  default_expiry_unix: next.active_expiry_unix,
                  tabs: next.expiry_unixes.map(expiryUnix => ({
                    expiry_unix: expiryUnix,
                    instruments: [],
                  })),
                },
          )
          batch(() => {
            pushOptionsSnapshot(next)
          })
          setErrorMessage(null)
          return
        }
        if (next.asset !== selectedAsset()) {
          return
        }
        const pendingExpiry = expirySwitchInFlightRef.blockStreamUntilExpiryUnix
        if (pendingExpiry !== null) {
          if (next.active_expiry_unix !== pendingExpiry) {
            return
          }
          expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
        } else {
          const selected = selectedExpiryUnix()
          const selectedStillListed =
            selected !== null && next.expiry_unixes.includes(selected)
          if (next.active_expiry_unix !== selected && selectedStillListed) {
            return
          }
          if (next.active_expiry_unix !== selected) {
            setSelectedExpiryUnix(next.active_expiry_unix)
          }
        }
        batch(() => {
          pushOptionsSnapshot(next)
        })
        setErrorMessage(null)
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Stream parse error",
        )
      } finally {
        setIsLoading(false)
      }
    }
    streamRef.onerror = () => {
      setErrorMessage("Stream disconnected. Waiting for reconnection...")
    }
  }

  // createEffect: open options EventSource only while streamEnabled is true.
  // Re-bind when networkMode changes so the chain follows the Testnet toggle.
  // Do not read selectedAsset/expiry here -- initialize sets them and would
  // re-trigger this effect into an abort loop.
  createEffect(() => {
    if (!props.streamEnabled()) {
      streamRef?.close()
      streamRef = null
      setIsLoading(false)
      return
    }

    const network = props.networkMode()
    const controller = new AbortController()
    const mountGeneration = { value: 0 }
    const claim = ++mountGeneration.value
    setIsLoading(true)
    setBootstrap(null)
    setOrderSelection(null)
    setBook(reconcile(emptyQuoteBook()))
    quotePriceHistoryRef.map.clear()
    quotePriceHistoryRef.activeExpiryUnix = null
    setFlashByInstrument(reconcile({}))

    const initialize = async () => {
      try {
        const boot = await Effect.runPromise(
          deriveService.fetchBootstrap(
            deriveBaseUrl,
            network,
            controller.signal,
          ),
        )
        if (mountGeneration.value !== claim) {
          return
        }
        setBootstrap(boot)
        setSelectedAsset(boot.asset)
        const defaultUnix = boot.default_expiry_unix
        setSelectedExpiryUnix(defaultUnix)
        await postActiveExpiry(defaultUnix, controller.signal)
        if (mountGeneration.value !== claim) {
          return
        }
        const data = await loadSnapshot(controller.signal)
        if (mountGeneration.value !== claim) {
          return
        }
        batch(() => {
          pushOptionsSnapshot(data)
        })
        setSelectedAsset(data.asset)
        setSelectedExpiryUnix(data.active_expiry_unix)
        setErrorMessage(null)
        startStream()
      } catch (error) {
        if (mountGeneration.value !== claim) {
          return
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unknown derive options error",
        )
      } finally {
        if (mountGeneration.value === claim) {
          setIsLoading(false)
        }
      }
    }

    void initialize()

    onCleanup(() => {
      mountGeneration.value += 1
      controller.abort()
      expirySwitchInFlightRef.postAbort?.abort()
      expirySwitchInFlightRef.postAbort = undefined
      expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
      assetSwitchInFlightRef.postAbort?.abort()
      assetSwitchInFlightRef.postAbort = undefined
      assetSwitchInFlightRef.blockStreamUntilAsset = null
      streamRef?.close()
      streamRef = null
    })
  })

  const chainTable = (): JSX.Element => (
    <table class="d-chain table-fixed">
      <colgroup>
        <For each={[...OPTION_CHAIN_COL_CLASSES]}>
          {widthClass => <col class={widthClass} />}
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
                book={book}
                flashStore={flashByInstrument}
                selection={orderSelection}
                onQuoteSelect={handleQuoteSelect}
              />
            )
          }
        </For>
      </tbody>
    </table>
  )

  const greeksTable = (): JSX.Element => (
    <table class="d-chain table-fixed min-w-[1320px]">
      <colgroup>
        <For each={[...GREEKS_CHAIN_COL_CLASSES]}>
          {widthClass => <col class={widthClass} />}
        </For>
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
        <For each={book.instrumentNamesAsc}>
          {name => (
            <GreeksQuoteRow
              instrumentName={name}
              book={book}
              flashStore={flashByInstrument}
              selection={orderSelection}
              onQuoteSelect={handleQuoteSelect}
            />
          )}
        </For>
      </tbody>
    </table>
  )

  const detailPanel = (): JSX.Element => (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center justify-between border-t border-[var(--d-border)] px-2 py-1">
        <div class="flex items-center gap-1">
          <button
            type="button"
            classList={{
              "d-detail-tab": true,
              "d-detail-tab-active": detailTab() === "greeks",
            }}
            onClick={() => {
              setDetailTab("greeks")
            }}
          >
            Greeks
          </button>
          <button
            type="button"
            classList={{
              "d-detail-tab": true,
              "d-detail-tab-active": detailTab() === "order",
            }}
            onClick={() => {
              setDetailTab("order")
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
            props.greeksLayout.setVisible(false)
          }}
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
      <Show
        when={detailTab() === "greeks"}
        fallback={
          <div class="d-greeks-scroll min-h-0 flex-1 overflow-auto">
            <DeriveOrderTicket
              selection={orderSelection}
              minNotional={minNotional()}
              onSideChange={handleTicketSideChange}
              onAdd={props.onAddOption}
            />
          </div>
        }
      >
        <div class="d-greeks-scroll min-h-0 flex-1 overflow-auto">
          {greeksTable()}
        </div>
      </Show>
    </div>
  )

  const splitviewComponents: Record<
    string,
    (_panelProps: ISplitviewPanelProps) => JSX.Element
  > = {
    chain: () => (
      <div class="d-chain-scroll h-full min-h-0 overflow-auto">
        {chainTable()}
      </div>
    ),
    greeks: () => detailPanel(),
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
              <For each={assetTabList()}>
                {asset => (
                  <button
                    type="button"
                    class={`d-chip shrink-0 ${selectedAsset() === asset ? "d-chip-active" : ""}`}
                    onMouseDown={() => {
                      switchAssetTab(asset)
                    }}
                    onClick={(
                      event: MouseEvent & {
                        currentTarget: HTMLButtonElement
                        target: Element
                      },
                    ) => {
                      if (event.detail === 0) {
                        switchAssetTab(asset)
                      }
                    }}
                  >
                    {asset}
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={isLoading()}>
            <span class="shrink-0 text-[var(--d-muted)]">Loading chain...</span>
          </Show>
        </header>

        <Show when={errorMessage()}>
          <div class="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            {errorMessage()}
          </div>
        </Show>

        <div class="d-board flex min-h-0 flex-1 flex-col">
          <div class="shrink-0 overflow-x-auto border-b border-[var(--d-border)] px-2 scrollbar-hide">
            <div class="flex w-max">
              <ExpiryTabButtons
                tabs={expiryTabList}
                selectedUnix={selectedExpiryUnix}
                onSelect={switchExpiryTab}
              />
            </div>
          </div>

          <Show
            when={greeksVisible()}
            fallback={
              <div class="d-chain-scroll min-h-0 flex-1 overflow-auto">
                {chainTable()}
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
