import { batch } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"

import {
  EMPTY_OPTION_GREEKS,
  EMPTY_TAB_RISK,
  type ExpiryUnix,
  type OptionGreeks,
  type OptionQuote,
  type OptionsSnapshot,
  type PortfolioRiskSummary,
  type ScenarioPoint,
} from "./optionsSnapshot"

/** Fine-grained live book: cells read leaf store paths, not whole snapshots. */
export type QuoteBook = {
  loaded: boolean
  asset: string
  updated_at: string
  active_expiry_unix: ExpiryUnix | null
  expiry_unixes: ExpiryUnix[]
  expiry_dates: string[]
  spot_price: number
  risk: PortfolioRiskSummary
  scenarios: ScenarioPoint[]
  byInstrument: Record<string, OptionQuote>
  callByStrike: Record<number, string>
  putByStrike: Record<number, string>
  strikesAsc: number[]
  instrumentNamesAsc: string[]
}

export const emptyQuoteBook = (): QuoteBook => ({
  loaded: false,
  asset: "",
  updated_at: "",
  active_expiry_unix: null,
  expiry_unixes: [],
  expiry_dates: [],
  spot_price: 0,
  risk: EMPTY_TAB_RISK,
  scenarios: [],
  byInstrument: {},
  callByStrike: {},
  putByStrike: {},
  strikesAsc: [],
  instrumentNamesAsc: [],
})

