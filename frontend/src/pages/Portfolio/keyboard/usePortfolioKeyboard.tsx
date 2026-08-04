import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js"

import type { OrderSide } from "@/hooks/useTrading"
import type { StagedConnectionState } from "@/pages/Portfolio/components/StagedChangesPanel"
import { steppedCrossAccountLeverage } from "@/pages/Portfolio/components/PositionsPanel/crossAccountLeverage"

import { panelIdForDigitKey, type KeyboardPanelId } from "./hotkeyHints"
import {
  isEditableKeyboardTarget,
  isKeyboardSuppressed,
} from "./isKeyboardSuppressed"
import { isPrimaryModifierPressed } from "./modifierLabel"
import {
  blurActiveElement,
  focusAllSymbolsSearch,
  focusPanelContainer,
  focusPortfolioCell,
  focusStagedPin,
  STAGED_PIN_ATTR,
} from "./portfolioCellFocus"

export interface PortfolioKeyboardActions {
  activatePanel: (panelId: KeyboardPanelId) => void
  getPortfolioSymbols: () => string[]
  getAllSymbolSymbols: () => string[]
  isPinDialogOpen: () => boolean
  connectionState: () => StagedConnectionState
  onRemove: (symbol: string) => void
  onUndoRemove: (symbol: string) => void
  onSideChange: (symbol: string, side: OrderSide) => void
  onLeverageChange: (symbol: string, leverage: number) => void
  getPositionSide: (symbol: string) => OrderSide | undefined
  getPositionLeverage: (symbol: string) => number | undefined
  getMaxLeverage: (symbol: string) => number | undefined
  getCrossAccountLeverage: () => number
  onCrossAccountLeverageChange: (leverage: number) => void
  isPositionClosing: (symbol: string) => boolean
  onAllSymbolEnter: (symbol: string) => void
  onStagedSubmit: () => void
  onStagedClearAll: () => void
  onOpenWalletPinDialog: () => void
}

interface PortfolioKeyboardContextValue {
  focusedPanel: Accessor<KeyboardPanelId>
  setFocusedPanel: Setter<KeyboardPanelId>
  selectedPortfolioSymbol: Accessor<string | null>
  setSelectedPortfolioSymbol: Setter<string | null>
  selectedAllSymbolsIndex: Accessor<number | null>
  setSelectedAllSymbolsIndex: Setter<number | null>
  leverageEditorSymbol: Accessor<string | null>
  setLeverageEditorSymbol: Setter<string | null>
  portfolioSymbolOrder: Accessor<string[]>
  setPortfolioSymbolOrder: Setter<string[]>
  allSymbolOrder: Accessor<string[]>
  setAllSymbolOrder: Setter<string[]>
  ensurePortfolioSelection: () => void
  ensureAllSymbolsSelection: () => void
  onPanelActivated: (panelId: KeyboardPanelId) => void
  registerStagedUnlockSubmit: (submit: (() => void) | null) => void
}

const PortfolioKeyboardContext = createContext<PortfolioKeyboardContextValue>()

export { PortfolioKeyboardContext }

export const usePortfolioKeyboardContext =
  (): PortfolioKeyboardContextValue => {
    const context = useContext(PortfolioKeyboardContext)
    if (!context) {
      throw new Error(
        "usePortfolioKeyboardContext must be used within PortfolioKeyboardProvider",
      )
    }
    return context
  }

/** Returns undefined when rendered outside the provider (e.g. isolated panel tests). */
export const tryUsePortfolioKeyboardContext = ():
  | PortfolioKeyboardContextValue
  | undefined => useContext(PortfolioKeyboardContext)

const moveIndex = (
  current: number | null,
  length: number,
  delta: number,
): number | null => {
  if (length === 0) {
    return null
  }

  if (current === null) {
    return delta > 0 ? 0 : length - 1
  }

  const next = current + delta
  if (next < 0) {
    return 0
  }
  if (next >= length) {
    return length - 1
  }
  return next
}

