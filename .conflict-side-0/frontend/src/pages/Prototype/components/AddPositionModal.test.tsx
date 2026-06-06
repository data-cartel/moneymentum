import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { AddPositionModal } from "./AddPositionModal"

const mockInstruments = [
  {
    symbol: "SOL/USDC:USDC",
    type: "perp" as const,
    rate: 0.18,
    rateLabel: "funding",
  },
  { symbol: "SOL-SPOT", type: "spot" as const, rate: 0, rateLabel: "carry" },
]

const defaultProps = {
  isOpen: true,
  underlying: "SOL",
  instruments: mockInstruments,
  nav: 250000,
  currentLeverage: 1,
  onClose: vi.fn(),
  onAddPosition: vi.fn(),
}

describe("AddPositionModal", () => {
  describe("instrument selection step", () => {
    it("renders instrument options", () => {
      render(() => <AddPositionModal {...defaultProps} />)

      expect(screen.getByText("Add SOL Position")).toBeInTheDocument()
      expect(screen.getByText("SOL/USDC:USDC")).toBeInTheDocument()
      expect(screen.getByText("SOL-SPOT")).toBeInTheDocument()
    })

    it("shows rate for each instrument", () => {
      render(() => <AddPositionModal {...defaultProps} />)

      expect(screen.getByText("+18.0%")).toBeInTheDocument()
      expect(screen.getByText("0.0%")).toBeInTheDocument()
    })

    it("navigates with j/k keys", () => {
      render(() => <AddPositionModal {...defaultProps} />)

      const firstOption = screen
        .getByText("SOL/USDC:USDC")
        .closest("div[role='button']")
      expect(firstOption).toHaveClass("border-primary")

      fireEvent.keyDown(window, { key: "j" })

      const secondOption = screen
        .getByText("SOL-SPOT")
        .closest("div[role='button']")
      expect(secondOption).toHaveClass("border-primary")
    })

    it("selects instrument on Enter", () => {
      render(() => <AddPositionModal {...defaultProps} />)

      fireEvent.keyDown(window, { key: "Enter" })

      expect(screen.getByText(/Configure:/)).toBeInTheDocument()
    })

    it("closes on Escape", () => {
      const onClose = vi.fn()
      render(() => <AddPositionModal {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(window, { key: "Escape" })

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe("configuration step", () => {
    it("shows direction buttons", async () => {
      render(() => <AddPositionModal {...defaultProps} />)

      fireEvent.keyDown(window, { key: "Enter" })

      expect(screen.getByText("LONG")).toBeInTheDocument()
      expect(screen.getByText("SHORT")).toBeInTheDocument()
    })

    it("toggles direction on button click", async () => {
      render(() => <AddPositionModal {...defaultProps} />)

      fireEvent.keyDown(window, { key: "Enter" })

      const shortButton = screen.getByText("SHORT")
      await userEvent.click(shortButton)

      expect(shortButton).toHaveClass("bg-red-500/20")
    })

    it("switches between weight and notional modes", async () => {
      render(() => <AddPositionModal {...defaultProps} />)

      fireEvent.keyDown(window, { key: "Enter" })

      const weightButton = screen.getByText("Weight %")
      await userEvent.click(weightButton)

      expect(weightButton).toHaveClass("bg-primary")
    })

    it("updates preview when size changes", async () => {
      render(() => <AddPositionModal {...defaultProps} />)

      fireEvent.keyDown(window, { key: "Enter" })

      const input = screen.getByPlaceholderText("5000")
      await userEvent.clear(input)
      await userEvent.type(input, "10000")

      // toLocaleString() may format as "10,000" or "10 000" depending on locale
      const notionalCell = screen.getByText("Notional").parentElement
      expect(notionalCell).toHaveTextContent(/10[, ]?000|10\.0k/)
    })

    it("goes back on Escape", () => {
      render(() => <AddPositionModal {...defaultProps} />)

      fireEvent.keyDown(window, { key: "Enter" })
      expect(screen.getByText(/Configure:/)).toBeInTheDocument()

      fireEvent.keyDown(window, { key: "Escape" })
      expect(screen.getByText("Add SOL Position")).toBeInTheDocument()
    })

    it("calls onAddPosition with correct params", async () => {
      const onAddPosition = vi.fn()
      render(() => (
        <AddPositionModal {...defaultProps} onAddPosition={onAddPosition} />
      ))

      fireEvent.keyDown(window, { key: "Enter" })

      const input = screen.getByPlaceholderText("5000")
      await userEvent.clear(input)
      await userEvent.type(input, "25000")

      const addButton = screen.getByText("Add Position")
      await userEvent.click(addButton)

      expect(onAddPosition).toHaveBeenCalledWith({
        symbol: "SOL/USDC:USDC",
        direction: "long",
        weight: 0.1, // 25000 / (250000 * 1) = 0.1
      })
    })
  })

  describe("when closed", () => {
    it("renders nothing", () => {
      const { container } = render(() => (
        <AddPositionModal {...defaultProps} isOpen={false} />
      ))

      expect(container.firstChild).toBeNull()
    })
  })

  describe("weight calculation", () => {
    it("calculates weight from notional correctly", async () => {
      const onAddPosition = vi.fn()
      render(() => (
        <AddPositionModal
          {...defaultProps}
          nav={100000}
          currentLeverage={2}
          onAddPosition={onAddPosition}
        />
      ))

      fireEvent.keyDown(window, { key: "Enter" })

      const input = screen.getByPlaceholderText("5000")
      await userEvent.clear(input)
      await userEvent.type(input, "20000")

      await userEvent.click(screen.getByText("Add Position"))

      // weight = 20000 / (100000 * 2) = 0.1
      expect(onAddPosition).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 0.1 }),
      )
    })

    it("calculates weight from percentage correctly", async () => {
      const onAddPosition = vi.fn()
      render(() => (
        <AddPositionModal {...defaultProps} onAddPosition={onAddPosition} />
      ))

      fireEvent.keyDown(window, { key: "Enter" })

      await userEvent.click(screen.getByText("Weight %"))

      const input = screen.getByPlaceholderText("2.0")
      await userEvent.clear(input)
      await userEvent.type(input, "5")

      await userEvent.click(screen.getByText("Add Position"))

      expect(onAddPosition).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 0.05 }),
      )
    })
  })
})
