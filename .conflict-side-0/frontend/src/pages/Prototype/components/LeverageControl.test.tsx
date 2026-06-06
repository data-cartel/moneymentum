import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { LeverageControl } from "./LeverageControl"

describe("LeverageControl", () => {
  it("displays the effective leverage value", () => {
    render(() => (
      <LeverageControl
        leverage={1.0}
        effectiveLeverage={0.8}
        onLeverageChange={() => {}}
      />
    ))

    expect(screen.getByText("0.80x")).toBeInTheDocument()
  })

  it("calls onLeverageChange when slider is moved", () => {
    const handleChange = vi.fn()
    render(() => (
      <LeverageControl
        leverage={1.0}
        effectiveLeverage={0.8}
        onLeverageChange={handleChange}
      />
    ))

    const slider = screen.getByRole("slider")
    fireEvent.input(slider, { target: { value: "2.0" } })

    expect(handleChange).toHaveBeenCalledWith(2.0)
  })

  it("slider reflects current leverage value", () => {
    render(() => (
      <LeverageControl
        leverage={2.5}
        effectiveLeverage={2.0}
        onLeverageChange={() => {}}
      />
    ))

    const slider = screen.getByRole("slider")
    expect(slider).toHaveValue("2.5")
  })

  describe("keyboard navigation", () => {
    it("increases leverage on ArrowRight", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowRight}")

      expect(handleChange).toHaveBeenCalledWith(1.1)
    })

    it("decreases leverage on ArrowLeft", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowLeft}")

      expect(handleChange).toHaveBeenCalledWith(0.9)
    })

    it("increases leverage on ] (vim-style)", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("]")

      expect(handleChange).toHaveBeenCalledWith(1.1)
    })

    it("decreases leverage on [ (vim-style)", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{[}")

      expect(handleChange).toHaveBeenCalledWith(0.9)
    })

    it("uses 0.5x step with Shift modifier", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}")

      expect(handleChange).toHaveBeenCalledWith(1.5)
    })

    it("clamps leverage to minimum of 0.1", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={0.1}
          effectiveLeverage={0.08}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowLeft}")

      expect(handleChange).toHaveBeenCalledWith(0.1)
    })

    it("clamps leverage to maximum of 5", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={5.0}
          effectiveLeverage={4.0}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowRight}")

      expect(handleChange).toHaveBeenCalledWith(5.0)
    })

    it("is focusable with tab", async () => {
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={() => {}}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      expect(container).toHaveAttribute("tabIndex", "0")
    })
  })

  describe("isActive prop", () => {
    it("ignores keyboard when isActive=false", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
          isActive={false}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowRight}")

      expect(handleChange).not.toHaveBeenCalled()
    })

    it("handles keyboard when isActive=true", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
          isActive={true}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowRight}")

      expect(handleChange).toHaveBeenCalledWith(1.1)
    })

    it("handles keyboard when isActive=undefined (default)", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{ArrowRight}")

      expect(handleChange).toHaveBeenCalledWith(1.1)
    })

    it("ignores bracket keys when isActive=false", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
          isActive={false}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("]")

      expect(handleChange).not.toHaveBeenCalled()
    })

    it("ignores vim keys h/l when isActive=false", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
          isActive={false}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("l")

      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe("direct value input", () => {
    it("enters edit mode when Enter is pressed", async () => {
      const user = userEvent.setup()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={() => {}}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("{Enter}")

      expect(screen.getByTestId("leverage-input")).toBeInTheDocument()
    })

    it("enters edit mode when e is pressed", async () => {
      const user = userEvent.setup()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={() => {}}
        />
      ))

      const container = screen.getByTestId("leverage-control")
      container.focus()
      await user.keyboard("e")

      expect(screen.getByTestId("leverage-input")).toBeInTheDocument()
    })

    it("enters edit mode when clicking on display", async () => {
      const user = userEvent.setup()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={() => {}}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))

      expect(screen.getByTestId("leverage-input")).toBeInTheDocument()
    })

    it("commits value on Enter", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))
      await user.clear(screen.getByTestId("leverage-input"))
      await user.type(screen.getByTestId("leverage-input"), "2.5{Enter}")

      expect(handleChange).toHaveBeenCalledWith(2.5)
      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId("leverage-input")).not.toBeInTheDocument()
      expect(screen.getByTestId("leverage-display")).toBeInTheDocument()
    })

    it("cancels edit on Escape without committing", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))
      await user.clear(screen.getByTestId("leverage-input"))
      await user.type(screen.getByTestId("leverage-input"), "2.5{Escape}")

      expect(handleChange).not.toHaveBeenCalled()
      expect(screen.getByTestId("leverage-display")).toBeInTheDocument()
    })

    it("clamps value to min/max range", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))
      await user.clear(screen.getByTestId("leverage-input"))
      await user.type(screen.getByTestId("leverage-input"), "10{Enter}")

      expect(handleChange).toHaveBeenCalledWith(5.0) // max is 5
    })

    it("clamps negative value to minimum", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))
      await user.clear(screen.getByTestId("leverage-input"))
      await user.type(screen.getByTestId("leverage-input"), "-1{Enter}")

      expect(handleChange).toHaveBeenCalledWith(0.1) // min is 0.1
    })

    it("ignores invalid input", async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(() => (
        <LeverageControl
          leverage={1.0}
          effectiveLeverage={0.8}
          onLeverageChange={handleChange}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))
      await user.clear(screen.getByTestId("leverage-input"))
      await user.type(screen.getByTestId("leverage-input"), "abc{Enter}")

      expect(handleChange).not.toHaveBeenCalled()
    })

    it("pre-fills input with current leverage value", async () => {
      const user = userEvent.setup()
      render(() => (
        <LeverageControl
          leverage={2.5}
          effectiveLeverage={2.0}
          onLeverageChange={() => {}}
        />
      ))

      await user.click(screen.getByTestId("leverage-display"))

      expect(screen.getByTestId("leverage-input")).toHaveValue("2.5")
    })
  })
})
