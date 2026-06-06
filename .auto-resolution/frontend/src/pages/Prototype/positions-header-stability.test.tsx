import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import PrototypePage from "./index"

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// Mock matchMedia
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

// Mock lightweight-charts
vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({
      setData: vi.fn(),
    })),
    timeScale: vi.fn(() => ({
      fitContent: vi.fn(),
      applyOptions: vi.fn(),
    })),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  })),
  AreaSeries: {},
  HistogramSeries: {},
  LineSeries: {},
}))

describe("Positions panel header stability", () => {
  it("header always shows 'POSITIONS' text regardless of selection", async () => {
    const user = userEvent.setup()
    render(() => <PrototypePage />)

    // Focus positions panel
    await user.keyboard("2")

    // Verify header shows POSITIONS
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()
    expect(screen.getByText(/underlying assets/)).toBeInTheDocument()

    // Navigate down through multiple positions
    await user.keyboard("j")
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()

    await user.keyboard("j")
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()

    await user.keyboard("j")
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()

    // Navigate up
    await user.keyboard("k")
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()

    await user.keyboard("k")
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()
  })

  it("header never shows 'Press' text when navigating positions", async () => {
    const user = userEvent.setup()
    render(() => <PrototypePage />)

    // Focus positions panel
    await user.keyboard("2")

    // Navigate through positions multiple times
    for (let i = 0; i < 5; i++) {
      await user.keyboard("j")
      // Header should never contain "Press" text
      const headerArea = screen.getByText("POSITIONS").parentElement
      expect(headerArea?.textContent).not.toContain("Press")
    }

    for (let i = 0; i < 5; i++) {
      await user.keyboard("k")
      const headerArea = screen.getByText("POSITIONS").parentElement
      expect(headerArea?.textContent).not.toContain("Press")
    }
  })

  it("header count remains stable during navigation", async () => {
    const user = userEvent.setup()
    render(() => <PrototypePage />)

    // Focus positions panel
    await user.keyboard("2")

    // Get initial count
    const initialCountText = screen.getByText(/\d+ underlying assets/)
    const initialCount = initialCountText.textContent

    // Navigate through positions
    await user.keyboard("j")
    expect(screen.getByText(/\d+ underlying assets/).textContent).toBe(
      initialCount,
    )

    await user.keyboard("j")
    expect(screen.getByText(/\d+ underlying assets/).textContent).toBe(
      initialCount,
    )

    await user.keyboard("k")
    expect(screen.getByText(/\d+ underlying assets/).textContent).toBe(
      initialCount,
    )
  })

  it("expanding and collapsing positions does not affect header", async () => {
    const user = userEvent.setup()
    render(() => <PrototypePage />)

    // Focus positions panel
    await user.keyboard("2")

    // Get initial header text
    const positionsText = screen.getByText("POSITIONS")
    expect(positionsText).toBeInTheDocument()

    // Navigate to a position and expand/collapse
    await user.keyboard("j")
    await user.keyboard("o") // toggle expand
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()

    await user.keyboard("o") // toggle collapse
    expect(screen.getByText("POSITIONS")).toBeInTheDocument()
  })

  it("shows visible edit key badge when instrument is selected (no need for title tooltip)", async () => {
    const user = userEvent.setup()
    render(() => <PrototypePage />)

    // Focus positions panel and expand BTC to show instruments
    await user.keyboard("2")
    await user.keyboard("j") // Navigate to BTC
    await user.keyboard("o") // Expand BTC

    // Navigate to an instrument row (PERP)
    await user.keyboard("j")

    // The 'w' badge should be visible next to the selected weight cell
    // This makes the title tooltip redundant
    const wBadges = screen.getAllByText("w")
    // At least one 'w' badge should be in the selected cell area
    expect(wBadges.length).toBeGreaterThan(0)
  })

  it("EditableCell should not have title attribute that causes tooltip flicker", async () => {
    const user = userEvent.setup()
    const { container } = render(() => <PrototypePage />)

    // Focus positions panel and expand BTC
    await user.keyboard("2")
    await user.keyboard("j")
    await user.keyboard("o")
    await user.keyboard("j") // Select PERP

    // Find editable cells - they should not have title attributes
    // The title attribute causes browser tooltips that can flash/flicker
    const editableCells = container.querySelectorAll('[title*="Press"]')
    expect(editableCells.length).toBe(0)
  })
})
