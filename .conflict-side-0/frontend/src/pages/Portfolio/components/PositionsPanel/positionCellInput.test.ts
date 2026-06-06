import { describe, expect, it, vi } from "vitest"

import {
  isPositionCellInput,
  POSITION_CELL_INPUT_ATTR,
  schedulePositionCellEditRelease,
} from "./positionCellInput"

describe("positionCellInput", () => {
  it("detects position cell inputs by data attribute", () => {
    const input = document.createElement("input")
    input.setAttribute(POSITION_CELL_INPUT_ATTR, "")
    document.body.append(input)

    expect(isPositionCellInput(input)).toBe(true)
    expect(isPositionCellInput(document.body)).toBe(false)

    input.remove()
  })

  it("defers release until focus leaves all position cell inputs", async () => {
    const release = vi.fn()
    const first = document.createElement("input")
    first.setAttribute(POSITION_CELL_INPUT_ATTR, "")
    const second = document.createElement("input")
    second.setAttribute(POSITION_CELL_INPUT_ATTR, "")
    document.body.append(first, second)

    schedulePositionCellEditRelease(
      { relatedTarget: second } as FocusEvent,
      release,
    )

    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()

    first.remove()
    second.remove()
    schedulePositionCellEditRelease(
      { relatedTarget: null } as FocusEvent,
      release,
    )

    await Promise.resolve()
    expect(release).toHaveBeenCalledOnce()

    document.body.replaceChildren()
  })
})
