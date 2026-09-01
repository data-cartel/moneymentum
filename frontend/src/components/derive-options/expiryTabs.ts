import type { ExpiryUnix } from "./optionsSnapshot"

export type ExpiryTab = {
  unix: ExpiryUnix
  iso: string
}

const expiryTabsEqual = (left: ExpiryTab[], right: ExpiryTab[]): boolean =>
  left.length === right.length &&
  left.every(
    (tab, index) =>
      tab.unix === right[index]?.unix && tab.iso === right[index]?.iso,
  )

/** Keep prior tab object identity when unix/iso unchanged (avoids remount churn). */
export const stabilizeExpiryTabs = (
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
