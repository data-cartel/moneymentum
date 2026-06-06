import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js"
import { Settings } from "lucide-solid"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import type { OrderSide } from "@/hooks/useTrading"
import { useWallet } from "@/hooks/useWallet"
import { WalletHeader } from "@/components/wallet-header"
import { cn } from "@/lib/cn"

import { useFactorScores } from "../../hooks/useFactorScores"
import { type PortfolioInterface } from "../../hooks/usePortfolioState"
import type { ReadonlyBtcRow } from "../../hooks/useReadonlyPortfolioState"
import { AllSymbolsDataTable } from "./all-symbols-data-table"
import {
  allSymbolPortfolioState,
  buildAllSymbolRows,
  resolveAllSymbolClick,
} from "./allSymbolRowModel"
import { allSymbolsColumns } from "./allSymbolsColumns"
import { PositionsPanelAlerts } from "./PositionsPanelAlerts"
import {
  displayPosition,
  positionDelta,
  positionStatus,
  signedFundingRateForPosition,
  weightPercentForPosition,
  type PositionRowData,
} from "./positionRowModel"
import { buildPositionsColumns } from "./positionsColumns"
import {
  PORTFOLIO_METRIC_COLUMN_ORDER,
  PORTFOLIO_METRIC_COLUMN_LABELS,
  readPortfolioMetricVisibility,
  visiblePortfolioMetricColumns,
  writePortfolioMetricVisibility,
  type PortfolioMetricColumnId,
} from "./portfolioMetricVisibility"
import { PositionsDataTable } from "./positions-data-table"
import type { PositionsTableMeta } from "./positions-data-table"
import { ReadonlyBtcPanel } from "./ReadonlyBtcPanel"

export type PositionsPanelView = "portfolio" | "all"

interface PositionsPanelProps {
  hasTotalWeightExceeded: boolean
  currentPortfolio: Record<string, PortfolioInterface | undefined>
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  isLoading: boolean
  fundingIsLoading: boolean
  leverageLimitsIsLoading: boolean
  leverageLimitsMap: Record<string, number>
  _isRebalancing?: boolean
  isPrecise: boolean
  onPreciseChange: (value: boolean) => void
  isManualWeightEntry: boolean
  onManualWeightEntryChange: (value: boolean) => void
  onRemove: (symbol: string) => void
  onUndoRemove: (symbol: string) => void
  onSideChange: (symbol: string, side: OrderSide) => void
  onLeverageChange: (symbol: string, leverage: number) => void
  onNotionalChange: (symbol: string, notional: number) => void
  onWeightChange: (symbol: string, percentage: number) => void
  fundingRatesByBaseSymbol?: Record<string, number>
  targetTotalNotional: number
  symbolsBelowMinimum: string[]
  symbolsDeltaBelowMinimum: string[]
  /** Sum of target weights as % of targetTotalNotional. */
  targetAllocationPercent: number
  readonlyBtcRows: ReadonlyBtcRow[]
  isReadonlyBtcLoading: boolean
  readonlyBtcError: string | null
  readonlyBtcValidationError: string | null
  onAddReadonlyBtcAddress: (address: string) => boolean
  onRemoveReadonlyBtcAddress: (address: string) => void
  onReadonlyBtcIncludeInBetaChange: (
    address: string,
    includeInBeta: boolean,
  ) => void
  screenerSymbols: string[]
  onAddSymbol: (symbol: string) => void
}

