import { createEffect, onCleanup } from "solid-js"
import { createShortcutRegistry, createEscapeStack } from "../keyboard"
import type { ShortcutRegistry, EscapeStack, EscapeHandler } from "../keyboard"
import { getDirection } from "../utils/keys"

type FocusedPanel = "screener" | "positions" | null
type SecondaryFocus = "performance" | "staged" | "none"

interface KeyboardManagerConfig {
  focusedPanel: FocusedPanel
  secondaryFocus: SecondaryFocus
  showHelp: boolean
  columnConfigVisible: boolean
  isMetricSelectorOpen: boolean
  showFactorConfig: boolean
}

interface KeyboardManagerActions {
  focusPanel: (panel: FocusedPanel) => void
  setSecondaryFocus: (focus: SecondaryFocus) => void
  toggleHelp: () => void
  closeColumnConfig: () => void
  toggleColumnConfig: () => void
  setIsMetricSelectorOpen: (fn: (prev: boolean) => boolean) => void
  setShowFactorConfig: (fn: (prev: boolean) => boolean) => void
  handleEscape: () => void
  moveSelection: (direction: "up" | "down") => "boundary" | "moved"
  triggerTrade: (side: "buy" | "sell") => void
  toggleExpand: () => void
  adjustWeight: (delta: number) => void
  getSelectedSymbol: () => string | undefined
  getSelectedIndex: (panel: "screener" | "positions") => number | null
  toggleUnderlying: (underlying: string) => void
  toggleScreenerExpanded: (ticker: string) => void
  openAddPositionModal: (underlying: string) => void
  setLeverage: (fn: (prev: number) => number) => void
  executeStagedTrades: () => void
}

interface KeyboardManagerDeps {
  sortedAssets: Array<{ ticker: string }>
}

interface UseKeyboardManagerProps {
  config: () => KeyboardManagerConfig
  actions: KeyboardManagerActions
  deps: () => KeyboardManagerDeps
}

export interface KeyboardManager {
  registry: ShortcutRegistry
  escapeStack: EscapeStack
  registerEscapeHandler: (handler: EscapeHandler) => () => void
}

