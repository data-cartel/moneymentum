import type { DeriveCcxtOrder } from "@/services/deriveAccount"

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** Derive instrument_name: BTC-20250821-62000-P */
const DERIVE_INSTRUMENT_NAME = /^([A-Za-z]+)-(\d{8})-(\d+(?:\.\d+)?)-([CPcp])$/

export interface DeriveOpenOrderRow {
  id: string
  symbol: string
  label: string
  side: "buy" | "sell" | "—"
  amount: number | null
  price: number | null
  notional: number | null
  status: string
  orderType: string
}

const readInfoString = (
  info: Record<string, unknown> | undefined,
  key: string,
): string | null => {
  const value = info?.[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

const parseFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const formatDeriveInstrumentLabel = (raw: string): string => {
  const match = DERIVE_INSTRUMENT_NAME.exec(raw.trim())
  if (match === null) {
    return raw
  }

  const underlyingRaw = match[1]
  const yyyymmdd = match[2]
  const strikeRaw = match[3]
  const optionCodeRaw = match[4]
  const monthIndex = Number.parseInt(yyyymmdd.slice(4, 6), 10) - 1
  if (monthIndex < 0 || monthIndex > 11) {
    return raw
  }
  const day = Number.parseInt(yyyymmdd.slice(6, 8), 10)
  if (day < 1 || day > 31) {
    return raw
  }

  const month = MONTH_ABBREVIATIONS[monthIndex]
  const strike = Number.parseFloat(strikeRaw)
  const strikeLabel = Number.isFinite(strike)
    ? `$${strike.toLocaleString("en-US", { maximumFractionDigits: 4 })}`
    : `$${strikeRaw}`
  const optionLabel = optionCodeRaw.toUpperCase() === "P" ? "Put" : "Call"

  return `${underlyingRaw.toUpperCase()} ${strikeLabel} ${optionLabel} ${month} ${String(day)}`
}

const readInfoNumber = (
  info: Record<string, unknown> | undefined,
  key: string,
): number | null => parseFiniteNumber(info?.[key])

/**
 * Resting size in contracts: prefer CCXT remaining, else amount - filled from
 * either CCXT or Derive `info` (CCXT often leaves amount/remaining undefined
 * and cost at 0 for open options).
 */
const readRestingAmount = (order: DeriveCcxtOrder): number | null => {
  const remaining = parseFiniteNumber(order.remaining)
  if (remaining !== null) {
    return remaining
  }

  const total =
    parseFiniteNumber(order.amount) ?? readInfoNumber(order.info, "amount")
  if (total === null) {
    return null
  }

  const filled =
    parseFiniteNumber(order.filled) ??
    readInfoNumber(order.info, "filled_amount") ??
    0

  return Math.max(total - filled, 0)
}

const readLimitPrice = (order: DeriveCcxtOrder): number | null =>
  parseFiniteNumber(order.price) ??
  readInfoNumber(order.info, "limit_price") ??
  readInfoNumber(order.info, "average_price")

/** USD notional for a resting order: |size * limit price|. */
const readNotional = (
  amount: number | null,
  price: number | null,
  cost: number | null,
): number | null => {
  if (amount !== null && price !== null) {
    return Math.abs(amount * price)
  }
  if (cost !== null && cost > 0) {
    return cost
  }
  return null
}

export const mapDeriveOpenOrderRow = (
  order: DeriveCcxtOrder,
): DeriveOpenOrderRow | null => {
  const id =
    (typeof order.id === "string" && order.id.length > 0 ? order.id : null) ??
    readInfoString(order.info, "order_id") ??
    readInfoString(order.info, "orderId")
  const symbol =
    (typeof order.symbol === "string" && order.symbol.length > 0
      ? order.symbol
      : null) ?? readInfoString(order.info, "instrument_name")

  if (id === null || symbol === null) {
    return null
  }

  const instrumentName = readInfoString(order.info, "instrument_name") ?? symbol
  const sideRaw = (order.side ?? "").toLowerCase()
  const side: DeriveOpenOrderRow["side"] =
    sideRaw === "buy" || sideRaw === "sell" ? sideRaw : "—"

  const amount = readRestingAmount(order)
  const price = readLimitPrice(order)
  const notional = readNotional(amount, price, parseFiniteNumber(order.cost))

  const status =
    readInfoString(order.info, "order_status") ??
    (typeof order.status === "string" && order.status.length > 0
      ? order.status
      : "open")

  const orderType =
    readInfoString(order.info, "order_type") ??
    readInfoString(order.info, "type") ??
    "limit"

  return {
    id,
    symbol,
    label: formatDeriveInstrumentLabel(instrumentName),
    side,
    amount,
    price,
    notional,
    status,
    orderType,
  }
}

export const mapDeriveOpenOrderRows = (
  orders: DeriveCcxtOrder[],
): DeriveOpenOrderRow[] =>
  orders.flatMap(order => {
    const row = mapDeriveOpenOrderRow(order)
    return row === null ? [] : [row]
  })

/** Auto-refresh cadence for Derive open orders (matches the timer ring). */
export const OPEN_DERIVE_ORDERS_REFRESH_MS = 10_000

/** Progress 0..1 along a refresh cycle wall-clock window. */
export const refreshProgressAlongCycle = (
  startedAtMs: number,
  nowMs: number,
  durationMs: number,
): number => {
  if (durationMs <= 0) {
    return 1
  }
  return Math.min(1, Math.max(0, (nowMs - startedAtMs) / durationMs))
}
