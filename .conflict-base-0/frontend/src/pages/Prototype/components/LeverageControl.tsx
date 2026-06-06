import { createSignal, createEffect, Show } from "solid-js"
import { getDirection } from "../utils/keys"

type EditState = "editing" | "viewing"

interface LeverageControlProps {
  leverage: number
  effectiveLeverage: number
  onLeverageChange: (value: number) => void
  isActive?: boolean
}

const MIN_LEVERAGE = 0.1
const MAX_LEVERAGE = 5
const SMALL_STEP = 0.1
const LARGE_STEP = 0.5

export const LeverageControl = (props: LeverageControlProps) => {
  const [editState, setEditState] = createSignal<EditState>("viewing")
  const [editValue, setEditValue] = createSignal("")
  let inputRef: HTMLInputElement | undefined

  createEffect(() => {
    if (editState() === "editing" && inputRef) {
      inputRef.focus()
      inputRef.select()
    }
  })

  const startEdit = () => {
    setEditValue(props.leverage.toFixed(1))
    setEditState("editing")
  }

  const commitEdit = () => {
    if (editState() !== "editing") return
    const parsed = parseFloat(editValue())
    if (!isNaN(parsed)) {
      const clamped = Math.max(MIN_LEVERAGE, Math.min(MAX_LEVERAGE, parsed))
      const rounded = Math.round(clamped * 10) / 10
      props.onLeverageChange(rounded)
    }
    setEditState("viewing")
  }

  const cancelEdit = () => {
    setEditState("viewing")
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (props.isActive === false) return
    if (editState() === "editing") return

    const step = event.shiftKey ? LARGE_STEP : SMALL_STEP
    const direction = getDirection(event.key)

    if (direction === "right" || event.key === "]") {
      event.preventDefault()
      event.stopPropagation()
      const newValue = Math.min(
        MAX_LEVERAGE,
        Math.round((props.leverage + step) * 10) / 10,
      )
      props.onLeverageChange(newValue)
      return
    }

    if (direction === "left" || event.key === "[") {
      event.preventDefault()
      event.stopPropagation()
      const newValue = Math.max(
        MIN_LEVERAGE,
        Math.round((props.leverage - step) * 10) / 10,
      )
      props.onLeverageChange(newValue)
      return
    }

    if (event.key === "Enter" || event.key === "e") {
      event.preventDefault()
      startEdit()
      return
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      commitEdit()
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
    }
  }

  return (
    <div
      data-testid="leverage-control"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      class="flex items-center gap-2 px-2 py-1.5 border-b border-border/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
    >
      <span class="text-muted-foreground">Leverage</span>
      <input
        type="range"
        min="0.1"
        max="5"
        step="0.1"
        value={props.leverage}
        onInput={event => {
          props.onLeverageChange(parseFloat(event.currentTarget.value))
        }}
        class="flex-1 h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
        tabIndex={-1}
      />
      <Show
        when={editState() === "editing"}
        fallback={
          <button
            type="button"
            class="font-mono w-12 text-right cursor-pointer hover:text-primary bg-transparent border-none text-inherit"
            onClick={startEdit}
            data-testid="leverage-display"
            aria-label={`Edit leverage, currently ${props.effectiveLeverage.toFixed(2)}x`}
          >
            {props.effectiveLeverage.toFixed(2)}x
          </button>
        }
      >
        <input
          ref={inputRef}
          type="text"
          value={editValue()}
          onInput={event => {
            setEditValue(event.currentTarget.value)
          }}
          onKeyDown={handleInputKeyDown}
          onBlur={commitEdit}
          class="font-mono w-12 text-right bg-muted border border-primary rounded px-1 focus:outline-none"
          data-testid="leverage-input"
        />
      </Show>
    </div>
  )
}
