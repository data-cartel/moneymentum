import type { Row, SortingState } from "@tanstack/solid-table"
import {
  createSolidTable,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/solid-table"
import { createVirtualizer } from "@tanstack/solid-virtual"
import { Search } from "lucide-solid"
import {
  For,
  Show,
  createMemo,
  createRenderEffect,
  createEffect,
  createSignal,
  splitProps,
  type Accessor,
  type JSX,
} from "solid-js"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/cn"

import type { PortfolioInterface } from "../../hooks/usePortfolioState"
import {
  ALL_SYMBOLS_SEARCH_ATTR,
  tryUsePortfolioKeyboardContext,
} from "../../keyboard"

import { AllSymbolsRow } from "./AllSymbolsRow"
import type { AllSymbolRowData } from "./allSymbolRowModel"
import {
  allSymbolPortfolioState,
  filterAllSymbolRows,
} from "./allSymbolRowModel"
import {
  allSymbolColumnWidthClass,
  allSymbolHeaderClass,
  allSymbolTableColumnIds,
  isAllSymbolColumnId,
} from "./allSymbolColumnLayout"
import {
  buildAllSymbolsColumns,
  DEFAULT_ALL_SYMBOLS_SORTING,
} from "./allSymbolsColumns"
import type { PortfolioMetricColumnId } from "./portfolioMetricVisibility"

const ESTIMATED_ALL_SYMBOL_ROW_HEIGHT_PX = 34
const ALL_SYMBOLS_OVERSCAN_ROW_COUNT = 10

interface AllSymbolsVirtualRowProps {
  symbol: string
  rowBySymbol: Accessor<Map<string, Row<AllSymbolRowData>>>
  searchQuery: Accessor<string>
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  visibleMetricColumns: PortfolioMetricColumnId[]
  fundingIsLoading: boolean
  factorsIsLoading: boolean
  onSymbolClick: (symbol: string) => void
  isSelected: boolean
  onSelect: () => void
}

const AllSymbolsVirtualRow = (
  props: AllSymbolsVirtualRowProps,
): JSX.Element => {
  const row = createMemo(() => {
    props.searchQuery()
    return props.rowBySymbol().get(props.symbol)
  })

  return (
    <Show when={row()}>
      {resolvedRow => (
        <AllSymbolsRow
          row={resolvedRow().original}
          portfolioState={allSymbolPortfolioState(
            resolvedRow().original.symbol,
            props.targetPortfolio,
            props.deletedArchive,
          )}
          visibleMetricColumns={props.visibleMetricColumns}
          fundingIsLoading={props.fundingIsLoading}
          factorsIsLoading={props.factorsIsLoading}
          onSymbolClick={props.onSymbolClick}
          isSelected={props.isSelected}
          onSelect={props.onSelect}
        />
      )}
    </Show>
  )
}

interface AllSymbolsDataTableProps {
  data: Accessor<AllSymbolRowData[]>
  visibleMetricColumns: PortfolioMetricColumnId[]
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  fundingIsLoading: boolean
  factorsIsLoading: boolean
  onSymbolClick: (symbol: string) => void
  class?: string
}

export const AllSymbolsDataTable = (
  props: AllSymbolsDataTableProps,
): JSX.Element => {
  const [local] = splitProps(props, [
    "data",
    "visibleMetricColumns",
    "targetPortfolio",
    "deletedArchive",
    "fundingIsLoading",
    "factorsIsLoading",
    "onSymbolClick",
    "class",
  ])
  const [sorting, setSorting] = createSignal<SortingState>([
    ...DEFAULT_ALL_SYMBOLS_SORTING,
  ])
  const [searchQuery, setSearchQuery] = createSignal("")
  let tableContainerRef!: HTMLDivElement
  const keyboard = tryUsePortfolioKeyboardContext()

  const filteredData = createMemo(() =>
    filterAllSymbolRows(local.data(), searchQuery()),
  )

  const columns = createMemo(() =>
    buildAllSymbolsColumns(local.visibleMetricColumns),
  )

  const tableColumnIds = createMemo(() =>
    allSymbolTableColumnIds(local.visibleMetricColumns),
  )

  const table = createSolidTable({
    get data() {
      return filteredData()
    },
    get columns() {
      return columns()
    },
    getRowId: row => row.symbol,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      get sorting() {
        return sorting()
      },
    },
  })

  const rows = createMemo(() => {
    searchQuery()
    sorting()
    filteredData()
    return table.getRowModel().rows
  })

  const rowBySymbol = createMemo(() => {
    const map = new Map<string, Row<AllSymbolRowData>>()
    for (const row of rows()) {
      map.set(row.original.symbol, row)
    }
    return map
  })

  const rowVirtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => tableContainerRef,
    estimateSize: () => ESTIMATED_ALL_SYMBOL_ROW_HEIGHT_PX,
    overscan: ALL_SYMBOLS_OVERSCAN_ROW_COUNT,
  })

  const virtualRows = createMemo(() => {
    rows()
    searchQuery()
    return rowVirtualizer.getVirtualItems()
  })

  const virtualRowSymbols = createMemo(() => {
    const currentRows = rows()
    const symbols: string[] = []

    for (const virtualRow of virtualRows()) {
      if (virtualRow.index >= currentRows.length) {
        continue
      }

      symbols.push(currentRows[virtualRow.index].original.symbol)
    }

    return symbols
  })

  // createRenderEffect: reset scroll before paint when filter/sort changes so virtualizer indices stay in range (imperative DOM sync -- not expressible via createMemo)
  createRenderEffect(() => {
    searchQuery()
    sorting()
    rowVirtualizer.scrollToOffset(0)
  })

  // createEffect: keep keyboard order in sync with filtered/sorted rows
  createEffect(() => {
    const symbols = rows().map(row => row.original.symbol)
    keyboard?.setAllSymbolOrder(symbols)
    if (keyboard?.focusedPanel() === "allSymbols") {
      keyboard.ensureAllSymbolsSelection()
    }
  })

  // createEffect: scroll selected virtual row into view
  createEffect(() => {
    if (keyboard?.focusedPanel() !== "allSymbols") {
      return
    }
    const index = keyboard.selectedAllSymbolsIndex()
    if (index === null) {
      return
    }
    rowVirtualizer.scrollToIndex(index, { align: "auto" })
  })

  const totalSize = () => rowVirtualizer.getTotalSize()

  const isSymbolSelected = (symbol: string): boolean => {
    if (keyboard?.focusedPanel() !== "allSymbols") {
      return false
    }
    const index = keyboard.selectedAllSymbolsIndex()
    if (index === null) {
      return false
    }
    return rows()[index]?.original.symbol === symbol
  }

  const selectSymbol = (symbol: string) => {
    const index = rows().findIndex(row => row.original.symbol === symbol)
    if (index < 0) {
      return
    }
    keyboard?.setSelectedAllSymbolsIndex(index)
    keyboard?.setFocusedPanel("allSymbols")
  }

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
    <div class={cn("flex h-full min-h-0 flex-col", local.class)}>
      <div class="shrink-0 border-b border-border px-2 py-1.5">
        <div class="relative">
          <Search class="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search symbols..."
            value={searchQuery()}
            onInput={event => {
              setSearchQuery(event.currentTarget.value)
            }}
            class="h-7 pl-7 pr-8 text-[11px]"
            aria-label="Search symbols"
            {...{ [ALL_SYMBOLS_SEARCH_ATTR]: "" }}
          />
          <kbd class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            s
          </kbd>
        </div>
      </div>
      <div
        ref={tableContainerRef}
        class="min-h-0 flex-1 overflow-auto scrollbar-hide"
      >
        <table class="min-w-full w-max table-fixed">
          <colgroup>
            <For each={tableColumnIds()}>
              {columnId => <col class={allSymbolColumnWidthClass(columnId)} />}
            </For>
          </colgroup>
          <thead class="sticky top-0 z-10 bg-muted/90">
            <For each={table.getHeaderGroups()}>
              {headerGroup => (
                <tr>
                  <For each={headerGroup.headers}>
                    {header => {
                      const columnId = isAllSymbolColumnId(header.column.id)
                        ? header.column.id
                        : "asset"

                      return (
                        <th
                          colSpan={header.colSpan}
                          class={allSymbolHeaderClass(columnId)}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      )
                    }}
                  </For>
                </tr>
              )}
            </For>
          </thead>
          <tbody>
            <Show
              when={rows().length > 0}
              fallback={
                <tr>
                  <td
                    colSpan={tableColumnIds().length}
                    class="h-24 text-center text-muted-foreground text-[11px]"
                  >
                    {searchQuery().trim() === ""
                      ? "No symbols."
                      : "No matching symbols."}
                  </td>
                </tr>
              }
            >
              <Show when={paddingTop() > 0}>
                <tr>
                  <td
                    colSpan={tableColumnIds().length}
                    style={{ height: `${String(paddingTop())}px` }}
                  />
                </tr>
              </Show>
              <For each={virtualRowSymbols()}>
                {symbol => (
                  <AllSymbolsVirtualRow
                    symbol={symbol}
                    rowBySymbol={rowBySymbol}
                    searchQuery={searchQuery}
                    targetPortfolio={local.targetPortfolio}
                    deletedArchive={local.deletedArchive}
                    visibleMetricColumns={local.visibleMetricColumns}
                    fundingIsLoading={local.fundingIsLoading}
                    factorsIsLoading={local.factorsIsLoading}
                    onSymbolClick={local.onSymbolClick}
                    isSelected={isSymbolSelected(symbol)}
                    onSelect={() => {
                      selectSymbol(symbol)
                    }}
                  />
                )}
              </For>
              <Show when={paddingBottom() > 0}>
                <tr>
                  <td
                    colSpan={tableColumnIds().length}
                    style={{ height: `${String(paddingBottom())}px` }}
                  />
                </tr>
              </Show>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  )
}