export const useKeyboardManager = ({
  config,
  actions,
  deps,
}: UseKeyboardManagerProps): KeyboardManager => {
  const registry = createShortcutRegistry()
  const escapeStack = createEscapeStack()

  const registerEscapeHandler = (handler: EscapeHandler): (() => void) => {
    return escapeStack.push(handler)
  }

  const blurLeverageControl = () => {
    document
      .querySelector<HTMLElement>('[data-testid="leverage-control"]')
      ?.blur()
  }

  const focusLeverageControl = () => {
    document
      .querySelector<HTMLElement>('[data-testid="leverage-control"]')
      ?.focus()
  }

  createEffect(() => {
    const currentConfig = config()
    const currentDeps = deps()
    const { focusedPanel, secondaryFocus, showHelp, columnConfigVisible } =
      currentConfig
    const {
      focusPanel,
      setSecondaryFocus,
      toggleHelp,
      closeColumnConfig,
      toggleColumnConfig,
      setIsMetricSelectorOpen,
      setShowFactorConfig,
      handleEscape,
      moveSelection,
      triggerTrade,
      toggleExpand,
      adjustWeight,
      getSelectedSymbol,
      getSelectedIndex,
      toggleUnderlying,
      toggleScreenerExpanded,
      openAddPositionModal,
      setLeverage,
      executeStagedTrades,
    } = actions
    const { sortedAssets } = currentDeps

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === "?" || (event.key === "F1" && !event.ctrlKey)) {
        event.preventDefault()
        toggleHelp()
        return
      }

      if (key === "escape") {
        event.preventDefault()
        if (showHelp) {
          toggleHelp()
        } else if (columnConfigVisible) {
          closeColumnConfig()
        } else if (secondaryFocus !== "none") {
          setSecondaryFocus("none")
        } else {
          handleEscape()
        }
        return
      }

      if (event.key === "1") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (secondaryFocus === "staged") blurLeverageControl()
        setSecondaryFocus("none")
        focusPanel("screener")
        return
      }
      if (event.key === "2") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (secondaryFocus === "staged") blurLeverageControl()
        setSecondaryFocus("none")
        focusPanel("positions")
        return
      }
      if (event.key === "3") {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (secondaryFocus === "staged") blurLeverageControl()
        focusPanel(null)
        setSecondaryFocus("performance")
        return
      }
      if (event.key === "4") {
        event.preventDefault()
        event.stopImmediatePropagation()
        focusPanel(null)
        setSecondaryFocus("staged")
        focusLeverageControl()
        return
      }

      const direction = getDirection(event.key)

      if (focusedPanel && direction === "left") {
        event.preventDefault()
        focusPanel("screener")
        return
      }
      if (focusedPanel && direction === "right") {
        event.preventDefault()
        focusPanel("positions")
        return
      }

      if (focusedPanel && direction === "down") {
        event.preventDefault()
        const result = moveSelection("down")
        if (result === "boundary" && focusedPanel === "positions") {
          focusPanel(null)
          setSecondaryFocus("staged")
          focusLeverageControl()
        }
        return
      }
      if (focusedPanel && direction === "up") {
        event.preventDefault()
        moveSelection("up")
        return
      }

      if (secondaryFocus === "staged" && direction === "up") {
        event.preventDefault()
        blurLeverageControl()
        setSecondaryFocus("none")
        focusPanel("positions")
        return
      }

      if (
        focusedPanel === "positions" &&
        (key === "o" || key === " " || key === "enter")
      ) {
        event.preventDefault()
        const selectedUnderlying = getSelectedSymbol()
        if (selectedUnderlying) {
          toggleUnderlying(selectedUnderlying)
        }
        toggleExpand()
        return
      }
      if (focusedPanel === "screener" && key === "o") {
        event.preventDefault()
        const selectedIdx = getSelectedIndex("screener")
        if (selectedIdx !== null) {
          const asset = sortedAssets[selectedIdx] as
            | { ticker: string }
            | undefined
          if (asset) {
            toggleScreenerExpanded(asset.ticker)
          }
        }
        return
      }

      if (focusedPanel === "screener" && event.key === "Enter") {
        event.preventDefault()
        const selectedIdx = getSelectedIndex("screener")
        if (selectedIdx !== null) {
          const asset = sortedAssets[selectedIdx] as
            | { ticker: string }
            | undefined
          if (asset) {
            openAddPositionModal(asset.ticker)
          }
        }
        return
      }

      if (focusedPanel && (key === "+" || key === "=")) {
        event.preventDefault()
        if (event.shiftKey) {
          adjustWeight(0.05)
        } else {
          triggerTrade("buy")
        }
        return
      }
      if (focusedPanel && key === "-") {
        event.preventDefault()
        if (event.shiftKey) {
          adjustWeight(-0.05)
        } else {
          triggerTrade("sell")
        }
        return
      }

      if (key === "m") {
        event.preventDefault()
        setIsMetricSelectorOpen(prev => !prev)
        return
      }

      if (key === "f") {
        event.preventDefault()
        setShowFactorConfig(prev => !prev)
        return
      }

      if (key === "c") {
        event.preventDefault()
        toggleColumnConfig()
        return
      }

      if (event.key === "[") {
        event.preventDefault()
        setLeverage(prev => Math.max(0.1, Math.round((prev - 0.1) * 10) / 10))
        return
      }
      if (event.key === "]") {
        event.preventDefault()
        setLeverage(prev => Math.min(5, Math.round((prev + 0.1) * 10) / 10))
        return
      }

      if (key === "x") {
        event.preventDefault()
        executeStagedTrades()
        return
      }

      if (!focusedPanel && ["h", "j", "k", "l"].includes(key)) {
        event.preventDefault()
        focusPanel("screener")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  return { registry, escapeStack, registerEscapeHandler }
}
