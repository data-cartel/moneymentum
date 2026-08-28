export const PORTFOLIO_CELL_ATTR = "data-portfolio-cell"
export const PORTFOLIO_SYMBOL_ATTR = "data-portfolio-symbol"
export const PORTFOLIO_PANEL_ATTR = "data-portfolio-panel"
export const ALL_SYMBOLS_SEARCH_ATTR = "data-all-symbols-search"
export const STAGED_PANEL_ATTR = "data-staged-panel"
export const STAGED_PIN_ATTR = "data-staged-pin"
export const DERIVE_PIN_ATTR = "data-derive-pin"

export type PortfolioCellKind = "weight" | "notional"

export const focusPortfolioCell = (
  symbol: string,
  cell: PortfolioCellKind,
): boolean => {
  const selector = `input[${PORTFOLIO_CELL_ATTR}="${cell}"][${PORTFOLIO_SYMBOL_ATTR}="${CSS.escape(symbol)}"]`
  const input = document.querySelector(selector)
  if (!(input instanceof HTMLInputElement)) {
    return false
  }

  input.focus()
  input.select()
  return true
}

export const focusPanelContainer = (panelId: string): void => {
  const container = document.querySelector(
    `[${PORTFOLIO_PANEL_ATTR}="${CSS.escape(panelId)}"]`,
  )
  if (container instanceof HTMLElement) {
    container.focus()
  }
}

const focusInputByAttribute = (attributeName: string): boolean => {
  const input = document.querySelector(`[${attributeName}]`)
  if (!(input instanceof HTMLInputElement)) {
    return false
  }

  input.focus()
  input.select()
  return true
}

export const focusAllSymbolsSearch = (): boolean =>
  focusInputByAttribute(ALL_SYMBOLS_SEARCH_ATTR)

export const focusStagedPin = (): boolean =>
  focusInputByAttribute(STAGED_PIN_ATTR)

export const focusDerivePin = (): boolean =>
  focusInputByAttribute(DERIVE_PIN_ATTR)

/** Defer PIN focus until after the staged panel mounts the unlock field. */
export const scheduleFocusStagedPin = (): void => {
  queueMicrotask(() => {
    focusStagedPin()
  })
}

export const blurActiveElement = (): void => {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    active.blur()
  }
}
