/**
 * Portfolio keyboard workflow tests (acceptance gate).
 *
 * Exercises the keyboard controller with a mocked Dockview activate callback
 * and light panel DOM, without mounting the full Dockview shell.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library"
import { createSignal, For, type JSX } from "solid-js"

import {
  PortfolioHotkeyBar,
  PortfolioKeyboardProvider,
  PORTFOLIO_CELL_ATTR,
  PORTFOLIO_PANEL_ATTR,
  PORTFOLIO_SYMBOL_ATTR,
  ALL_SYMBOLS_SEARCH_ATTR,
  STAGED_PIN_ATTR,
  usePortfolioKeyboardContext,
  type PortfolioKeyboardActions,
  type KeyboardPanelId,
} from "./index"
import type { StagedConnectionState } from "../components/StagedChangesPanel"
import type { OrderSide } from "@/hooks/useTrading"

const activatePanel = vi.fn<(panelId: KeyboardPanelId) => void>()
const onRemove = vi.fn()
const onUndoRemove = vi.fn()
const onSideChange = vi.fn()
const onLeverageChange = vi.fn()
const onCrossAccountLeverageChange = vi.fn()
const onAllSymbolEnter = vi.fn()
const onStagedSubmit = vi.fn()
const onStagedClearAll = vi.fn()
const onOpenWalletPinDialog = vi.fn()

const [pinDialogOpen, setPinDialogOpen] = createSignal(false)
const [connectionState, setConnectionState] =
  createSignal<StagedConnectionState>("ready")
const [portfolioSymbols, setPortfolioSymbols] = createSignal([
  "BTC",
  "ETH",
  "SOL",
])
const [allSymbols, setAllSymbols] = createSignal(["BTC", "ETH", "SOL", "DOGE"])
const [sides, setSides] = createSignal<Record<string, OrderSide>>({
  BTC: "buy",
  ETH: "buy",
  SOL: "sell",
})
const [leverages, setLeverages] = createSignal<Record<string, number>>({
  BTC: 2,
  ETH: 3,
  SOL: 1,
})
const [crossAccountLeverage, setCrossAccountLeverage] = createSignal(1)
const [closing, setClosing] = createSignal<Record<string, boolean>>({})

const buildActions = (): PortfolioKeyboardActions => ({
  activatePanel: panelId => {
    activatePanel(panelId)
  },
  getPortfolioSymbols: () => portfolioSymbols(),
  getAllSymbolSymbols: () => allSymbols(),
  isPinDialogOpen: () => pinDialogOpen(),
  connectionState: () => connectionState(),
  onRemove,
  onUndoRemove,
  onSideChange,
  onLeverageChange,
  getPositionSide: symbol => sides()[symbol],
  getPositionLeverage: symbol => leverages()[symbol],
  getMaxLeverage: () => 20,
  getCrossAccountLeverage: () => crossAccountLeverage(),
  onCrossAccountLeverageChange: leverage => {
    setCrossAccountLeverage(leverage)
    onCrossAccountLeverageChange(leverage)
  },
  isPositionClosing: symbol => closing()[symbol] ?? false,
  onAllSymbolEnter,
  onStagedSubmit,
  onStagedClearAll,
  onOpenWalletPinDialog,
})

const SelectionProbe = () => {
  const keyboard = usePortfolioKeyboardContext()
  return (
    <div>
      <div data-testid="focused-panel">{keyboard.focusedPanel()}</div>
      <div data-testid="selected-symbol">
        {keyboard.selectedPortfolioSymbol() ?? "none"}
      </div>
      <div data-testid="selected-all-index">
        {keyboard.selectedAllSymbolsIndex() ?? "none"}
      </div>
      <div data-testid="leverage-symbol">
        {keyboard.leverageEditorSymbol() ?? "none"}
      </div>
      <PortfolioHotkeyBar focusedPanel={keyboard.focusedPanel()} />
    </div>
  )
}

const Harness = (props: { children?: JSX.Element }) => (
  <PortfolioKeyboardProvider actions={buildActions()}>
    <div
      tabIndex={0}
      {...{ [PORTFOLIO_PANEL_ATTR]: "portfolio" }}
      data-testid="portfolio-panel"
    >
      <For each={portfolioSymbols()}>
        {symbol => (
          <div data-portfolio-row={symbol}>
            <input
              {...{
                [PORTFOLIO_CELL_ATTR]: "weight",
                [PORTFOLIO_SYMBOL_ATTR]: symbol,
              }}
              defaultValue="10"
              aria-label={`${symbol} weight`}
            />
            <input
              {...{
                [PORTFOLIO_CELL_ATTR]: "notional",
                [PORTFOLIO_SYMBOL_ATTR]: symbol,
              }}
              defaultValue="100"
              aria-label={`${symbol} notional`}
            />
          </div>
        )}
      </For>
    </div>
    <div
      tabIndex={0}
      {...{ [PORTFOLIO_PANEL_ATTR]: "allSymbols" }}
      data-testid="all-symbols-panel"
    >
      <input
        {...{ [ALL_SYMBOLS_SEARCH_ATTR]: "" }}
        aria-label="Search symbols"
        defaultValue=""
      />
    </div>
    <div
      tabIndex={0}
      {...{ [PORTFOLIO_PANEL_ATTR]: "staged" }}
      data-testid="staged-panel"
    >
      <input
        {...{ [STAGED_PIN_ATTR]: "" }}
        aria-label="Enter PIN"
        defaultValue=""
      />
    </div>
    <SelectionProbe />
    {props.children}
  </PortfolioKeyboardProvider>
)

describe("portfolio keyboard workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPinDialogOpen(false)
    setConnectionState("ready")
    setPortfolioSymbols(["BTC", "ETH", "SOL"])
    setAllSymbols(["BTC", "ETH", "SOL", "DOGE"])
    setSides({ BTC: "buy", ETH: "buy", SOL: "sell" })
    setLeverages({ BTC: 2, ETH: 3, SOL: 1 })
    setCrossAccountLeverage(1)
    setClosing({})
  })

  afterEach(() => {
    cleanup()
  })

  it("activates panels with 1 2 3 and ignores repeat", () => {
    render(() => <Harness />)

    fireEvent.keyDown(window, { key: "2" })
    expect(activatePanel).toHaveBeenCalledWith("allSymbols")
    expect(screen.getByTestId("focused-panel").textContent).toBe("allSymbols")

    activatePanel.mockClear()
    fireEvent.keyDown(window, { key: "2" })
    expect(activatePanel).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: "3" })
    expect(activatePanel).toHaveBeenCalledWith("staged")
    expect(screen.getByTestId("focused-panel").textContent).toBe("staged")

    fireEvent.keyDown(window, { key: "1" })
    expect(activatePanel).toHaveBeenCalledWith("portfolio")
  })

  it("navigates portfolio rows with j/k and restores selection", () => {
    render(() => <Harness />)

    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("BTC")

    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("ETH")

    fireEvent.keyDown(window, { key: "k" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("BTC")

    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("ETH")

    fireEvent.keyDown(window, { key: "2" })
    fireEvent.keyDown(window, { key: "1" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("ETH")
  })

  it("focuses weight and notional with w and n", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("BTC")

    fireEvent.keyDown(window, { key: "w" })
    expect(document.activeElement).toBe(screen.getByLabelText("BTC weight"))

    fireEvent.keyDown(screen.getByLabelText("BTC weight"), { key: "Escape" })
    fireEvent.keyDown(window, { key: "n" })
    expect(document.activeElement).toBe(screen.getByLabelText("BTC notional"))
  })

  it("suppresses panel digits while an input is focused", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "w" })
    activatePanel.mockClear()

    fireEvent.keyDown(screen.getByLabelText("BTC weight"), { key: "2" })
    expect(activatePanel).not.toHaveBeenCalled()
    expect(screen.getByTestId("focused-panel").textContent).toBe("portfolio")
  })

  it("toggles side with t and delete with d", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "t" })
    expect(onSideChange).toHaveBeenCalledWith("BTC", "sell")

    fireEvent.keyDown(window, { key: "d" })
    expect(onRemove).toHaveBeenCalledWith("BTC")

    setClosing({ BTC: true })
    fireEvent.keyDown(window, { key: "d" })
    expect(onUndoRemove).toHaveBeenCalledWith("BTC")
  })

  it("opens leverage with l and steps with brackets", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "l" })
    expect(screen.getByTestId("leverage-symbol").textContent).toBe("BTC")

    fireEvent.keyDown(window, { key: "]" })
    expect(onLeverageChange).toHaveBeenCalledWith("BTC", 3)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.getByTestId("leverage-symbol").textContent).toBe("none")
  })

  it("steps cross-account leverage with Shift+brackets", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "1" })

    fireEvent.keyDown(window, {
      key: "}",
      code: "BracketRight",
      shiftKey: true,
    })
    expect(onCrossAccountLeverageChange).toHaveBeenCalledWith(1.1)

    fireEvent.keyDown(window, {
      key: "{",
      code: "BracketLeft",
      shiftKey: true,
    })
    expect(onCrossAccountLeverageChange).toHaveBeenCalledWith(1)

    setPortfolioSymbols([])
    onCrossAccountLeverageChange.mockClear()
    fireEvent.keyDown(window, {
      key: "}",
      code: "BracketRight",
      shiftKey: true,
    })
    expect(onCrossAccountLeverageChange).toHaveBeenCalledWith(1.1)
  })

  it("navigates all symbols and Enter toggles", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "2" })
    expect(screen.getByTestId("selected-all-index").textContent).toBe("0")

    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("selected-all-index").textContent).toBe("1")

    fireEvent.keyDown(window, { key: "Enter" })
    expect(onAllSymbolEnter).toHaveBeenCalledWith("ETH")
  })

  it("focuses search with s and keeps query on Escape", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "2" })
    const search = screen.getByLabelText("Search symbols")
    fireEvent.input(search, { target: { value: "btc" } })
    fireEvent.keyDown(window, { key: "s" })
    expect(document.activeElement).toBe(search)

    fireEvent.keyDown(search, { key: "Escape" })
    expect(search).toHaveProperty("value", "btc")
    expect(document.activeElement).not.toBe(search)
  })

  it("submits staged with mod+Enter and clears with mod+shift+backspace", () => {
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "3" })

    fireEvent.keyDown(window, { key: "Enter", metaKey: true })
    expect(onStagedSubmit).toHaveBeenCalled()

    fireEvent.keyDown(window, {
      key: "Backspace",
      metaKey: true,
      shiftKey: true,
    })
    expect(onStagedClearAll).toHaveBeenCalled()
  })

  it("opens wallet pin dialog on mod+Enter when agent missing", () => {
    setConnectionState("agentMissing")
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "3" })
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })
    expect(onOpenWalletPinDialog).toHaveBeenCalled()
    expect(onStagedSubmit).not.toHaveBeenCalled()
  })

  it("opens wallet pin dialog on mod+Enter when wallet disconnected from any panel", () => {
    setConnectionState("walletDisconnected")
    render(() => <Harness />)

    fireEvent.keyDown(window, { key: "1" })
    fireEvent.keyDown(window, { key: "w" })
    expect(document.activeElement).toBe(screen.getByLabelText("BTC weight"))

    fireEvent.keyDown(screen.getByLabelText("BTC weight"), { key: "Escape" })
    fireEvent.keyDown(window, { key: "t" })
    expect(onSideChange).toHaveBeenCalledWith("BTC", "sell")

    fireEvent.keyDown(window, { key: "Enter", metaKey: true })
    expect(onOpenWalletPinDialog).toHaveBeenCalled()
    expect(onStagedSubmit).not.toHaveBeenCalled()
  })

  it("allows portfolio edits without a trading agent", () => {
    setConnectionState("agentMissing")
    render(() => <Harness />)

    fireEvent.keyDown(window, { key: "2" })
    expect(activatePanel).toHaveBeenCalledWith("allSymbols")

    fireEvent.keyDown(window, { key: "1" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("BTC")
    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("selected-symbol").textContent).toBe("ETH")

    fireEvent.keyDown(window, { key: "w" })
    expect(document.activeElement).toBe(screen.getByLabelText("ETH weight"))

    fireEvent.keyDown(screen.getByLabelText("ETH weight"), { key: "Escape" })
    fireEvent.keyDown(window, { key: "t" })
    expect(onSideChange).toHaveBeenCalledWith("ETH", "sell")

    fireEvent.keyDown(window, { key: "l" })
    fireEvent.keyDown(window, { key: "Escape" })
    fireEvent.keyDown(window, { key: "d" })
    expect(onRemove).toHaveBeenCalledWith("ETH")
  })

  it("no-ops portfolio keys when empty", () => {
    setPortfolioSymbols([])
    render(() => <Harness />)
    fireEvent.keyDown(window, { key: "1" })
    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "w" })
    fireEvent.keyDown(window, { key: "d" })
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByTestId("selected-symbol").textContent).toBe("none")
  })

  it("swaps hotkey bar content with focused panel", () => {
    render(() => <Harness />)
    const bar = screen.getByTestId("portfolio-hotkey-bar")
    expect(bar.textContent).toContain("weight")

    fireEvent.keyDown(window, { key: "2" })
    expect(bar.textContent).toContain("search")
    expect(bar.textContent).not.toContain("weight")

    fireEvent.keyDown(window, { key: "3" })
    expect(bar.textContent).toContain("rebalance")
  })
})
