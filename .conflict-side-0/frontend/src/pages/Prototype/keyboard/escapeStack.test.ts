import { describe, it, expect, vi } from "vitest"
import { createEscapeStack, type EscapeHandler } from "./escapeStack"

describe("createEscapeStack", () => {
  const makeHandler = (
    overrides: Partial<EscapeHandler> = {},
  ): EscapeHandler => ({
    id: "test-handler",
    priority: 0,
    handler: () => true,
    label: "Test handler",
    ...overrides,
  })

  it("handles escape in LIFO order", () => {
    const stack = createEscapeStack()
    const calls: string[] = []

    stack.push(
      makeHandler({
        id: "first",
        handler: () => {
          calls.push("first")
          return true
        },
      }),
    )
    stack.push(
      makeHandler({
        id: "second",
        handler: () => {
          calls.push("second")
          return true
        },
      }),
    )

    stack.handleEscape()
    expect(calls).toEqual(["second"])
  })

  it("respects priority when same depth", () => {
    const stack = createEscapeStack()
    const calls: string[] = []

    stack.push(
      makeHandler({
        id: "low-priority",
        priority: 1,
        handler: () => {
          calls.push("low")
          return true
        },
      }),
    )
    stack.push(
      makeHandler({
        id: "high-priority",
        priority: 10,
        handler: () => {
          calls.push("high")
          return true
        },
      }),
    )

    stack.handleEscape()
    expect(calls).toEqual(["high"])
  })

  it("returns cleanup that removes handler", () => {
    const stack = createEscapeStack()

    const cleanup = stack.push(makeHandler({ id: "cleanup-test" }))
    expect(stack.getStack()).toHaveLength(1)

    cleanup()
    expect(stack.getStack()).toHaveLength(0)
  })

  it("returns false when stack is empty", () => {
    const stack = createEscapeStack()
    const result = stack.handleEscape()
    expect(result).toBe(false)
  })

  it("continues to next handler if current returns false", () => {
    const stack = createEscapeStack()
    const calls: string[] = []

    stack.push(
      makeHandler({
        id: "first",
        handler: () => {
          calls.push("first")
          return true
        },
      }),
    )
    stack.push(
      makeHandler({
        id: "second",
        handler: () => {
          calls.push("second")
          return false
        },
      }),
    )

    stack.handleEscape()
    expect(calls).toEqual(["second", "first"])
  })

  it("stops when handler returns true", () => {
    const stack = createEscapeStack()
    const handler1 = vi.fn(() => true)
    const handler2 = vi.fn(() => true)

    stack.push(makeHandler({ id: "first", handler: handler1 }))
    stack.push(makeHandler({ id: "second", handler: handler2 }))

    const result = stack.handleEscape()

    expect(result).toBe(true)
    expect(handler2).toHaveBeenCalled()
    expect(handler1).not.toHaveBeenCalled()
  })

  it("remove removes handler by id", () => {
    const stack = createEscapeStack()

    stack.push(makeHandler({ id: "to-remove" }))
    stack.push(makeHandler({ id: "to-keep" }))
    expect(stack.getStack()).toHaveLength(2)

    stack.remove("to-remove")
    expect(stack.getStack()).toHaveLength(1)
    expect(stack.getStack()[0].id).toBe("to-keep")
  })

  it("getStack returns copy of stack", () => {
    const stack = createEscapeStack()

    stack.push(makeHandler({ id: "h1" }))
    stack.push(makeHandler({ id: "h2" }))

    const copy = stack.getStack()
    expect(copy).toHaveLength(2)

    // Modifying copy should not affect original
    copy.pop()
    expect(stack.getStack()).toHaveLength(2)
  })
})
