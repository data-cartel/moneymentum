import { describe, it, expect, vi } from "vitest"
import { createKeyboardHandler, type KeyBinding } from "./keyboard"

describe("createKeyboardHandler", () => {
  const createMockEvent = (key: string): KeyboardEvent => {
    return {
      key,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent
  }

  it("calls handler when key matches", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "a", handler }]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(handler).toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it("does not call handler when key does not match", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "a", handler }]

    const event = createMockEvent("b")
    createKeyboardHandler(bindings)(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it("calls handler when key and when condition match", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "a", handler, when: () => true }]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(handler).toHaveBeenCalled()
  })

  it("does not call handler when when condition returns false", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "a", handler, when: () => false }]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it("calls stopImmediatePropagation when option is set", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [
      { key: "a", handler, stopImmediatePropagation: true },
    ]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it("does not call stopImmediatePropagation by default", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "a", handler }]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it("does not call preventDefault when explicitly disabled", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [
      { key: "a", handler, preventDefault: false },
    ]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(handler).toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it("uses first matching binding when multiple match", () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const bindings: KeyBinding[] = [
      { key: "a", handler: handler1 },
      { key: "a", handler: handler2 },
    ]

    const event = createMockEvent("a")
    createKeyboardHandler(bindings)(event)

    expect(handler1).toHaveBeenCalled()
    expect(handler2).not.toHaveBeenCalled()
  })

  it("handles special keys like Escape", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "Escape", handler }]

    const event = createMockEvent("Escape")
    createKeyboardHandler(bindings)(event)

    expect(handler).toHaveBeenCalled()
  })

  it("handles number keys", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "1", handler }]

    const event = createMockEvent("1")
    createKeyboardHandler(bindings)(event)

    expect(handler).toHaveBeenCalled()
  })

  it("handles question mark key", () => {
    const handler = vi.fn()
    const bindings: KeyBinding[] = [{ key: "?", handler }]

    const event = createMockEvent("?")
    createKeyboardHandler(bindings)(event)

    expect(handler).toHaveBeenCalled()
  })
})