const resolvePortfolioSelection = (
  previous: string | null,
  symbols: string[],
): string | null => {
  if (symbols.length === 0) {
    return null
  }
  if (previous !== null && symbols.includes(previous)) {
    return previous
  }
  return symbols[0] ?? null
}

const resolveAllSymbolsIndex = (
  previous: number | null,
  length: number,
): number | null => {
  if (length === 0) {
    return null
  }
  if (previous !== null && previous >= 0 && previous < length) {
    return previous
  }
  return 0
}

export const PortfolioKeyboardProvider = (props: {
  actions: PortfolioKeyboardActions
  children: JSX.Element
}): JSX.Element => {
  const [focusedPanel, setFocusedPanel] =
    createSignal<KeyboardPanelId>("portfolio")
  const [selectedPortfolioSymbol, setSelectedPortfolioSymbol] = createSignal<
    string | null
  >(null)
  const [selectedAllSymbolsIndex, setSelectedAllSymbolsIndex] = createSignal<
    number | null
  >(null)
  const [leverageEditorSymbol, setLeverageEditorSymbol] = createSignal<
    string | null
  >(null)
  const [portfolioSymbolOrder, setPortfolioSymbolOrder] = createSignal<
    string[]
  >([])
  const [allSymbolOrder, setAllSymbolOrder] = createSignal<string[]>([])
  let stagedUnlockSubmit: (() => void) | null = null

  const registerStagedUnlockSubmit = (submit: (() => void) | null) => {
    stagedUnlockSubmit = submit
  }

  const getPortfolioSymbols = () => {
    const ordered = portfolioSymbolOrder()
    if (ordered.length > 0) {
      return ordered
    }
    return props.actions.getPortfolioSymbols()
  }

  const getAllSymbolSymbols = () => {
    const ordered = allSymbolOrder()
    if (ordered.length > 0) {
      return ordered
    }
    return props.actions.getAllSymbolSymbols()
  }

  const ensurePortfolioSelection = () => {
    setSelectedPortfolioSymbol(previous =>
      resolvePortfolioSelection(previous, getPortfolioSymbols()),
    )
  }

  const ensureAllSymbolsSelection = () => {
    const symbols = getAllSymbolSymbols()
    setSelectedAllSymbolsIndex(previous =>
      resolveAllSymbolsIndex(previous, symbols.length),
    )
  }

  const onPanelActivated = (panelId: KeyboardPanelId) => {
    setFocusedPanel(panelId)
    setLeverageEditorSymbol(null)

    if (panelId === "portfolio") {
      ensurePortfolioSelection()
      focusPanelContainer("portfolio")
      return
    }

    if (panelId === "hyperliquid") {
      ensureAllSymbolsSelection()
      focusPanelContainer("hyperliquid")
      return
    }

    if (panelId === "derive") {
      focusPanelContainer("derive")
      return
    }

    focusPanelContainer("staged")
    if (props.actions.connectionState() === "agentLocked") {
      // Defer so the PIN field is mounted when switching into staged.
      queueMicrotask(() => {
        focusStagedPin()
      })
    }
  }

  const stepLeverage = (delta: number) => {
    const symbol = leverageEditorSymbol() ?? selectedPortfolioSymbol()
    if (symbol === null) {
      return
    }

    const current = props.actions.getPositionLeverage(symbol)
    if (current === undefined) {
      return
    }

    const maxLeverage = Math.floor(props.actions.getMaxLeverage(symbol) ?? 1)
    const next = Math.min(maxLeverage, Math.max(1, current + delta))
    if (next === current) {
      return
    }

    props.actions.onLeverageChange(symbol, next)
  }

  const stepCrossAccountLeverage = (deltaSteps: number) => {
    const current = props.actions.getCrossAccountLeverage()
    const next = steppedCrossAccountLeverage(current, deltaSteps)
    if (next === current) {
      return
    }

    props.actions.onCrossAccountLeverageChange(next)
  }

  const handlePortfolioKeys = (event: KeyboardEvent) => {
    // Account leverage: Shift+[ ] (event.key is {/} on many layouts).
    if (
      event.shiftKey &&
      (event.code === "BracketLeft" || event.code === "BracketRight")
    ) {
      event.preventDefault()
      stepCrossAccountLeverage(event.code === "BracketRight" ? 1 : -1)
      return
    }

    const symbols = getPortfolioSymbols()
    if (symbols.length === 0) {
      return
    }

    const selected = selectedPortfolioSymbol()
    const selectedIndex = selected === null ? -1 : symbols.indexOf(selected)
    const hasValidSelection =
      selectedIndex >= 0 && selectedIndex < symbols.length
    const leverageOpen = leverageEditorSymbol() !== null

    if (leverageOpen) {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault()
        setLeverageEditorSymbol(null)
        focusPanelContainer("portfolio")
        return
      }

      if (event.key === "ArrowLeft" || event.key === "[") {
        event.preventDefault()
        stepLeverage(-1)
        return
      }

      if (event.key === "ArrowRight" || event.key === "]") {
        event.preventDefault()
        stepLeverage(1)
        return
      }

      // Digits are handled inside PositionsPanelRow while editor is open.
      return
    }

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault()
      if (!hasValidSelection) {
        setSelectedPortfolioSymbol(symbols[0] ?? null)
        return
      }
      const nextIndex = moveIndex(selectedIndex, symbols.length, 1)
      if (nextIndex !== null) {
        setSelectedPortfolioSymbol(symbols[nextIndex] ?? null)
      }
      return
    }

    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault()
      if (!hasValidSelection) {
        setSelectedPortfolioSymbol(symbols[symbols.length - 1] ?? null)
        return
      }
      const nextIndex = moveIndex(selectedIndex, symbols.length, -1)
      if (nextIndex !== null) {
        setSelectedPortfolioSymbol(symbols[nextIndex] ?? null)
      }
      return
    }

    ensurePortfolioSelection()
    const ensured = selectedPortfolioSymbol()
    if (ensured === null) {
      return
    }

    if (event.key === "w") {
      event.preventDefault()
      focusPortfolioCell(ensured, "weight")
      return
    }

    if (event.key === "n") {
      event.preventDefault()
      focusPortfolioCell(ensured, "notional")
      return
    }

    if (event.key === "t") {
      event.preventDefault()
      const side = props.actions.getPositionSide(ensured)
      if (side === undefined || props.actions.isPositionClosing(ensured)) {
        return
      }
      props.actions.onSideChange(ensured, side === "buy" ? "sell" : "buy")
      return
    }

    if (event.key === "d") {
      event.preventDefault()
      if (props.actions.isPositionClosing(ensured)) {
        props.actions.onUndoRemove(ensured)
      } else {
        props.actions.onRemove(ensured)
      }
      return
    }

    if (event.key === "l") {
      event.preventDefault()
      if (props.actions.isPositionClosing(ensured)) {
        return
      }
      setLeverageEditorSymbol(ensured)
      return
    }

    if (event.key === "[" || event.key === "]") {
      event.preventDefault()
      if (props.actions.isPositionClosing(ensured)) {
        return
      }
      setLeverageEditorSymbol(ensured)
      stepLeverage(event.key === "]" ? 1 : -1)
    }
  }

  const handleAllSymbolsKeys = (event: KeyboardEvent) => {
    const symbols = getAllSymbolSymbols()

    if (event.key === "s") {
      event.preventDefault()
      focusAllSymbolsSearch()
      return
    }

    if (symbols.length === 0) {
      return
    }

    const selectedIndex = selectedAllSymbolsIndex()
    const hasValidSelection =
      selectedIndex !== null &&
      selectedIndex >= 0 &&
      selectedIndex < symbols.length

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault()
      if (!hasValidSelection) {
        setSelectedAllSymbolsIndex(0)
        return
      }
      setSelectedAllSymbolsIndex(moveIndex(selectedIndex, symbols.length, 1))
      return
    }

    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault()
      if (!hasValidSelection) {
        setSelectedAllSymbolsIndex(symbols.length - 1)
        return
      }
      setSelectedAllSymbolsIndex(moveIndex(selectedIndex, symbols.length, -1))
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      if (!hasValidSelection) {
        setSelectedAllSymbolsIndex(0)
        props.actions.onAllSymbolEnter(symbols[0])
        return
      }
      props.actions.onAllSymbolEnter(symbols[selectedIndex])
    }
  }

  const handleStagedKeys = (event: KeyboardEvent) => {
    if (
      isPrimaryModifierPressed(event) &&
      event.shiftKey &&
      event.key === "Backspace"
    ) {
      event.preventDefault()
      props.actions.onStagedClearAll()
      return
    }

    if (isPrimaryModifierPressed(event) && event.key === "Enter") {
      event.preventDefault()

      const connection = props.actions.connectionState()
      if (
        connection === "walletDisconnected" ||
        connection === "agentMissing"
      ) {
        props.actions.onOpenWalletPinDialog()
        return
      }
      if (connection === "agentLocked") {
        if (stagedUnlockSubmit) {
          stagedUnlockSubmit()
        } else {
          focusStagedPin()
        }
        return
      }
      props.actions.onStagedSubmit()
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const leverageOpen = leverageEditorSymbol() !== null
    const isPinField =
      event.target instanceof HTMLElement &&
      event.target.hasAttribute(STAGED_PIN_ATTR)

    // Staged modifier chords work from any panel, and while the PIN field is
    // focused. Draft edits do not require canTrade; connect opens when needed.
    if (
      isPrimaryModifierPressed(event) &&
      !props.actions.isPinDialogOpen() &&
      (isPinField || !isEditableKeyboardTarget(event.target))
    ) {
      if (event.shiftKey && event.key === "Backspace") {
        handleStagedKeys(event)
        return
      }
      if (event.key === "Enter") {
        handleStagedKeys(event)
        return
      }
    }

    // While typing in an input, only allow Enter/Esc blur (keeps query / value).
    if (isEditableKeyboardTarget(event.target)) {
      if (
        (event.key === "Enter" || event.key === "Escape") &&
        event.target instanceof HTMLInputElement &&
        !isPrimaryModifierPressed(event)
      ) {
        event.preventDefault()
        blurActiveElement()
        focusPanelContainer(focusedPanel())
      }
      return
    }

    if (
      isKeyboardSuppressed({
        eventTarget: event.target,
        isPinDialogOpen: props.actions.isPinDialogOpen(),
      })
    ) {
      return
    }

    // Leverage editor owns digits and step keys; mute panel switching.
    if (leverageOpen && focusedPanel() === "portfolio") {
      handlePortfolioKeys(event)
      return
    }

    const panelFromDigit = panelIdForDigitKey(event.key)
    if (
      panelFromDigit !== undefined &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      if (focusedPanel() === panelFromDigit) {
        return
      }
      event.preventDefault()
      props.actions.activatePanel(panelFromDigit)
      onPanelActivated(panelFromDigit)
      return
    }

    switch (focusedPanel()) {
      case "portfolio":
        handlePortfolioKeys(event)
        break
      case "hyperliquid":
        handleAllSymbolsKeys(event)
        break
      case "staged":
        handleStagedKeys(event)
        break
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  const contextValue: PortfolioKeyboardContextValue = {
    focusedPanel,
    setFocusedPanel,
    selectedPortfolioSymbol,
    setSelectedPortfolioSymbol,
    selectedAllSymbolsIndex,
    setSelectedAllSymbolsIndex,
    leverageEditorSymbol,
    setLeverageEditorSymbol,
    portfolioSymbolOrder,
    setPortfolioSymbolOrder,
    allSymbolOrder,
    setAllSymbolOrder,
    ensurePortfolioSelection,
    ensureAllSymbolsSelection,
    onPanelActivated,
    registerStagedUnlockSubmit,
  }

  return (
    <PortfolioKeyboardContext.Provider value={contextValue}>
      {props.children}
    </PortfolioKeyboardContext.Provider>
  )
}
