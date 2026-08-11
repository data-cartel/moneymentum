export const POSITION_CELL_INPUT_ATTR = "data-position-cell-input"

export const positionCellInputProps = {
  [POSITION_CELL_INPUT_ATTR]: "",
} as const

export const isPositionCellInput = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest(`[${POSITION_CELL_INPUT_ATTR}]`) !== null

export const schedulePositionCellEditRelease = (
  event: FocusEvent,
  release: () => void,
): void => {
  queueMicrotask(() => {
    if (isPositionCellInput(document.activeElement)) return
    if (isPositionCellInput(event.relatedTarget)) return
    release()
  })
}