export const PositionsPanel = (props: PositionsPanelProps): JSX.Element => {
  const { isConnected } = useWallet()
  const factorScoresQuery = useFactorScores()
  const [panelView, setPanelView] =
    createSignal<PositionsPanelView>("portfolio")
  const [metricVisibility, setMetricVisibility] = createSignal(
    readPortfolioMetricVisibility(),
  )

  // createEffect: persist metricVisibility to localStorage when gear toggles change (imperative storage sync -- valid side-effect, not expressible via createMemo)
  createEffect(() => {
    writePortfolioMetricVisibility(metricVisibility())
  })

  const visibleMetricColumns = createMemo(() =>
    visiblePortfolioMetricColumns(metricVisibility()),
  )

  const portfolioColumns = createMemo(() =>
    buildPositionsColumns(visibleMetricColumns()),
  )

  const factorScoresByTicker = createMemo(
    () =>
      new Map(
        (factorScoresQuery.data ?? []).map(score => [score.ticker, score]),
      ),
  )

  const renderableSymbols = createMemo(() => [
    ...new Set([
      ...Object.keys(props.currentPortfolio),
      ...Object.keys(props.targetPortfolio),
    ]),
  ])

  const targetPositionCount = createMemo(
    () => Object.keys(props.targetPortfolio).length,
  )

  const hasRenderablePortfolioRows = createMemo(
    () => renderableSymbols().length > 0,
  )

  const positionRows = createMemo((): PositionRowData[] =>
    renderableSymbols().map(symbol => {
      const position = displayPosition(
        symbol,
        props.currentPortfolio,
        props.targetPortfolio,
        props.deletedArchive,
      )
      const baseSymbol = symbol.split("/")[0] ?? symbol
      const factors = factorScoresByTicker().get(baseSymbol)

      return {
        symbol,
        status: positionStatus(
          symbol,
          props.currentPortfolio,
          props.targetPortfolio,
        ),
        position,
        symbolDelta: positionDelta(
          symbol,
          props.currentPortfolio,
          props.targetPortfolio,
        ),
        side: position.side,
        weightPercent: weightPercentForPosition(
          position,
          props.targetTotalNotional,
        ),
        notional: position.notional,
        signedFundingRate: signedFundingRateForPosition(
          position,
          props.fundingRatesByBaseSymbol,
        ),
        beta: factors?.beta ?? null,
        volatility: factors?.annualized_volatility ?? null,
        sharpe: factors?.sharpe ?? null,
        sortino: factors?.sortino ?? null,
        momentum: factors?.cum_return ?? null,
        carry: factors?.carry ?? null,
      }
    }),
  )

  const allSymbolRows = createMemo(() =>
    buildAllSymbolRows(
      props.screenerSymbols,
      factorScoresQuery.data ?? [],
      props.fundingRatesByBaseSymbol,
    ),
  )

  const handleAllSymbolClick = (symbol: string) => {
    const action = resolveAllSymbolClick(
      allSymbolPortfolioState(
        symbol,
        props.targetPortfolio,
        props.deletedArchive,
      ),
    )

    if (action === "remove") {
      props.onRemove(symbol)
      return
    }
    if (action === "undoRemove") {
      props.onUndoRemove(symbol)
      return
    }
    props.onAddSymbol(symbol)
  }

  const setMetricColumnVisible = (
    columnId: PortfolioMetricColumnId,
    visible: boolean,
  ) => {
    setMetricVisibility(previous => ({
      ...previous,
      [columnId]: visible,
    }))
  }

  const togglePanelView = () => {
    setPanelView(previous => (previous === "portfolio" ? "all" : "portfolio"))
  }

  const positionsTableMeta = createMemo(
    (): PositionsTableMeta => ({
      currentPortfolio: props.currentPortfolio,
      targetPortfolio: props.targetPortfolio,
      deletedArchive: props.deletedArchive,
      leverageLimitsMap: props.leverageLimitsMap,
      leverageLimitsIsLoading: props.leverageLimitsIsLoading,
      isPrecise: props.isPrecise,
      fundingIsLoading: props.fundingIsLoading,
      fundingRatesByBaseSymbol: props.fundingRatesByBaseSymbol,
      targetTotalNotional: props.targetTotalNotional,
      symbolsBelowMinimum: props.symbolsBelowMinimum,
      symbolsDeltaBelowMinimum: props.symbolsDeltaBelowMinimum,
      onRemove: props.onRemove,
      onUndoRemove: props.onUndoRemove,
      onSideChange: props.onSideChange,
      onLeverageChange: props.onLeverageChange,
      onNotionalChange: props.onNotionalChange,
      onWeightChange: props.onWeightChange,
    }),
  )

  return (
    <div class="flex flex-col rounded border border-border min-h-0 max-h-[calc(100vh-4rem)] w-full min-w-0 flex-1">
      <div class="px-2 py-1.5 border-b border-border bg-muted/30 flex items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-medium">
            <Show when={panelView() === "portfolio"} fallback="ALL SYMBOLS">
              PORTFOLIO ({targetPositionCount()})
            </Show>
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="flex h-7 min-w-[8.75rem] items-center rounded border border-border bg-muted/40 p-0.5 text-[10px] font-medium hover:bg-muted/60"
            aria-label={
              panelView() === "portfolio"
                ? "Show all symbols"
                : "Show portfolio positions"
            }
            onClick={togglePanelView}
          >
            <span
              class={cn(
                "flex-1 rounded-sm px-2 py-0.5 text-center",
                panelView() === "portfolio"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              Portfolio
            </span>
            <span
              class={cn(
                "flex-1 rounded-sm px-2 py-0.5 text-center",
                panelView() === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              All
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              as={Button}
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              aria-label="Open positions settings"
            >
              <Settings class="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                class="flex items-center justify-between gap-2"
                closeOnSelect={false}
              >
                <span>Precise</span>
                <Switch
                  checked={props.isPrecise}
                  onChange={value => {
                    props.onPreciseChange(value)
                  }}
                />
              </DropdownMenuItem>
              <DropdownMenuItem
                class="flex items-center justify-between gap-2"
                closeOnSelect={false}
              >
                <span>Manual weight entry</span>
                <Switch
                  checked={props.isManualWeightEntry}
                  onChange={value => {
                    props.onManualWeightEntryChange(value)
                  }}
                />
              </DropdownMenuItem>
              <For each={PORTFOLIO_METRIC_COLUMN_ORDER}>
                {columnId => (
                  <DropdownMenuItem
                    class="flex items-center justify-between gap-2"
                    closeOnSelect={false}
                  >
                    <span>{PORTFOLIO_METRIC_COLUMN_LABELS[columnId]}</span>
                    <Switch
                      checked={metricVisibility()[columnId]}
                      onChange={value => {
                        setMetricColumnVisible(columnId, value)
                      }}
                    />
                  </DropdownMenuItem>
                )}
              </For>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div class="flex-1 min-h-0 flex flex-col">
        <Show
          when={panelView() === "all"}
          fallback={
            <Show
              when={!props.isLoading}
              fallback={
                <div class="flex-1 min-h-0 overflow-auto scrollbar-hide p-2 space-y-1">
                  <For each={Array.from({ length: 8 })}>
                    {() => <Skeleton class="h-5 w-full" />}
                  </For>
                </div>
              }
            >
              <Show
                when={isConnected()}
                fallback={
                  <div class="h-full flex flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground text-[11px]">
                    <p class="max-w-[260px]">
                      Connect your wallet to view and rebalance positions.
                    </p>
                    <WalletHeader />
                  </div>
                }
              >
                <div class="flex-1 min-h-0 overflow-auto scrollbar-hide">
                  <Show
                    when={hasRenderablePortfolioRows()}
                    fallback={
                      <div class="p-4 text-center text-muted-foreground text-[11px]">
                        Add positions from the all view.
                      </div>
                    }
                  >
                    <PositionsDataTable
                      columns={portfolioColumns()}
                      data={positionRows}
                      visibleMetricColumns={visibleMetricColumns()}
                      factorsIsLoading={
                        factorScoresQuery.isLoading ||
                        factorScoresQuery.isFetching
                      }
                      meta={positionsTableMeta()}
                    />
                  </Show>
                </div>
                <ReadonlyBtcPanel
                  rows={props.readonlyBtcRows}
                  isLoading={props.isReadonlyBtcLoading}
                  error={props.readonlyBtcError}
                  validationError={props.readonlyBtcValidationError}
                  onAddAddress={props.onAddReadonlyBtcAddress}
                  onRemoveAddress={props.onRemoveReadonlyBtcAddress}
                  onIncludeInBetaChange={props.onReadonlyBtcIncludeInBetaChange}
                />
              </Show>
            </Show>
          }
        >
          <div class="flex-1 min-h-0">
            <AllSymbolsDataTable
              columns={allSymbolsColumns}
              data={allSymbolRows}
              targetPortfolio={props.targetPortfolio}
              deletedArchive={props.deletedArchive}
              fundingIsLoading={props.fundingIsLoading}
              factorsIsLoading={
                factorScoresQuery.isLoading || factorScoresQuery.isFetching
              }
              onSymbolClick={handleAllSymbolClick}
            />
          </div>
        </Show>
      </div>
      <Show when={panelView() === "portfolio"}>
        <PositionsPanelAlerts
          isLoading={props.isLoading}
          isConnected={isConnected()}
          hasPositions={hasRenderablePortfolioRows()}
          hasTotalWeightExceeded={props.hasTotalWeightExceeded}
          targetAllocationPercent={props.targetAllocationPercent}
          symbolsBelowMinimum={props.symbolsBelowMinimum}
          symbolsDeltaBelowMinimum={props.symbolsDeltaBelowMinimum}
          isPrecise={props.isPrecise}
          targetPortfolio={props.targetPortfolio}
          currentPortfolio={props.currentPortfolio}
        />
      </Show>
    </div>
  )
}
