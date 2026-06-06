export type ShortcutCategory =
  | "navigation"
  | "panel"
  | "trading"
  | "configuration"
  | "general"

export type ShortcutContext =
  | "global"
  | "screener"
  | "positions"
  | "staged"
  | "modal"

export interface ShortcutDefinition {
  id: string
  key: string
  category: ShortcutCategory
  context: ShortcutContext
  description: string
  when?: () => boolean
  modifiers?: { shift?: boolean }
}

export interface ShortcutRegistry {
  register: (shortcut: ShortcutDefinition) => () => void
  unregister: (id: string) => void
  getByCategory: (category: ShortcutCategory) => ShortcutDefinition[]
  getAll: () => ShortcutDefinition[]
  findByKey: (
    key: string,
    modifiers?: { shift?: boolean },
  ) => ShortcutDefinition | undefined
}

export const createShortcutRegistry = (): ShortcutRegistry => {
  const shortcuts = new Map<string, ShortcutDefinition>()

  const register = (shortcut: ShortcutDefinition): (() => void) => {
    shortcuts.set(shortcut.id, shortcut)
    return () => shortcuts.delete(shortcut.id)
  }

  const unregister = (id: string): void => {
    shortcuts.delete(id)
  }

  const getByCategory = (category: ShortcutCategory): ShortcutDefinition[] => {
    return Array.from(shortcuts.values()).filter(s => s.category === category)
  }

  const getAll = (): ShortcutDefinition[] => {
    return Array.from(shortcuts.values())
  }

  const findByKey = (
    key: string,
    modifiers?: { shift?: boolean },
  ): ShortcutDefinition | undefined => {
    return Array.from(shortcuts.values()).find(s => {
      if (s.key !== key) return false
      const shortcutShift = s.modifiers?.shift ?? false
      const eventShift = modifiers?.shift ?? false
      return shortcutShift === eventShift
    })
  }

  return { register, unregister, getByCategory, getAll, findByKey }
}
