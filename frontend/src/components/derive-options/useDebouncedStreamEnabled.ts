import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/** Keep the options stream warm briefly after a dockview panel hides. */
export const STREAM_HIDE_DISCONNECT_MS = 10_000

/**
 * True while the panel is visible, and for `debounceMs` after it becomes hidden.
 * Closing the stream immediately on every tab hop is painful; this debounce covers
 * rapid switches between adjacent dockview panels.
 */
export const useDebouncedStreamEnabled = (
  isPanelVisible: Accessor<boolean>,
  debounceMs: number = STREAM_HIDE_DISCONNECT_MS,
): Accessor<boolean> => {
  const [streamEnabled, setStreamEnabled] = createSignal(isPanelVisible())

  createEffect(() => {
    const visible = isPanelVisible()
    if (visible) {
      setStreamEnabled(true)
      return
    }

    const timerId = window.setTimeout(() => {
      setStreamEnabled(false)
    }, debounceMs)

    onCleanup(() => {
      window.clearTimeout(timerId)
    })
  })

  return streamEnabled
}
