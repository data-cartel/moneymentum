export interface EscapeHandler {
  id: string
  priority: number
  handler: () => boolean
  label: string
}

export interface EscapeStack {
  push: (handler: EscapeHandler) => () => void
  remove: (id: string) => void
  handleEscape: () => boolean
  getStack: () => EscapeHandler[]
}

export const createEscapeStack = (): EscapeStack => {
  const stack: EscapeHandler[] = []

  const push = (handler: EscapeHandler): (() => void) => {
    stack.push(handler)
    return () => {
      remove(handler.id)
    }
  }

  const remove = (id: string): void => {
    const index = stack.findIndex(h => h.id === id)
    if (index !== -1) {
      stack.splice(index, 1)
    }
  }

  const handleEscape = (): boolean => {
    if (stack.length === 0) return false

    // Sort by priority descending (higher priority = handled first)
    // If same priority, LIFO order (later items first)
    const sorted = [...stack].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return stack.indexOf(b) - stack.indexOf(a)
    })

    for (const handler of sorted) {
      if (handler.handler()) {
        return true
      }
    }
    return false
  }

  const getStack = (): EscapeHandler[] => [...stack]

  return { push, remove, handleEscape, getStack }
}
