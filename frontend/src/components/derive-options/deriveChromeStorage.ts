/** Shared Derive options chrome: greeks visibility + chain/greeks split ratio. */

export const DERIVE_GREEKS_VISIBLE_STORAGE_KEY = "derive-options-greeks-visible"

export const DERIVE_CHAIN_GREEKS_SPLIT_STORAGE_KEY =
  "derive-options-chain-greeks"

export const readDeriveGreeksVisible = (): boolean => {
  try {
    const raw = localStorage.getItem(DERIVE_GREEKS_VISIBLE_STORAGE_KEY)
    return raw !== "false"
  } catch {
    return true
  }
}

export const writeDeriveGreeksVisible = (visible: boolean): void => {
  try {
    localStorage.setItem(
      DERIVE_GREEKS_VISIBLE_STORAGE_KEY,
      visible ? "true" : "false",
    )
  } catch {
    // Ignore quota / private mode failures.
  }
}
