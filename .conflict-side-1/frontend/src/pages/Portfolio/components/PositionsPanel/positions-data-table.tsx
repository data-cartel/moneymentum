import type { ColumnDef, Row, SortingState } from "@tanstack/solid-table"
import {
  createSolidTable,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/solid-table"
import {
  For,
  Show,
  createMemo,
  createSignal,
  splitProps,
  type Accessor,
  type JSX,
} from "solid-js"

import { cn } from "@/lib/cn"
import type { OrderSide } from "@/hooks/useTrading"

import {
  positionColumnWidthClass,
  positionHeaderClass,
  positionTableColumnIds,
  type PositionColumnId,
} from "./positionColumnLayout"
import type { PositionRowData } from "./positionRowModel"
import { displayPosition } from "./positionRowModel"
import { type PortfolioInterface } from "../../hooks/usePortfolioState"
import { PositionsPanelRow } from "./PositionsPanelRow"
import { DEFAULT_POSITIONS_SORTING } from "./positionsColumns"
import { schedulePositionCellEditRelease } from "./positionCellInput"
import {
  isPortfolioMetricColumnId,
  type PortfolioMetricColumnId,
} from "./portfolioMetricVisibility"

export interface PositionsTableMeta {
  currentPortfolio: Record<string, PortfolioInterface | undefined>
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  leverageLimitsMap: Record<string, number>
  leverageLimitsIsLoading: boolean
  isPrecise: boolean
  fundingIsLoading: boolean
  fundingRatesByBaseSymbol?: Record<string, number>
  targetTotalNotional: number
  symbolsBelowMinimum: string[]
  symbolsDeltaBelowMinimum: string[]
  onRemove: (symbol: string) => void
  onUndoRemove: (symbol: string) => void
  onSideChange: (symbol: string, side: OrderSide) => void
  onLeverageChange: (symbol: string, leverage: number) => void
  onNotionalChange: (symbol: string, notional: number) => void
  onWeightChange: (symbol: string, percentage: number) => void
}

interface PositionsDataTableProps {
  columns: ColumnDef<PositionRowData>[]
  data: Accessor<PositionRowData[]>
  visibleMetricColumns: PortfolioMetricColumnId[]
  factorsIsLoading: boolean
  meta: PositionsTableMeta
  class?: string
}

const isPositionColumnId = (value: string): value is PositionColumnId =>
  value === "asset" ||
  value === "side" ||
  value === "weight" ||
  value === "notional" ||
  value === "actions" ||
  isPortfolioMetricColumnId(value)

interface PositionsTableBodyRowProps {
  symbol: string
  rowDataBySymbol: Accessor<Map<string, PositionRowData>>
  visibleMetricColumns: PortfolioMetricColumnId[]
  factorsIsLoading: boolean
  meta: PositionsTableMeta
  onCellEditFocus: () => void
  onCellEditBlur: (event: FocusEvent) => void
}

const PositionsTableBodyRow = (
  props: PositionsTableBodyRowProps,
): JSX.Element => {
  const row = createMemo(() => props.rowDataBySymbol().get(props.symbol))

  return (
    <Show when={row()}>
      {resolvedRow => (
        <PositionsPanelRow
          symbol={props.symbol}
          position={() =>
            displayPosition(
              props.symbol,
              props.meta.currentPortfolio,
              props.meta.targetPortfolio,
              props.meta.deletedArchive,
            )
          }
          status={resolvedRow().status}
          visibleMetricColumns={props.visibleMetricColumns}
          rowMetrics={{
            signedFundingRate: resolvedRow().signedFundingRate,
            beta: resolvedRow().beta,
            volatility: resolvedRow().volatility,
            sharpe: resolvedRow().sharpe,
            sortino: resolvedRow().sortino,
            momentum: resolvedRow().momentum,
            carry: resolvedRow().carry,
          }}
          maxLeverage={props.meta.leverageLimitsMap[props.symbol]}
          leverageLimitsIsLoading={props.meta.leverageLimitsIsLoading}
          isPrecise={props.meta.isPrecise}
          fundingIsLoading={props.meta.fundingIsLoading}
          factorsIsLoading={props.factorsIsLoading}
          onCellEditFocus={props.onCellEditFocus}
          onCellEditBlur={props.onCellEditBlur}
          onRemove={props.meta.onRemove}
          onUndoRemove={props.meta.onUndoRemove}
          onSideChange={props.meta.onSideChange}
          onLeverageChange={props.meta.onLeverageChange}
          onNotionalChange={props.meta.onNotionalChange}
          onWeightChange={props.meta.onWeightChange}
          totalNotional={props.meta.targetTotalNotional}
          symbolsBelowMinimum={props.meta.symbolsBelowMinimum}
          symbolsDeltaBelowMinimum={props.meta.symbolsDeltaBelowMinimum}
          symbolDelta={resolvedRow().symbolDelta}
        />
      )}
    </Show>
  )
}

export const PositionsDataTable = (
  props: PositionsDataTableProps,
): JSX.Element => {
  const [local] = splitProps(props, [
    "columns",
    "data",
    "visibleMetricColumns",
    "factorsIsLoading",
    "meta",
    "class",
  ])
  const [sorting, setSorting] = createSignal<SortingState>([
    ...DEFAULT_POSITIONS_SORTING,
  ])
  const [frozenRowOrder, setFrozenRowOrder] = createSignal<string[] | null>(
    null,
  )

  const rowDataBySymbol = createMemo(() => {
    const map = new Map<string, PositionRowData>()
    for (const entry of local.data()) {
      map.set(entry.symbol, entry)
    }
    return map
  })

  const frozenSymbolSet = createMemo(() => {
    const order = frozenRowOrder()
    return order === null ? null : new Set(order)
  })

  const table = createSolidTable({
    get data() {
      return local.data()
    },
    get columns() {
      return local.columns
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
    get meta() {
      return local.meta
    },
  })

  const sortedRows = () => table.getRowModel().rows

  const displayRows = (): Row<PositionRowData>[] => {
    const order = frozenRowOrder()
    const rows = sortedRows()
    if (order === null) return rows

    const rowsBySymbol = new Map(rows.map(row => [row.original.symbol, row]))
    const ordered: Row<PositionRowData>[] = []
    const frozenSymbols = frozenSymbolSet()
    if (frozenSymbols === null) return rows

    for (const symbol of order) {
      const row = rowsBySymbol.get(symbol)
      if (row !== undefined) {
        ordered.push(row)
      }
    }

    for (const row of rows) {
      if (!frozenSymbols.has(row.original.symbol)) {
        ordered.push(row)
      }
    }

    return ordered
  }

  const onCellEditFocus = () => {
    if (frozenRowOrder() !== null) return
    setFrozenRowOrder(sortedRows().map(row => row.original.symbol))
  }

  const onCellEditBlur = (event: FocusEvent) => {
    schedulePositionCellEditRelease(event, () => {
      setFrozenRowOrder(null)
    })
  }

  const tableColumnIds = () =>
    positionTableColumnIds(local.visibleMetricColumns)
  const rowSymbols = (): string[] =>
    displayRows().map(row => row.original.symbol)

  return (
    <div class={cn("w-full", local.class)}>
      <table class="min-w-full w-max table-fixed">
        <colgroup>
          <For each={tableColumnIds()}>
            {columnId => <col class={positionColumnWidthClass(columnId)} />}
          </For>
        </colgroup>
        <thead class="sticky top-0 z-20 bg-muted/90">
          <For each={table.getHeaderGroups()}>
            {headerGroup => (
              <tr>
                <For each={headerGroup.headers}>
                  {header => {
                    const columnId = isPositionColumnId(header.column.id)
                      ? header.column.id
                      : "asset"

                    return (
                      <th
                        colSpan={header.colSpan}
                        class={positionHeaderClass(columnId)}
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
          <For each={rowSymbols()}>
            {symbol => (
              <PositionsTableBodyRow
                symbol={symbol}
                rowDataBySymbol={rowDataBySymbol}
                visibleMetricColumns={local.visibleMetricColumns}
                factorsIsLoading={local.factorsIsLoading}
                meta={local.meta}
                onCellEditFocus={onCellEditFocus}
                onCellEditBlur={onCellEditBlur}
              />
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}
