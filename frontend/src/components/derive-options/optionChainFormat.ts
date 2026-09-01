import type { Moneyness } from "./optionsSnapshot"

export const formatNumber = (value: number | null, digits = 2): string =>
  value === null ? "—" : value.toFixed(digits)

export const formatUsdPrice = (value: number | null, digits = 2): string =>
  value === null ? "+" : `$${value.toFixed(digits)}`

export const formatIvPercent = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`

export const formatSpotBadge = (asset: string, spot: number): string =>
  `${asset} $${spot.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

/** Derive-style expiry header: `Thu Aug 6 13h 12m 31s`. */
export const formatExpiryCountdown = (
  expiryUnix: number,
  nowMs: number,
): string => {
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

export const formatExpiryTabLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  })

export const formatMoneyness = (value: Moneyness): string =>
  value === "in_the_money" ? "ITM" : value === "at_the_money" ? "ATM" : "OTM"
