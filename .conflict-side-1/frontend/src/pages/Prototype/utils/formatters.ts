export const formatNum = (
  n: number | null | undefined,
  decimals = 2,
): string => {
  if (n === null || n === undefined) return "—"
  return n.toFixed(decimals)
}

export const formatPct = (n: number): string =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`

export const formatUsd = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}
