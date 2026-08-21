export const modifierKeyLabel = (): "⌘" | "Ctrl" => {
  if (typeof navigator === "undefined") {
    return "Ctrl"
  }

  const userAgent = navigator.userAgent.toLowerCase()
  if (
    userAgent.includes("mac") ||
    userAgent.includes("iphone") ||
    userAgent.includes("ipad")
  ) {
    return "⌘"
  }

  return "Ctrl"
}

export const isPrimaryModifierPressed = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey
