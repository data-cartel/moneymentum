import { createRoot, useContext } from "solid-js"
import { describe, expect, it } from "vitest"
import type { DockviewIDisposable } from "@arminmajerie/dockview-core"

import {
  SolidPart,
  SolidPartContext,
  usePortalsLifecycle,
} from "./dockviewSolidPart"

const collectingPortalStore = () => {
  const portals: DockviewIDisposable[] = []
  return {
    portals,
    addPortal: (disposeFn: DockviewIDisposable) => {
      portals.push(disposeFn)
      return disposeFn
    },
  }
}

describe("SolidPart", () => {
  it("exposes the dockview context to panels that read it while rendering", () => {
    const parent = document.createElement("div")
    const panelContext = { containerApi: "dockview-container-api" }
    let contextDuringRender: unknown

    const Panel = (props: { title: string }) => {
      contextDuringRender = useContext(SolidPartContext)
      return <span>{props.title}</span>
    }

    new SolidPart(
      parent,
      collectingPortalStore(),
      Panel,
      { title: "PORTFOLIO" },
      panelContext,
    )

    expect(contextDuringRender).toBe(panelContext)
    expect(parent.textContent).toBe("PORTFOLIO")
  })

  it("tears the portal down once when dispose is called repeatedly", () => {
    const parent = document.createElement("div")
    const Panel = (props: { title: string }) => <span>{props.title}</span>

    createRoot(disposeOwner => {
      const [portals, addPortal] = usePortalsLifecycle()
      const part = new SolidPart(parent, { addPortal }, Panel, {
        title: "PORTFOLIO",
      })

      expect(portals()).toHaveLength(1)

      part.dispose()

      expect(portals()).toHaveLength(0)
      expect(parent.textContent).toBe("")
      expect(() => {
        part.dispose()
      }).not.toThrow()

      disposeOwner()
    })
  })
})
