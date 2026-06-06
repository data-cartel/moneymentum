import { createEffect, onCleanup } from "solid-js"
import { createKeyboardHandler, type KeyBinding } from "../utils/keyboard"

const useGlobalKeyboard = (
  bindings: () => KeyBinding[],
  options?: {
    ignoreInputs?: boolean
  },
) => {
  createEffect(() => {
    const ignoreInputs = options?.ignoreInputs !== false
    const currentBindings = bindings()

    const handler = (event: KeyboardEvent) => {
      if (ignoreInputs) {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        ) {
          return
        }
      }
      createKeyboardHandler(currentBindings)(event)
    }

    window.addEventListener("keydown", handler)
    onCleanup(() => {
      window.removeEventListener("keydown", handler)
    })
  })
}

export { useGlobalKeyboard }
