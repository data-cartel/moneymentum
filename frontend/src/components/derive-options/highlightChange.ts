import { onCleanup } from "solid-js"

/** Hold peak flash after the 0.15s fade-in before removing the class. */
const FLASH_MS = 300

/**
 * Pulse `.quote-flash` on the host. Color from CSS
 * (`.d-bid.quote-flash` / `.d-ask.quote-flash`).
 * Call from a tracked scope (e.g. `createEffect`) when the value changes.
 */
export const flashQuoteChange = (element: HTMLElement): void => {
  element.classList.remove("quote-flash")
  void element.offsetWidth
  element.classList.add("quote-flash")

  const timerId = window.setTimeout(() => {
    element.classList.remove("quote-flash")
  }, FLASH_MS)

  onCleanup(() => {
    window.clearTimeout(timerId)
  })
}
