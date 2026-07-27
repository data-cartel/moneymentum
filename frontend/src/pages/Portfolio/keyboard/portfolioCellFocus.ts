export const PORTFOLIO_CELL_ATTR = "data-portfolio-cell"
export const PORTFOLIO_SYMBOL_ATTR = "data-portfolio-symbol"
export const PORTFOLIO_PANEL_ATTR = "data-portfolio-panel"
export const ALL_SYMBOLS_SEARCH_ATTR = "data-all-symbols-search"
export const STAGED_PANEL_ATTR = "data-staged-panel"
export const STAGED_PIN_ATTR = "data-staged-pin"

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

export const focusAllSymbolsSearch = (): boolean => {
  const input = document.querySelector(`[${ALL_SYMBOLS_SEARCH_ATTR}]`)
  if (!(input instanceof HTMLInputElement)) {
    return false
  }

  input.focus()
  input.select()
  return true
}

export const focusStagedPin = (): boolean => {
  const input = document.querySelector(`[${STAGED_PIN_ATTR}]`)
  if (!(input instanceof HTMLInputElement)) {
    return false
  }

  input.focus()
  input.select()
  return true
}

export const blurActiveElement = (): void => {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    active.blur()
  }
}
