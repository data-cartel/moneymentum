import { createSignal, createEffect, Show } from "solid-js"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/cn"
import { useNetwork } from "@/hooks/useNetwork"
import { useWallet } from "@/hooks/useWallet"
import { WalletHeader } from "@/components/wallet-header"
import { ModeToggle } from "@/components/ui/mode-toggle"

import {
  usePortfolioState,
  writeManualWeightEntry,
  writePreciseToggle,
} from "./hooks/usePortfolioState"
import { useBeta, type BetaBenchmark } from "./hooks/useBeta"
import {
  useHyperliquidTickers,
  useHyperliquidFundingRates,
} from "@/hooks/useTrading"
import { PositionsPanel } from "@/pages/Portfolio/components/PositionsPanel/PositionsPanel"
import { PerformancePanel } from "@/pages/Portfolio/components/PerformancePanel"
import {
  StagedChangesPanel,
  type StagedConnectionState,
} from "@/pages/Portfolio/components/StagedChangesPanel"
import { FactorsPanel } from "@/pages/Portfolio/components/FactorsPanel"
import { RiskPanel } from "@/pages/Portfolio/components/RiskPanel"
import { WalletPinDialog } from "@/pages/Portfolio/components/WalletPinDialog"

const LEVERAGE_MIN = 0.001
const LEVERAGE_MAX = 5
const LEVERAGE_STEP = 0.1

const bitcoinBetaBenchmark: BetaBenchmark = {
  symbol: "BTC",
  label: "BTC perpetual on Hyperliquid",
  interval: "daily log returns",
  lookback: "365 calendar days",
}

