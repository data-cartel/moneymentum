import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

export type Timeframe = "1h" | "15m"

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1h": "1 hour",
  "15m": "15 minutes",
}

const TIMEFRAME_OPTIONS: Timeframe[] = ["1h", "15m"]

interface TimeframeSelectProps {
  value: Timeframe
  onValueChange: (value: Timeframe) => void
  class?: string
}

export const TimeframeSelect = (props: TimeframeSelectProps) => {
  return (
    <Select<Timeframe>
      options={TIMEFRAME_OPTIONS}
      value={props.value}
      onChange={value => {
        if (value) props.onValueChange(value)
      }}
      itemComponent={itemProps => (
        <SelectItem item={itemProps.item}>
          {TIMEFRAME_LABELS[itemProps.item.rawValue]}
        </SelectItem>
      )}
    >
      <SelectTrigger class={props.class}>
        <SelectValue<Timeframe>>
          {state => TIMEFRAME_LABELS[state.selectedOption()]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
  )
}
