import type { Column, Row, SortingFn } from "@tanstack/solid-table"
import { ArrowDown, ArrowUp } from "lucide-solid"
import { Show, type JSX } from "solid-js"

import { cn } from "@/lib/cn"

export const toggleColumnSort = <TData,>(column: Column<TData>): void => {
  const sorted = column.getIsSorted()
  if (!sorted) {
    column.toggleSorting(false)
    return
  }
  column.toggleSorting(sorted === "asc")
}

const SortIcon = <TData,>(props: {
  column: Column<TData>
  class?: string
}): JSX.Element => {
  const sorted = () => props.column.getIsSorted()
  const isActive = () => sorted() === "asc" || sorted() === "desc"

  return (
    <span
      class={cn(
        "inline-flex h-3 w-3 shrink-0 items-center justify-center",
        !isActive() && "opacity-0 transition-opacity group-hover:opacity-100",
        props.class,
      )}
    >
      <Show when={sorted() === "asc"} fallback={<ArrowDown class="h-3 w-3" />}>
        <ArrowUp class="h-3 w-3" />
      </Show>
    </span>
  )
}

export const createSortableHeader =
  <TData,>(
    label: string,
    align: "left" | "right" = "right",
    options?: { title?: string; ariaLabel?: string },
  ) =>
  (headerContext: { column: Column<TData> }): JSX.Element => {
    const iconPositionClass =
      align === "right"
        ? "absolute right-full top-1/2 mr-0.5 -translate-y-1/2"
        : "absolute left-full top-1/2 ml-0.5 -translate-y-1/2"

    return (
      <button
        type="button"
        title={options?.title}
        aria-label={options?.ariaLabel ?? `Sort by ${label}`}
        class="group relative inline-block max-w-full font-medium text-muted-foreground hover:text-foreground"
        onClick={() => {
          toggleColumnSort(headerContext.column)
        }}
      >
        <span class="whitespace-nowrap">{label}</span>
        <SortIcon column={headerContext.column} class={iconPositionClass} />
      </button>
    )
  }

const isSortedDesc = <TData,>(row: Row<TData>, columnId: string): boolean =>
  row
    .getAllCells()[0]
    ?.getContext()
    .table.getColumn(columnId)
    ?.getIsSorted() === "desc"

export const compareNullableNumbers = (
  left: number | null,
  right: number | null,
  isDesc: boolean,
): number => {
  if (left === null && right === null) return 0
  if (left === null) return isDesc ? -1 : 1
  if (right === null) return isDesc ? 1 : -1

  if (left === right) return 0
  return left > right ? 1 : -1
}

export const createNullableNumberSortFn =
  <TData,>(accessor: (row: TData) => number | null): SortingFn<TData> =>
  (rowA, rowB, columnId) =>
    compareNullableNumbers(
      accessor(rowA.original),
      accessor(rowB.original),
      isSortedDesc(rowA, columnId),
    )
