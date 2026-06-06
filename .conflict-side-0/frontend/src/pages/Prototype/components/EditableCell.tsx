import { createSignal, createEffect, Show, onCleanup } from "solid-js"
import { twMerge } from "tailwind-merge"
import { clsx } from "clsx"

type CellFormat = "percent" | "currency" | "number"
type EditState = "editing" | "viewing"

interface EditableCellProps {
  value: number
  format: CellFormat
  onCommit: (newValue: number) => void
  isSelected?: boolean
  editKey?: string
  directEdit?: boolean
  class?: string
}

const formatValue = (value: number, format: CellFormat): string => {
  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`
    case "currency":
      return value >= 1000
        ? `$${(value / 1000).toFixed(1)}k`
        : `$${value.toFixed(0)}`
    case "number":
      return value.toFixed(2)
  }
}

const parseInput = (input: string, format: CellFormat): number | null => {
  const cleaned = input.replace(/[$,%k]/gi, "").trim()
  const num = parseFloat(cleaned)
  if (isNaN(num)) return null

  switch (format) {
    case "percent":
      return num / 100
    case "currency":
      return input.toLowerCase().includes("k") ? num * 1000 : num
    case "number":
      return num
  }
}

export const EditableCell = (props: EditableCellProps) => {
  const [editState, setEditState] = createSignal<EditState>("viewing")
  const [inputValue, setInputValue] = createSignal("")
  const [seeded, setSeeded] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  const startEditing = (initialValue?: string) => {
    if (initialValue !== undefined) {
      setInputValue(initialValue)
      setSeeded(true)
    } else {
      setInputValue(
        props.format === "percent"
          ? (props.value * 100).toFixed(1)
          : props.format === "currency"
            ? props.value.toFixed(0)
            : props.value.toFixed(2),
      )
      setSeeded(false)
    }
    setEditState("editing")
  }

  const commitEdit = () => {
    const parsed = parseInput(inputValue(), props.format)
    if (parsed !== null && parsed !== props.value) {
      props.onCommit(parsed)
    }
    setEditState("viewing")
  }

  const cancelEdit = () => {
    setEditState("viewing")
  }

  // Imperative effect: programmatic focus and cursor placement cannot be
  // expressed declaratively -- the DOM input element must be focused and its
  // selection range set after SolidJS renders it into the DOM.
  createEffect(() => {
    if (editState() === "editing" && inputRef) {
      inputRef.focus()
      if (seeded()) {
        const length = inputRef.value.length
        inputRef.setSelectionRange(length, length)
      } else {
        inputRef.select()
      }
    }
  })

  // Imperative effect: registers a global keydown listener on `document` so
  // the selected cell can enter edit mode from anywhere on the page, not just
  // when the cell itself has DOM focus.
  createEffect(() => {
    const isSelected = props.isSelected ?? false
    if (!isSelected || editState() === "editing") return
    if (!props.editKey && !props.directEdit) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (event.key.toLowerCase() === props.editKey?.toLowerCase()) {
        event.preventDefault()
        startEditing()
        return
      }

      if (
        props.directEdit &&
        /^[0-9.]$/.test(event.key) &&
        !["1", "2", "3", "4"].includes(event.key)
      ) {
        event.preventDefault()
        startEditing(event.key)
        return
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown)
    })
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commitEdit()
    } else if (event.key === "Escape") {
      event.preventDefault()
      cancelEdit()
    }
  }

  return (
    <Show
      when={editState() === "editing"}
      fallback={
        <button
          type="button"
          onClick={event => {
            event.stopPropagation()
            startEditing()
          }}
          class={twMerge(
            clsx(
              "cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded inline-flex items-center gap-1",
              "border-b border-dashed border-muted-foreground/40 hover:border-primary/60",
              "bg-transparent text-inherit font-inherit text-left",
              (props.isSelected ?? false) && "bg-primary/20 border-primary/60",
            ),
            props.class,
          )}
        >
          {formatValue(props.value, props.format)}
          <Show when={(props.isSelected ?? false) && props.editKey}>
            <kbd class="text-[8px] px-1 py-0.5 bg-muted/60 rounded font-mono text-muted-foreground">
              {props.editKey}
            </kbd>
          </Show>
        </button>
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={inputValue()}
        onInput={event => {
          setInputValue(event.currentTarget.value)
        }}
        onKeyDown={handleKeyDown}
        onBlur={commitEdit}
        class={twMerge(
          clsx(
            "w-full bg-muted border border-primary rounded px-1 py-0.5 text-right font-mono",
            "focus:outline-none focus:ring-1 focus:ring-primary",
          ),
          props.class,
        )}
      />
    </Show>
  )
}
