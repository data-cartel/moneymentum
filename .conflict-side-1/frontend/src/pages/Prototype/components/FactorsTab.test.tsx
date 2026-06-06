import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { FactorsTab } from "./FactorsTab"
import type {
  FactorExposure,
  FactorHistoricalReturn,
  FactorAttribution,
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
  LineSeries: {},
}))

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

describe("FactorsTab", () => {
  const now = Math.floor(Date.now() / 1000)

  const mockFactorExposures: FactorExposure[] = [
    { name: "Market Beta", value: 0.85, color: "#3b82f6" },
    { name: "Momentum", value: 0.42, color: "#22c55e" },
    { name: "Carry", value: -0.15, color: "#f59e0b" },
    { name: "Volatility", value: 0.28, color: "#ef4444" },
    { name: "Size", value: -0.1, color: "#8b5cf6" },
  ]

  const mockFactorHistoricalReturns: FactorHistoricalReturn[] = [
    { factor: "Market Beta", date: now - 86400, value: 1.01 },
    { factor: "Market Beta", date: now, value: 1.02 },
    { factor: "Momentum", date: now - 86400, value: 1.005 },
    { factor: "Momentum", date: now, value: 1.015 },
    { factor: "Carry", date: now - 86400, value: 0.998 },
    { factor: "Carry", date: now, value: 1.001 },
    { factor: "Volatility", date: now - 86400, value: 0.995 },
    { factor: "Volatility", date: now, value: 0.99 },
    { factor: "Size", date: now - 86400, value: 1.002 },
    { factor: "Size", date: now, value: 1.008 },
  ]

  const mockFactorAttribution: FactorAttribution[] = [
    { factor: "Market Beta", contribution: 0.15, color: "#3b82f6" },
    { factor: "Momentum", contribution: 0.08, color: "#22c55e" },
    { factor: "Carry", contribution: -0.02, color: "#f59e0b" },
    { factor: "Volatility", contribution: 0.03, color: "#ef4444" },
    { factor: "Idiosyncratic", contribution: 0.05, color: "#888" },
  ]

  const defaultProps = {
    factorExposures: mockFactorExposures,
    factorHistoricalReturns: mockFactorHistoricalReturns,
    factorAttribution: mockFactorAttribution,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("view mode switching", () => {
    it("renders exposures view by default", () => {
      render(() => <FactorsTab {...defaultProps} />)

      // Should show exposures content
      expect(screen.getByText("Market Beta")).toBeInTheDocument()
      expect(screen.getByText("Momentum")).toBeInTheDocument()
      expect(screen.getByText("Carry")).toBeInTheDocument()
    })

    it("shows view mode buttons", () => {
      render(() => <FactorsTab {...defaultProps} />)

      expect(screen.getByText("exposures")).toBeInTheDocument()
      expect(screen.getByText("performance")).toBeInTheDocument()
      expect(screen.getByText("attribution")).toBeInTheDocument()
    })

    it("switches to exposures view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      // First switch to performance
      await user.click(screen.getByText("performance"))
      // Then back to exposures
      await user.click(screen.getByText("exposures"))

      const button = screen.getByText("exposures").closest("button")
      expect(button?.className).toContain("bg-primary")
    })

    it("switches to performance view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      const button = screen.getByText("performance").closest("button")
      expect(button?.className).toContain("bg-primary")
    })

    it("switches to attribution view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      const button = screen.getByText("attribution").closest("button")
      expect(button?.className).toContain("bg-primary")
    })
  })

  describe("exposures view", () => {
    it("displays factor names", () => {
      render(() => <FactorsTab {...defaultProps} />)

      for (const factor of mockFactorExposures) {
        expect(screen.getByText(factor.name)).toBeInTheDocument()
      }
    })

    it("displays factor values", () => {
      render(() => <FactorsTab {...defaultProps} />)

      // Check for formatted values
      expect(screen.getByText("+0.85")).toBeInTheDocument()
      expect(screen.getByText("+0.42")).toBeInTheDocument()
      expect(screen.getByText("-0.15")).toBeInTheDocument()
    })

    it("shows positive values with + prefix", () => {
      render(() => <FactorsTab {...defaultProps} />)

      expect(screen.getByText("+0.85")).toBeInTheDocument()
    })

    it("shows negative values with - prefix", () => {
      render(() => <FactorsTab {...defaultProps} />)

      expect(screen.getByText("-0.15")).toBeInTheDocument()
    })
  })

  describe("simulation feature in exposures view", () => {
    it("shows simulation dropdown", () => {
      render(() => <FactorsTab {...defaultProps} />)

      expect(screen.getByText("Simulate:")).toBeInTheDocument()
      expect(screen.getByRole("combobox")).toBeInTheDocument()
    })

    it("has None as default simulation option", () => {
      render(() => <FactorsTab {...defaultProps} />)

      const select = screen.getByRole("combobox")
      expect(select).toHaveValue("")
    })

    it("shows available factors in simulation dropdown", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      const select = screen.getByRole("combobox")
      await user.click(select)

      // Options should include factor names
      const options = within(select).getAllByRole("option")
      expect(options.length).toBeGreaterThan(1) // None + factors
    })

    it("shows projected impact when simulation is selected", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      const select = screen.getByRole("combobox")
      await user.selectOptions(select, "Momentum")

      expect(screen.getByText("Projected Impact")).toBeInTheDocument()
    })

    it("shows delta changes when simulating", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      const select = screen.getByRole("combobox")
      await user.selectOptions(select, "Momentum")

      // Should show deltas (values in parentheses)
      expect(screen.getByText(/\+0\.10\)/)).toBeInTheDocument()
    })
  })

  describe("performance view", () => {
    it("shows factor buttons for selection", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      // Factor selection buttons should be visible
      expect(screen.getByText("Beta")).toBeInTheDocument() // "Market Beta" shortened
      expect(screen.getByText("Momentum")).toBeInTheDocument()
    })

    it("has two factors selected by default", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      // Default selection is Momentum and Market Beta
      // These buttons should have colored background
      const momentumButton = screen.getByText("Momentum").closest("button")
      expect(momentumButton?.style.backgroundColor).toBeTruthy()
    })

    it("toggles factor selection when clicking", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      // Click Carry to select it (will deselect one of the defaults)
      const carryButton = screen.getByText("Carry")
      await user.click(carryButton)

      // Carry should now be selected (have a colored background)
      expect(carryButton.closest("button")?.style.backgroundColor).toBeTruthy()
    })

    it("limits selection to 2 factors", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      // Default: Momentum and Market Beta selected
      // Click Carry - this should replace one of them
      await user.click(screen.getByText("Carry"))
      // Click Volatility - this should replace another
      await user.click(screen.getByText("Volatility"))

      // Count selected factors (those with colored background)
      const buttons = screen
        .getAllByRole("button")
        .filter(b => b.style.backgroundColor)
      // View mode buttons + 2 selected factor buttons
      const selectedFactors = buttons.filter(b => {
        const text = b.textContent ?? ""
        return (
          text.includes("Momentum") ||
          text.includes("Beta") ||
          text.includes("Carry") ||
          text.includes("Volatility") ||
          text.includes("Size")
        )
      })
      expect(selectedFactors.length).toBeLessThanOrEqual(2)
    })

    it("can deselect a factor", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      // Click Momentum to deselect it
      const momentumButton = screen.getByText("Momentum")
      await user.click(momentumButton)

      // Momentum should be deselected (no colored background)
      const buttonStyle =
        momentumButton.closest("button")?.style.backgroundColor ?? ""
      expect(buttonStyle).toBeFalsy()
    })
  })

  describe("attribution view", () => {
    it("displays factor attribution", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      for (const attr of mockFactorAttribution) {
        expect(screen.getByText(attr.factor)).toBeInTheDocument()
      }
    })

    it("shows contribution percentages", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      // Check for formatted contributions
      expect(screen.getByText("+15.0%")).toBeInTheDocument()
      expect(screen.getByText("+8.0%")).toBeInTheDocument()
      expect(screen.getByText("-2.0%")).toBeInTheDocument()
    })

    it("shows total return explained", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      expect(screen.getByText("Total Return Explained")).toBeInTheDocument()
      // Total: 0.15 + 0.08 - 0.02 + 0.03 + 0.05 = 0.29 = 29.0%
      expect(screen.getByText("+29.0%")).toBeInTheDocument()
    })

    it("displays positive contributions in green", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      const positiveValue = screen.getByText("+15.0%")
      expect(positiveValue.className).toContain("text-green")
    })

    it("displays negative contributions in red", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      const negativeValue = screen.getByText("-2.0%")
      expect(negativeValue.className).toContain("text-red")
    })
  })

  describe("simulation does not show in other views", () => {
    it("does not show simulation dropdown in performance view", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("performance"))

      expect(screen.queryByText("Simulate:")).not.toBeInTheDocument()
    })

    it("does not show simulation dropdown in attribution view", async () => {
      const user = userEvent.setup()
      render(() => <FactorsTab {...defaultProps} />)

      await user.click(screen.getByText("attribution"))

      expect(screen.queryByText("Simulate:")).not.toBeInTheDocument()
    })
  })
})
