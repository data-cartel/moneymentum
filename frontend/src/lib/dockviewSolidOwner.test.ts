import { createRoot, getOwner, type Owner } from "solid-js"
import { describe, expect, it } from "vitest"

import {
  bindDockviewSolidOwner,
  readDockviewSolidOwner,
  releaseDockviewSolidOwner,
} from "./dockviewSolidOwner"

const createDetachedOwner = (): Owner => {
  const owner = createRoot(() => getOwner())
  if (owner === null) {
    throw new Error("expected createRoot to provide an owner")
  }
  return owner
}

describe("dockviewSolidOwner", () => {
  it("clears the binding when its own token is released", () => {
    const owner = createDetachedOwner()
    const token = bindDockviewSolidOwner(owner)

    expect(readDockviewSolidOwner()).toBe(owner)

    releaseDockviewSolidOwner(token)

    expect(readDockviewSolidOwner()).toBeNull()
  })

  it("keeps a newer owner when an overlapping older binding is released", () => {
    const replacedOwner = createDetachedOwner()
    const currentOwner = createDetachedOwner()
    const replacedToken = bindDockviewSolidOwner(replacedOwner)
    const currentToken = bindDockviewSolidOwner(currentOwner)

    releaseDockviewSolidOwner(replacedToken)

    expect(readDockviewSolidOwner()).toBe(currentOwner)

    releaseDockviewSolidOwner(currentToken)

    expect(readDockviewSolidOwner()).toBeNull()
  })
})
