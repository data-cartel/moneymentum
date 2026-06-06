import { describe, it, expect, vi } from "vitest"
import { createSignal } from "solid-js"
import { render, screen } from "@solidjs/testing-library"
import { TimeframeSelect, type Timeframe } from "./timeframe-select"

describe("TimeframeSelect", () => {
  it("renders with the provided value", () => {
    const mockOnChange = vi.fn()
    render(() => <TimeframeSelect value="1h" onValueChange={mockOnChange} />)

    expect(screen.getByRole("button")).toBeInTheDocument()
  })

  it("displays the correct value for 1h", () => {
    const mockOnChange = vi.fn()
    render(() => <TimeframeSelect value="1h" onValueChange={mockOnChange} />)

    expect(screen.getByText("1 hour")).toBeInTheDocument()
  })

  it("displays the correct value for 15m", () => {
    const mockOnChange = vi.fn()
    render(() => <TimeframeSelect value="15m" onValueChange={mockOnChange} />)

    expect(screen.getByText("15 minutes")).toBeInTheDocument()
  })

  it("renders trigger with correct role", () => {
    const mockOnChange = vi.fn()
    render(() => <TimeframeSelect value="1h" onValueChange={mockOnChange} />)

    const trigger = screen.getByRole("button")
    expect(trigger).toBeInTheDocument()
    expect(screen.getByText("1 hour")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const mockOnChange = vi.fn()
    const customClass = "custom-test-class"

    render(() => (
      <TimeframeSelect
        value="1h"
        onValueChange={mockOnChange}
        class={customClass}
      />
    ))

    const trigger = screen.getByRole("button")
    expect(trigger.className).toContain(customClass)
  })

  it("updates displayed value when value prop changes", () => {
    const mockOnChange = vi.fn<(value: Timeframe) => void>()
    const [value, setValue] = createSignal<Timeframe>("1h")

    render(() => (
      <TimeframeSelect value={value()} onValueChange={mockOnChange} />
    ))
    expect(screen.getByText("1 hour")).toBeInTheDocument()

    setValue("15m")
    expect(screen.getByText("15 minutes")).toBeInTheDocument()
  })
})
