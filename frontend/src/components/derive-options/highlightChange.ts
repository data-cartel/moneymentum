import { createEffect, onCleanup } from "solid-js"

declare module "solid-js" {
  // Solid `use:` directives require JSX namespace merging.
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Solid module augmentation
  namespace JSX {
    interface Directives {
      /** Pulse `.quote-flash` when a numeric quote leaf changes. */
      flashQuoteChange: number | null
    }
  }
}

/** Hold peak flash after the 0.15s fade-in before removing the class. */
const FLASH_MS = 300

/**
 * Solid `use:` directive: flash the host when its bound value changes.
 * Color from CSS (`.d-bid.quote-flash` / `.d-ask.quote-flash`).
 */
export const flashQuoteChange = (
  element: HTMLElement,
  accessor: () => number | null,
): void => {
  createEffect((previous: number | null | undefined) => {
    const current = accessor()

    if (previous !== undefined && previous !== current) {
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

    return current
  })
}
