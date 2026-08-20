import {
  createEffect,
  createMemo,
  createSignal,
  For,
  getOwner,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { ModeToggle } from "@/components/ui/mode-toggle"
import { WalletHeader } from "@/components/wallet-header"
import { WalletProvider } from "@/contexts/WalletProvider"
import { cn } from "@/lib/cn"
import { useDockviewPanelProviders } from "@/lib/dockviewPanelProviders"
import { bindDockviewSolidOwner } from "@/lib/dockviewSolidOwner"
import { useNetwork } from "@/hooks/useNetwork"
import { useWallet } from "@/hooks/useWallet"
import {
  useHyperliquidFundingRates,
  useHyperliquidTickers,
} from "@/hooks/useTrading"
import "@arminmajerie/dockview-solid/styles/dockview.css"
import {
  DockviewDefaultTab,
  DockviewSolid,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "@arminmajerie/dockview-solid"

import { AllSymbolsPanel } from "./components/AllSymbolsPanel"
import { FactorsPanel } from "./components/FactorsPanel"
import { PerformancePanel } from "./components/PerformancePanel"
import { PortfolioSettingsMenu } from "./components/PortfolioSettingsMenu"
import { PositionsPanel } from "./components/PositionsPanel/PositionsPanel"
import {
  readPortfolioMetricVisibility,
  writePortfolioMetricVisibility,
  type PortfolioMetricColumnId,
  type PortfolioMetricVisibility,
} from "./components/PositionsPanel/portfolioMetricVisibility"
import { RiskPanel } from "./components/RiskPanel"
import {
  StagedChangesPanel,
  type StagedConnectionState,
} from "./components/StagedChangesPanel"
import { WalletPinDialog } from "./components/WalletPinDialog"
import { useBeta, type BetaBenchmark } from "./hooks/useBeta"
import {
  usePortfolioState,
  writeManualWeightEntry,
  writePreciseToggle,
} from "./hooks/usePortfolioState"
import {
  readPortfolioDockviewLayout,
  writePortfolioDockviewLayout,
} from "./portfolioLayoutStorage"
import "./portfolio-dockview.css"

type PortfolioPanelId =
  | "portfolio"
  | "allSymbols"
  | "performance"
  | "staged"
  | "factors"
  | "risk"

type ClosablePanelId = "performance" | "factors" | "risk"

type PanelCatalogEntry =
  | {
      id: ClosablePanelId
      title: string
      component: string
      tabComponent: string
      closable: true
    }
  | {
      id: Exclude<PortfolioPanelId, ClosablePanelId>
      title: string
      component: string
      tabComponent: string
      closable: false
    }

const panelCatalog: PanelCatalogEntry[] = [
  {
    id: "portfolio",
    title: "PORTFOLIO",
    component: "portfolio",
    tabComponent: "portfolioTab",
    closable: false,
  },
  {
    id: "allSymbols",
    title: "ALL SYMBOLS",
    component: "allSymbols",
    tabComponent: "lockedTab",
    closable: false,
  },
  {
    id: "performance",
    title: "PERFORMANCE",
    component: "performance",
    tabComponent: "closableTab",
    closable: true,
  },
  {
    id: "staged",
    title: "STAGED CHANGES",
    component: "staged",
    tabComponent: "lockedTab",
    closable: false,
  },
  {
    id: "factors",
    title: "FACTORS",
    component: "factors",
    tabComponent: "closableTab",
    closable: true,
  },
  {
    id: "risk",
    title: "RISK",
    component: "risk",
    tabComponent: "closableTab",
    closable: true,
  },
]

const closablePanelIds: ClosablePanelId[] = panelCatalog
  .filter(
    (entry): entry is Extract<PanelCatalogEntry, { closable: true }> =>
      entry.closable,
  )
  .map(entry => entry.id)

const findPanelCatalogEntry = (
  panelId: string,
): PanelCatalogEntry | undefined =>
  panelCatalog.find(entry => entry.id === panelId)

const bitcoinBetaBenchmark: BetaBenchmark = {
  symbol: "BTC",
  label: "BTC perpetual on Hyperliquid",
  interval: "daily log returns",
  lookback: "365 calendar days",
}

/** App-token theme; avoids dockview-theme-dark (#1e1e1e) fighting --background. */
const portfolioDockviewTheme: DockviewTheme = {
  name: "portfolio",
  className: "portfolio-dockview-theme",
  gap: 4,
}

const useDockviewPanelTitle = (props: IDockviewPanelHeaderProps) => {
  const [title, setTitle] = createSignal("")

  // createEffect: sync the title signal with the imperative Dockview API
  // subscription and dispose the listener on cleanup.
  createEffect(() => {
    const api = props.api
    setTitle(api.title)
    const disposable = api.onDidTitleChange(event => {
      setTitle(event.title)
    })
    onCleanup(() => {
      disposable.dispose()
    })
  })

  return title
}

const LockedTab = (props: IDockviewPanelHeaderProps) => (
  <DockviewDefaultTab {...props} hideClose />
)

const ClosableTab = (props: IDockviewPanelHeaderProps) => (
  <DockviewDefaultTab {...props} />
)

const AddPanelMenu = (props: IDockviewHeaderActionsProps) => {
  const [menuOpen, setMenuOpen] = createSignal(false)
  let menuRef: HTMLDivElement | undefined

  onMount(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!menuOpen()) {
        return
      }
      if (menuRef && !menuRef.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleDocumentClick)
    onCleanup(() => {
      document.removeEventListener("mousedown", handleDocumentClick)
    })
  })

  const closedClosablePanelIds = () =>
    closablePanelIds.filter(
      panelId => props.containerApi.getPanel(panelId) === undefined,
    )

  const addPanel = (panelId: ClosablePanelId) => {
    const config = findPanelCatalogEntry(panelId)
    if (!config) {
      return
    }

    const activePanel = props.activePanel
    const position =
      activePanel === undefined
        ? undefined
        : {
            referencePanel: activePanel,
            direction: "within" as const,
          }

    props.containerApi.addPanel({
      id: config.id,
      component: config.component,
      tabComponent: config.tabComponent,
      title: config.title,
      position,
    })

    setMenuOpen(false)
  }

  return (
    <div ref={menuRef} class="relative">
      <button
        type="button"
        class="portfolio-dockview-add-button"
        title="Add panel"
        onClick={() => {
          setMenuOpen(open => !open)
        }}
      >
        +
      </button>
      <Show when={menuOpen()}>
        <div class="portfolio-dockview-menu">
          <Show
            when={closedClosablePanelIds().length > 0}
            fallback={
              <div class="px-3 py-2 text-muted-foreground">All panels open</div>
            }
          >
            <For each={closedClosablePanelIds()}>
              {panelId => {
                const config = findPanelCatalogEntry(panelId)
                return (
                  <button
                    type="button"
                    class="portfolio-dockview-menu-item"
                    onClick={() => {
                      addPanel(panelId)
                    }}
                  >
                    {config?.title ?? panelId}
                  </button>
                )
              }}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const PortfolioPage = () => {
  const portfolioOwner = getOwner()
  bindDockviewSolidOwner(portfolioOwner)
  onCleanup(() => {
    bindDockviewSolidOwner(null)
  })

  const { isNetworkSwitching } = useNetwork()
  const { hasStoredSession, isLocked, canTrade, isConnected } = useWallet()
  const DockviewProviders = useDockviewPanelProviders()
  const portfolio = usePortfolioState()

  const [pinDialogOpen, setPinDialogOpen] = createSignal(false)
  const [metricVisibility, setMetricVisibility] =
    createSignal<PortfolioMetricVisibility>(readPortfolioMetricVisibility())

  let dockviewApi: DockviewApi | undefined
  let dockviewContainer: HTMLDivElement | undefined
  let layoutChangeDisposable: { dispose: () => void } | undefined
  const [containerWidth, setContainerWidth] = createSignal(0)
  const [containerHeight, setContainerHeight] = createSignal(0)

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

  // createEffect: persist metric visibility when gear toggles change
  createEffect(() => {
    writePortfolioMetricVisibility(metricVisibility())
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

  const targetPositionCount = createMemo(
    () => Object.keys(portfolio.targetPortfolio).length,
  )

  const setMetricColumnVisible = (
    columnId: PortfolioMetricColumnId,
    visible: boolean,
  ) => {
    setMetricVisibility(previous => ({
      ...previous,
      [columnId]: visible,
    }))
  }

  // createEffect: keep PORTFOLIO tab title count in sync
  createEffect(() => {
    const count = targetPositionCount()
    dockviewApi?.getPanel("portfolio")?.api.setTitle(`PORTFOLIO (${count})`)
  })

  onMount(() => {
    const container = dockviewContainer
    if (!container) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      setContainerWidth(container.offsetWidth)
      setContainerHeight(container.offsetHeight)
    })

    resizeObserver.observe(container)
    setContainerWidth(container.offsetWidth)
    setContainerHeight(container.offsetHeight)

    onCleanup(() => {
      resizeObserver.disconnect()
    })
  })

  const PortfolioTab = (props: IDockviewPanelHeaderProps) => {
    const title = useDockviewPanelTitle(props)

    return (
      <DockviewProviders>
        <div class="dv-default-tab portfolio-dockview-tab">
          <span class="dv-default-tab-content portfolio-dockview-tab-title">
            {title()}
          </span>
          <PortfolioSettingsMenu
            isPrecise={portfolio.isPrecise}
            onPreciseChange={value => {
              portfolio.setIsPrecise(value)
            }}
            isManualWeightEntry={portfolio.isManualWeightEntry}
            onManualWeightEntryChange={value => {
              portfolio.setManualWeightEntry(value)
            }}
            metricVisibility={metricVisibility()}
            onMetricVisibilityChange={setMetricColumnVisible}
          />
        </div>
      </DockviewProviders>
    )
  }

  const panelComponents = {
    portfolio: (_props: IDockviewPanelProps) => (
      <DockviewProviders>
        <div class="portfolio-dockview-panel-body">
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
            readonlyBtcValidationError={portfolio.readonlyBtcValidationError}
            onAddReadonlyBtcAddress={portfolio.addReadonlyBtcAddress}
            onRemoveReadonlyBtcAddress={portfolio.removeReadonlyBtcAddress}
            onReadonlyBtcIncludeInBetaChange={
              portfolio.setReadonlyBtcIncludeInBeta
            }
            metricVisibility={metricVisibility()}
            isBalanceLoading={portfolio.isBalanceLoading}
            targetCrossAccountLeverage={portfolio.targetCrossAccountLeverage}
            onCrossAccountLeverageChange={
              portfolio.handleCrossAccountLeverageChange
            }
          />
        </div>
      </DockviewProviders>
    ),
    allSymbols: (_props: IDockviewPanelProps) => (
      <DockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <AllSymbolsPanel
            screenerSymbols={screenerSymbols}
            targetPortfolio={portfolio.targetPortfolio}
            deletedArchive={portfolio.deletedArchive}
            fundingIsLoading={fundingRatesQuery.isLoading}
            fundingRatesByBaseSymbol={fundingRatesByBaseSymbol()}
            metricVisibility={metricVisibility()}
            onRemove={portfolio.handleRemoveToken}
            onUndoRemove={portfolio.handleUndoRemoveToken}
            onAddSymbol={portfolio.handleAddToken}
          />
        </div>
      </DockviewProviders>
    ),
    performance: (_props: IDockviewPanelProps) => (
      <DockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <PerformancePanel />
        </div>
      </DockviewProviders>
    ),
    staged: (_props: IDockviewPanelProps) => (
      <DockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <StagedChangesPanel
            stagedTrades={portfolio.stagedTrades}
            currentTotalNotional={portfolio.currentTotalNotional}
            targetTotalNotional={portfolio.targetTotalNotional}
            currentCrossAccountLeverage={portfolio.currentCrossAccountLeverage}
            targetCrossAccountLeverage={portfolio.targetCrossAccountLeverage}
            onPrimaryAction={handlePrimaryStagedAction}
            onUnlocked={handleAgentUnlocked}
            isRebalancing={portfolio.isRebalancing}
            canSubmit={portfolio.canSubmit}
            connectionState={stagedConnectionState()}
            onClearAll={portfolio.handleResetToCurrent}
          />
        </div>
      </DockviewProviders>
    ),
    factors: (_props: IDockviewPanelProps) => (
      <DockviewProviders>
        <div class="portfolio-dockview-panel-body">
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
      </DockviewProviders>
    ),
    risk: (_props: IDockviewPanelProps) => (
      <DockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <RiskPanel />
        </div>
      </DockviewProviders>
    ),
  }

  const applyDefaultLayout = (api: DockviewApi) => {
    const layoutWidth = containerWidth()
    const layoutHeight = containerHeight()

    const portfolioConfig = findPanelCatalogEntry("portfolio")
    const allSymbolsConfig = findPanelCatalogEntry("allSymbols")
    const performanceConfig = findPanelCatalogEntry("performance")
    const stagedConfig = findPanelCatalogEntry("staged")
    const factorsConfig = findPanelCatalogEntry("factors")
    const riskConfig = findPanelCatalogEntry("risk")

    if (
      portfolioConfig === undefined ||
      allSymbolsConfig === undefined ||
      performanceConfig === undefined ||
      stagedConfig === undefined ||
      factorsConfig === undefined ||
      riskConfig === undefined
    ) {
      return
    }

    const portfolioPanel = api.addPanel({
      id: portfolioConfig.id,
      component: portfolioConfig.component,
      tabComponent: portfolioConfig.tabComponent,
      title: `PORTFOLIO (${targetPositionCount()})`,
    })

    api.addPanel({
      id: allSymbolsConfig.id,
      component: allSymbolsConfig.component,
      tabComponent: allSymbolsConfig.tabComponent,
      title: allSymbolsConfig.title,
      position: { referencePanel: portfolioConfig.id, direction: "within" },
    })

    const performancePanel = api.addPanel({
      id: performanceConfig.id,
      component: performanceConfig.component,
      tabComponent: performanceConfig.tabComponent,
      title: performanceConfig.title,
      position: { referencePanel: portfolioConfig.id, direction: "right" },
    })

    const stagedPanel = api.addPanel({
      id: stagedConfig.id,
      component: stagedConfig.component,
      tabComponent: stagedConfig.tabComponent,
      title: stagedConfig.title,
      position: { referencePanel: performanceConfig.id, direction: "below" },
    })

    const factorsPanel = api.addPanel({
      id: factorsConfig.id,
      component: factorsConfig.component,
      tabComponent: factorsConfig.tabComponent,
      title: factorsConfig.title,
      position: { referencePanel: stagedConfig.id, direction: "right" },
    })

    api.addPanel({
      id: riskConfig.id,
      component: riskConfig.component,
      tabComponent: riskConfig.tabComponent,
      title: riskConfig.title,
      position: { referencePanel: factorsConfig.id, direction: "right" },
    })

    if (layoutWidth < 100 || layoutHeight < 100) {
      return
    }

    window.setTimeout(() => {
      const leftWidth = Math.floor(layoutWidth * 0.48)
      const rightWidth = Math.max(layoutWidth - leftWidth, 1)
      const topHeight = Math.floor(layoutHeight * 0.45)
      const bottomHeight = Math.max(layoutHeight - topHeight, 1)

      portfolioPanel.group.api.setSize({ width: leftWidth })
      performancePanel.group.api.setSize({ width: rightWidth })
      performancePanel.api.setSize({ height: topHeight })
      stagedPanel.group.api.setSize({
        width: Math.floor(rightWidth * 0.4),
        height: bottomHeight,
      })
      factorsPanel.group.api.setSize({
        width: Math.floor(rightWidth * 0.25),
      })
    }, 0)
  }

  const handleReady = (event: DockviewReadyEvent) => {
    dockviewApi = event.api

    const hasRequiredPanels = (): boolean =>
      (["portfolio", "allSymbols", "staged"] as const).every(
        panelId => event.api.getPanel(panelId) !== undefined,
      )

    const persistRepairedLayout = () => {
      try {
        writePortfolioDockviewLayout(event.api.toJSON())
      } catch {
        // QuotaExceededError / SecurityError: keep trading; drop persistence.
      }
    }

    const savedLayout = readPortfolioDockviewLayout()
    if (savedLayout !== null) {
      try {
        event.api.fromJSON(savedLayout)
        if (!hasRequiredPanels()) {
          event.api.clear()
          applyDefaultLayout(event.api)
          persistRepairedLayout()
        }
      } catch {
        event.api.clear()
        applyDefaultLayout(event.api)
        persistRepairedLayout()
      }
    } else {
      applyDefaultLayout(event.api)
      persistRepairedLayout()
    }

    const layoutChange = event.api.onDidLayoutChange(() => {
      try {
        writePortfolioDockviewLayout(event.api.toJSON())
      } catch {
        // QuotaExceededError / SecurityError: keep trading; drop persistence.
      }
    })
    layoutChangeDisposable = layoutChange
  }

  onCleanup(() => {
    layoutChangeDisposable?.dispose()
  })

  return (
    <>
      <header class="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
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
            class="cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/80"
            onClick={() => {
              alert("coming soon...")
            }}
          >
            ?
          </kbd>
        </div>
      </header>

      <div
        ref={dockviewContainer}
        class={cn(
          "portfolio-dockview-shell min-h-0 flex-1 p-1",
          isNetworkSwitching() && "pointer-events-none opacity-50",
        )}
      >
        <DockviewSolid
          theme={portfolioDockviewTheme}
          components={panelComponents}
          tabComponents={{
            portfolioTab: PortfolioTab,
            lockedTab: LockedTab,
            closableTab: ClosableTab,
          }}
          rightHeaderActionsComponent={AddPanelMenu}
          onReady={handleReady}
        />
      </div>

      <WalletPinDialog
        open={pinDialogOpen()}
        mode="authorize"
        onOpenChange={setPinDialogOpen}
      />
    </>
  )
}

const PortfolioRoute = () => (
  <WalletProvider>
    <PortfolioPage />
  </WalletProvider>
)

export default PortfolioRoute
