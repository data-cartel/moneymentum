import { createSignal, createMemo } from "solid-js"

export type ListPanelId = "screener" | "positions"

interface ScreenerItem {
  symbol: string
}

interface InstrumentItem {
  symbol: string
}

interface PositionItem {
  underlying: string
  instruments: InstrumentItem[]
}

interface UseListSelectionConfig {
  screenerItems: () => ScreenerItem[]
  positionItems: () => PositionItem[]
  onAddTrade: (symbol: string, side: "buy" | "sell") => void
  onAdjustWeight?: (symbol: string, delta: number) => void
}

interface SelectionState {
  screener: number | null
  positions: number | null
  instrumentIndex: number | null
}

const clampIndex = (index: number | null, length: number): number | null => {
  if (index === null || length === 0) return length === 0 ? null : index
  if (length === 0) return null
  return Math.min(index, length - 1)
}

export const useListSelection = (config: UseListSelectionConfig) => {
  const { onAddTrade, onAdjustWeight } = config

  const [focusedPanel, setFocusedPanel] = createSignal<ListPanelId | null>(null)
  const [rawSelection, setRawSelection] = createSignal<SelectionState>({
    screener: null,
    positions: null,
    instrumentIndex: null,
  })
  const [expandedUnderlyings, setExpandedUnderlyings] = createSignal<
    Set<string>
  >(
    new Set(
      config
        .positionItems()
        .filter(p => p.instruments.length > 1)
        .map(p => p.underlying),
    ),
  )

  const selection = createMemo((): SelectionState => {
    const raw = rawSelection()
    const posItems = config.positionItems()
    const scrItems = config.screenerItems()
    const expanded = expandedUnderlyings()

    const clampedPositions = clampIndex(raw.positions, posItems.length)

    let clampedInstrumentIndex: number | null = null
    if (clampedPositions !== null && raw.instrumentIndex !== null) {
      const selectedPosition = posItems[clampedPositions]
      if (expanded.has(selectedPosition.underlying)) {
        clampedInstrumentIndex = clampIndex(
          raw.instrumentIndex,
          selectedPosition.instruments.length,
        )
      }
    }

    return {
      screener: clampIndex(raw.screener, scrItems.length),
      positions: clampedPositions,
      instrumentIndex: clampedInstrumentIndex,
    }
  })

  const getListLength = (panel: ListPanelId): number => {
    return panel === "screener"
      ? config.screenerItems().length
      : config.positionItems().length
  }

  const focusPanel = (panel: ListPanelId | null) => {
    setFocusedPanel(panel)

    if (panel !== null) {
      setRawSelection(prev => {
        if (prev[panel] !== null) return prev

        const length =
          panel === "screener"
            ? config.screenerItems().length
            : config.positionItems().length
        if (length === 0) return prev

        return { ...prev, [panel]: 0 }
      })
    }
  }

  const getSelectedIndex = (panel: ListPanelId): number | null => {
    return selection()[panel]
  }

  const isAtBoundary = (direction: "up" | "down"): boolean => {
    const panel = focusedPanel()
    if (panel === null) return false

    const length = getListLength(panel)
    if (length === 0) return true

    const sel = selection()
    const current = sel[panel]
    if (current === null) return false

    if (panel === "positions") {
      const posItems = config.positionItems()
      const selectedPosition = posItems[current]
      const isPositionExpanded = expandedUnderlyings().has(
        selectedPosition.underlying,
      )

      if (direction === "down") {
        const isLastUnderlying = current >= length - 1
        if (!isLastUnderlying) return false

        if (isPositionExpanded) {
          const instrumentCount = selectedPosition.instruments.length
          const atLastInstrument =
            sel.instrumentIndex !== null &&
            sel.instrumentIndex >= instrumentCount - 1
          return atLastInstrument
        }
        return true
      } else {
        return current === 0 && sel.instrumentIndex === null
      }
    }

    if (direction === "down") {
      return current >= length - 1
    } else {
      return current === 0
    }
  }

  const moveSelection = (direction: "up" | "down"): "moved" | "boundary" => {
    const panel = focusedPanel()
    if (panel === null) return "boundary"

    const length = getListLength(panel)
    if (length === 0) return "boundary"

    if (isAtBoundary(direction)) {
      return "boundary"
    }

    setRawSelection(prev => {
      const current = prev[panel]
      const posItems = config.positionItems()

      if (panel === "positions" && current !== null) {
        const selectedPosition = posItems[current]
        const isExpanded = expandedUnderlyings().has(
          selectedPosition.underlying,
        )

        if (isExpanded) {
          const instrumentCount = selectedPosition.instruments.length

          if (direction === "down") {
            if (prev.instrumentIndex === null) {
              return { ...prev, instrumentIndex: 0 }
            }
            if (prev.instrumentIndex >= instrumentCount - 1) {
              const nextIndex = Math.min(current + 1, length - 1)
              return { ...prev, positions: nextIndex, instrumentIndex: null }
            }
            return { ...prev, instrumentIndex: prev.instrumentIndex + 1 }
          } else {
            if (prev.instrumentIndex === 0) {
              return { ...prev, instrumentIndex: null }
            }
            if (prev.instrumentIndex === null) {
              const prevIndex = Math.max(current - 1, 0)
              return { ...prev, positions: prevIndex }
            }
            return { ...prev, instrumentIndex: prev.instrumentIndex - 1 }
          }
        }
      }

      let newIndex: number
      if (current === null) {
        newIndex = 0
      } else if (direction === "down") {
        newIndex = Math.min(current + 1, length - 1)
      } else {
        newIndex = Math.max(current - 1, 0)
      }

      return { ...prev, [panel]: newIndex, instrumentIndex: null }
    })

    return "moved"
  }

  const getSelectedSymbol = (): string | null => {
    const panel = focusedPanel()
    if (panel === null) return null

    const sel = selection()
    const index = sel[panel]
    if (index === null) return null

    if (panel === "screener") {
      return config.screenerItems()[index]?.symbol ?? null
    } else {
      return config.positionItems()[index]?.underlying ?? null
    }
  }

  const getSelectedInstrument = (): string | null => {
    if (focusedPanel() !== "positions") return null

    const sel = selection()
    const posIndex = sel.positions
    if (posIndex === null || sel.instrumentIndex === null) return null

    const position = config.positionItems()[posIndex]
    return position.instruments[sel.instrumentIndex]?.symbol ?? null
  }

  const isExpanded = (underlying: string): boolean => {
    return expandedUnderlyings().has(underlying)
  }

  const toggleExpand = () => {
    if (focusedPanel() !== "positions") return

    const sel = selection()
    const posIndex = sel.positions
    if (posIndex === null) return

    const posItems = config.positionItems()
    const position = posItems[posIndex]
    const underlying = position.underlying
    const isCurrentlyExpanded = expandedUnderlyings().has(underlying)

    if (isCurrentlyExpanded) {
      setExpandedUnderlyings(
        prev => new Set([...prev].filter(u => u !== underlying)),
      )
      setRawSelection(s => ({ ...s, instrumentIndex: null }))
    } else {
      setExpandedUnderlyings(prev => new Set([...prev, underlying]))
    }
  }

  const adjustWeight = (delta: number) => {
    if (!onAdjustWeight) return
    if (focusedPanel() !== "positions") return

    const instrumentSymbol = getSelectedInstrument()
    if (!instrumentSymbol) return

    onAdjustWeight(instrumentSymbol, delta)
  }

  const triggerTrade = (side: "buy" | "sell") => {
    const symbol = getSelectedSymbol()
    if (symbol === null) return

    onAddTrade(symbol, side)
  }

  const handleEscape = () => {
    const panel = focusedPanel()
    if (panel === null) return

    const sel = selection()
    const currentSelection = sel[panel]

    if (currentSelection !== null) {
      setRawSelection(prev => ({ ...prev, [panel]: null }))
    } else {
      setFocusedPanel(null)
    }
  }

  return {
    focusedPanel,
    focusPanel,
    getSelectedIndex,
    moveSelection,
    triggerTrade,
    handleEscape,
    getSelectedSymbol,
    getSelectedInstrument,
    isExpanded,
    toggleExpand,
    adjustWeight,
  }
}
