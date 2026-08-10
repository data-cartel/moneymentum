import type { OrderSide } from "@/services/hyperliquid-client"

import type { OptionQuote } from "./optionsSnapshot"

export type QuoteBookSide = "bid" | "ask"

export type DeriveOrderTicketSelection = {
  instrumentName: string
  /** Human label e.g. `SOL $76 Call Aug 14`. */
  displayLabel: string
  side: OrderSide
  limitPrice: number
  quoteSide: QuoteBookSide
}

/** Minimum contracts so premium (`amount * price`) meets `minNotional`. */
export const defaultContractsForPremium = (
  limitPrice: number,
  minNotional: number,
): number => {
  if (!(limitPrice > 0) || !(minNotional > 0)) {
    return 0
  }
  const needed = minNotional / limitPrice
  if (needed <= 1) {
    return 1
  }
  // Scale via integer cents to avoid float ceil edge cases (e.g. 11 / 5).
  return Math.ceil((minNotional * 100) / limitPrice) / 100
}

export const notionalFromAmountAndPrice = (
  amount: number,
  limitPrice: number,
): number => {
  if (!(amount > 0) || !(limitPrice > 0)) {
    return 0
  }
  return amount * limitPrice
}

export const amountFromNotionalAndPrice = (
  notional: number,
  limitPrice: number,
): number => {
  if (!(notional > 0) || !(limitPrice > 0)) {
    return 0
  }
  return notional / limitPrice
}

const MIN_AMOUNT_STEP = 0.00001
const MAX_AMOUNT_STEP = 1
const MIN_LIMIT_PRICE_STEP = 0.01
const MAX_LIMIT_PRICE_STEP = 1

/**
 * Amount input step from option premium: ~$0.01 notional per tick, snapped to
 * a power of 10. Expensive (BTC) premiums -> finer size; cheap (SOL) -> coarser.
 */
export const amountStepFromPremium = (premium: number): number => {
  if (!(premium > 0)) {
    return MIN_AMOUNT_STEP
  }
  const raw = 0.01 / premium
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  return Math.min(MAX_AMOUNT_STEP, Math.max(MIN_AMOUNT_STEP, magnitude))
}

/**
 * Limit price input step from premium magnitude (powers of 10, clamped).
 */
export const limitPriceStepFromPremium = (premium: number): number => {
  if (!(premium > 0)) {
    return MAX_LIMIT_PRICE_STEP
  }
  const raw = premium / 1000
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  return Math.min(
    MAX_LIMIT_PRICE_STEP,
    Math.max(MIN_LIMIT_PRICE_STEP, magnitude),
  )
}

const formatStrikeLabel = (strike: number): string => {
  if (Number.isInteger(strike)) {
    return String(strike)
  }
  return String(strike)
}

/**
 * Display label for the order ticket header, e.g. `SOL $76 Call Aug 14`.
 */
export const formatOptionSelectionLabel = (quote: OptionQuote): string => {
  const asset = quote.instrument_name.split("-")[0] ?? quote.instrument_name
  const kindLabel = quote.kind === "C" ? "Call" : "Put"
  const expiryDate = new Date(`${quote.expiry}T00:00:00Z`)
  const month = expiryDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  const day = expiryDate.getUTCDate()
  return `${asset} $${formatStrikeLabel(quote.strike)} ${kindLabel} ${month} ${day}`
}

/**
 * Ask click -> buy (lift); bid click -> sell (hit).
 * Same instrument+side as `previous` clears the selection (returns null).
 * Missing/non-positive quotes still select with `limitPrice: 0` so the user
 * can type a price.
 */
export const selectionFromQuoteClick = (
  quote: OptionQuote,
  quoteSide: QuoteBookSide,
  previous: DeriveOrderTicketSelection | null = null,
): DeriveOrderTicketSelection | null => {
  if (
    previous !== null &&
    previous.instrumentName === quote.instrument_name &&
    previous.quoteSide === quoteSide
  ) {
    return null
  }

  const rawLimit = quoteSide === "ask" ? quote.ask : quote.bid
  const limitPrice = rawLimit !== null && rawLimit > 0 ? rawLimit : 0

  return {
    instrumentName: quote.instrument_name,
    displayLabel: formatOptionSelectionLabel(quote),
    side: quoteSide === "ask" ? "buy" : "sell",
    limitPrice,
    quoteSide,
  }
}

/** Buy lifts the ask; sell hits the bid. */
export const quoteSideForOrderSide = (side: OrderSide): QuoteBookSide =>
  side === "buy" ? "ask" : "bid"

/**
 * Flip ticket side and matching chain highlight (ask/bid). Prefers a live
 * positive book price; otherwise limit is 0 for the user to fill in.
 */
export const selectionWithOrderSide = (
  selection: DeriveOrderTicketSelection,
  side: OrderSide,
  limitPrice: number | null,
): DeriveOrderTicketSelection => ({
  ...selection,
  side,
  quoteSide: quoteSideForOrderSide(side),
  limitPrice: limitPrice !== null && limitPrice > 0 ? limitPrice : 0,
})
