import type { ColumnDef, SortingState } from "@tanstack/solid-table"
import {
  createSolidTable,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/solid-table"
import { createVirtualizer, type VirtualItem } from "@tanstack/solid-virtual"
import { createSignal, For, Show, splitProps, type JSX } from "solid-js"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/cn"

const ESTIMATED_ROW_HEIGHT_PX = 34
const OVERSCAN_ROW_COUNT = 10
const TABLE_CONTAINER_HEIGHT_PX = 500

interface VirtualizedDataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  class?: string
}

export const VirtualizedDataTable = <TData, TValue>(
  props: VirtualizedDataTableProps<TData, TValue>,
): JSX.Element => {
  const [local] = splitProps(props, ["columns", "data", "class"])
  const [sorting, setSorting] = createSignal<SortingState>([])
  let tableContainerRef!: HTMLDivElement

  const table = createSolidTable({
    get data() {
      return local.data
    },
    get columns() {
      return local.columns
    },
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      get sorting() {
        return sorting()
      },
    },
  })

  const rows = () => table.getRowModel().rows

  const rowVirtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => tableContainerRef,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROW_COUNT,
  })

  const virtualRows = () => rowVirtualizer.getVirtualItems()
  const totalSize = () => rowVirtualizer.getTotalSize()

  const paddingTop = () => {
    const items = virtualRows()
    return items.length > 0 ? (items[0]?.start ?? 0) : 0
  }

  const paddingBottom = () => {
    const items = virtualRows()
    return items.length > 0
      ? totalSize() - (items[items.length - 1]?.end ?? 0)
      : 0
  }

  return (
    <div
      class={cn("w-full overflow-auto rounded-md border", local.class)}
      style={{ height: `${String(TABLE_CONTAINER_HEIGHT_PX)}px` }}
      ref={tableContainerRef}
    >
      <Table>
        <TableHeader>
          <For each={table.getHeaderGroups()}>
            {headerGroup => (
              <TableRow>
                <For each={headerGroup.headers}>
                  {header => (
                    <TableHead colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  )}
                </For>
              </TableRow>
            )}
          </For>
        </TableHeader>
        <TableBody>
          <Show
            when={rows().length > 0}
            fallback={
              <TableRow>
                <TableCell
                  colSpan={local.columns.length}
                  class="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            }
          >
            <Show when={paddingTop() > 0}>
              <tr>
                <td
                  colSpan={local.columns.length}
                  style={{ height: `${String(paddingTop())}px` }}
                />
              </tr>
            </Show>
            <For each={virtualRows()}>
              {(virtualRow: VirtualItem) => {
                const currentRows = rows()
                if (virtualRow.index >= currentRows.length) return null
                const row = currentRows[virtualRow.index]
                return (
                  <TableRow
                    data-state={row.getIsSelected() ? "selected" : undefined}
                  >
                    <For each={row.getVisibleCells()}>
                      {cell => (
                        <TableCell>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      )}
                    </For>
                  </TableRow>
                )
              }}
            </For>
            <Show when={paddingBottom() > 0}>
              <tr>
                <td
                  colSpan={local.columns.length}
                  style={{ height: `${String(paddingBottom())}px` }}
                />
              </tr>
            </Show>
          </Show>
        </TableBody>
      </Table>
    </div>
  )
}

export type { VirtualizedDataTableProps }
