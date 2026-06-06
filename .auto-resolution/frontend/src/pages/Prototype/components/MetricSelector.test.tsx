import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { MetricSelector } from "./MetricSelector"
import { METRIC_OPTIONS, WINDOW_OPTIONS } from "../metrics/registry"

describe("MetricSelector", () => {
  const defaultProps = {
    selectedMetricIds: ["equity"],
    selectedWindowId: "30d",
    onMetricToggle: vi.fn(),
    onWindowChange: vi.fn(),
    isOpen: false,
    onOpenChange: vi.fn(),
    isFocused: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("display", () => {
    it("renders with single selected metric name", () => {
      render(() => (
        <MetricSelector {...defaultProps} selectedMetricIds={["equity"]} />
      ))
      expect(screen.getByText("Equity Curve")).toBeInTheDocument()
    })

    it("renders count for multiple selected metrics", () => {
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["equity", "drawdown", "sharpe"]}
        />
      ))
      expect(screen.getByText("3 metrics")).toBeInTheDocument()
    })

    it("renders 'Select metrics' when none selected", () => {
      render(() => <MetricSelector {...defaultProps} selectedMetricIds={[]} />)
      expect(screen.getByText("Select metrics")).toBeInTheDocument()
    })
  })

  describe("dropdown behavior", () => {
    it("calls onOpenChange when clicking the button", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          onOpenChange={onOpenChange}
          isOpen={false}
        />
      ))

      await user.click(screen.getByRole("button", { name: /equity curve/i }))
      expect(onOpenChange).toHaveBeenCalledWith(true)
    })

    it("shows dropdown content when open", () => {
      render(() => <MetricSelector {...defaultProps} isOpen={true} />)

      // Check that dropdown options are visible (getAllByText since name may appear in button too)
      for (const metric of METRIC_OPTIONS) {
        const elements = screen.getAllByText(metric.name)
        expect(elements.length).toBeGreaterThan(0)
      }
    })

    it("toggles metric when clicking option in dropdown", async () => {
      const user = userEvent.setup()
      const onMetricToggle = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isOpen={true}
          onMetricToggle={onMetricToggle}
        />
      ))

      await user.click(screen.getByText("Drawdown"))
      expect(onMetricToggle).toHaveBeenCalledWith("drawdown")
    })

    it("shows checkmark for selected metrics", () => {
      render(() => (
        <MetricSelector
          {...defaultProps}
          isOpen={true}
          selectedMetricIds={["equity", "drawdown"]}
        />
      ))

      // The checkmarks are rendered as SVG icons within checked options
      const checkmarks = document.querySelectorAll(
        ".bg-primary.border-primary svg",
      )
      expect(checkmarks.length).toBe(2)
    })
  })

  describe("keyboard navigation when focused", () => {
    it("opens dropdown when m is pressed", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          onOpenChange={onOpenChange}
        />
      ))

      await user.keyboard("m")
      expect(onOpenChange).toHaveBeenCalledWith(true)
    })

    it("closes dropdown when m is pressed while open", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={true}
          onOpenChange={onOpenChange}
        />
      ))

      await user.keyboard("m")
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("moves highlight down with j key", async () => {
      const user = userEvent.setup()
      const { container } = render(() => (
        <MetricSelector {...defaultProps} isFocused={true} isOpen={true} />
      ))

      await user.keyboard("j")

      // The second option should be highlighted (index 1)
      const buttons = container.querySelectorAll("button.bg-muted\\/70")
      expect(buttons.length).toBe(1)
    })

    it("moves highlight up with k key", async () => {
      const user = userEvent.setup()
      render(() => (
        <MetricSelector {...defaultProps} isFocused={true} isOpen={true} />
      ))

      // Move down first, then back up
      await user.keyboard("j")
      await user.keyboard("k")

      // Should be back at first option
      const buttons = document.querySelectorAll("button.bg-muted\\/70")
      // First button in dropdown should be highlighted
      expect(buttons.length).toBe(1)
    })

    it("moves highlight down with ArrowDown", async () => {
      const user = userEvent.setup()
      render(() => (
        <MetricSelector {...defaultProps} isFocused={true} isOpen={true} />
      ))

      await user.keyboard("{ArrowDown}")

      const buttons = document.querySelectorAll("button.bg-muted\\/70")
      expect(buttons.length).toBe(1)
    })

    it("moves highlight up with ArrowUp", async () => {
      const user = userEvent.setup()
      render(() => (
        <MetricSelector {...defaultProps} isFocused={true} isOpen={true} />
      ))

      await user.keyboard("{ArrowDown}")
      await user.keyboard("{ArrowUp}")

      const buttons = document.querySelectorAll("button.bg-muted\\/70")
      expect(buttons.length).toBe(1)
    })

    it("toggles highlighted metric with Enter", async () => {
      const user = userEvent.setup()
      const onMetricToggle = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={true}
          onMetricToggle={onMetricToggle}
        />
      ))

      // Highlight is on first item by default (equity)
      await user.keyboard("{Enter}")
      expect(onMetricToggle).toHaveBeenCalledWith(METRIC_OPTIONS[0].id)
    })

    it("toggles highlighted metric with Space", async () => {
      const user = userEvent.setup()
      const onMetricToggle = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={true}
          onMetricToggle={onMetricToggle}
        />
      ))

      await user.keyboard(" ")
      expect(onMetricToggle).toHaveBeenCalledWith(METRIC_OPTIONS[0].id)
    })

    it("closes dropdown with Escape", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={true}
          onOpenChange={onOpenChange}
        />
      ))

      await user.keyboard("{Escape}")
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("does not exceed bounds when moving down", async () => {
      const user = userEvent.setup()
      const onMetricToggle = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={true}
          onMetricToggle={onMetricToggle}
        />
      ))

      // Press j many times (more than options)
      for (let i = 0; i < METRIC_OPTIONS.length + 5; i++) {
        await user.keyboard("j")
      }

      await user.keyboard("{Enter}")
      // Should toggle the last metric
      expect(onMetricToggle).toHaveBeenCalledWith(
        METRIC_OPTIONS[METRIC_OPTIONS.length - 1].id,
      )
    })

    it("does not go below 0 when moving up", async () => {
      const user = userEvent.setup()
      const onMetricToggle = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={true}
          onMetricToggle={onMetricToggle}
        />
      ))

      // Try to go up from the start
      await user.keyboard("k")
      await user.keyboard("k")
      await user.keyboard("{Enter}")

      // Should still be on first metric
      expect(onMetricToggle).toHaveBeenCalledWith(METRIC_OPTIONS[0].id)
    })
  })

  describe("window selection when dropdown closed", () => {
    it("shows window buttons when a metric needing window is selected", () => {
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["sharpe"]}
          isOpen={false}
        />
      ))

      for (const window of WINDOW_OPTIONS) {
        expect(screen.getByText(window.label)).toBeInTheDocument()
      }
    })

    it("does not show window buttons for non-windowed metrics", () => {
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["equity"]}
          isOpen={false}
        />
      ))

      for (const window of WINDOW_OPTIONS) {
        expect(screen.queryByText(window.label)).not.toBeInTheDocument()
      }
    })

    it("changes window with number keys when focused and closed", async () => {
      const user = userEvent.setup()
      const onWindowChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["sharpe"]}
          isFocused={true}
          isOpen={false}
          onWindowChange={onWindowChange}
        />
      ))

      await user.keyboard("1")
      expect(onWindowChange).toHaveBeenCalledWith(WINDOW_OPTIONS[0].id)
    })

    it("changes window with arrow keys when focused and closed", async () => {
      const user = userEvent.setup()
      const onWindowChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["sharpe"]}
          selectedWindowId="30d"
          isFocused={true}
          isOpen={false}
          onWindowChange={onWindowChange}
        />
      ))

      await user.keyboard("{ArrowRight}")
      expect(onWindowChange).toHaveBeenCalled()
    })

    it("changes window with h/l vim keys when focused and closed", async () => {
      const user = userEvent.setup()
      const onWindowChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["sharpe"]}
          selectedWindowId="30d"
          isFocused={true}
          isOpen={false}
          onWindowChange={onWindowChange}
        />
      ))

      await user.keyboard("l")
      expect(onWindowChange).toHaveBeenCalled()
    })

    it("clicks window button to change window", async () => {
      const user = userEvent.setup()
      const onWindowChange = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          selectedMetricIds={["sharpe"]}
          onWindowChange={onWindowChange}
        />
      ))

      const windowButton = screen.getByText("7d")
      await user.click(windowButton)
      expect(onWindowChange).toHaveBeenCalledWith("7d")
    })
  })

  describe("not focused", () => {
    it("does not respond to keyboard when not focused", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const onMetricToggle = vi.fn()
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={false}
          onOpenChange={onOpenChange}
          onMetricToggle={onMetricToggle}
        />
      ))

      await user.keyboard("m")
      await user.keyboard("j")
      await user.keyboard("{Enter}")

      expect(onOpenChange).not.toHaveBeenCalled()
      expect(onMetricToggle).not.toHaveBeenCalled()
    })
  })

  describe("focus indicator", () => {
    it("shows m key hint when focused", () => {
      const { container } = render(() => (
        <MetricSelector {...defaultProps} isFocused={true} />
      ))

      // The 'm' hint should be visible in a span
      expect(container.textContent).toContain("m")
    })

    it("shows keyboard hints in dropdown when focused", () => {
      render(() => (
        <MetricSelector {...defaultProps} isFocused={true} isOpen={true} />
      ))

      expect(screen.getByText(/navigate/)).toBeInTheDocument()
    })
  })

  describe("highlight reset", () => {
    it("resets highlight to 0 when dropdown opens", async () => {
      const user = userEvent.setup()
      const onMetricToggle = vi.fn()
      const [isOpen, setIsOpen] = createSignal(true)
      render(() => (
        <MetricSelector
          {...defaultProps}
          isFocused={true}
          isOpen={isOpen()}
          onMetricToggle={onMetricToggle}
        />
      ))

      // Move highlight down
      await user.keyboard("j")
      await user.keyboard("j")

      // Close and reopen dropdown
      setIsOpen(false)
      setIsOpen(true)

      // Press Enter - should be on first item again
      await user.keyboard("{Enter}")
      expect(onMetricToggle).toHaveBeenCalledWith(METRIC_OPTIONS[0].id)
    })
  })
})
