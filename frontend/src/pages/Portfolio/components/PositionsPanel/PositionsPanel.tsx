import {
  For,
  Show,
  createMemo,
  createSignal,
  createEffect,
  type JSX,
} from "solid-js"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import type { OrderSide } from "@/hooks/useTrading"
import { useWallet } from "@/hooks/useWallet"
import { WalletInlineConnect } from "./WalletInlineConnect"
import { useFactorScores } from "../../hooks/useFactorScores"
import { type PortfolioInterface } from "../../hooks/usePortfolioState"
import type { ReadonlyBtcRow } from "../../hooks/useReadonlyPortfolioState"
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
  visiblePortfolioMetricColumns,
  type PortfolioMetricVisibility,
} from "./portfolioMetricVisibility"
import { PositionsDataTable } from "./positions-data-table"
import type { PositionsTableMeta } from "./positions-data-table"
import { ReadonlyBtcPanel } from "./ReadonlyBtcPanel"

const LEVERAGE_MIN = 0.001
const LEVERAGE_MAX = 5
const LEVERAGE_STEP = 0.1

interface PositionsPanelProps {
  hasTotalWeightExceeded: boolean
  currentPortfolio: Record<string, PortfolioInterface | undefined>
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  errorsBySymbol: Record<string, string | undefined>
  isLoading: boolean
  fundingIsLoading: boolean
  leverageLimitsIsLoading: boolean
  leverageLimitsMap: Record<string, number>
  _isRebalancing?: boolean
  isPrecise: boolean
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
  onAddReadonlyBtcAddress: (address: string) => boolean | Promise<boolean>
  onRemoveReadonlyBtcAddress: (address: string) => void
  onReadonlyBtcIncludeInBetaChange: (
    address: string,
    includeInBeta: boolean,
  ) => void
  metricVisibility: PortfolioMetricVisibility
  isBalanceLoading: boolean
  targetCrossAccountLeverage: number
  onCrossAccountLeverageChange: (leverage: number) => void
}

export const PositionsPanel = (props: PositionsPanelProps): JSX.Element => {
  const { isConnected } = useWallet()
  const factorScoresQuery = useFactorScores()

  const [leverageInput, setLeverageInput] = createSignal("")
  const [isLeverageInputFocused, setIsLeverageInputFocused] =
    createSignal(false)

  // createEffect: keep leverage input in sync when not focused
  createEffect(() => {
    if (!isLeverageInputFocused()) {
      setLeverageInput(props.targetCrossAccountLeverage.toFixed(2))
    }
  })

  const visibleMetricColumns = createMemo(() =>
    visiblePortfolioMetricColumns(props.metricVisibility),
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

  const applyLeverageInput = (raw: string) => {
    setLeverageInput(raw)
    if (raw === "") {
      return
    }
    const value = parseFloat(raw)
    if (!Number.isNaN(value)) {
      const clamped = Math.max(LEVERAGE_MIN, Math.min(LEVERAGE_MAX, value))
      props.onCrossAccountLeverageChange(clamped)
    }
  }

  const positionsTableMeta = createMemo(
    (): PositionsTableMeta => ({
      currentPortfolio: props.currentPortfolio,
      targetPortfolio: props.targetPortfolio,
      deletedArchive: props.deletedArchive,
      errorsBySymbol: props.errorsBySymbol,
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
    <div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col">
        <Show
          when={!props.isLoading}
          fallback={
            <div class="min-h-0 flex-1 space-y-1 overflow-auto p-2 scrollbar-hide">
              <For each={Array.from({ length: 8 })}>
                {() => <Skeleton class="h-5 w-full" />}
              </For>
            </div>
          }
        >
          <Show when={isConnected()} fallback={<WalletInlineConnect />}>
            <div class="min-h-0 flex-1 overflow-auto scrollbar-hide">
              <Show
                when={hasRenderablePortfolioRows()}
                fallback={
                  <div class="p-4 text-center text-[11px] text-muted-foreground">
                    Add positions from All Symbols.
                  </div>
                }
              >
                <PositionsDataTable
                  columns={portfolioColumns()}
                  data={positionRows}
                  visibleMetricColumns={visibleMetricColumns()}
                  factorsIsLoading={
                    factorScoresQuery.isLoading || factorScoresQuery.isFetching
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
      </div>

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

      <div class="shrink-0 border-t border-border bg-background/80 backdrop-blur">
        <div class="flex items-center pt-3 text-[12px]">
          <div class="flex flex-1 items-center gap-3">
            <span class="whitespace-nowrap font-semibold text-muted-foreground">
              Leverage
            </span>
            <Show
              when={!props.isBalanceLoading}
              fallback={<Skeleton class="h-4 w-full" />}
            >
              <Slider
                value={[props.targetCrossAccountLeverage]}
                onChange={([selectedLeverage]) => {
                  props.onCrossAccountLeverageChange(selectedLeverage)
                }}
                minValue={LEVERAGE_MIN}
                maxValue={LEVERAGE_MAX}
                step={LEVERAGE_STEP}
                class="flex-1"
              />
              <input
                type="number"
                value={leverageInput()}
                onFocus={() => setIsLeverageInputFocused(true)}
                onBlur={() => {
                  setIsLeverageInputFocused(false)
                  setLeverageInput(props.targetCrossAccountLeverage.toFixed(2))
                }}
                onInput={leverageInputChangeEvent => {
                  applyLeverageInput(
                    leverageInputChangeEvent.currentTarget.value,
                  )
                }}
                min={LEVERAGE_MIN}
                max={LEVERAGE_MAX}
                step={LEVERAGE_STEP}
                class="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-center font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span class="text-sm font-medium">x</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
