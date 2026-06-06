import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  onCleanup,
  untrack,
  type JSX,
} from "solid-js"
import { ChevronLeft, ChevronRight } from "lucide-solid"

import { cn } from "@/lib/cn"
import { Button } from "@/components/ui/button"

interface CalendarProps {
  class?: string
  mode?: "single"
  selected?: Date
  onSelect?: (date: Date | undefined) => void
  captionLayout?: "label" | "dropdown"
  startMonth?: Date
  endMonth?: Date
  disabled?: Array<{ before: Date } | { after: Date }>
  showOutsideDays?: boolean
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const getDaysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate()

const getFirstDayOfMonth = (year: number, month: number) =>
  new Date(year, month, 1).getDay()

const isSameDay = (dateA: Date, dateB: Date) =>
  dateA.getFullYear() === dateB.getFullYear() &&
  dateA.getMonth() === dateB.getMonth() &&
  dateA.getDate() === dateB.getDate()

const toCalendarDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const isDateDisabled = (
  date: Date,
  disabled: Array<{ before: Date } | { after: Date }>,
) => {
  const normalized = toCalendarDay(date)
  return disabled.some(rule => {
    if ("before" in rule) return normalized < toCalendarDay(rule.before)
    if ("after" in rule) return normalized > toCalendarDay(rule.after)
    return false
  })
}

const clampToRange = (
  year: number,
  month: number,
  startMonth: Date | undefined,
  endMonth: Date | undefined,
): { year: number; month: number } => {
  if (startMonth) {
    const startYear = startMonth.getFullYear()
    const startMo = startMonth.getMonth()
    if (year < startYear || (year === startYear && month < startMo)) {
      return { year: startYear, month: startMo }
    }
  }
  if (endMonth) {
    const endYear = endMonth.getFullYear()
    const endMo = endMonth.getMonth()
    if (year > endYear || (year === endYear && month > endMo)) {
      return { year: endYear, month: endMo }
    }
  }
  return { year, month }
}

const Calendar = (props: CalendarProps): JSX.Element => {
  const clampedInitial = untrack(() => {
    const initial = props.selected ?? new Date()
    return clampToRange(
      initial.getFullYear(),
      initial.getMonth(),
      props.startMonth,
      props.endMonth,
    )
  })
  const [viewYear, setViewYear] = createSignal(clampedInitial.year)
  const [viewMonth, setViewMonth] = createSignal(clampedInitial.month)

  const showOutsideDays = () => props.showOutsideDays ?? true
  const isDropdown = () => props.captionLayout === "dropdown"

  const monthOptions = createMemo(() => {
    const startYear = props.startMonth?.getFullYear() ?? viewYear() - 10
    const startMo = props.startMonth?.getMonth() ?? 0
    const endYear = props.endMonth?.getFullYear() ?? viewYear() + 10
    const endMo = props.endMonth?.getMonth() ?? 11

    return Array.from({ length: 12 }, (_, month) => month).filter(month => {
      const tooEarly = viewYear() === startYear && month < startMo
      const tooLate = viewYear() === endYear && month > endMo
      return !tooEarly && !tooLate
    })
  })

  const yearOptions = createMemo(() => {
    const startYear = props.startMonth?.getFullYear() ?? viewYear() - 10
    const endYear = props.endMonth?.getFullYear() ?? viewYear() + 10
    return Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => startYear + index,
    )
  })

  const canGoBack = () => {
    if (!props.startMonth) return true
    return (
      viewYear() > props.startMonth.getFullYear() ||
      (viewYear() === props.startMonth.getFullYear() &&
        viewMonth() > props.startMonth.getMonth())
    )
  }

  const canGoForward = () => {
    if (!props.endMonth) return true
    return (
      viewYear() < props.endMonth.getFullYear() ||
      (viewYear() === props.endMonth.getFullYear() &&
        viewMonth() < props.endMonth.getMonth())
    )
  }

  const goToPrevMonth = () => {
    if (!canGoBack()) return
    if (viewMonth() === 0) {
      setViewMonth(11)
      setViewYear(prev => prev - 1)
    } else {
      setViewMonth(prev => prev - 1)
    }
  }

  const goToNextMonth = () => {
    if (!canGoForward()) return
    if (viewMonth() === 11) {
      setViewMonth(0)
      setViewYear(prev => prev + 1)
    } else {
      setViewMonth(prev => prev + 1)
    }
  }

