import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@solidjs/testing-library"
import { FactorConfigPanel } from "./FactorConfigPanel"
import type { FactorExposure } from "../mockData"

const mockFactors: FactorExposure[] = [
  { name: "β to BTC", value: 0.85, color: "hsl(var(--chart-1))" },
  { name: "β to SPY", value: 0.42, color: "hsl(var(--chart-2))" },
  { name: "Momentum", value: 0.28, color: "hsl(var(--chart-3))" },
]

describe("FactorConfigPanel", () => {
  const defaultProps = {
    factors: mockFactors,
    onClose: vi.fn(),
    onSave: vi.fn(),
  }

  it("displays existing factors", () => {
    render(() => <FactorConfigPanel {...defaultProps} />)

    expect(screen.getByText("β to BTC")).toBeInTheDocument()
    expect(screen.getByText("β to SPY")).toBeInTheDocument()
    expect(screen.getByText("Momentum")).toBeInTheDocument()
  })

  it("shows all benchmarks as toggles with active state", () => {
    render(() => <FactorConfigPanel {...defaultProps} />)

    // All benchmarks should be visible as toggles
    expect(screen.getByRole("button", { name: /BTC/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /SPY/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /ETH/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /QQQ/ })).toBeInTheDocument()
  })

  it("calls onSave and onClose when Done clicked", () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(() => (
      <FactorConfigPanel {...defaultProps} onSave={onSave} onClose={onClose} />
    ))

    fireEvent.click(screen.getByText("Done"))
    expect(onSave).toHaveBeenCalledWith(mockFactors)
    expect(onClose).toHaveBeenCalled()
  })

  it("removes factor when X clicked", () => {
    render(() => <FactorConfigPanel {...defaultProps} />)

    // Find the remove buttons (X icons) in the factor list
    const factorRow = screen.getByText("β to BTC").closest("div")
    const removeButton = factorRow?.querySelector("button")
    if (removeButton) {
      fireEvent.click(removeButton)
    }

    // After removing, the factor should no longer be in the list
    expect(screen.queryByText("β to BTC")).not.toBeInTheDocument()
  })

  it("toggles benchmark when quick toggle button clicked", () => {
    render(() => <FactorConfigPanel {...defaultProps} />)

    // ETH is not in the initial factors, click to add
    fireEvent.click(screen.getByRole("button", { name: /ETH/ }))

    // Now beta to ETH should be in the factors list
    expect(screen.getByText("β to ETH")).toBeInTheDocument()

    // Click again to remove
    fireEvent.click(screen.getByRole("button", { name: /ETH/ }))
    expect(screen.queryByText("β to ETH")).not.toBeInTheDocument()
  })
})
