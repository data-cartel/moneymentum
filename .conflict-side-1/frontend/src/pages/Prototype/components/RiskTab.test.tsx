import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { RiskTab } from "./RiskTab"
import type {
  RiskMetricsData,
  StressTest,
  MonteCarloDistribution,
  ConcentrationMetric,
  CorrelationEntry,
} from "../mockData"

describe("RiskTab", () => {
  const mockRiskMetrics: RiskMetricsData = {
    var95: -0.032,
    var99: -0.058,
    diversificationRatio: 1.45,
    effectiveBets: 3.2,
  }

  const mockStressTests: StressTest[] = [
    {
      scenario: "COVID March 2020",
      portfolioImpact: -0.35,
      btcImpact: -0.5,
      ethImpact: -0.6,
    },
    {
      scenario: "FTX Collapse",
      portfolioImpact: -0.22,
      btcImpact: -0.25,
      ethImpact: -0.3,
    },
    {
      scenario: "BTC -50%",
      portfolioImpact: -0.28,
      btcImpact: -0.5,
      ethImpact: -0.45,
    },
  ]

  const mockMonteCarloData: MonteCarloDistribution[] = [
    { bucket: -0.2, frequency: 10 },
    { bucket: -0.1, frequency: 50 },
    { bucket: 0, frequency: 100 },
    { bucket: 0.1, frequency: 80 },
    { bucket: 0.2, frequency: 30 },
  ]

  const mockConcentrationMetrics: ConcentrationMetric[] = [
    { metric: "Top Position", value: 0.225, description: "BTC" },
    { metric: "Top 3 Positions", value: 0.455, description: "BTC, ETH, SOL" },
    { metric: "Herfindahl Index", value: 0.12, description: "Concentration" },
  ]

  const mockCorrelationMatrix: CorrelationEntry[] = [
    { asset1: "BTC", asset2: "BTC", correlation: 1.0 },
    { asset1: "BTC", asset2: "ETH", correlation: 0.85 },
    { asset1: "BTC", asset2: "SOL", correlation: 0.72 },
    { asset1: "ETH", asset2: "BTC", correlation: 0.85 },
    { asset1: "ETH", asset2: "ETH", correlation: 1.0 },
    { asset1: "ETH", asset2: "SOL", correlation: 0.78 },
    { asset1: "SOL", asset2: "BTC", correlation: 0.72 },
    { asset1: "SOL", asset2: "ETH", correlation: 0.78 },
    { asset1: "SOL", asset2: "SOL", correlation: 1.0 },
  ]

  const mockCorrelationAssets = ["BTC", "ETH", "SOL"]

  const defaultProps = {
    riskMetrics: mockRiskMetrics,
    stressTests: mockStressTests,
    monteCarloData: mockMonteCarloData,
    concentrationMetrics: mockConcentrationMetrics,
    correlationMatrix: mockCorrelationMatrix,
    correlationAssets: mockCorrelationAssets,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("view mode switching", () => {
    it("renders VaR view by default", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(screen.getByText("Value at Risk (95%)")).toBeInTheDocument()
      expect(screen.getByText("Value at Risk (99%)")).toBeInTheDocument()
    })

    it("shows all view mode buttons", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(screen.getByText("VaR")).toBeInTheDocument()
      expect(screen.getByText("Stress")).toBeInTheDocument()
      expect(screen.getByText("Concentration")).toBeInTheDocument()
      expect(screen.getByText("Correlation")).toBeInTheDocument()
      expect(screen.getByText("Monte Carlo")).toBeInTheDocument()
    })

    it("switches to VaR view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Stress"))
      await user.click(screen.getByText("VaR"))

      const button = screen.getByText("VaR").closest("button")
      expect(button?.className).toContain("bg-primary")
    })

    it("switches to Stress view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Stress"))

      const button = screen.getByText("Stress").closest("button")
      expect(button?.className).toContain("bg-primary")
      expect(screen.getByText("COVID March 2020")).toBeInTheDocument()
    })

    it("switches to Concentration view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByRole("button", { name: "Concentration" }))

      const button = screen.getByRole("button", { name: "Concentration" })
      expect(button.className).toContain("bg-primary")
      expect(screen.getByText("Top Position")).toBeInTheDocument()
    })

    it("switches to Correlation view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Correlation"))

      const button = screen.getByText("Correlation").closest("button")
      expect(button?.className).toContain("bg-primary")
    })

    it("switches to Monte Carlo view when clicking button", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      const button = screen.getByText("Monte Carlo").closest("button")
      expect(button?.className).toContain("bg-primary")
    })
  })

  describe("VaR view", () => {
    it("displays VaR 95% value", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(screen.getByText("-3.2%")).toBeInTheDocument()
    })

    it("displays VaR 99% value", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(screen.getByText("-5.8%")).toBeInTheDocument()
    })

    it("displays diversification ratio", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(screen.getByText("Diversification Ratio")).toBeInTheDocument()
      expect(screen.getByText("1.45x")).toBeInTheDocument()
    })

    it("displays effective bets", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(screen.getByText("Effective Bets")).toBeInTheDocument()
      expect(screen.getByText("3.2")).toBeInTheDocument()
    })

    it("shows description for each metric", () => {
      render(() => <RiskTab {...defaultProps} />)

      expect(
        screen.getByText("95% confidence daily loss limit"),
      ).toBeInTheDocument()
      expect(
        screen.getByText("99% confidence daily loss limit"),
      ).toBeInTheDocument()
    })
  })

  describe("Stress view", () => {
    it("displays stress test table headers", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Stress"))

      expect(screen.getByText("Scenario")).toBeInTheDocument()
      expect(screen.getByText("Portfolio")).toBeInTheDocument()
      expect(screen.getByText("BTC")).toBeInTheDocument()
      expect(screen.getByText("ETH")).toBeInTheDocument()
    })

    it("displays stress test scenarios", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Stress"))

      for (const test of mockStressTests) {
        expect(screen.getByText(test.scenario)).toBeInTheDocument()
      }
    })

    it("displays portfolio impact in red for negative values", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Stress"))

      const negativeValue = screen.getByText("-35.0%")
      expect(negativeValue.className).toContain("text-red")
    })
  })

  describe("Concentration view", () => {
    it("displays concentration metrics", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Concentration"))

      for (const metric of mockConcentrationMetrics) {
        expect(screen.getByText(metric.metric)).toBeInTheDocument()
      }
    })

    it("displays metric descriptions", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Concentration"))

      expect(screen.getByText("BTC")).toBeInTheDocument()
      expect(screen.getByText("BTC, ETH, SOL")).toBeInTheDocument()
    })

    it("formats percentage values correctly", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Concentration"))

      // 0.225 = 22.5%
      expect(screen.getByText("22.5%")).toBeInTheDocument()
      // 0.455 = 45.5%
      expect(screen.getByText("45.5%")).toBeInTheDocument()
    })

    it("formats non-percentage values correctly", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Concentration"))

      // 0.12 <= 1 so displayed as percentage
      expect(screen.getByText("12.0%")).toBeInTheDocument()
    })
  })

  describe("Correlation view", () => {
    it("displays correlation matrix headers", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Correlation"))

      // Asset names should appear in headers
      const table = screen.getByRole("table")
      for (const asset of mockCorrelationAssets) {
        // Each asset appears multiple times (row header + column header)
        const cells = within(table).getAllByText(asset)
        expect(cells.length).toBeGreaterThanOrEqual(2)
      }
    })

    it("displays correlation values", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Correlation"))

      // Check for specific correlation values
      expect(screen.getAllByText("0.85").length).toBe(2) // BTC-ETH symmetric
      expect(screen.getAllByText("0.72").length).toBe(2) // BTC-SOL symmetric
      expect(screen.getAllByText("0.78").length).toBe(2) // ETH-SOL symmetric
    })

    it("displays diagonal values as 1.00", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Correlation"))

      // Diagonal should be 1.00
      expect(screen.getAllByText("1.00").length).toBe(3)
    })

    it("applies color coding based on correlation strength", async () => {
      const user = userEvent.setup()
      const { container } = render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Correlation"))

      // High correlations should have positive background (now uses semantic class)
      const highCorrCells = container.querySelectorAll(".bg-positive")
      expect(highCorrCells.length).toBeGreaterThan(0)
    })
  })

  describe("Monte Carlo view", () => {
    it("displays simulation controls", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      expect(screen.getByText("Sims:")).toBeInTheDocument()
      expect(screen.getByText("Horizon:")).toBeInTheDocument()
    })

    it("shows simulation count dropdown", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      const selects = screen.getAllByRole("combobox")
      const simsSelect = selects[0]
      expect(simsSelect).toHaveValue("1000") // Default
    })

    it("shows horizon dropdown", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      const selects = screen.getAllByRole("combobox")
      const horizonSelect = selects[1]
      expect(horizonSelect).toHaveValue("252") // Default (1Y)
    })

    it("simulation count select is disabled until compute pipeline is wired", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      const selects = screen.getAllByRole("combobox")
      expect(selects[0]).toBeDisabled()
    })

    it("horizon select is disabled until compute pipeline is wired", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      const selects = screen.getAllByRole("combobox")
      expect(selects[1]).toBeDisabled()
    })

    it("displays distribution chart", async () => {
      const user = userEvent.setup()
      const { container } = render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      // Should render histogram bars
      const bars = container.querySelectorAll("[style*='height']")
      expect(bars.length).toBeGreaterThan(0)
    })

    it("displays percentile values", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      expect(screen.getByText("5th %ile")).toBeInTheDocument()
      expect(screen.getByText("Median")).toBeInTheDocument()
      expect(screen.getByText("95th %ile")).toBeInTheDocument()
    })

    it("displays x-axis labels", async () => {
      const user = userEvent.setup()
      render(() => <RiskTab {...defaultProps} />)

      await user.click(screen.getByText("Monte Carlo"))

      expect(screen.getByText("-40%")).toBeInTheDocument()
      expect(screen.getByText("0")).toBeInTheDocument()
      expect(screen.getByText("+40%")).toBeInTheDocument()
    })
  })
})
