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
import * as Effect from "effect/Effect"

import { fetchStreamChecked, NetworkError } from "@/lib/http"
import { computeRollingVolatility } from "@/pages/Prototype/metrics/computations"
import type { TimeSeriesPoint } from "@/pages/Prototype/metrics/registry"
import * as deriveService from "@/services/derive"

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
  default_expiry_unix: ExpiryUnix
  tabs: Array<{ expiry_unix: ExpiryUnix; instruments: string[] }>
}

const formatNumber = (value: number | null, digits = 2): string =>
  value === null ? "-" : value.toFixed(digits)

const formatMoneyness = (value: Moneyness): string =>
  value === "in_the_money" ? "ITM" : value === "at_the_money" ? "ATM" : "OTM"

const OPTION_CHAIN_LEG_COL_CLASSES = [
  "w-[3.5rem]",
  "w-[3.25rem]",
  "w-[4.5rem]",
  "w-[4.5rem]",
  "w-[4.5rem]",
  "w-[3.25rem]",
  "w-[3.5rem]",
  "w-[3.25rem]",
] as const

const OPTION_CHAIN_COL_CLASSES = [
  ...OPTION_CHAIN_LEG_COL_CLASSES,
  "w-[3.25rem]",
  "w-[3.75rem]",
  ...OPTION_CHAIN_LEG_COL_CLASSES,
  "w-[3.25rem]",
] as const

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
  flashMap: Partial<Record<string, QuoteFlashEntry>>,
  instrumentName: string | undefined,
  side: "bid" | "ask",
): string => {
  const base =
    "inline-block min-w-[2.75rem] rounded-sm px-1 py-px text-right tabular-nums"
  if (instrumentName === undefined) {
    return base
  }
  const direction = flashMap[instrumentName]?.[side]
  if (direction === "up") {
    return `${base} quote-flash-up`
  }
  if (direction === "down") {
    return `${base} quote-flash-down`
  }
  return base
}

