import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import * as Effect from "effect/Effect"

import { fetchStreamChecked, NetworkError } from "@/lib/http"
import { computeRollingVolatility } from "@/pages/Prototype/metrics/computations"
import type { TimeSeriesPoint } from "@/pages/Prototype/metrics/registry"
import * as deriveService from "@/services/derive"
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

type OptionKind = "C" | "P"
type Moneyness = "in_the_money" | "at_the_money" | "out_of_the_money"

type ExpiryUnix = number & { readonly __brand: "ExpiryUnix" }

type OptionGreeks = {
  bid_iv: number | null
  ask_iv: number | null
  delta: number | null
  gamma: number | null
  vega: number | null
  theta: number | null
  iv: number | null
  rho: number | null
  forward_price: number | null
  discount_factor: number | null
  option_model_mark: number | null
}

type OptionQuote = {
  instrument_name: string
  kind: OptionKind
  strike: number
  expiry: string
  expiry_unix: ExpiryUnix
  bid: number | null
  ask: number | null
  bid_size: number | null
  ask_size: number | null
  mark: number | null
  spot_price: number
  moneyness: Moneyness
  greeks: OptionGreeks
}

type PortfolioRiskSummary = {
  aggregate_delta: number
  aggregate_gamma: number
  aggregate_vega: number
  aggregate_theta: number
  hedge_ratio_btc: number
}

const EMPTY_TAB_RISK: PortfolioRiskSummary = {
  aggregate_delta: 0,
  aggregate_gamma: 0,
  aggregate_vega: 0,
  aggregate_theta: 0,
  hedge_ratio_btc: 0,
}

const EMPTY_OPTION_GREEKS: OptionGreeks = {
  bid_iv: null,
  ask_iv: null,
  delta: null,
  gamma: null,
  vega: null,
  theta: null,
  iv: null,
  rho: null,
  forward_price: null,
  discount_factor: null,
  option_model_mark: null,
}

/** Keep strike / instrument layout while zeroing prices for a switch skeleton. */
const skeletonizeQuotes = (quotes: OptionQuote[]): OptionQuote[] =>
  quotes.map(quote => ({
    ...quote,
    bid: null,
    ask: null,
    bid_size: null,
    ask_size: null,
    mark: null,
    greeks: EMPTY_OPTION_GREEKS,
  }))

type ScenarioPoint = {
  pct_move: number
  estimated_pnl: number
}

export type OptionsSnapshot = {
  asset: string
  updated_at: string
  active_expiry_unix: ExpiryUnix
  expiry_unixes: ExpiryUnix[]
  spot_price: number
  expiry_dates: string[]
  strikes: number[]
  quotes: OptionQuote[]
  risk: PortfolioRiskSummary
  scenarios: ScenarioPoint[]
}

export type OptionsBootstrap = {
  asset: string
  assets: string[]
  default_expiry_unix: ExpiryUnix
  tabs: Array<{ expiry_unix: ExpiryUnix; instruments: string[] }>
}

const formatNumber = (value: number | null, digits = 2): string =>
  value === null ? "—" : value.toFixed(digits)

const formatIvPercent = (value: number | null): string =>
  value === null ? "—" : (value * 100).toFixed(1)

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
  "w-[3rem]",
  "w-[4rem]",
  "w-[4rem]",
  "w-[4rem]",
  "w-[3rem]",
  "w-[3.25rem]",
  "w-[3rem]",
] as const

const OPTION_CHAIN_COL_CLASSES = [
  ...OPTION_CHAIN_LEG_COL_CLASSES,
  "w-[8.5rem]",
  ...OPTION_CHAIN_LEG_COL_CLASSES,
] as const

const legCellClass = (moneyness: Moneyness | undefined, extra = ""): string => {
  const itm = moneyness === "in_the_money" ? "d-itm" : ""
  return `text-right ${itm} ${extra}`.trim()
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

const REALIZED_VOL_WINDOW_DAYS = 30

const parseNdjsonRecords = (text: string): unknown[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return []
  }
  if (trimmed.startsWith("[")) {
    const parsed = parseJsonUnknown(trimmed)
    return Array.isArray(parsed) ? parsed : []
  }
  return trimmed
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => parseJsonUnknown(line))
}

const recordToObject = (row: unknown): Record<string, unknown> | null =>
  row !== null && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null

