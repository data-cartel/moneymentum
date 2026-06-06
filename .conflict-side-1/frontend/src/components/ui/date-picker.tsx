import { createSignal, createUniqueId, type JSX } from "solid-js"
import { ChevronDown } from "lucide-solid"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface Calendar22Props {
  label: string
  selected?: Date | null
  onChange?: (date: Date | null) => void
  minDate?: Date
  maxDate?: Date
}

const normalizeToDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const Calendar22 = (props: Calendar22Props): JSX.Element => {
  const pickerId = createUniqueId()
  const [open, setOpen] = createSignal(false)

  const disabledDays = () => [
    ...(props.minDate ? [{ before: props.minDate }] : []),
    ...(props.maxDate ? [{ after: props.maxDate }] : []),
  ]

  const normalizedSelected = () =>
    props.selected ? normalizeToDay(props.selected) : undefined

  return (
    <div class="flex flex-col gap-3">
      <Label for={pickerId} class="px-1">
        {props.label}
      </Label>
      <Popover open={open()} onOpenChange={setOpen} placement="bottom-start">
        <PopoverTrigger
          as={Button}
          variant="outline"
          id={pickerId}
          class="w-48 justify-between font-normal"
        >
          {(() => {
            const selected = normalizedSelected()
            return selected
              ? selected.toLocaleDateString("ru-RU")
              : "Select date"
          })()}
          <ChevronDown />
        </PopoverTrigger>
        <PopoverContent class="w-auto overflow-hidden p-0">
          <Calendar
            mode="single"
            selected={normalizedSelected()}
            captionLayout="dropdown"
            startMonth={props.minDate}
            endMonth={props.maxDate}
            onSelect={date => {
              props.onChange?.(date ? normalizeToDay(date) : null)
              setOpen(false)
            }}
            disabled={disabledDays()}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