const PortfolioPage = () => {
  const { isNetworkSwitching } = useNetwork()
  const { hasStoredSession, isLocked, canTrade, isConnected } = useWallet()
  const portfolio = usePortfolioState()

  const [pinDialogOpen, setPinDialogOpen] = createSignal(false)

  const stagedConnectionState = (): StagedConnectionState => {
    if (!isConnected()) {
      return "walletDisconnected"
    }
    if (!hasStoredSession()) {
      return "agentMissing"
    }
    if (isLocked()) {
      return "agentLocked"
    }
    return "ready"
  }

  const handlePrimaryStagedAction = () => {
    switch (stagedConnectionState()) {
      case "walletDisconnected":
      case "agentLocked":
        return
      case "agentMissing":
        setPinDialogOpen(true)
        return
      case "ready":
        if (!canTrade()) {
          return
        }
        portfolio.handleRebalancePositions()
    }
  }

  const handleAgentUnlocked = () => {
    if (!canTrade()) {
      return
    }
    if (!portfolio.canSubmit) {
      return
    }
    portfolio.handleRebalancePositions()
  }

  // createEffect: persist precise toggle to localStorage when it changes
  createEffect(() => {
    writePreciseToggle(portfolio.isPrecise)
  })

  // createEffect: persist manual weight entry toggle to localStorage when it changes
  createEffect(() => {
    writeManualWeightEntry(portfolio.isManualWeightEntry)
  })
  const betaResult = useBeta(
    () => portfolio.targetPortfolio,
    () => portfolio.targetTotalNotional,
    () => portfolio.readonlyBetaPositions,
    () => bitcoinBetaBenchmark,
  )

  const tickersQuery = useHyperliquidTickers()
  const fundingRatesQuery = useHyperliquidFundingRates()
  const screenerSymbols = () => tickersQuery.data ?? []
  const fundingRatesByBaseSymbol = () => fundingRatesQuery.data ?? {}

  const [leverageInput, setLeverageInput] = createSignal(
    portfolio.targetCrossAccountLeverage.toFixed(2),
  )

  const [isLeverageInputFocused, setIsLeverageInputFocused] =
    createSignal(false)
  createEffect(() => {
    if (!isLeverageInputFocused()) {
      setLeverageInput(portfolio.targetCrossAccountLeverage.toFixed(2))
    }
  })

  const applyLeverageInput = (raw: string) => {
    setLeverageInput(raw)
    if (raw === "") return
    const value = parseFloat(raw)
    if (!Number.isNaN(value)) {
      const clamped = Math.max(LEVERAGE_MIN, Math.min(LEVERAGE_MAX, value))
      portfolio.handleCrossAccountLeverageChange(clamped)
    }
  }

  return (
    <>
      <header class="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-muted/30">
        <div class="flex items-center gap-5">
          <span class="font-semibold">Moneymentum</span>
          <div class="h-4 border-l border-border" />
          <WalletHeader
            handleDisconnect={portfolio.handleDisconnect}
            handleNetworkSwitch={portfolio.resetPortfolioStateForNetworkChange}
          />
          <div class="h-4 border-l border-border" />
          <div class="flex gap-1.5">
            <span class="text-muted-foreground">NAV</span>
            <span class="font-mono">${portfolio.accountValue.toFixed(2)}</span>
          </div>
          <div class="flex gap-1.5">
            <span class="text-muted-foreground">Notional</span>
            <span class="font-mono">
              ${portfolio.targetTotalNotional.toFixed(2)}
            </span>
          </div>
          <span class="text-muted-foreground">coming soon...</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="text-muted-foreground">Δ</span>
          <span class="font-mono">coming soon...</span>
          <span class="text-muted-foreground">Γ</span>
          <span class="font-mono">coming soon...</span>
          <span class="text-muted-foreground">Θ</span>
          <span class="font-mono">coming soon...</span>
          <div class="h-4 border-l border-border" />
          <span class="text-muted-foreground">VaR</span>
          <span class="font-mono text-red-400">coming soon...</span>
          <ModeToggle />
          <kbd
            class="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded cursor-pointer hover:bg-muted/80"
            onClick={() => {
              alert("coming soon...")
            }}
          >
            ?
          </kbd>
        </div>
      </header>
      <div
        class={cn(
          "flex flex-1 min-h-0 gap-1 p-1",
          isNetworkSwitching() && "pointer-events-none opacity-50",
        )}
      >
        <div class="flex-1 min-w-0 flex gap-1 overflow-hidden">
          <div class="shrink-0 flex-[0_0_780px] flex flex-col overflow-hidden min-h-0">
            <div class="flex min-h-0 min-w-0 flex-1">
              <PositionsPanel
                currentPortfolio={portfolio.currentPortfolio}
                targetPortfolio={portfolio.targetPortfolio}
                deletedArchive={portfolio.deletedArchive}
                errorsBySymbol={portfolio.errorsBySymbol}
                isLoading={portfolio.isPositionsLoading}
                fundingIsLoading={fundingRatesQuery.isLoading}
                leverageLimitsIsLoading={portfolio.isLeverageLimitsLoading}
                leverageLimitsMap={portfolio.leverageLimitsMap}
                _isRebalancing={portfolio.isRebalancing}
                isPrecise={portfolio.isPrecise}
                onPreciseChange={value => {
                  portfolio.setIsPrecise(value)
                }}
                isManualWeightEntry={portfolio.isManualWeightEntry}
                onManualWeightEntryChange={value => {
                  portfolio.setManualWeightEntry(value)
                }}
                onRemove={portfolio.handleRemoveToken}
                onUndoRemove={portfolio.handleUndoRemoveToken}
                onSideChange={portfolio.handleSideChange}
                onLeverageChange={portfolio.handleLeverageChange}
                onNotionalChange={portfolio.handleNotionalChange}
                onWeightChange={portfolio.handleWeightChange}
                fundingRatesByBaseSymbol={fundingRatesByBaseSymbol()}
                targetTotalNotional={portfolio.targetTotalNotional}
                symbolsBelowMinimum={portfolio.symbolsBelowMinimum}
                symbolsDeltaBelowMinimum={portfolio.symbolsDeltaBelowMinimum}
                hasTotalWeightExceeded={portfolio.hasTotalWeightExceeded}
                targetAllocationPercent={portfolio.targetAllocationPercent}
                readonlyBtcRows={portfolio.readonlyBtcRows}
                isReadonlyBtcLoading={portfolio.isReadonlyBtcLoading}
                readonlyBtcError={portfolio.readonlyBtcError}
                readonlyBtcValidationError={
                  portfolio.readonlyBtcValidationError
                }
                onAddReadonlyBtcAddress={portfolio.addReadonlyBtcAddress}
                onRemoveReadonlyBtcAddress={portfolio.removeReadonlyBtcAddress}
                onReadonlyBtcIncludeInBetaChange={
                  portfolio.setReadonlyBtcIncludeInBeta
                }
                screenerSymbols={screenerSymbols}
                onAddSymbol={portfolio.handleAddToken}
              />
            </div>
            {/* <Show when={portfolio.blockingReasons.length > 0}>
              <Card class="shrink-0">
                <CardContent class="space-y-2 text-sm text-rose-400 py-3">
                  <For each={portfolio.blockingReasons}>
                    {reason => <p>{reason}</p>}
                  </For>
                </CardContent>
              </Card>
            </Show> */}

            {/* Footer */}
            <div class="sticky bottom-0 bg-background/80 backdrop-blur mt-auto">
              <div class="text-[12px] border-t border-border pt-3 flex items-center">
                <div class="flex items-center gap-3 flex-1">
                  <span class="font-semibold text-muted-foreground whitespace-nowrap">
                    Leverage
                  </span>
                  <Show
                    when={!portfolio.isBalanceLoading}
                    fallback={<Skeleton class="h-4 w-full" />}
                  >
                    <Slider
                      value={[portfolio.targetCrossAccountLeverage]}
                      onChange={([selectedLeverage]) => {
                        portfolio.handleCrossAccountLeverageChange(
                          selectedLeverage,
                        )
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
                        setLeverageInput(
                          portfolio.targetCrossAccountLeverage.toFixed(2),
                        )
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

          {/* Right: Analysis panels (PERFORMANCE, STAGED, FACTORS, RISK) */}
          <div class="flex flex-col gap-1 min-h-0 flex-1 min-w-0">
            <PerformancePanel />
            <div class="flex-1 flex gap-1 min-h-0">
              <div class="flex flex-[0_0_40%] min-w-0">
                <StagedChangesPanel
                  stagedTrades={portfolio.stagedTrades}
                  currentTotalNotional={portfolio.currentTotalNotional}
                  targetTotalNotional={portfolio.targetTotalNotional}
                  currentCrossAccountLeverage={
                    portfolio.currentCrossAccountLeverage
                  }
                  targetCrossAccountLeverage={
                    portfolio.targetCrossAccountLeverage
                  }
                  onPrimaryAction={handlePrimaryStagedAction}
                  onUnlocked={handleAgentUnlocked}
                  isRebalancing={portfolio.isRebalancing}
                  canSubmit={portfolio.canSubmit}
                  connectionState={stagedConnectionState()}
                  onClearAll={portfolio.handleResetToCurrent}
                />
              </div>
              <div class="flex-[0_0_25%] min-w-0">
                <FactorsPanel
                  beta={betaResult.beta}
                  isBetaLoading={betaResult.isLoading}
                  betaError={betaResult.error}
                  excludedBetaSymbols={betaResult.excludedSymbols}
                  betaDataAgeHours={betaResult.dataAgeHours}
                  isBetaDataStale={betaResult.isDataStale}
                  betaMethodology={betaResult.methodology}
                />
              </div>
              <div class="flex-1 min-w-0">
                <RiskPanel />
              </div>
            </div>
          </div>
        </div>
      </div>

      <WalletPinDialog
        open={pinDialogOpen()}
        mode="authorize"
        onOpenChange={setPinDialogOpen}
      />
    </>
  )
}

export default PortfolioPage
