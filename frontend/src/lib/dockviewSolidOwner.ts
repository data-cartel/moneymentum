import type { Owner } from "solid-js"

/** Identifies one binding of the dockview owner so stale cleanups are ignored. */
export type DockviewSolidOwnerToken = symbol

let dockviewSolidOwner: Owner | null = null
let dockviewSolidOwnerToken: DockviewSolidOwnerToken | null = null

/**
 * Bind the Solid owner that dockview panel portals should inherit (providers).
 * Returns the token that `releaseDockviewSolidOwner` needs to clear it again.
 */
export const bindDockviewSolidOwner = (
  owner: Owner | null,
): DockviewSolidOwnerToken => {
  const token = Symbol("dockview-solid-owner")
  dockviewSolidOwner = owner
  dockviewSolidOwnerToken = token
  return token
}

/**
 * Clear the bound owner only when `token` is still the active binding, so an
 * overlapping mount (hot reload, route transition) keeps its newer owner.
 */
export const releaseDockviewSolidOwner = (
  token: DockviewSolidOwnerToken,
): void => {
  if (dockviewSolidOwnerToken !== token) {
    return
  }
  dockviewSolidOwner = null
  dockviewSolidOwnerToken = null
}

export const readDockviewSolidOwner = (): Owner | null => dockviewSolidOwner
