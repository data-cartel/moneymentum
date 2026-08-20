import { useContext } from "solid-js"
import { describe, expect, it } from "vitest"
import type { DockviewIDisposable } from "@arminmajerie/dockview-core"

import { SolidPart, SolidPartContext } from "./dockviewSolidPart"

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
})
