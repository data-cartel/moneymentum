import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { EditableCell } from "./EditableCell"

describe("EditableCell", () => {
  describe("display formatting", () => {
    it("formats percent values", () => {
      render(() => (
        <EditableCell value={0.125} format="percent" onCommit={vi.fn()} />
      ))
      expect(screen.getByText("12.5%")).toBeInTheDocument()
    })

    it("formats currency values in thousands", () => {
      render(() => (
        <EditableCell value={5000} format="currency" onCommit={vi.fn()} />
      ))
      expect(screen.getByText("$5.0k")).toBeInTheDocument()
    })

    it("formats small currency values without k suffix", () => {
      render(() => (
        <EditableCell value={500} format="currency" onCommit={vi.fn()} />
      ))
      expect(screen.getByText("$500")).toBeInTheDocument()
    })

    it("formats number values", () => {
      render(() => (
        <EditableCell value={1.234} format="number" onCommit={vi.fn()} />
      ))
      expect(screen.getByText("1.23")).toBeInTheDocument()
    })
  })

  describe("click to edit", () => {
    it("enters edit mode on click", async () => {
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={vi.fn()} />
      ))

      await userEvent.click(screen.getByText("10.0%"))

      expect(screen.getByRole("textbox")).toBeInTheDocument()
    })

    it("pre-fills input with current value", async () => {
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={vi.fn()} />
      ))

      await userEvent.click(screen.getByText("10.0%"))

      expect(screen.getByRole("textbox")).toHaveValue("10.0")
    })

    it("commits on Enter", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("10.0%"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "15{Enter}")

      expect(onCommit).toHaveBeenCalledWith(0.15)
    })

    it("cancels on Escape without committing", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("10.0%"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "15{Escape}")

      expect(onCommit).not.toHaveBeenCalled()
      expect(screen.getByText("10.0%")).toBeInTheDocument()
    })

    it("commits on blur", async () => {
      const onCommit = vi.fn()
      render(() => (
        <div>
          <EditableCell value={0.1} format="percent" onCommit={onCommit} />
          <button type="button">other</button>
        </div>
      ))

      await userEvent.click(screen.getByText("10.0%"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "20")
      await userEvent.click(screen.getByText("other"))

      expect(onCommit).toHaveBeenCalledWith(0.2)
    })
  })

  describe("keyboard shortcut to edit", () => {
    it("enters edit mode when editKey is pressed while selected", async () => {
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={vi.fn()}
          isSelected={true}
          editKey="w"
        />
      ))

      fireEvent.keyDown(document, { key: "w" })

      expect(screen.getByRole("textbox")).toBeInTheDocument()
    })

    it("does not enter edit mode when not selected", () => {
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={vi.fn()}
          isSelected={false}
          editKey="w"
        />
      ))

      fireEvent.keyDown(document, { key: "w" })

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    })
  })

  describe("directEdit mode", () => {
    it("enters edit mode when typing a number (5-9) while selected with directEdit", () => {
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={vi.fn()}
          isSelected={true}
          directEdit
        />
      ))

      fireEvent.keyDown(document, { key: "5" })

      expect(screen.getByRole("textbox")).toBeInTheDocument()
      expect(screen.getByRole("textbox")).toHaveValue("5")
    })

    it("does not enter edit mode for panel focus keys (1, 2, 3, 4)", () => {
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={vi.fn()}
          isSelected={true}
          directEdit
        />
      ))

      // Test key '1'
      fireEvent.keyDown(document, { key: "1" })
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()

      // Test key '4' (staged changes panel)
      fireEvent.keyDown(document, { key: "4" })
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    })

    it("enters edit mode when typing decimal point", () => {
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={vi.fn()}
          isSelected={true}
          directEdit
        />
      ))

      fireEvent.keyDown(document, { key: "." })

      expect(screen.getByRole("textbox")).toBeInTheDocument()
      expect(screen.getByRole("textbox")).toHaveValue(".")
    })

    it("does not enter edit mode when not selected", () => {
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={vi.fn()}
          isSelected={false}
          directEdit
        />
      ))

      fireEvent.keyDown(document, { key: "5" })

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    })

    it("allows full workflow: type number, continue typing, commit", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell
          value={0.1}
          format="percent"
          onCommit={onCommit}
          isSelected={true}
          directEdit
        />
      ))

      // Start by typing '5'
      fireEvent.keyDown(document, { key: "5" })
      expect(screen.getByRole("textbox")).toHaveValue("5")

      // Continue typing '0'
      await userEvent.type(screen.getByRole("textbox"), "0{Enter}")

      expect(onCommit).toHaveBeenCalledWith(0.5) // 50%
    })
  })

  describe("input parsing", () => {
    it("parses percent input without % symbol", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("10.0%"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "25{Enter}")

      expect(onCommit).toHaveBeenCalledWith(0.25)
    })

    it("parses currency input with k suffix", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={5000} format="currency" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("$5.0k"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "10k{Enter}")

      expect(onCommit).toHaveBeenCalledWith(10000)
    })

    it("parses currency input without k suffix", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={5000} format="currency" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("$5.0k"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "7500{Enter}")

      expect(onCommit).toHaveBeenCalledWith(7500)
    })

    it("does not commit invalid input", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("10.0%"))
      await userEvent.clear(screen.getByRole("textbox"))
      await userEvent.type(screen.getByRole("textbox"), "abc{Enter}")

      expect(onCommit).not.toHaveBeenCalled()
    })

    it("does not commit if value unchanged", async () => {
      const onCommit = vi.fn()
      render(() => (
        <EditableCell value={0.1} format="percent" onCommit={onCommit} />
      ))

      await userEvent.click(screen.getByText("10.0%"))
      await userEvent.type(screen.getByRole("textbox"), "{Enter}")

      expect(onCommit).not.toHaveBeenCalled()
    })
  })
})
