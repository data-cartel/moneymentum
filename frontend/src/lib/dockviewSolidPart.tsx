// Patched SolidPart: mount panel portals under the app owner so Solid context
// (WalletProvider, QueryClientProvider, etc.) remains available.
// Upstream uses render() which creates a detached root and drops context.
import { createContext, createRoot, createSignal, type JSX } from "solid-js"
import { insert } from "solid-js/web"
import type { DockviewIDisposable } from "@arminmajerie/dockview-core"
import { readDockviewSolidOwner } from "@/lib/dockviewSolidOwner"

export const SolidPartContext = createContext({})

export interface SolidPortalStore {
  addPortal: (disposeFn: DockviewIDisposable) => DockviewIDisposable
}

export class SolidPart<P extends object = object, C extends object = object> {
  private readonly parent: HTMLElement
  private readonly portalStore: SolidPortalStore
  private readonly component: (props: P) => JSX.Element
  private readonly parameters: P
  private readonly context?: C
  private ref?: DockviewIDisposable
  private disposed = false
  private overrides: Record<string, unknown> = {}
  private triggerUpdate?: (version: number) => void
  private version = 0

  constructor(
    parent: HTMLElement,
    portalStore: SolidPortalStore,
    component: (props: P) => JSX.Element,
    parameters: P,
    context?: C,
  ) {
    this.parent = parent
    this.portalStore = portalStore
    this.component = component
    this.parameters = parameters
    this.context = context
    this.createPortal()
  }

  update(props: Record<string, unknown>): void {
    if (this.disposed) {
      throw new Error("invalid operation: resource is already disposed")
    }
    Object.assign(this.overrides, props)
    this.version++
    this.triggerUpdate?.(this.version)
  }

  private createPortal(): void {
    if (this.disposed) {
      throw new Error("already disposed")
    }

    const baseParams = this.parameters
    const overridesRef = this.overrides
    const Comp = this.component
    const ctx = this.context
    const parentEl = this.parent
    const parentOwner = readDockviewSolidOwner()

    const disposeRoot = createRoot(dispose => {
      const [version, setVersion] = createSignal(0)
      this.triggerUpdate = setVersion

      // Comp must be instantiated as a child of the provider: calling it here
      // would run its synchronous context reads before the provider exists.
      const ComponentWithContext = () => {
        version()
        const plainProps = { ...baseParams, ...overridesRef } as P

        return (
          <SolidPartContext.Provider value={ctx ?? {}}>
            <Comp {...plainProps} />
          </SolidPartContext.Provider>
        )
      }

      insert(parentEl, () => <ComponentWithContext />, null)
      return dispose
    }, parentOwner ?? undefined)

    this.ref = this.portalStore.addPortal({
      dispose: () => {
        disposeRoot()
        parentEl.textContent = ""
        this.disposed = true
      },
    })
  }

  dispose(): void {
    this.ref?.dispose()
    this.disposed = true
  }
}

type PortalLifecycleHook = () => [
  () => DockviewIDisposable[],
  (cleanup: DockviewIDisposable) => DockviewIDisposable,
]

export const usePortalsLifecycle: PortalLifecycleHook = () => {
  const [portals, setPortals] = createSignal<DockviewIDisposable[]>([])

  const addPortal = (cleanup: DockviewIDisposable) => {
    setPortals(existing => [...existing, cleanup])
    let disposed = false
    return {
      dispose() {
        if (disposed) {
          throw new Error("invalid operation: resource already disposed")
        }
        disposed = true
        setPortals(existing => existing.filter(portal => portal !== cleanup))
        cleanup.dispose()
      },
    }
  }

  return [portals, addPortal]
}
