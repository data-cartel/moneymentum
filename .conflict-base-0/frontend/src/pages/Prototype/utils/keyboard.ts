type KeyBinding = {
  key: string
  handler: () => void
  when?: () => boolean
  preventDefault?: boolean
  stopImmediatePropagation?: boolean
}

const createKeyboardHandler =
  (bindings: KeyBinding[]) => (event: KeyboardEvent) => {
    const binding = bindings.find(
      b => b.key === event.key && (b.when === undefined || b.when()),
    )
    if (binding) {
      if (binding.preventDefault !== false) {
        event.preventDefault()
      }
      if (binding.stopImmediatePropagation) {
        event.stopImmediatePropagation()
      }
      binding.handler()
    }
  }

export type { KeyBinding }
export { createKeyboardHandler }
