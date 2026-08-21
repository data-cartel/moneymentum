import { createMemo, type Accessor, type JSX } from "solid-js"
import { useFactorScores } from "../hooks/useFactorScores"
import { type PortfolioInterface } from "../hooks/usePortfolioState"
import { AllSymbolsDataTable } from "./PositionsPanel/all-symbols-data-table"
import {
  allSymbolPortfolioState,
  buildAllSymbolRows,
  resolveAllSymbolClick,
} from "./PositionsPanel/allSymbolRowModel"
import {
  visiblePortfolioMetricColumns,
  type PortfolioMetricVisibility,
} from "./PositionsPanel/portfolioMetricVisibility"

interface AllSymbolsPanelProps {
  screenerSymbols: Accessor<string[]>
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  fundingIsLoading: boolean
  fundingRatesByBaseSymbol?: Record<string, number>
  metricVisibility: PortfolioMetricVisibility
  onRemove: (symbol: string) => void
  onUndoRemove: (symbol: string) => void
  onAddSymbol: (symbol: string) => void
}

export const AllSymbolsPanel = (props: AllSymbolsPanelProps): JSX.Element => {
  const factorScoresQuery = useFactorScores()

  const visibleMetricColumns = createMemo(() =>
    visiblePortfolioMetricColumns(props.metricVisibility),
  )

  const allSymbolRows = createMemo(() =>
    buildAllSymbolRows(
      props.screenerSymbols(),
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

  return (
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div class="min-h-0 flex-1">
        <AllSymbolsDataTable
          data={allSymbolRows}
          visibleMetricColumns={visibleMetricColumns()}
          targetPortfolio={props.targetPortfolio}
          deletedArchive={props.deletedArchive}
          fundingIsLoading={props.fundingIsLoading}
          factorsIsLoading={
            factorScoresQuery.isLoading || factorScoresQuery.isFetching
          }
          onSymbolClick={handleAllSymbolClick}
        />
      </div>
    </div>
  )
}
