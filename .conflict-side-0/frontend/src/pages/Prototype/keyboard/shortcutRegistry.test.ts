import { describe, it, expect } from "vitest"
import {
  createShortcutRegistry,
  type ShortcutDefinition,
} from "./shortcutRegistry"

describe("createShortcutRegistry", () => {
  const makeShortcut = (
    overrides: Partial<ShortcutDefinition> = {},
  ): ShortcutDefinition => ({
    id: "test-shortcut",
    key: "a",
    category: "general",
    context: "global",
    description: "Test shortcut",
    ...overrides,
  })

  it("registers shortcuts and retrieves by category", () => {
    const registry = createShortcutRegistry()

    registry.register(makeShortcut({ id: "nav-1", category: "navigation" }))
    registry.register(makeShortcut({ id: "nav-2", category: "navigation" }))
    registry.register(makeShortcut({ id: "trade-1", category: "trading" }))

    const navShortcuts = registry.getByCategory("navigation")
    expect(navShortcuts).toHaveLength(2)
    expect(navShortcuts.map(s => s.id)).toEqual(["nav-1", "nav-2"])

    const tradeShortcuts = registry.getByCategory("trading")
    expect(tradeShortcuts).toHaveLength(1)
    expect(tradeShortcuts[0].id).toBe("trade-1")
  })

  it("returns cleanup function that unregisters", () => {
    const registry = createShortcutRegistry()

    const cleanup = registry.register(makeShortcut({ id: "cleanup-test" }))
    expect(registry.getAll()).toHaveLength(1)

    cleanup()
    expect(registry.getAll()).toHaveLength(0)
  })

  it("getAll returns all registered shortcuts", () => {
    const registry = createShortcutRegistry()

    registry.register(makeShortcut({ id: "s1" }))
    registry.register(makeShortcut({ id: "s2" }))
    registry.register(makeShortcut({ id: "s3" }))

    const all = registry.getAll()
    expect(all).toHaveLength(3)
    expect(all.map(s => s.id).sort()).toEqual(["s1", "s2", "s3"])
  })

  it("unregister removes a shortcut by id", () => {
    const registry = createShortcutRegistry()

    registry.register(makeShortcut({ id: "to-remove" }))
    registry.register(makeShortcut({ id: "to-keep" }))
    expect(registry.getAll()).toHaveLength(2)

    registry.unregister("to-remove")
    expect(registry.getAll()).toHaveLength(1)
    expect(registry.getAll()[0].id).toBe("to-keep")
  })

  it("findByKey returns matching shortcut", () => {
    const registry = createShortcutRegistry()

    registry.register(makeShortcut({ id: "key-a", key: "a" }))
    registry.register(makeShortcut({ id: "key-b", key: "b" }))

    const found = registry.findByKey("a")
    expect(found).toBeDefined()
    expect(found?.id).toBe("key-a")

    const notFound = registry.findByKey("c")
    expect(notFound).toBeUndefined()
  })

  it("findByKey respects shift modifier", () => {
    const registry = createShortcutRegistry()

    registry.register(makeShortcut({ id: "plus-no-shift", key: "+" }))
    registry.register(
      makeShortcut({
        id: "plus-with-shift",
        key: "+",
        modifiers: { shift: true },
      }),
    )

    const noShift = registry.findByKey("+")
    expect(noShift?.id).toBe("plus-no-shift")

    const withShift = registry.findByKey("+", { shift: true })
    expect(withShift?.id).toBe("plus-with-shift")
  })

  it("returns empty array for category with no shortcuts", () => {
    const registry = createShortcutRegistry()

    registry.register(makeShortcut({ id: "nav-1", category: "navigation" }))

    const configShortcuts = registry.getByCategory("configuration")
    expect(configShortcuts).toEqual([])
  })
})
