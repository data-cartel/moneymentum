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

  const amount =
    parseFiniteNumber(order.remaining) ?? parseFiniteNumber(order.amount)
  const price = parseFiniteNumber(order.price)
  const notional =
    parseFiniteNumber(order.cost) ??
    (amount !== null && price !== null ? Math.abs(amount * price) : null)

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