  const calendarDays = createMemo(() => {
    const year = viewYear()
    const month = viewMonth()
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)

    const days: Array<{ date: Date | null; isOutside: boolean }> = []

    if (showOutsideDays()) {
      const prevMonthDays = getDaysInMonth(year, month - 1)
      for (let offset = firstDay - 1; offset >= 0; offset--) {
        days.push({
          date: new Date(year, month - 1, prevMonthDays - offset),
          isOutside: true,
        })
      }
    } else {
      for (let offset = 0; offset < firstDay; offset++) {
        days.push({ date: null, isOutside: true })
      }
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push({ date: new Date(year, month, day), isOutside: false })
    }

    const remaining = 7 - (days.length % 7)
    if (remaining < 7) {
      for (let offset = 1; offset <= remaining; offset++) {
        if (showOutsideDays()) {
          days.push({
            date: new Date(year, month + 1, offset),
            isOutside: true,
          })
        } else {
          days.push({ date: null, isOutside: true })
        }
      }
    }

    return days
  })

  const weeks = createMemo(() => {
    const allDays = calendarDays()
    const result: Array<typeof allDays> = []
    for (let weekStart = 0; weekStart < allDays.length; weekStart += 7) {
      result.push(allDays.slice(weekStart, weekStart + 7))
    }
    return result
  })

  const [today, setToday] = createSignal(new Date())
  const msUntilMidnight = () => {
    const now = new Date()
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    )
    return midnight.getTime() - now.getTime()
  }
  createEffect(() => {
    const timer = setTimeout(() => {
      setToday(new Date())
    }, msUntilMidnight())
    onCleanup(() => {
      clearTimeout(timer)
    })
  })

  return (
    <div data-slot="calendar" class={cn("bg-background p-3", props.class)}>
      <div class="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="icon"
          class="size-8 p-0"
          disabled={!canGoBack()}
          onClick={goToPrevMonth}
          aria-label="Previous month"
        >
          <ChevronLeft class="size-4" />
        </Button>

        <div class="flex items-center gap-1.5">
          <Show
            when={isDropdown()}
            fallback={
              <span class="text-sm font-medium select-none">
                {MONTH_LABELS[viewMonth()]} {viewYear()}
              </span>
            }
          >
            <div class="relative rounded-md border border-input shadow-xs">
              <select
                aria-label="Select month"
                class="appearance-none bg-transparent px-2 py-1 pr-6 text-sm font-medium cursor-pointer"
                value={viewMonth()}
                onChange={event =>
                  setViewMonth(Number(event.currentTarget.value))
                }
              >
                <For each={monthOptions()}>
                  {month => (
                    <option value={month}>{MONTH_LABELS[month]}</option>
                  )}
                </For>
              </select>
            </div>
            <div class="relative rounded-md border border-input shadow-xs">
              <select
                aria-label="Select year"
                class="appearance-none bg-transparent px-2 py-1 pr-6 text-sm font-medium cursor-pointer"
                value={viewYear()}
                onChange={event => {
                  const newYear = Number(event.currentTarget.value)
                  setViewYear(newYear)
                  const newMonthOptions = monthOptions()
                  if (!newMonthOptions.includes(viewMonth())) {
                    setViewMonth(newMonthOptions[0] ?? 0)
                  }
                }}
              >
                <For each={yearOptions()}>
                  {year => <option value={year}>{year}</option>}
                </For>
              </select>
            </div>
          </Show>
        </div>

        <Button
          variant="ghost"
          size="icon"
          class="size-8 p-0"
          disabled={!canGoForward()}
          onClick={goToNextMonth}
          aria-label="Next month"
        >
          <ChevronRight class="size-4" />
        </Button>
      </div>

      <div role="grid" class="grid grid-cols-7 gap-0">
        <div role="row" class="contents">
          <For each={WEEKDAY_LABELS}>
            {label => (
              <div
                role="columnheader"
                class="text-muted-foreground text-center text-[0.8rem] font-normal select-none py-1"
              >
                {label}
              </div>
            )}
          </For>
        </div>

        <For each={weeks()}>
          {week => (
            <div role="row" class="contents">
              <For each={week}>
                {day => {
                  if (!day.date) {
                    return <div role="gridcell" class="aspect-square" />
                  }

                  const date = day.date
                  const disabled = () =>
                    props.disabled
                      ? isDateDisabled(date, props.disabled)
                      : false
                  const selected = () =>
                    props.selected ? isSameDay(date, props.selected) : false
                  const isToday = () => isSameDay(date, today())
                  const dateLabel = () =>
                    date.toLocaleDateString(undefined, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })

                  return (
                    <Show
                      when={!day.isOutside || showOutsideDays()}
                      fallback={<div role="gridcell" class="aspect-square" />}
                    >
                      <div role="gridcell">
                        <button
                          type="button"
                          disabled={disabled()}
                          aria-selected={selected()}
                          aria-disabled={disabled()}
                          aria-label={dateLabel()}
                          tabIndex={selected() || isToday() ? 0 : -1}
                          class={cn(
                            "inline-flex aspect-square w-full items-center justify-center rounded-md text-sm font-normal transition-colors",
                            "hover:bg-accent hover:text-accent-foreground",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            "disabled:pointer-events-none disabled:opacity-50",
                            day.isOutside && "text-muted-foreground opacity-50",
                            selected() &&
                              "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                            isToday() &&
                              !selected() &&
                              "bg-accent text-accent-foreground",
                          )}
                          onClick={() => props.onSelect?.(date)}
                        >
                          {date.getDate()}
                        </button>
                      </div>
                    </Show>
                  )
                }}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

export { Calendar }
export type { CalendarProps }