const numberArraysEqual = (left: number[], right: number[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const stringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

/**
 * Round to the same precision the UI renders so float noise does not notify
 * cells whose formatted text would be unchanged.
 */
const quantize = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const quantizeNullable = (
  value: number | null,
  decimals: number,
): number | null => (value === null ? null : quantize(value, decimals))

/** IV is shown as `(value * 100).toFixed(1)` -- 0.1% display buckets. */
const quantizeIv = (value: number | null): number | null =>
  quantizeNullable(value, 3)

const quantizeGreeks = (greeks: OptionGreeks): OptionGreeks => ({
  bid_iv: quantizeIv(greeks.bid_iv),
  ask_iv: quantizeIv(greeks.ask_iv),
  delta: quantizeNullable(greeks.delta, 4),
  gamma: quantizeNullable(greeks.gamma, 6),
  vega: quantizeNullable(greeks.vega, 4),
  theta: quantizeNullable(greeks.theta, 4),
  iv: quantizeIv(greeks.iv),
  rho: quantizeNullable(greeks.rho, 2),
  forward_price: quantizeNullable(greeks.forward_price, 0),
  discount_factor: quantizeNullable(greeks.discount_factor, 4),
  option_model_mark: quantizeNullable(greeks.option_model_mark, 0),
})

const quantizeQuote = (quote: OptionQuote): OptionQuote => ({
  ...quote,
  bid: quantizeNullable(quote.bid, 2),
  ask: quantizeNullable(quote.ask, 2),
  bid_size: quantizeNullable(quote.bid_size, 2),
  ask_size: quantizeNullable(quote.ask_size, 2),
  mark: quantizeNullable(quote.mark, 2),
  spot_price: quantize(quote.spot_price, 2),
  greeks: quantizeGreeks(quote.greeks),
})

const buildQuoteIndex = (
  quotes: OptionQuote[],
): Pick<
  QuoteBook,
  | "byInstrument"
  | "callByStrike"
  | "putByStrike"
  | "strikesAsc"
  | "instrumentNamesAsc"
> => {
  const byInstrument: Record<string, OptionQuote> = {}
  const callByStrike: Record<number, string> = {}
  const putByStrike: Record<number, string> = {}
  const strikeSet = new Set<number>()

  for (const quote of quotes) {
    byInstrument[quote.instrument_name] = quote
    strikeSet.add(quote.strike)
    if (quote.kind === "C") {
      callByStrike[quote.strike] = quote.instrument_name
    } else {
      putByStrike[quote.strike] = quote.instrument_name
    }
  }

  const strikesAsc = [...strikeSet].sort((left, right) => left - right)
  const instrumentNamesAsc = Object.keys(byInstrument).sort((left, right) => {
    const leftQuote = byInstrument[left]
    const rightQuote = byInstrument[right]
    if (leftQuote.strike !== rightQuote.strike) {
      return leftQuote.strike - rightQuote.strike
    }
    return leftQuote.kind.localeCompare(rightQuote.kind)
  })

  return {
    byInstrument,
    callByStrike,
    putByStrike,
    strikesAsc,
    instrumentNamesAsc,
  }
}

/** Returns the first display-field path that differs, for skip / debug. */
const firstQuoteDisplayDiff = (
  before: OptionQuote | undefined,
  quote: OptionQuote,
): string | null => {
  if (before === undefined) {
    return "missing"
  }
  const beforeGreeks = before.greeks
  const nextGreeks = quote.greeks
  const checks: Array<[string, unknown, unknown]> = [
    ["bid", before.bid, quote.bid],
    ["ask", before.ask, quote.ask],
    ["mark", before.mark, quote.mark],
    ["bid_size", before.bid_size, quote.bid_size],
    ["ask_size", before.ask_size, quote.ask_size],
    ["moneyness", before.moneyness, quote.moneyness],
    ["spot_price", before.spot_price, quote.spot_price],
    ["greeks.bid_iv", beforeGreeks.bid_iv, nextGreeks.bid_iv],
    ["greeks.ask_iv", beforeGreeks.ask_iv, nextGreeks.ask_iv],
    ["greeks.delta", beforeGreeks.delta, nextGreeks.delta],
    ["greeks.gamma", beforeGreeks.gamma, nextGreeks.gamma],
    ["greeks.vega", beforeGreeks.vega, nextGreeks.vega],
    ["greeks.theta", beforeGreeks.theta, nextGreeks.theta],
    ["greeks.iv", beforeGreeks.iv, nextGreeks.iv],
    ["greeks.rho", beforeGreeks.rho, nextGreeks.rho],
    [
      "greeks.forward_price",
      beforeGreeks.forward_price,
      nextGreeks.forward_price,
    ],
    [
      "greeks.discount_factor",
      beforeGreeks.discount_factor,
      nextGreeks.discount_factor,
    ],
    [
      "greeks.option_model_mark",
      beforeGreeks.option_model_mark,
      nextGreeks.option_model_mark,
    ],
  ]
  for (const [field, left, right] of checks) {
    if (left !== right) {
      return field
    }
  }
  return null
}

const riskDisplayEqual = (
  left: PortfolioRiskSummary,
  right: PortfolioRiskSummary,
): boolean =>
  quantize(left.aggregate_delta, 4) === quantize(right.aggregate_delta, 4) &&
  quantize(left.aggregate_gamma, 6) === quantize(right.aggregate_gamma, 6) &&
  quantize(left.aggregate_vega, 4) === quantize(right.aggregate_vega, 4) &&
  quantize(left.aggregate_theta, 4) === quantize(right.aggregate_theta, 4) &&
  quantize(left.hedge_ratio_btc, 4) === quantize(right.hedge_ratio_btc, 4)

const scenariosDisplayEqual = (
  left: ScenarioPoint[],
  right: ScenarioPoint[],
): boolean =>
  left.length === right.length &&
  left.every(
    (point, index) =>
      point.pct_move === right[index]?.pct_move &&
      quantize(point.estimated_pnl, 2) ===
        quantize(right[index]?.estimated_pnl ?? 0, 2),
  )

/** Greeks-table-only fields -- throttle to cut full-panel paint storms. */
const COLD_GREEK_KEYS: ReadonlySet<keyof OptionGreeks> = new Set([
  "gamma",
  "vega",
  "theta",
  "rho",
  "forward_price",
  "discount_factor",
  "option_model_mark",
])

const patchQuoteLeaves = (
  setBook: SetStoreFunction<QuoteBook>,
  name: string,
  before: OptionQuote | undefined,
  quote: OptionQuote,
  applyColdGreeks: boolean,
): {
  bidChanged: boolean
  askChanged: boolean
  markChanged: boolean
  anyChanged: boolean
  firstDiff: string | null
} => {
  if (before === undefined) {
    setBook("byInstrument", name, quote)
    return {
      bidChanged: true,
      askChanged: true,
      markChanged: true,
      anyChanged: true,
      firstDiff: "missing",
    }
  }

  let bidChanged = false
  let askChanged = false
  let markChanged = false
  let anyChanged = false
  let firstDiff: string | null = null

  const note = (field: string): void => {
    anyChanged = true
    firstDiff ??= field
  }

  if (before.bid !== quote.bid) {
    setBook("byInstrument", name, "bid", quote.bid)
    bidChanged = true
    note("bid")
  }
  if (before.ask !== quote.ask) {
    setBook("byInstrument", name, "ask", quote.ask)
    askChanged = true
    note("ask")
  }
  if (before.mark !== quote.mark) {
    setBook("byInstrument", name, "mark", quote.mark)
    markChanged = true
    note("mark")
  }
  if (before.bid_size !== quote.bid_size) {
    setBook("byInstrument", name, "bid_size", quote.bid_size)
    note("bid_size")
  }
  if (before.ask_size !== quote.ask_size) {
    setBook("byInstrument", name, "ask_size", quote.ask_size)
    note("ask_size")
  }
  if (before.moneyness !== quote.moneyness) {
    setBook("byInstrument", name, "moneyness", quote.moneyness)
    note("moneyness")
  }
  if (before.spot_price !== quote.spot_price) {
    setBook("byInstrument", name, "spot_price", quote.spot_price)
    note("spot_price")
  }

  const beforeGreeks = before.greeks
  const nextGreeks = quote.greeks
  const greekLeaves: Array<[keyof OptionGreeks, number | null]> = [
    ["bid_iv", nextGreeks.bid_iv],
    ["ask_iv", nextGreeks.ask_iv],
    ["delta", nextGreeks.delta],
    ["gamma", nextGreeks.gamma],
    ["vega", nextGreeks.vega],
    ["theta", nextGreeks.theta],
    ["iv", nextGreeks.iv],
    ["rho", nextGreeks.rho],
    ["forward_price", nextGreeks.forward_price],
    ["discount_factor", nextGreeks.discount_factor],
    ["option_model_mark", nextGreeks.option_model_mark],
  ]
  for (const [greekKey, nextValue] of greekLeaves) {
    if (!applyColdGreeks && COLD_GREEK_KEYS.has(greekKey)) {
      continue
    }
    if (beforeGreeks[greekKey] !== nextValue) {
      setBook("byInstrument", name, "greeks", greekKey, nextValue)
      note(`greeks.${greekKey}`)
    }
  }

  return { bidChanged, askChanged, markChanged, anyChanged, firstDiff }
}

export type ApplyOptionsSnapshotOptions = {
  /** When false, ignore cold-greek leaf changes (caller throttles). */
  applyColdGreeks?: boolean
}

export const applyOptionsSnapshot = (
  setBook: SetStoreFunction<QuoteBook>,
  next: OptionsSnapshot,
  previousByInstrument?: Record<string, OptionQuote>,
  options: ApplyOptionsSnapshotOptions = {},
): {
  totalQuotes: number
  bidChanged: number
  askChanged: number
  markChanged: number
  skipped: boolean
  coldGreeksApplied: boolean
} => {
  const applyColdGreeks = options.applyColdGreeks !== false

  const quantizedQuotes = next.quotes.map(quantizeQuote)
  const index = buildQuoteIndex(quantizedQuotes)
  const previous: Partial<Record<string, OptionQuote>> =
    previousByInstrument ?? {}
  const previousNames = Object.keys(previous)
  const nextSpot = quantize(next.spot_price, 2)

  let bidChanged = 0
  let askChanged = 0
  let markChanged = 0
  let leafPatches = 0

  if (previousNames.length !== index.instrumentNamesAsc.length) {
    leafPatches += 1
  }

  const quoteNeedsApply = (
    before: OptionQuote | undefined,
    quote: OptionQuote,
  ): boolean => {
    if (before === undefined) {
      return true
    }
    return (
      firstQuoteDisplayDiff(before, {
        ...quote,
        greeks: {
          ...quote.greeks,
          // Pin cold greeks to previous when throttled so only hot fields apply.
          gamma: applyColdGreeks ? quote.greeks.gamma : before.greeks.gamma,
          vega: applyColdGreeks ? quote.greeks.vega : before.greeks.vega,
          theta: applyColdGreeks ? quote.greeks.theta : before.greeks.theta,
          rho: applyColdGreeks ? quote.greeks.rho : before.greeks.rho,
          forward_price: applyColdGreeks
            ? quote.greeks.forward_price
            : before.greeks.forward_price,
          discount_factor: applyColdGreeks
            ? quote.greeks.discount_factor
            : before.greeks.discount_factor,
          option_model_mark: applyColdGreeks
            ? quote.greeks.option_model_mark
            : before.greeks.option_model_mark,
        },
      }) !== null
    )
  }

  for (const quote of quantizedQuotes) {
    const before = previous[quote.instrument_name]
    if (quoteNeedsApply(before, quote)) {
      leafPatches += 1
    }
    if (before?.bid !== quote.bid) {
      bidChanged += 1
    }
    if (before?.ask !== quote.ask) {
      askChanged += 1
    }
    if (before?.mark !== quote.mark) {
      markChanged += 1
    }
  }

  const previousSpotName: string | undefined =
    previousNames.length > 0 ? previousNames[0] : undefined
  const previousSpot =
    previousSpotName === undefined
      ? undefined
      : previous[previousSpotName]?.spot_price
  const spotChanged = previousSpot !== nextSpot
  if (spotChanged) {
    leafPatches += 1
  }

  const skipped = previousNames.length > 0 && leafPatches === 0

  if (skipped) {
    return {
      totalQuotes: next.quotes.length,
      bidChanged,
      askChanged,
      markChanged,
      skipped: true,
      coldGreeksApplied: false,
    }
  }

  const priceOrSpotChanged =
    bidChanged + askChanged + markChanged > 0 || spotChanged
  let coldGreeksApplied = false

  batch(() => {
    setBook("loaded", true)
    setBook("asset", next.asset)
    if (priceOrSpotChanged) {
      setBook("updated_at", next.updated_at)
    }
    setBook("active_expiry_unix", next.active_expiry_unix)
    setBook("expiry_unixes", previousExpiry =>
      numberArraysEqual(previousExpiry, next.expiry_unixes)
        ? previousExpiry
        : next.expiry_unixes,
    )
    setBook("expiry_dates", previousDates =>
      stringArraysEqual(previousDates, next.expiry_dates)
        ? previousDates
        : next.expiry_dates,
    )
    if (spotChanged) {
      setBook("spot_price", nextSpot)
    }

    setBook("risk", previousRisk =>
      riskDisplayEqual(previousRisk, next.risk) ? previousRisk : next.risk,
    )
    setBook("scenarios", previousScenarios =>
      scenariosDisplayEqual(previousScenarios, next.scenarios)
        ? previousScenarios
        : next.scenarios,
    )

    for (const quote of quantizedQuotes) {
      const patch = patchQuoteLeaves(
        setBook,
        quote.instrument_name,
        previous[quote.instrument_name],
        quote,
        applyColdGreeks,
      )
      if (applyColdGreeks && patch.anyChanged) {
        const before = previous[quote.instrument_name]
        if (before !== undefined) {
          for (const coldKey of COLD_GREEK_KEYS) {
            if (before.greeks[coldKey] !== quote.greeks[coldKey]) {
              coldGreeksApplied = true
              break
            }
          }
        } else {
          coldGreeksApplied = true
        }
      }
    }

    for (const [strikeKey, instrumentName] of Object.entries(
      index.callByStrike,
    )) {
      const strike = Number(strikeKey)
      setBook("callByStrike", strike, previousName =>
        previousName === instrumentName ? previousName : instrumentName,
      )
    }
    for (const [strikeKey, instrumentName] of Object.entries(
      index.putByStrike,
    )) {
      const strike = Number(strikeKey)
      setBook("putByStrike", strike, previousName =>
        previousName === instrumentName ? previousName : instrumentName,
      )
    }

    setBook("strikesAsc", previousStrikes =>
      numberArraysEqual(previousStrikes, index.strikesAsc)
        ? previousStrikes
        : index.strikesAsc,
    )
    setBook("instrumentNamesAsc", previousInstrumentNames =>
      stringArraysEqual(previousInstrumentNames, index.instrumentNamesAsc)
        ? previousInstrumentNames
        : index.instrumentNamesAsc,
    )
  })

  return {
    totalQuotes: next.quotes.length,
    bidChanged,
    askChanged,
    markChanged,
    skipped: false,
    coldGreeksApplied: applyColdGreeks && coldGreeksApplied,
  }
}

/** Keep strike / instrument layout; zero prices until matching stream data. */
export const skeletonizeQuoteBook = (
  setBook: SetStoreFunction<QuoteBook>,
): void => {
  setBook("byInstrument", previous => {
    const next: Record<string, OptionQuote> = {}
    for (const [name, quote] of Object.entries(previous)) {
      next[name] = {
        ...quote,
        bid: null,
        ask: null,
        bid_size: null,
        ask_size: null,
        mark: null,
        greeks: EMPTY_OPTION_GREEKS,
      }
    }
    return next
  })
  setBook("risk", EMPTY_TAB_RISK)
  setBook("scenarios", previous =>
    previous.map(scenario => ({ ...scenario, estimated_pnl: 0 })),
  )
  setBook("updated_at", new Date().toISOString())
}

export type BoardKey = number | "spot"

export const boardKeysEqual = (left: BoardKey[], right: BoardKey[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

export const buildBoardKeys = (
  strikesAsc: number[],
  spotPrice: number,
): BoardKey[] => {
  if (spotPrice <= 0 || strikesAsc.length === 0) {
    return strikesAsc
  }
  const insertAt = strikesAsc.findIndex(strike => strike >= spotPrice)
  const spotIndex = insertAt === -1 ? strikesAsc.length : insertAt
  return [
    ...strikesAsc.slice(0, spotIndex),
    "spot",
    ...strikesAsc.slice(spotIndex),
  ]
}