const isBtcCandleRow = (row: Record<string, unknown>): boolean => {
  const ticker = row.ticker
  if (typeof ticker === "string" && ticker.toUpperCase() === "BTC") {
    return true
  }
  const symbol = row.symbol
  if (typeof symbol === "string") {
    const sym = symbol.toUpperCase()
    if (sym === "BTC" || sym.startsWith("BTC/") || sym.startsWith("BTC:")) {
      return true
    }
  }
  return false
}

const rowClosePrice = (row: Record<string, unknown>): number | null => {
  const close = row.close
  if (typeof close === "number" && Number.isFinite(close)) {
    return close
  }
  if (typeof close === "string") {
    const parsed = Number.parseFloat(close)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const rowTimeMs = (row: Record<string, unknown>): number => {
  const ts = row.timestamp
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts < 1e12 ? ts * 1000 : ts
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const btcCloseSeriesFromCandlesResponse = (text: string): TimeSeriesPoint[] => {
  const points: TimeSeriesPoint[] = []
  for (const raw of parseNdjsonRecords(text)) {
    const row = recordToObject(raw)
    if (row === null || !isBtcCandleRow(row)) {
      continue
    }
    const close = rowClosePrice(row)
    if (close === null) {
      continue
    }
    const time = rowTimeMs(row)
    if (!Number.isFinite(time) || time <= 0) {
      continue
    }
    points.push({ time, value: close })
  }
  points.sort((left, right) => left.time - right.time)
  const deduped: TimeSeriesPoint[] = []
  for (const point of points) {
    const tail = deduped.length > 0 ? deduped[deduped.length - 1] : undefined
    if (tail?.time === point.time) {
      deduped[deduped.length - 1] = point
      continue
    }
    deduped.push(point)
  }
  return deduped
}

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
): string => {
  const tone = side === "bid" ? "d-bid" : "d-ask"
  const base = `inline-block min-w-[2.5rem] rounded-sm px-0.5 text-right tabular-nums ${tone}`
  if (direction === "up") {
    return `${base} quote-flash-up`
  }
  if (direction === "down") {
    return `${base} quote-flash-down`
  }
  return base
}

type StrikeLegs = {
  call: OptionQuote | null
  put: OptionQuote | null
}

type BoardKey = number | "spot"

const FlashingPrice = (props: {
  side: "bid" | "ask"
  value: Accessor<number | null>
  instrumentName: Accessor<string | undefined>
  flashStore: Record<string, QuoteFlashEntry>
}) => (
  <span
    class={bidAskFlashClass(
      props.side,
      (() => {
        const instrumentName = props.instrumentName()
        if (instrumentName === undefined) {
          return undefined
        }
        return props.flashStore[instrumentName][props.side]
      })(),
    )}
  >
    {formatNumber(props.value())}
  </span>
)

const SpotDividerRow = (props: {
  asset: Accessor<string>
  spot: Accessor<number>
}) => (
  <tr class="d-spot-divider-row">
    <td colspan={OPTION_CHAIN_COLUMN_COUNT}>
      <div class="d-spot-divider">
        <div class="d-spot-divider-line" />
        <div class="d-spot-badge">
          {formatSpotBadge(props.asset(), props.spot())}
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
      {(() => {
        const expiryUnix = props.expiryUnix()
        if (expiryUnix === null) {
          return "—"
        }
        return formatExpiryCountdown(expiryUnix, nowMs())
      })()}
    </th>
  )
}

const ChainStrikeRow = (props: {
  strike: number
  rowByStrike: Accessor<Map<number, StrikeLegs>>
  flashStore: Record<string, QuoteFlashEntry>
}) => {
  const call = createMemo(
    () => props.rowByStrike().get(props.strike)?.call ?? null,
  )
  const put = createMemo(
    () => props.rowByStrike().get(props.strike)?.put ?? null,
  )

  return (
    <tr>
      <td class={legCellClass(call()?.moneyness, "d-size")}>
        {formatNumber(call()?.bid_size ?? null, 2)}
      </td>
      <td class={legCellClass(call()?.moneyness, "d-iv")}>
        {formatIvPercent(call()?.greeks.bid_iv ?? null)}
      </td>
      <td class={legCellClass(call()?.moneyness)}>
        <FlashingPrice
          side="bid"
          value={() => call()?.bid ?? null}
          instrumentName={() => call()?.instrument_name}
          flashStore={props.flashStore}
        />
      </td>
      <td class={legCellClass(call()?.moneyness, "d-mark")}>
        {formatNumber(call()?.mark ?? null)}
      </td>
      <td class={legCellClass(call()?.moneyness)}>
        <FlashingPrice
          side="ask"
          value={() => call()?.ask ?? null}
          instrumentName={() => call()?.instrument_name}
          flashStore={props.flashStore}
        />
      </td>
      <td class={legCellClass(call()?.moneyness, "d-iv")}>
        {formatIvPercent(call()?.greeks.ask_iv ?? null)}
      </td>
      <td class={legCellClass(call()?.moneyness, "d-size")}>
        {formatNumber(call()?.ask_size ?? null, 2)}
      </td>
      <td class={legCellClass(call()?.moneyness, "d-delta")}>
        {formatNumber(call()?.greeks.delta ?? null, 3)}
      </td>

      <td class="d-strike-col">{formatNumber(props.strike, 0)}</td>

      <td class={legCellClass(put()?.moneyness, "d-delta")}>
        {formatNumber(put()?.greeks.delta ?? null, 3)}
      </td>
      <td class={legCellClass(put()?.moneyness, "d-size")}>
        {formatNumber(put()?.ask_size ?? null, 2)}
      </td>
      <td class={legCellClass(put()?.moneyness, "d-iv")}>
        {formatIvPercent(put()?.greeks.ask_iv ?? null)}
      </td>
      <td class={legCellClass(put()?.moneyness)}>
        <FlashingPrice
          side="ask"
          value={() => put()?.ask ?? null}
          instrumentName={() => put()?.instrument_name}
          flashStore={props.flashStore}
        />
      </td>
      <td class={legCellClass(put()?.moneyness, "d-mark")}>
        {formatNumber(put()?.mark ?? null)}
      </td>
      <td class={legCellClass(put()?.moneyness)}>
        <FlashingPrice
          side="bid"
          value={() => put()?.bid ?? null}
          instrumentName={() => put()?.instrument_name}
          flashStore={props.flashStore}
        />
      </td>
      <td class={legCellClass(put()?.moneyness, "d-iv")}>
        {formatIvPercent(put()?.greeks.bid_iv ?? null)}
      </td>
      <td class={legCellClass(put()?.moneyness, "d-size")}>
        {formatNumber(put()?.bid_size ?? null, 2)}
      </td>
    </tr>
  )
}

const DeriveOptionsPage = () => {
  const [snapshot, setSnapshot] = createSignal<OptionsSnapshot | null>(null)
  const [bootstrap, setBootstrap] = createSignal<OptionsBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isLoading, setIsLoading] = createSignal(true)
  const [selectedExpiryUnix, setSelectedExpiryUnix] =
    createSignal<ExpiryUnix | null>(null)
  const [selectedAsset, setSelectedAsset] = createSignal<string | null>(null)
  const [smileKind, setSmileKind] = createSignal<"C" | "P" | "both">("both")
  const [tableView, setTableView] = createSignal<"chain" | "greeks">("chain")
  const [flashByInstrument, setFlashByInstrument] = createStore<
    Record<string, QuoteFlashEntry>
  >({})

  const clearQuoteFlash = (): void => {
    setFlashByInstrument(reconcile({}))
  }
  const [realizedVolAnnual30d, setRealizedVolAnnual30d] = createSignal<
    number | null
  >(null)

  const quotePriceHistoryRef: {
    map: Map<string, { bid: number | null; ask: number | null }>
    activeExpiryUnix: ExpiryUnix | null
  } = { map: new Map(), activeExpiryUnix: null }

  const flashClearTimerRef: { id: number | undefined } = { id: undefined }

  const viteDeriveUrl: unknown = import.meta.env.VITE_DERIVE_SERVER_URL
  const deriveBaseUrl =
    typeof viteDeriveUrl === "string" && viteDeriveUrl.length > 0
      ? viteDeriveUrl
      : "http://localhost:8100"
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
    const current = snapshot()
    if (current !== null) {
      return [current.asset]
    }
    return [] as string[]
  })

  const expiryTabList = createMemo(
    (previous: ExpiryTab[] | undefined): ExpiryTab[] => {
      const current = snapshot()
      let tabs: ExpiryTab[] = []
      if (current !== null && current.expiry_unixes.length > 0) {
        tabs = current.expiry_unixes.map((unix, index) => ({
          unix,
          iso:
            current.expiry_dates[index] ?? new Date(unix * 1000).toISOString(),
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
      selectedExpiryUnix() ?? snapshot()?.active_expiry_unix ?? null,
  )

  const postActiveExpiry = (
    expiryUnix: ExpiryUnix,
    signal?: AbortSignal,
  ): Promise<void> =>
    Effect.runPromise(
      deriveService.postActiveExpiry(deriveBaseUrl, expiryUnix, signal),
    )

  const postActiveAsset = (
    asset: string,
    signal?: AbortSignal,
  ): Promise<void> =>
    Effect.runPromise(
      deriveService.postActiveAsset(deriveBaseUrl, asset, signal),
    )

  const clearQuotesForPendingSwitch = (
    nextExpiryUnix: ExpiryUnix | null,
    nextAsset: string | null,
  ): void => {
    const snap = snapshot()
    if (snap === null) {
      return
    }
    // Keep previous strikes / instruments so the chain does not collapse;
    // prices show as em-dashes until the matching stream snapshot arrives.
    setSnapshot({
      ...snap,
      asset: nextAsset ?? snap.asset,
      active_expiry_unix: nextExpiryUnix ?? snap.active_expiry_unix,
      updated_at: new Date().toISOString(),
      quotes: skeletonizeQuotes(snap.quotes),
      risk: EMPTY_TAB_RISK,
      scenarios: snap.scenarios.map(scenario => ({
        ...scenario,
        estimated_pnl: 0,
      })),
    })
    clearQuoteFlash()
  }

  const switchExpiryTab = (expiryUnix: ExpiryUnix): void => {
    if (assetSwitchInFlightRef.blockStreamUntilAsset !== null) {
      return
    }
    const currentSnap = snapshot()
    if (
      selectedExpiryUnix() === expiryUnix &&
      currentSnap !== null &&
      currentSnap.active_expiry_unix === expiryUnix &&
      currentSnap.quotes.length > 0
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
    const currentSnap = snapshot()
    if (
      selectedAsset() === asset &&
      currentSnap !== null &&
      currentSnap.asset === asset &&
      currentSnap.quotes.length > 0
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

  const activeExpiryLabel = createMemo(() => {
    const unix = selectedExpiryUnix()
    if (unix === null) {
      return "—"
    }
    const tab = expiryTabList().find(entry => entry.unix === unix)
    if (tab !== undefined) {
      return formatExpiryTabLabel(tab.iso)
    }
    return new Date(unix * 1000).toLocaleDateString()
  })

  const ivSmilePoints = createMemo(() => {
    const current = snapshot()
    if (!current) {
      return [] as Array<{ strike: number; iv: number }>
    }

    const sameExpiry = current.quotes
    if (smileKind() === "both") {
      const buckets = new Map<number, number[]>()
      for (const quote of sameExpiry) {
        if (quote.greeks.iv === null) {
          continue
        }
        const list = buckets.get(quote.strike) ?? []
        list.push(quote.greeks.iv)
        buckets.set(quote.strike, list)
      }
      return [...buckets.entries()]
        .map(([strike, ivs]) => ({
          strike,
          iv:
            ivs.reduce((accumulator, value) => accumulator + value, 0) /
            ivs.length,
        }))
        .sort((left, right) => left.strike - right.strike)
    }

    return sameExpiry
      .filter(quote => quote.kind === smileKind() && quote.greeks.iv !== null)
      .map(quote => ({ strike: quote.strike, iv: quote.greeks.iv as number }))
      .sort((left, right) => left.strike - right.strike)
  })

  const chainRows = createMemo(() => {
    const current = snapshot()
    if (!current) {
      return [] as Array<{
        strike: number
        call: OptionQuote | null
        put: OptionQuote | null
      }>
    }

    const rows = new Map<
      number,
      { call: OptionQuote | null; put: OptionQuote | null }
    >()
    for (const quote of current.quotes) {
      const row = rows.get(quote.strike) ?? { call: null, put: null }
      if (quote.kind === "C") {
        row.call = quote
      } else {
        row.put = quote
      }
      rows.set(quote.strike, row)
    }

    return [...rows.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([strike, row]) => ({ strike, call: row.call, put: row.put }))
  })

  const rowByStrike = createMemo(() => {
    const map = new Map<number, StrikeLegs>()
    for (const row of chainRows()) {
      map.set(row.strike, { call: row.call, put: row.put })
    }
    return map
  })

  const boardKeys = createMemo((): BoardKey[] => {
    const strikes = chainRows().map(row => row.strike)
    const current = snapshot()
    if (current === null || current.spot_price <= 0 || strikes.length === 0) {
      return strikes
    }

    const spot = current.spot_price
    const insertAt = strikes.findIndex(strike => strike >= spot)
    const spotIndex = insertAt === -1 ? strikes.length : insertAt

    return [...strikes.slice(0, spotIndex), "spot", ...strikes.slice(spotIndex)]
  })

  const spotAsset = createMemo(() => snapshot()?.asset ?? selectedAsset() ?? "")
  const spotPrice = createMemo(() => snapshot()?.spot_price ?? 0)

  const greeksRows = createMemo(() => {
    const current = snapshot()
    if (!current) {
      return [] as OptionQuote[]
    }
    return current.quotes.slice().sort((left, right) => {
      if (left.strike !== right.strike) {
        return left.strike - right.strike
      }
      return left.kind.localeCompare(right.kind)
    })
  })

  createEffect(() => {
    // Imperative previous-quote map + timeout; memo alone cannot express "flash then clear".
    const snap = snapshot()
    if (snap === null) {
      return
    }

    onCleanup(() => {
      if (flashClearTimerRef.id !== undefined) {
        window.clearTimeout(flashClearTimerRef.id)
        flashClearTimerRef.id = undefined
      }
    })

    if (quotePriceHistoryRef.activeExpiryUnix !== snap.active_expiry_unix) {
      quotePriceHistoryRef.map.clear()
      quotePriceHistoryRef.activeExpiryUnix = snap.active_expiry_unix
      for (const quote of snap.quotes) {
        quotePriceHistoryRef.map.set(quote.instrument_name, {
          bid: quote.bid,
          ask: quote.ask,
        })
      }
      setFlashByInstrument(reconcile({}))
      return
    }

    const nextFlash: Partial<Record<string, QuoteFlashEntry>> = {}

    for (const quote of snap.quotes) {
      const prev = quotePriceHistoryRef.map.get(quote.instrument_name)
      if (prev !== undefined) {
        const bidTick = priceTickDirection(prev.bid, quote.bid)
        const askTick = priceTickDirection(prev.ask, quote.ask)
        if (bidTick !== undefined) {
          nextFlash[quote.instrument_name] = {
            ...nextFlash[quote.instrument_name],
            bid: bidTick,
          }
        }
        if (askTick !== undefined) {
          nextFlash[quote.instrument_name] = {
            ...nextFlash[quote.instrument_name],
            ask: askTick,
          }
        }
      }
      quotePriceHistoryRef.map.set(quote.instrument_name, {
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
      flashClearTimerRef.id = window.setTimeout(() => {
        setFlashByInstrument(reconcile({}))
        flashClearTimerRef.id = undefined
      }, 950)
    }
  })

  const smileGeometry = createMemo(() => {
    const points = ivSmilePoints()
    const realizedAnnual =
      selectedAsset() === "BTC" ? realizedVolAnnual30d() : null
    const width = 760
    const height = 260
    const paddingLeft = 52
    const paddingRight = 20
    const paddingTop = 20
    const paddingBottom = 34
    const plotHeight = height - paddingTop - paddingBottom
    const empty = () => ({
      width,
      height,
      circles: [] as Array<{
        x: number
        y: number
        strike: number
        iv: number
      }>,
      path: "",
      realizedY: null as number | null,
      realizedAnnual: null as number | null,
    })
    if (points.length < 2) {
      return empty()
    }

    const strikes = points.map(point => point.strike)
    const ivs = points.map(point => point.iv)
    let minIv = Math.min(...ivs)
    let maxIv = Math.max(...ivs)
    if (
      realizedAnnual !== null &&
      Number.isFinite(realizedAnnual) &&
      realizedAnnual > 0
    ) {
      minIv = Math.min(minIv, realizedAnnual)
      maxIv = Math.max(maxIv, realizedAnnual)
    }
    const ivSpan = maxIv - minIv || 0.0001
    const pad = Math.max(ivSpan * 0.05, 0.0005)
    minIv -= pad
    maxIv += pad
    const ivRange = maxIv - minIv || 0.0001

    const minStrike = Math.min(...strikes)
    const maxStrike = Math.max(...strikes)
    const strikeRange = maxStrike - minStrike || 1

    const circles = points.map(point => {
      const x =
        paddingLeft +
        ((point.strike - minStrike) / strikeRange) *
          (width - paddingLeft - paddingRight)
      const y =
        height - paddingBottom - ((point.iv - minIv) / ivRange) * plotHeight
      return { x, y, strike: point.strike, iv: point.iv }
    })

    const path = circles
      .map(
        (circle, index) => `${index === 0 ? "M" : "L"} ${circle.x} ${circle.y}`,
      )
      .join(" ")

    const realizedY =
      realizedAnnual !== null &&
      Number.isFinite(realizedAnnual) &&
      realizedAnnual > 0
        ? height -
          paddingBottom -
          ((realizedAnnual - minIv) / ivRange) * plotHeight
        : null

    return {
      width,
      height,
      circles,
      path,
      realizedY,
      realizedAnnual:
        realizedAnnual !== null &&
        Number.isFinite(realizedAnnual) &&
        realizedAnnual > 0
          ? realizedAnnual
          : null,
    }
  })

  const loadSnapshot = (signal?: AbortSignal): Promise<OptionsSnapshot> =>
    Effect.runPromise(deriveService.fetchSnapshot(deriveBaseUrl, signal))

  const startStream = (): void => {
    streamRef?.close()
    streamRef = new EventSource(`${deriveBaseUrl}/derive/options/stream`)
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
          setSnapshot(next)
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
        } else if (next.active_expiry_unix !== selectedExpiryUnix()) {
          return
        }
        setSnapshot(next)
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

  onMount(() => {
    const controller = new AbortController()
    const mountGeneration = { value: 0 }
    const claim = ++mountGeneration.value

    const loadBtcRealizedVol = async (): Promise<void> => {
      try {
        const viteCandles: unknown = import.meta.env.VITE_CANDLES_BASE_URL
        const prefix =
          typeof viteCandles === "string" && viteCandles.length > 0
            ? viteCandles.replace(/\/$/, "")
            : ""
        const response = await Effect.runPromise(
          fetchStreamChecked(`${prefix}/candles/1d`, {
            signal: controller.signal,
          }),
        )
        const text = await response.text()
        if (mountGeneration.value !== claim) {
          return
        }
        const series = btcCloseSeriesFromCandlesResponse(text)
        const volSeries = computeRollingVolatility(
          series,
          REALIZED_VOL_WINDOW_DAYS,
        )
        if (mountGeneration.value !== claim) {
          return
        }
        if (volSeries.length === 0) {
          setRealizedVolAnnual30d(null)
          return
        }
        const last = volSeries[volSeries.length - 1]
        setRealizedVolAnnual30d(last.value)
      } catch (error) {
        const aborted = isAbortError(error)
        if (!aborted && mountGeneration.value === claim) {
          setRealizedVolAnnual30d(null)
        }
      }
    }

    const initialize = async () => {
      try {
        const boot = await Effect.runPromise(
          deriveService.fetchBootstrap(deriveBaseUrl, controller.signal),
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
        setSnapshot(data)
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
    void loadBtcRealizedVol()

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

  return (
    <div class="derive-options h-screen overflow-auto p-3 text-[11px]">
      <div class="mx-auto flex max-w-[1680px] flex-col gap-3">
        <header class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0 space-y-2">
            <div class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--d-muted)]">
              Options
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex flex-wrap gap-1">
                <For each={assetTabList()}>
                  {asset => (
                    <button
                      type="button"
                      class={`d-chip ${selectedAsset() === asset ? "d-chip-active" : ""}`}
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
              <div class="d-spot">
                {formatNumber(snapshot()?.spot_price ?? null, 2)}
              </div>
              <div class="text-[var(--d-muted)]">
                {selectedAsset() ?? "—"} / USDC
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 text-[var(--d-muted)]">
            <Show when={isLoading()}>
              <span>Loading chain...</span>
            </Show>
            <Show when={snapshot()}>
              {(getSnapshot: Accessor<OptionsSnapshot>) => (
                <span>
                  Updated{" "}
                  {new Date(getSnapshot().updated_at).toLocaleTimeString()}
                </span>
              )}
            </Show>
          </div>
        </header>

        <Show when={errorMessage()}>
          <div class="rounded border border-[var(--d-ask)]/40 bg-[rgba(255,107,138,0.08)] px-3 py-2 text-[var(--d-ask)]">
            {errorMessage()}
          </div>
        </Show>

        <div class="d-board">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--d-border)] px-2">
            <div class="flex min-w-0 flex-1 flex-wrap">
              <ExpiryTabButtons
                tabs={expiryTabList}
                selectedUnix={selectedExpiryUnix}
                onSelect={switchExpiryTab}
              />
            </div>
            <div class="flex items-center gap-3 py-2 pr-1">
              <span class="text-[var(--d-muted)]">{activeExpiryLabel()}</span>
              <div class="d-toggle">
                <button
                  type="button"
                  class={tableView() === "chain" ? "d-toggle-active" : ""}
                  onClick={() => {
                    setTableView("chain")
                  }}
                >
                  Prices
                </button>
                <button
                  type="button"
                  class={tableView() === "greeks" ? "d-toggle-active" : ""}
                  onClick={() => {
                    setTableView("greeks")
                  }}
                >
                  Greeks
                </button>
              </div>
            </div>
          </div>

          <Show when={tableView() === "chain"}>
            <div class="d-chain-scroll max-h-[min(70vh,820px)] overflow-auto">
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
                          rowByStrike={rowByStrike}
                          flashStore={flashByInstrument}
                        />
                      )
                    }
                  </For>
                </tbody>
              </table>
            </div>
          </Show>

          <Show when={tableView() === "greeks"}>
            <div class="max-h-[min(70vh,820px)] overflow-auto">
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
                  <Index each={greeksRows()}>
                    {quote => (
                      <tr>
                        <td
                          class={`max-w-[10.5rem] truncate text-left ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                          title={quote().instrument_name}
                        >
                          {quote().instrument_name}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().strike, 0)}
                        </td>
                        <td
                          class={`text-left ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {quote().kind}
                        </td>
                        <td
                          class={`text-left ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatMoneyness(quote().moneyness)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          <FlashingPrice
                            side="bid"
                            value={() => quote().bid}
                            instrumentName={() => quote().instrument_name}
                            flashStore={flashByInstrument}
                          />
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          <FlashingPrice
                            side="ask"
                            value={() => quote().ask}
                            instrumentName={() => quote().instrument_name}
                            flashStore={flashByInstrument}
                          />
                        </td>
                        <td
                          class={`text-right d-iv ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatIvPercent(quote().greeks.iv)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.delta, 4)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.gamma, 6)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.vega, 4)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.theta, 4)}
                        </td>
                        <td
                          class={`text-right d-iv ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatIvPercent(quote().greeks.bid_iv)}
                        </td>
                        <td
                          class={`text-right d-iv ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatIvPercent(quote().greeks.ask_iv)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.rho, 2)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.forward_price, 0)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.discount_factor, 4)}
                        </td>
                        <td
                          class={`text-right ${quote().moneyness === "in_the_money" ? "d-itm" : ""}`}
                        >
                          {formatNumber(quote().greeks.option_model_mark, 0)}
                        </td>
                      </tr>
                    )}
                  </Index>
                </tbody>
              </table>
            </div>
          </Show>
        </div>

        <Show when={snapshot()}>
          {(getSnapshot: Accessor<OptionsSnapshot>) => (
            <>
              <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div class="d-panel">
                  <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                    Portfolio Risk
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                    <div>
                      Delta:{" "}
                      {formatNumber(getSnapshot().risk.aggregate_delta, 4)}
                    </div>
                    <div>
                      Gamma:{" "}
                      {formatNumber(getSnapshot().risk.aggregate_gamma, 4)}
                    </div>
                    <div>
                      Vega: {formatNumber(getSnapshot().risk.aggregate_vega, 4)}
                    </div>
                    <div>
                      Theta:{" "}
                      {formatNumber(getSnapshot().risk.aggregate_theta, 4)}
                    </div>
                    <div>
                      Hedge:{" "}
                      {formatNumber(getSnapshot().risk.hedge_ratio_btc, 4)}
                    </div>
                  </div>
                </div>

                <div class="d-panel">
                  <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                    Scenario PnL
                  </div>
                  <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <For each={getSnapshot().scenarios}>
                      {scenario => (
                        <div class="rounded border border-[var(--d-border)] px-2 py-1.5">
                          <div class="text-[var(--d-muted)]">
                            Move: {formatNumber(scenario.pct_move * 100, 1)}%
                          </div>
                          <div class="mt-0.5 font-medium">
                            {formatNumber(scenario.estimated_pnl, 2)}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <div class="d-panel">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div class="text-[10px] font-semibold uppercase tracking-wide text-[var(--d-muted)]">
                    IV Smile
                  </div>
                  <div class="flex items-center gap-2">
                    <select
                      class="rounded border border-[var(--d-border)] bg-[var(--d-chip)] px-2 py-1 text-xs text-[var(--d-text)]"
                      value={
                        selectedExpiryUnix() !== null
                          ? String(selectedExpiryUnix())
                          : ""
                      }
                      onChange={event => {
                        const value = Number.parseInt(
                          event.currentTarget.value,
                          10,
                        )
                        if (Number.isFinite(value)) {
                          switchExpiryTab(value as ExpiryUnix)
                        }
                      }}
                    >
                      <For each={expiryTabList()}>
                        {tab => (
                          <option value={String(tab.unix)}>
                            {formatExpiryTabLabel(tab.iso)}
                          </option>
                        )}
                      </For>
                    </select>
                    <select
                      class="rounded border border-[var(--d-border)] bg-[var(--d-chip)] px-2 py-1 text-xs text-[var(--d-text)]"
                      value={smileKind()}
                      onChange={event => {
                        const next = event.currentTarget.value
                        if (next === "C" || next === "P" || next === "both") {
                          setSmileKind(next)
                        }
                      }}
                    >
                      <option value="both">Calls + Puts</option>
                      <option value="C">Calls</option>
                      <option value="P">Puts</option>
                    </select>
                  </div>
                </div>
                <Show when={ivSmilePoints().length > 0}>
                  <div class="overflow-auto rounded border border-[var(--d-border)] p-2">
                    <svg
                      width={smileGeometry().width}
                      height={smileGeometry().height}
                    >
                      <line
                        x1="52"
                        y1="20"
                        x2="52"
                        y2="226"
                        stroke="currentColor"
                        opacity="0.25"
                      />
                      <line
                        x1="52"
                        y1="226"
                        x2="740"
                        y2="226"
                        stroke="currentColor"
                        opacity="0.25"
                      />
                      <Show when={smileGeometry().realizedY !== null}>
                        {() => {
                          const realizedY = smileGeometry().realizedY ?? 0
                          return (
                            <g>
                              <title>{`Realized ${REALIZED_VOL_WINDOW_DAYS}d annualized (daily closes, sqrt(252)): ${formatNumber(realizedVolAnnual30d(), 4)}`}</title>
                              <line
                                x1="52"
                                y1={realizedY}
                                x2="740"
                                y2={realizedY}
                                stroke="#fb923c"
                                stroke-dasharray="7 5"
                                stroke-width="1.75"
                                opacity="0.92"
                              />
                            </g>
                          )
                        }}
                      </Show>
                      <Show when={smileGeometry().path.length > 0}>
                        <path
                          d={smileGeometry().path}
                          fill="none"
                          stroke="#38bdf8"
                          stroke-width="1.75"
                        />
                      </Show>
                      <For each={smileGeometry().circles}>
                        {circle => (
                          <circle
                            cx={circle.x}
                            cy={circle.y}
                            r="3"
                            fill="#38bdf8"
                          />
                        )}
                      </For>
                    </svg>
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-[var(--d-muted)]">
                    <div class="flex items-center gap-2">
                      <span class="inline-block h-0.5 w-7 bg-sky-400" />
                      <span>Implied vol</span>
                    </div>
                    <Show when={selectedAsset() === "BTC"}>
                      <div class="flex items-center gap-2">
                        <span class="inline-block w-7 border-t-2 border-dashed border-orange-400" />
                        <span>
                          Realized {REALIZED_VOL_WINDOW_DAYS}d (ann.):{" "}
                          <span class="font-medium text-[var(--d-text)]">
                            {realizedVolAnnual30d() !== null
                              ? formatNumber(realizedVolAnnual30d(), 4)
                              : "—"}
                          </span>
                        </span>
                      </div>
                    </Show>
                  </div>
                  <div class="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <For each={ivSmilePoints().slice(0, 12)}>
                      {point => (
                        <div class="rounded border border-[var(--d-border)] px-2 py-1">
                          K {formatNumber(point.strike, 0)} | IV{" "}
                          {formatIvPercent(point.iv)}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}

export default DeriveOptionsPage