const DeriveOptionsPage = () => {
  const [snapshot, setSnapshot] = createSignal<OptionsSnapshot | null>(null)
  const [bootstrap, setBootstrap] = createSignal<OptionsBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isLoading, setIsLoading] = createSignal(true)
  const [selectedExpiryUnix, setSelectedExpiryUnix] =
    createSignal<ExpiryUnix | null>(null)
  const [smileKind, setSmileKind] = createSignal<"C" | "P" | "both">("both")
  const [tableView, setTableView] = createSignal<"chain" | "greeks">("chain")
  const [flashByInstrument, setFlashByInstrument] = createSignal<
    Partial<Record<string, QuoteFlashEntry>>
  >({})
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

  const expiryTabList = createMemo(() => {
    const current = snapshot()
    let tabs: Array<{ unix: ExpiryUnix; iso: string }> = []
    if (current !== null && current.expiry_unixes.length > 0) {
      tabs = current.expiry_unixes.map((unix, index) => ({
        unix,
        iso: current.expiry_dates[index] ?? new Date(unix * 1000).toISOString(),
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
    return [...tabs].sort((left, right) => left.unix - right.unix)
  })

  const formatExpiryTabLabel = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    })

  const postActiveExpiry = (
    expiryUnix: ExpiryUnix,
    signal?: AbortSignal,
  ): Promise<void> =>
    Effect.runPromise(
      deriveService.postActiveExpiry(deriveBaseUrl, expiryUnix, signal),
    )

  const switchExpiryTab = (expiryUnix: ExpiryUnix): void => {
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

    const snap = snapshot()
    if (snap !== null) {
      setSnapshot({
        ...snap,
        active_expiry_unix: expiryUnix,
        updated_at: new Date().toISOString(),
        quotes: [],
        strikes: [],
        risk: EMPTY_TAB_RISK,
        scenarios: snap.scenarios.map(scenario => ({
          ...scenario,
          estimated_pnl: 0,
        })),
      })
    }

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

  const activeExpiryLabel = createMemo(() => {
    const unix = selectedExpiryUnix()
    if (unix === null) {
      return "-"
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
      setFlashByInstrument({})
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
      const previousFlash = flashByInstrument()
      const mergedFlash: Partial<Record<string, QuoteFlashEntry>> = {
        ...previousFlash,
      }
      for (const name of Object.keys(nextFlash)) {
        const tick = nextFlash[name]
        if (tick === undefined) {
          continue
        }
        mergedFlash[name] = {
          ...mergedFlash[name],
          ...tick,
        }
      }
      setFlashByInstrument(mergedFlash)
      flashClearTimerRef.id = window.setTimeout(() => {
        setFlashByInstrument({})
        flashClearTimerRef.id = undefined
      }, 950)
    }
  })

  const smileGeometry = createMemo(() => {
    const points = ivSmilePoints()
    const realizedAnnual = realizedVolAnnual30d()
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
        const pending = expirySwitchInFlightRef.blockStreamUntilExpiryUnix
        if (pending !== null) {
          if (next.active_expiry_unix !== pending) {
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
      streamRef?.close()
      streamRef = null
    })
  })

  return (
    <div class="h-screen overflow-auto bg-background p-4 text-[11px] text-foreground">
      <div class="mx-auto max-w-[1600px] space-y-4">
        <h1 class="text-sm font-semibold">BTC Options Realtime Monitor</h1>

        <Show when={snapshot()}>
          <div class="rounded border border-border p-3">
            <div class="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1">
                <div class="mb-2 text-xs font-semibold text-muted-foreground">
                  Expiry
                </div>
                <div class="flex flex-wrap gap-1">
                  <For each={expiryTabList()}>
                    {tab => (
                      <button
                        type="button"
                        class={`rounded border px-2 py-1 text-xs ${
                          selectedExpiryUnix() === tab.unix
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground"
                        }`}
                        onMouseDown={() => {
                          switchExpiryTab(tab.unix)
                        }}
                        onClick={(
                          event: MouseEvent & {
                            currentTarget: HTMLButtonElement
                            target: Element
                          },
                        ) => {
                          if (event.detail === 0) {
                            switchExpiryTab(tab.unix)
                          }
                        }}
                      >
                        {formatExpiryTabLabel(tab.iso)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Show when={snapshot()}>
                {(getSnapshot: Accessor<OptionsSnapshot>) => (
                  <div class="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                    Updated:{" "}
                    {new Date(getSnapshot().updated_at).toLocaleTimeString()}
                  </div>
                )}
              </Show>
            </div>

            <div class="mb-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <div class="flex items-center gap-3">
                <div class="text-xs font-semibold">Option Chain</div>
                <div class="inline-flex rounded border border-border p-0.5 text-xs">
                  <button
                    type="button"
                    class={`rounded px-2 py-1 ${tableView() === "chain" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                    onClick={() => {
                      setTableView("chain")
                    }}
                  >
                    Prices
                  </button>
                  <button
                    type="button"
                    class={`rounded px-2 py-1 ${tableView() === "greeks" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                    onClick={() => {
                      setTableView("greeks")
                    }}
                  >
                    Greeks
                  </button>
                </div>
              </div>
              <div class="text-xs text-muted-foreground">
                Expiry:{" "}
                <span class="font-medium text-foreground">
                  {activeExpiryLabel()}
                </span>
              </div>
            </div>
            <Show when={tableView() === "chain"}>
              <div class="overflow-x-auto">
                <table class="table-fixed w-full min-w-[1040px] border-collapse text-xs tabular-nums [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                  <colgroup>
                    <For each={[...OPTION_CHAIN_COL_CLASSES]}>
                      {widthClass => <col class={widthClass} />}
                    </For>
                  </colgroup>
                  <thead>
                    <tr class="border-b border-border text-muted-foreground">
                      <th class="p-1 text-left" colSpan={8}>
                        Calls
                      </th>
                      <th class="p-1 text-center">Strike</th>
                      <th class="p-1 text-center border-x border-border">
                        Strike
                      </th>
                      <th class="p-1 text-left" colSpan={8}>
                        Puts
                      </th>
                      <th class="p-1 text-center">Strike</th>
                    </tr>
                    <tr class="border-b border-border text-left text-muted-foreground">
                      <th class="p-1 text-right">Bid Size</th>
                      <th class="p-1 text-right">Bid IV</th>
                      <th class="p-1 text-right">Bid</th>
                      <th class="p-1 text-right">Mark</th>
                      <th class="p-1 text-right">Ask</th>
                      <th class="p-1 text-right">Ask IV</th>
                      <th class="p-1 text-right">Ask Size</th>
                      <th class="p-1 text-right">Delta</th>
                      <th class="p-1 text-right">Strike</th>
                      <th class="p-1 text-right border-x border-border">
                        Strike
                      </th>
                      <th class="p-1 text-right">Bid Size</th>
                      <th class="p-1 text-right">Bid IV</th>
                      <th class="p-1 text-right">Bid</th>
                      <th class="p-1 text-right">Mark</th>
                      <th class="p-1 text-right">Ask</th>
                      <th class="p-1 text-right">Ask IV</th>
                      <th class="p-1 text-right">Ask Size</th>
                      <th class="p-1 text-right">Delta</th>
                      <th class="p-1 text-right">Strike</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Index each={chainRows()}>
                      {row => (
                        <tr class="border-b border-border/50">
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().call?.bid_size ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().call?.greeks.bid_iv ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            <span
                              class={bidAskFlashClass(
                                flashByInstrument(),
                                row().call?.instrument_name,
                                "bid",
                              )}
                            >
                              {formatNumber(row().call?.bid ?? null)}
                            </span>
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().call?.mark ?? null)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            <span
                              class={bidAskFlashClass(
                                flashByInstrument(),
                                row().call?.instrument_name,
                                "ask",
                              )}
                            >
                              {formatNumber(row().call?.ask ?? null)}
                            </span>
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().call?.greeks.ask_iv ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().call?.ask_size ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().call?.greeks.delta ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().call?.moneyness === "in_the_money" ? "bg-emerald-500/10 text-emerald-300" : "text-muted-foreground"}`}
                          >
                            {formatNumber(row().call?.strike ?? null, 0)}
                          </td>

                          <td class="p-1 text-right border-x border-border font-semibold">
                            {formatNumber(row().strike, 0)}
                          </td>

                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().put?.bid_size ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().put?.greeks.bid_iv ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            <span
                              class={bidAskFlashClass(
                                flashByInstrument(),
                                row().put?.instrument_name,
                                "bid",
                              )}
                            >
                              {formatNumber(row().put?.bid ?? null)}
                            </span>
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().put?.mark ?? null)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            <span
                              class={bidAskFlashClass(
                                flashByInstrument(),
                                row().put?.instrument_name,
                                "ask",
                              )}
                            >
                              {formatNumber(row().put?.ask ?? null)}
                            </span>
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().put?.greeks.ask_iv ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().put?.ask_size ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                          >
                            {formatNumber(row().put?.greeks.delta ?? null, 4)}
                          </td>
                          <td
                            class={`p-1 text-right ${row().put?.moneyness === "in_the_money" ? "bg-emerald-500/10 text-emerald-300" : "text-muted-foreground"}`}
                          >
                            {formatNumber(row().put?.strike ?? null, 0)}
                          </td>
                        </tr>
                      )}
                    </Index>
                  </tbody>
                </table>
              </div>
            </Show>

            <Show when={tableView() === "greeks"}>
              <div class="overflow-x-auto">
                <table class="table-fixed w-full min-w-[1320px] border-collapse text-xs tabular-nums [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
                  <colgroup>
                    <For each={[...GREEKS_CHAIN_COL_CLASSES]}>
                      {widthClass => <col class={widthClass} />}
                    </For>
                  </colgroup>
                  <thead>
                    <tr class="border-b border-border text-left text-muted-foreground">
                      <th class="p-1">Instrument</th>
                      <th class="p-1 text-right">Strike</th>
                      <th class="p-1">Type</th>
                      <th class="p-1">Money</th>
                      <th class="p-1 text-right">Bid</th>
                      <th class="p-1 text-right">Ask</th>
                      <th class="p-1 text-right">IV</th>
                      <th class="p-1 text-right">Delta</th>
                      <th class="p-1 text-right">Gamma</th>
                      <th class="p-1 text-right">Vega</th>
                      <th class="p-1 text-right">Theta</th>
                      <th class="p-1 text-right">Bid IV</th>
                      <th class="p-1 text-right">Ask IV</th>
                      <th class="p-1 text-right">Rho</th>
                      <th class="p-1 text-right">Forward</th>
                      <th class="p-1 text-right">DF</th>
                      <th class="p-1 text-right">Mdl M</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Index each={greeksRows()}>
                      {quote => (
                        <tr
                          class={`border-b border-border/50 ${quote().moneyness === "in_the_money" ? "bg-emerald-500/10" : ""}`}
                        >
                          <td
                            class="max-w-[10.5rem] truncate p-1"
                            title={quote().instrument_name}
                          >
                            {quote().instrument_name}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().strike, 0)}
                          </td>
                          <td class="p-1">{quote().kind}</td>
                          <td class="p-1">
                            {formatMoneyness(quote().moneyness)}
                          </td>
                          <td class="p-1 text-right">
                            <span
                              class={bidAskFlashClass(
                                flashByInstrument(),
                                quote().instrument_name,
                                "bid",
                              )}
                            >
                              {formatNumber(quote().bid)}
                            </span>
                          </td>
                          <td class="p-1 text-right">
                            <span
                              class={bidAskFlashClass(
                                flashByInstrument(),
                                quote().instrument_name,
                                "ask",
                              )}
                            >
                              {formatNumber(quote().ask)}
                            </span>
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.iv, 4)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.delta, 4)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.gamma, 6)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.vega, 4)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.theta, 4)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.bid_iv, 4)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.ask_iv, 4)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.rho, 2)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.forward_price, 0)}
                          </td>
                          <td class="p-1 text-right">
                            {formatNumber(quote().greeks.discount_factor, 4)}
                          </td>
                          <td class="p-1 text-right">
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
        </Show>

        <div class="rounded border border-border p-3">
          <div class="text-xs text-muted-foreground">
            Spot:{" "}
            <span class="font-medium text-foreground">
              {formatNumber(snapshot()?.spot_price ?? null, 2)}
            </span>
          </div>
          <Show when={errorMessage()}>
            <div class="mt-2 text-xs text-destructive">{errorMessage()}</div>
          </Show>
          <Show when={isLoading()}>
            <div class="mt-2 text-xs">Loading realtime chain...</div>
          </Show>
        </div>

        <Show when={snapshot()}>
          {(getSnapshot: Accessor<OptionsSnapshot>) => (
            <>
              <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div class="rounded border border-border p-3">
                  <div class="mb-2 text-xs font-semibold">
                    Available Strikes
                  </div>
                  <div class="max-h-40 overflow-auto flex flex-wrap gap-1">
                    <For each={getSnapshot().strikes}>
                      {strike => (
                        <span class="rounded border border-border px-1 py-0.5 text-xs">
                          {formatNumber(strike, 0)}
                        </span>
                      )}
                    </For>
                  </div>
                </div>

                <div class="rounded border border-border p-3">
                  <div class="mb-2 text-xs font-semibold">Portfolio Risk</div>
                  <div class="space-y-1 text-xs">
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
                      Hedge Ratio BTC:{" "}
                      {formatNumber(getSnapshot().risk.hedge_ratio_btc, 4)}
                    </div>
                  </div>
                </div>
              </div>

              <div class="rounded border border-border p-3">
                <div class="mb-2 text-xs font-semibold">
                  Scenario PnL (delta + gamma approximation)
                </div>
                <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <For each={getSnapshot().scenarios}>
                    {scenario => (
                      <div class="rounded border border-border p-2 text-xs">
                        <div class="text-muted-foreground">
                          BTC move: {formatNumber(scenario.pct_move * 100, 1)}%
                        </div>
                        <div class="mt-1 font-medium">
                          est. PnL: {formatNumber(scenario.estimated_pnl, 2)}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div class="rounded border border-border p-3">
                <div class="mb-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-xs font-semibold">IV Smile</div>
                    <div class="flex items-center gap-2 text-xs">
                      <select
                        class="rounded border border-border bg-background px-2 py-1"
                        value={
                          selectedExpiryUnix() !== null
                            ? String(selectedExpiryUnix())
                            : ""
                        }
                        onChange={event => {
                          const nextUnix = Number.parseInt(
                            event.currentTarget.value,
                            10,
                          )
                          if (Number.isNaN(nextUnix)) {
                            return
                          }
                          switchExpiryTab(nextUnix as ExpiryUnix)
                        }}
                      >
                        <For each={expiryTabList()}>
                          {tab => (
                            <option value={String(tab.unix)}>
                              {new Date(tab.iso).toLocaleDateString()}
                            </option>
                          )}
                        </For>
                      </select>
                      <select
                        class="rounded border border-border bg-background px-2 py-1"
                        value={smileKind()}
                        onChange={event => {
                          const nextKind = event.currentTarget.value
                          if (
                            nextKind === "C" ||
                            nextKind === "P" ||
                            nextKind === "both"
                          ) {
                            setSmileKind(nextKind)
                          }
                        }}
                      >
                        <option value="both">Call + Put (avg)</option>
                        <option value="C">Calls only</option>
                        <option value="P">Puts only</option>
                      </select>
                    </div>
                  </div>
                  <div class="mt-1 text-[10px] leading-snug text-muted-foreground">
                    Blue: implied volatility (options). Orange dashed: realized{" "}
                    {REALIZED_VOL_WINDOW_DAYS}d annualized vol from BTC{" "}
                    <code class="rounded bg-muted px-0.5">/candles/1d</code>{" "}
                    (main API). Same vertical scale as IV.
                  </div>
                </div>

                <Show
                  when={smileGeometry().circles.length >= 2}
                  fallback={
                    <div class="text-xs text-muted-foreground">
                      Not enough IV points for smile chart
                    </div>
                  }
                >
                  <div class="overflow-auto rounded border border-border/60 p-2">
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
                          // realizedY is a pixel coordinate that can legitimately
                          // be 0, so gate on an explicit null check (not falsiness)
                          // and read the value with a defensive nullish fallback.
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
                      <path
                        d={smileGeometry().path}
                        fill="none"
                        stroke="#60a5fa"
                        stroke-width="2"
                      />
                      <For each={smileGeometry().circles}>
                        {point => (
                          <g>
                            <circle
                              cx={point.x}
                              cy={point.y}
                              r="3"
                              fill="#93c5fd"
                            >
                              <title>{`K=${formatNumber(point.strike, 0)} IV=${formatNumber(point.iv, 4)}`}</title>
                            </circle>
                          </g>
                        )}
                      </For>
                    </svg>
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
                    <div class="flex items-center gap-2">
                      <span class="inline-block h-0.5 w-7 bg-sky-400" />
                      <span>Implied vol</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="inline-block w-7 border-t-2 border-dashed border-orange-400" />
                      <span>
                        Realized {REALIZED_VOL_WINDOW_DAYS}d (ann.):{" "}
                        <span class="font-medium text-foreground">
                          {realizedVolAnnual30d() !== null
                            ? formatNumber(realizedVolAnnual30d(), 4)
                            : "—"}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div class="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <For each={ivSmilePoints().slice(0, 12)}>
                      {point => (
                        <div class="rounded border border-border/60 px-2 py-1">
                          K {formatNumber(point.strike, 0)} | IV{" "}
                          {formatNumber(point.iv, 4)}
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
