import { describe, expect, it, vi, afterEach } from "vitest"
import { createRoot, createSignal } from "solid-js"

import {
  STREAM_HIDE_DISCONNECT_MS,
  useDebouncedStreamEnabled,
} from "./useDebouncedStreamEnabled"

describe("useDebouncedStreamEnabled", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("stays enabled for the hide debounce then turns off", async () => {
    vi.useFakeTimers()

    const { disposeRoot, setVisible, streamEnabled } = createRoot(
      disposeRoot => {
        const [visible, setVisible] = createSignal(true)
        const streamEnabled = useDebouncedStreamEnabled(visible, 10_000)
        return { disposeRoot, setVisible, streamEnabled }
      },
    )

    expect(streamEnabled()).toBe(true)

    setVisible(false)
    // Solid effects run after the current turn.
    await Promise.resolve()
    expect(streamEnabled()).toBe(true)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(streamEnabled()).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(streamEnabled()).toBe(false)

    disposeRoot()
  })

  it("cancels pending disconnect when the panel becomes visible again", async () => {
    vi.useFakeTimers()

    const { disposeRoot, setVisible, streamEnabled } = createRoot(
      disposeRoot => {
        const [visible, setVisible] = createSignal(true)
        const streamEnabled = useDebouncedStreamEnabled(
          visible,
          STREAM_HIDE_DISCONNECT_MS,
        )
        return { disposeRoot, setVisible, streamEnabled }
      },
    )

    setVisible(false)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_000)
    setVisible(true)
    await Promise.resolve()
    expect(streamEnabled()).toBe(true)

    await vi.advanceTimersByTimeAsync(STREAM_HIDE_DISCONNECT_MS)
    expect(streamEnabled()).toBe(true)

    disposeRoot()
  })
})
