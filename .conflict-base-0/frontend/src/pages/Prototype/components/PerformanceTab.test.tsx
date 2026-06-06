import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { PerformanceTab } from "./PerformanceTab"
import type {
  BacktestPoint,
  DrawdownPoint,
  ReturnDistributionBucket,
  PerformanceStats,
} from "../mockData"

// Mock lightweight-charts since it requires DOM manipulation
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
}))

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

describe("PerformanceTab", () => {
  const now = Math.floor(Date.now() / 1000)

  const mockBacktestData: BacktestPoint[] = Array.from(
    { length: 30 },
    (_, i) => ({
      time: now - (30 - i) * 24 * 60 * 60,
      value: 10000 + i * 100,
    }),
  )

  const mockDrawdownData: DrawdownPoint[] = mockBacktestData.map(
    (point, i) => ({
      time: point.time,
      drawdown: -0.01 * (i % 5),
    }),
  )

  const mockReturnDistribution: ReturnDistributionBucket[] = [
    { bucket: -0.02, frequency: 5 },
    { bucket: -0.01, frequency: 10 },
    { bucket: 0, frequency: 15 },
    { bucket: 0.01, frequency: 12 },
    { bucket: 0.02, frequency: 8 },
  ]

  const mockPerformanceStats: PerformanceStats = {
    totalReturn: 0.25,
    sharpeRatio: 1.5,
    maxDrawdown: -0.15,
    sortinoRatio: 2.0,
    winRate: 0.55,
    profitFactor: 1.8,
  }

  const defaultProps = {
    backtestData: mockBacktestData,
    drawdownData: mockDrawdownData,
    returnDistribution: mockReturnDistribution,
    performanceStats: mockPerformanceStats,
    hasStagedTrades: false,
    isFocused: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("rendering", () => {
    it("renders the performance tab", () => {
      render(() => <PerformanceTab {...defaultProps} />)
      expect(screen.getByTestId("performance-tab")).toBeInTheDocument()
    })

    it("displays chart type buttons", () => {
      render(() => <PerformanceTab {...defaultProps} />)
      expect(screen.getByText("Equity")).toBeInTheDocument()
      expect(screen.getByText("Drawdown")).toBeInTheDocument()
      expect(screen.getByText("Distribution")).toBeInTheDocument()
    })

    it("displays period buttons", () => {
      render(() => <PerformanceTab {...defaultProps} />)
      expect(screen.getByText("1M")).toBeInTheDocument()
      expect(screen.getByText("3M")).toBeInTheDocument()
      expect(screen.getByText("6M")).toBeInTheDocument()
      expect(screen.getByText("1Y")).toBeInTheDocument()
      expect(screen.getByText("All")).toBeInTheDocument()
    })

    it("displays performance stats", () => {
      render(() => <PerformanceTab {...defaultProps} />)
      expect(screen.getByText("Return")).toBeInTheDocument()
      expect(screen.getByText("Sharpe")).toBeInTheDocument()
      expect(screen.getByText("Sortino")).toBeInTheDocument()
      expect(screen.getByText("Max DD")).toBeInTheDocument()
      expect(screen.getByText("Win Rate")).toBeInTheDocument()
      expect(screen.getByText("Profit")).toBeInTheDocument()
      expect(screen.getByText("Calmar")).toBeInTheDocument()
    })

    it("formats positive return with + sign", () => {
      render(() => <PerformanceTab {...defaultProps} />)
      expect(screen.getByText("+25.0%")).toBeInTheDocument()
    })

    it("formats sharpe ratio to 2 decimal places", () => {
      render(() => <PerformanceTab {...defaultProps} />)
      expect(screen.getByText("1.50")).toBeInTheDocument()
    })
  })

  describe("chart type switching", () => {
    it("switches to Equity when clicking Equity button", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} />)

      await user.click(screen.getByText("Drawdown"))
      await user.click(screen.getByText("Equity"))

      // Button should be highlighted (has bg-primary class)
      const equityButton = screen.getByText("Equity").closest("button")
      expect(equityButton?.className).toContain("bg-primary")
    })

    it("switches to Drawdown when clicking Drawdown button", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} />)

      await user.click(screen.getByText("Drawdown"))

      const drawdownButton = screen.getByText("Drawdown").closest("button")
      expect(drawdownButton?.className).toContain("bg-primary")
    })

    it("switches to Distribution when clicking Distribution button", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} />)

      await user.click(screen.getByText("Distribution"))

      const distButton = screen.getByText("Distribution").closest("button")
      expect(distButton?.className).toContain("bg-primary")
    })
  })

  describe("keyboard navigation when focused", () => {
    it("switches chart type with 1 key", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      // First switch away from equity
      await user.keyboard("2")
      // Then switch back to equity
      await user.keyboard("1")

      const equityButton = screen.getByText("Equity").closest("button")
      expect(equityButton?.className).toContain("bg-primary")
    })

    it("switches chart type with 2 key", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("2")

      const drawdownButton = screen.getByText("Drawdown").closest("button")
      expect(drawdownButton?.className).toContain("bg-primary")
    })

    it("switches chart type with 3 key", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("3")

      const distButton = screen.getByText("Distribution").closest("button")
      expect(distButton?.className).toContain("bg-primary")
    })

    it("changes period with q key (1M)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("q")

      const monthButton = screen.getByText("1M").closest("button")
      expect(monthButton?.className).toContain("bg-muted")
    })

    it("changes period with w key (3M)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("w")

      const button = screen.getByText("3M").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("changes period with e key (6M)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("e")

      const button = screen.getByText("6M").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("changes period with r key (1Y)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("r")

      const button = screen.getByText("1Y").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("changes period with t key (All)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      // First change to something else
      await user.keyboard("q")
      // Then change to All
      await user.keyboard("t")

      const button = screen.getByText("All").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("navigates periods with ArrowLeft", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      // Default is "All", move left to 1Y
      await user.keyboard("{ArrowLeft}")

      const button = screen.getByText("1Y").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("navigates periods with ArrowRight", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      // First go to 1M
      await user.keyboard("q")
      // Then go right to 3M
      await user.keyboard("{ArrowRight}")

      const button = screen.getByText("3M").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("navigates periods with h key (left)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("h")

      const button = screen.getByText("1Y").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("navigates periods with l key (right)", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("q") // Go to 1M
      await user.keyboard("l") // Go right to 3M

      const button = screen.getByText("3M").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("does not go below first period", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("q") // Go to 1M
      await user.keyboard("{ArrowLeft}") // Try to go before 1M
      await user.keyboard("{ArrowLeft}")

      const button = screen.getByText("1M").closest("button")
      expect(button?.className).toContain("bg-muted")
    })

    it("does not go beyond last period", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      await user.keyboard("{ArrowRight}") // Already at All, try to go right
      await user.keyboard("{ArrowRight}")

      const button = screen.getByText("All").closest("button")
      expect(button?.className).toContain("bg-muted")
    })
  })

  describe("comparison mode", () => {
    it("does not show comparison mode when no staged trades", () => {
      render(() => <PerformanceTab {...defaultProps} hasStagedTrades={false} />)

      expect(screen.queryByText("current")).not.toBeInTheDocument()
      expect(screen.queryByText("target")).not.toBeInTheDocument()
      expect(screen.queryByText("compare")).not.toBeInTheDocument()
    })

    it("shows comparison mode buttons when has staged trades", () => {
      render(() => <PerformanceTab {...defaultProps} hasStagedTrades={true} />)

      expect(screen.getByText("current")).toBeInTheDocument()
      expect(screen.getByText("target")).toBeInTheDocument()
      expect(screen.getByText("compare")).toBeInTheDocument()
    })

    it("cycles comparison mode with c key", async () => {
      const user = userEvent.setup()
      render(() => (
        <PerformanceTab
          {...defaultProps}
          hasStagedTrades={true}
          isFocused={true}
        />
      ))

      // Default is 'current'
      const currentButton = screen.getByText("current").closest("button")
      expect(currentButton?.className).toContain("bg-primary")

      // Press c to go to target
      await user.keyboard("c")

      const targetButton = screen.getByText("target").closest("button")
      expect(targetButton?.className).toContain("bg-primary")

      // Press c to go to compare
      await user.keyboard("c")

      const compareButton = screen.getByText("compare").closest("button")
      expect(compareButton?.className).toContain("bg-primary")

      // Press c to cycle back to current
      await user.keyboard("c")

      expect(currentButton?.className).toContain("bg-primary")
    })

    it("does not respond to c key when no staged trades", async () => {
      const user = userEvent.setup()
      render(() => (
        <PerformanceTab
          {...defaultProps}
          hasStagedTrades={false}
          isFocused={true}
        />
      ))

      // Press c - should not show comparison buttons
      await user.keyboard("c")

      expect(screen.queryByText("current")).not.toBeInTheDocument()
    })

    it("clicking comparison mode button switches mode", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} hasStagedTrades={true} />)

      await user.click(screen.getByText("target"))

      const targetButton = screen.getByText("target").closest("button")
      expect(targetButton?.className).toContain("bg-primary")
    })
  })

  describe("not focused", () => {
    it("does not respond to keyboard when not focused", async () => {
      const user = userEvent.setup()
      render(() => <PerformanceTab {...defaultProps} isFocused={false} />)

      await user.keyboard("2")

      // Should still be on equity
      const equityButton = screen.getByText("Equity").closest("button")
      expect(equityButton?.className).toContain("bg-primary")
    })
  })

  describe("focus ring", () => {
    it("shows focus ring when focused", () => {
      render(() => <PerformanceTab {...defaultProps} isFocused={true} />)

      const tab = screen.getByTestId("performance-tab")
      expect(tab.className).toContain("ring-1")
    })

    it("does not show focus ring when not focused", () => {
      render(() => <PerformanceTab {...defaultProps} isFocused={false} />)

      const tab = screen.getByTestId("performance-tab")
      expect(tab.className).not.toContain("ring-1")
    })
  })

  describe("keyboard hints when focused", () => {
    it("shows number hints next to chart type buttons when focused", () => {
      const { container } = render(() => (
        <PerformanceTab {...defaultProps} isFocused={true} />
      ))

      // Check for the number hints in the chart type buttons
      const buttons = container.querySelectorAll("button")
      const equityButton = Array.from(buttons).find(b =>
        b.textContent?.includes("Equity"),
      )
      expect(equityButton?.textContent).toContain("1")
    })

    it("shows arrow hints next to period buttons when focused", () => {
      const { container } = render(() => (
        <PerformanceTab {...defaultProps} isFocused={true} />
      ))

      // The arrows hint should be visible
      expect(container.textContent).toContain("←→")
    })
  })
})
