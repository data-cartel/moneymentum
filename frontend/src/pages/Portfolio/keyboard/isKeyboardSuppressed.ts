import { isPositionCellInput } from "../components/PositionsPanel/positionCellInput"

export const isEditableKeyboardTarget = (
  target: EventTarget | null,
): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (isPositionCellInput(target)) {
    return true
  }

  const tagName = target.tagName
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true
  }

  return target.isContentEditable
}

export const isKeyboardSuppressed = (options: {
  eventTarget: EventTarget | null
  isPinDialogOpen: boolean
}): boolean => {
  if (options.isPinDialogOpen) {
    return true
  }

  return isEditableKeyboardTarget(options.eventTarget)
}
