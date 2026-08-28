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
import * as Effect from "effect/Effect"
import { toast } from "solid-sonner"
import hyperliquidIconUrl from "@/assets/venues/hyperliquid.png"
import deriveIconUrl from "@/assets/venues/derive.png"
import { ModeToggle } from "@/components/ui/mode-toggle"
import { WalletHeader } from "@/components/wallet-header"
import { WalletProvider } from "@/contexts/WalletProvider"
import { cn } from "@/lib/cn"
import { useDockviewPanelProviders } from "@/lib/dockviewPanelProviders"
import {
  bindDockviewSolidOwner,
  releaseDockviewSolidOwner,
} from "@/lib/dockviewSolidOwner"
import { getErrorMessage } from "@/lib/error-message"
import { hasLiveEip1193Provider } from "@/reown/evmAppKit"
import { useNetwork } from "@/hooks/useNetwork"
import { useWallet } from "@/hooks/useWallet"
import {
  useHyperliquidFundingRates,
  useHyperliquidTickers,
  useWalletSettings,
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

import { DerivePanel } from "./components/DerivePanel"
import { DeriveSettingsMenu } from "./components/DeriveSettingsMenu"
import { FactorsPanel } from "./components/FactorsPanel"
import {
  HyperliquidPanel,
  openHyperliquidConnectModal,
} from "./components/HyperliquidPanel"
import { PerformancePanel } from "./components/PerformancePanel"
import { PortfolioSettingsMenu } from "./components/PortfolioSettingsMenu"
import { PositionsPanel } from "./components/PositionsPanel/PositionsPanel"
import { usePortfolioMetricVisibility } from "./components/PositionsPanel/portfolioMetricVisibility"
import {
  readDeriveGreeksVisible,
  writeDeriveGreeksVisible,
} from "@/components/derive-options/deriveChromeStorage"
import { RiskPanel } from "./components/RiskPanel"
import {
  StagedChangesPanel,
  resolveStagedConnectionState,
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
  persistPortfolioDockviewLayout,
  restorePortfolioDockviewLayout,
  writePortfolioDockviewLayout,
  type PortfolioLayoutHost,
} from "./portfolioLayoutStorage"
import {
  PortfolioShellProvider,
  usePortfolioShell,
} from "./portfolioShellContext"
import {
  isKeyboardPanelId,
  PANEL_DIGIT_BY_ID,
  panelDigitForId,
  PortfolioHotkeyBar,
  PortfolioKeyboardContext,
  PortfolioKeyboardProvider,
  tryUsePortfolioKeyboardContext,
  type KeyboardPanelId,
  type PortfolioKeyboardActions,
  usePortfolioKeyboardContext,
} from "./keyboard"
import { positionStatus } from "./components/PositionsPanel/positionRowModel"
import { dispatchAllSymbolClick } from "./components/PositionsPanel/allSymbolRowModel"
import "./portfolio-dockview.css"

type PortfolioPanelId =
  | "portfolio"
  | "hyperliquid"
  | "derive"
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
    id: "hyperliquid",
    title: "HYPERLIQUID",
    component: "hyperliquid",
    tabComponent: "hyperliquidTab",
    closable: false,
  },
  {
    id: "derive",
    title: "DERIVE",
    component: "derive",
    tabComponent: "deriveTab",
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
    tabComponent: "stagedTab",
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

const formatUsdBalance = (value: number): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const VenueBalancesHeader = () => {
  const { data: walletSettings } = useWalletSettings()

  const connectedVenues = () =>
    walletSettings().venues.filter(
      venue => venue.connected && venue.balanceUsd !== null,
    )

  return (
    <div class="flex items-center gap-3">
      <For each={connectedVenues()}>
        {venue => (
          <div class="flex items-center gap-1.5">
            <img
              src={
                venue.id === "hyperliquid" ? hyperliquidIconUrl : deriveIconUrl
              }
              alt=""
              class="size-4"
              aria-hidden="true"
            />
            <span class="font-mono text-[12px]">
              ${formatUsdBalance(venue.balanceUsd ?? 0)}
            </span>
          </div>
        )}
      </For>
    </div>
  )
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
    if (api.title !== undefined) {
      setTitle(api.title)
    }
    const disposable = api.onDidTitleChange(event => {
      setTitle(event.title)
    })
    onCleanup(() => {
      disposable.dispose()
    })
  })

  return title
}

const LockedTab = (props: IDockviewPanelHeaderProps) => {
  const digit = () => panelDigitForId(props.api.id)

  return (
    <Show when={digit()} fallback={<DockviewDefaultTab {...props} hideClose />}>
      {resolvedDigit => (
        <LockedTabWithDigit {...props} digit={resolvedDigit()} />
      )}
    </Show>
  )
}

const LockedTabWithDigit = (
  props: IDockviewPanelHeaderProps & {
    digit: string
    trailing?: import("solid-js").JSX.Element
  },
) => {
  const title = useDockviewPanelTitle(props)

  return (
    <div
      data-testid="dockview-dv-default-tab"
      class="dv-default-tab portfolio-dockview-tab"
    >
      <span class="dv-default-tab-content portfolio-dockview-tab-title">
        {title()}
      </span>
      <kbd class="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
        {props.digit}
      </kbd>
      {props.trailing}
    </div>
  )
}

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
  const { isNetworkSwitching } = useNetwork()
  const {
    hasStoredSession,
    isLocked,
    isHyperliquidConnected,
    isDeriveConnected,
    isDeriveLocked,
    hasVerifiedSessionPin,
    authorizeAgent,
    setMainAddress,
  } = useWallet()
  const shell = usePortfolioShell()
  const DockviewProviders = useDockviewPanelProviders()
  const portfolio = usePortfolioState()

  const [pinDialogOpen, setPinDialogOpen] = createSignal(false)
  const [pinDialogMode, setPinDialogMode] = createSignal<
    "authorize" | "unlock"
  >("authorize")
  const { metricVisibility, setMetricColumnVisible } =
    usePortfolioMetricVisibility()
  const [deriveGreeksVisible, setDeriveGreeksVisible] = createSignal(
    readDeriveGreeksVisible(),
  )

  let dockviewContainer: HTMLDivElement | undefined
  let layoutChangeDisposable: { dispose: () => void } | undefined
  let pendingLayoutFrame: number | undefined
  let pendingLayoutSnapshot: ReturnType<DockviewApi["toJSON"]> | undefined
  let defaultLayoutSizingTimeout: number | undefined
  let defaultLayoutSizingCancelled = false
  const [dockviewApi, setDockviewApi] = createSignal<DockviewApi | undefined>()
  const [containerWidth, setContainerWidth] = createSignal(0)
  const [containerHeight, setContainerHeight] = createSignal(0)
  const [defaultLayoutSizing, setDefaultLayoutSizing] = createSignal<{
    api: DockviewApi
    portfolioPanel: ReturnType<DockviewApi["addPanel"]>
    performancePanel: ReturnType<DockviewApi["addPanel"]>
    stagedPanel: ReturnType<DockviewApi["addPanel"]>
    factorsPanel: ReturnType<DockviewApi["addPanel"]>
  } | null>(null)

  const stagedConnectionState = (): StagedConnectionState =>
    resolveStagedConnectionState({
      hyperliquidPublicConnected: isHyperliquidConnected(),
      hasHyperliquidAgent: hasStoredSession(),
      hyperliquidUnlocked: hasStoredSession() && !isLocked(),
      deriveConnected: isDeriveConnected(),
      deriveUnlocked: isDeriveConnected() && !isDeriveLocked(),
      hasHyperliquidStagedChanges: portfolio.stagedTrades.some(
        trade => trade.venue === "hyperliquid",
      ),
      hasDeriveStagedChanges: portfolio.stagedTrades.some(
        trade => trade.venue === "derive",
      ),
    })

  const openHyperliquidWalletConnect = () => {
    shell.focusVenue({ venue: "hyperliquid", openConnect: true })
  }

  const openDeriveWalletConnect = () => {
    shell.focusVenue({ venue: "derive", focusWalletField: true })
  }

  const authorizeAgentWithSessionPin = () => {
    void Effect.runPromise(
      authorizeAgent().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            toast.success("Hyperliquid agent connected")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            // Overlapping clicks / Cmd+Enter while authorize is in flight.
            const cause =
              typeof error.cause === "object" && error.cause !== null
                ? error.cause
                : null
            if (
              cause !== null &&
              "_tag" in cause &&
              cause._tag === "WalletOperationContextChanged"
            ) {
              return
            }
            console.error("Failed to authorize Hyperliquid agent:", error)
            toast.error(getErrorMessage(error))
          }),
        ),
      ),
    )
  }

  /**
   * Staged "Connect Hyperliquid agent":
   * - Stored agent exists -> unlock with PIN (never mint a replacement agent)
   * - Live Reown provider required before approveAgent (remembered address is
   *   read-only; AppKit enableReconnect is false)
   * - Open AppKit Connect in place when the provider is missing -- do not bounce
   *   to the Hyperliquid tab (remembered public address already looks "connected")
   * - PIN already entered this browser session -> authorize agent, then wallet sign
   * - otherwise -> PIN dialog, then authorize
   */
  const continueHyperliquidAgentAuthorize = () => {
    if (hasVerifiedSessionPin()) {
      authorizeAgentWithSessionPin()
      return
    }
    setPinDialogMode("authorize")
    setPinDialogOpen(true)
  }

  const beginHyperliquidTradingConnect = () => {
    if (hasStoredSession()) {
      setPinDialogMode("unlock")
      setPinDialogOpen(true)
      return
    }

    void (async () => {
      if (await hasLiveEip1193Provider()) {
        continueHyperliquidAgentAuthorize()
        return
      }

      // Remembered HL address loads the portfolio, but approveAgent needs a live
      // injected provider. Opening AppKit here avoids the Hyperliquid-tab dead
      // end (panel treats remembered address as already connected).
      openHyperliquidConnectModal({
        setMainAddress,
        onConnected: () => {
          void (async () => {
            // AppKit account callback can fire before getProvider is ready.
            for (let attempt = 0; attempt < 30; attempt += 1) {
              if (await hasLiveEip1193Provider()) {
                continueHyperliquidAgentAuthorize()
                return
              }
              await new Promise<void>(resolve => {
                window.setTimeout(resolve, 50)
              })
            }
            toast.error(
              "Wallet connected, but the signer is not ready. Click Connect Hyperliquid agent again.",
            )
          })()
        },
      })
    })()
  }

  const handlePrimaryStagedAction = () => {
    switch (stagedConnectionState()) {
      case "chooseVenue":
      case "agentLocked":
        return
      case "agentMissing":
        beginHyperliquidTradingConnect()
        return
      case "ready":
        portfolio.handleRebalancePositions()
    }
  }

  // createEffect: persist precise toggle to localStorage when it changes
  createEffect(() => {
    writePreciseToggle(portfolio.isPrecise)
  })

  // createEffect: persist manual weight entry toggle to localStorage when it changes
  createEffect(() => {
    writeManualWeightEntry(portfolio.isManualWeightEntry)
  })

  // createEffect: persist Derive greeks visibility when gear / close toggle changes
  createEffect(() => {
    writeDeriveGreeksVisible(deriveGreeksVisible())
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

  // createEffect: keep PORTFOLIO tab title count in sync
  createEffect(() => {
    const count = targetPositionCount()
    dockviewApi()?.getPanel("portfolio")?.api.setTitle(`PORTFOLIO (${count})`)
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

  const KeyboardAwareDockviewProviders = (props: {
    children: import("solid-js").JSX.Element
  }) => {
    const keyboard = tryUsePortfolioKeyboardContext()
    return (
      <DockviewProviders>
        {keyboard ? (
          <PortfolioKeyboardContext.Provider value={keyboard}>
            {props.children}
          </PortfolioKeyboardContext.Provider>
        ) : (
          props.children
        )}
      </DockviewProviders>
    )
  }

  const PortfolioTab = (props: IDockviewPanelHeaderProps) => (
    <KeyboardAwareDockviewProviders>
      <LockedTabWithDigit
        {...props}
        digit={PANEL_DIGIT_BY_ID.portfolio}
        trailing={
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
        }
      />
    </KeyboardAwareDockviewProviders>
  )

  const HyperliquidTab = (props: IDockviewPanelHeaderProps) => (
    <KeyboardAwareDockviewProviders>
      <LockedTabWithDigit {...props} digit={PANEL_DIGIT_BY_ID.hyperliquid} />
    </KeyboardAwareDockviewProviders>
  )

  const DeriveTab = (props: IDockviewPanelHeaderProps) => {
    const title = useDockviewPanelTitle(props)

    return (
      <KeyboardAwareDockviewProviders>
        <div
          data-testid="dockview-dv-default-tab"
          class="dv-default-tab portfolio-dockview-tab"
        >
          <span class="dv-default-tab-content portfolio-dockview-tab-title">
            {title()}
          </span>
          <kbd class="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            {PANEL_DIGIT_BY_ID.derive}
          </kbd>
          <DeriveSettingsMenu
            greeksVisible={deriveGreeksVisible}
            onGreeksVisibleChange={setDeriveGreeksVisible}
          />
        </div>
      </KeyboardAwareDockviewProviders>
    )
  }

  const StagedTab = (props: IDockviewPanelHeaderProps) => (
    <KeyboardAwareDockviewProviders>
      <LockedTabWithDigit {...props} digit={PANEL_DIGIT_BY_ID.staged} />
    </KeyboardAwareDockviewProviders>
  )

  const panelComponents = {
    portfolio: (_props: IDockviewPanelProps) => (
      <KeyboardAwareDockviewProviders>
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
            hasUnderAllocation={portfolio.hasUnderAllocation}
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
      </KeyboardAwareDockviewProviders>
    ),
    hyperliquid: (_props: IDockviewPanelProps) => (
      <KeyboardAwareDockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <HyperliquidPanel
            screenerSymbols={screenerSymbols}
            targetPortfolio={portfolio.targetPortfolio}
            deletedArchive={portfolio.deletedArchive}
            fundingIsLoading={fundingRatesQuery.isLoading}
            fundingRatesByBaseSymbol={fundingRatesByBaseSymbol()}
            metricVisibility={metricVisibility()}
            onRemove={portfolio.handleRemoveToken}
            onUndoRemove={portfolio.handleUndoRemoveToken}
            onAddSymbol={symbol => {
              portfolio.handleAddToken(symbol, "perp", "hyperliquid")
            }}
          />
        </div>
      </KeyboardAwareDockviewProviders>
    ),
    derive: (panelProps: IDockviewPanelProps) => {
      const [isPanelVisible, setIsPanelVisible] = createSignal(true)

      // createEffect: track dockview panel visibility for options stream lifecycle.
      createEffect(() => {
        // Dockview's isVisible is imperative; seed once then subscribe to changes.
        setIsPanelVisible(panelProps.api.isVisible)
        const disposable = panelProps.api.onDidVisibilityChange(event => {
          setIsPanelVisible(event.isVisible)
        })
        onCleanup(() => {
          disposable.dispose()
        })
      })

      return (
        <KeyboardAwareDockviewProviders>
          <div class="portfolio-dockview-panel-body">
            <DerivePanel
              isPanelVisible={isPanelVisible}
              greeksVisible={deriveGreeksVisible}
              onGreeksVisibleChange={setDeriveGreeksVisible}
              onAddOption={request => {
                portfolio.handleAddToken(request.symbol, "option", "derive", {
                  side: request.side,
                  notional: request.notional,
                })
              }}
            />
          </div>
        </KeyboardAwareDockviewProviders>
      )
    },
    performance: (_props: IDockviewPanelProps) => (
      <KeyboardAwareDockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <PerformancePanel />
        </div>
      </KeyboardAwareDockviewProviders>
    ),
    staged: (_props: IDockviewPanelProps) => (
      <KeyboardAwareDockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <StagedChangesPanel
            stagedTrades={portfolio.stagedTrades}
            currentTotalNotional={portfolio.currentTotalNotional}
            targetTotalNotional={portfolio.targetTotalNotional}
            currentCrossAccountLeverage={portfolio.currentCrossAccountLeverage}
            targetCrossAccountLeverage={portfolio.targetCrossAccountLeverage}
            onPrimaryAction={handlePrimaryStagedAction}
            onChooseHyperliquid={openHyperliquidWalletConnect}
            onChooseDerive={openDeriveWalletConnect}
            isRebalancing={portfolio.isRebalancing}
            canSubmit={portfolio.canSubmit}
            connectionState={stagedConnectionState()}
            onClearAll={portfolio.handleResetToCurrent}
          />
        </div>
      </KeyboardAwareDockviewProviders>
    ),
    factors: (_props: IDockviewPanelProps) => (
      <KeyboardAwareDockviewProviders>
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
      </KeyboardAwareDockviewProviders>
    ),
    risk: (_props: IDockviewPanelProps) => (
      <KeyboardAwareDockviewProviders>
        <div class="portfolio-dockview-panel-body">
          <RiskPanel />
        </div>
      </KeyboardAwareDockviewProviders>
    ),
  }

  const applyDefaultLayout = (api: DockviewApi) => {
    const portfolioConfig = findPanelCatalogEntry("portfolio")
    const hyperliquidConfig = findPanelCatalogEntry("hyperliquid")
    const deriveConfig = findPanelCatalogEntry("derive")
    const performanceConfig = findPanelCatalogEntry("performance")
    const stagedConfig = findPanelCatalogEntry("staged")
    const factorsConfig = findPanelCatalogEntry("factors")
    const riskConfig = findPanelCatalogEntry("risk")

    if (
      portfolioConfig === undefined ||
      hyperliquidConfig === undefined ||
      deriveConfig === undefined ||
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
      id: hyperliquidConfig.id,
      component: hyperliquidConfig.component,
      tabComponent: hyperliquidConfig.tabComponent,
      title: hyperliquidConfig.title,
      position: { referencePanel: portfolioConfig.id, direction: "within" },
    })

    api.addPanel({
      id: deriveConfig.id,
      component: deriveConfig.component,
      tabComponent: deriveConfig.tabComponent,
      title: deriveConfig.title,
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

    setDefaultLayoutSizing({
      api,
      portfolioPanel,
      performancePanel,
      stagedPanel,
      factorsPanel,
    })
  }

  // createEffect: retry default panel sizing until the dockview host is large
  // enough; cancel any pending timeout when the pending target changes.
  createEffect(() => {
    const pending = defaultLayoutSizing()
    if (pending === null) {
      return
    }

    const layoutWidth = containerWidth()
    const layoutHeight = containerHeight()
    if (layoutWidth < 100 || layoutHeight < 100) {
      return
    }

    if (defaultLayoutSizingTimeout !== undefined) {
      window.clearTimeout(defaultLayoutSizingTimeout)
      defaultLayoutSizingTimeout = undefined
    }

    const activeApi = dockviewApi()
    // setTimeout: wait one macrotask so Dockview finishes inserting panels
    // before setSize.
    defaultLayoutSizingTimeout = window.setTimeout(() => {
      defaultLayoutSizingTimeout = undefined
      if (defaultLayoutSizingCancelled) {
        return
      }
      if (activeApi !== pending.api) {
        setDefaultLayoutSizing(null)
        return
      }

      const leftWidth = Math.floor(layoutWidth * 0.48)
      const rightWidth = Math.max(layoutWidth - leftWidth, 1)
      const topHeight = Math.floor(layoutHeight * 0.45)
      const bottomHeight = Math.max(layoutHeight - topHeight, 1)

      pending.portfolioPanel.group.api.setSize({ width: leftWidth })
      pending.performancePanel.group.api.setSize({ width: rightWidth })
      pending.performancePanel.api.setSize({ height: topHeight })
      pending.stagedPanel.group.api.setSize({
        width: Math.floor(rightWidth * 0.4),
        height: bottomHeight,
      })
      pending.factorsPanel.group.api.setSize({
        width: Math.floor(rightWidth * 0.25),
      })
      setDefaultLayoutSizing(null)
    }, 0)

    onCleanup(() => {
      if (defaultLayoutSizingTimeout !== undefined) {
        window.clearTimeout(defaultLayoutSizingTimeout)
        defaultLayoutSizingTimeout = undefined
      }
    })
  })

  const handleReady = (event: DockviewReadyEvent) => {
    setDockviewApi(event.api)

    const layoutHost: PortfolioLayoutHost = {
      fromJSON: layout => {
        event.api.fromJSON(layout)
      },
      clear: () => {
        event.api.clear()
      },
      toJSON: () => event.api.toJSON(),
      hasPanel: panelId => event.api.getPanel(panelId) !== undefined,
    }

    if (
      restorePortfolioDockviewLayout(layoutHost) === "requires-default-layout"
    ) {
      applyDefaultLayout(event.api)
      persistPortfolioDockviewLayout(layoutHost)
    }

    const flushPendingLayoutWrite = () => {
      if (pendingLayoutFrame !== undefined) {
        window.cancelAnimationFrame(pendingLayoutFrame)
        pendingLayoutFrame = undefined
      }
      if (pendingLayoutSnapshot === undefined) {
        return
      }
      const layout = pendingLayoutSnapshot
      pendingLayoutSnapshot = undefined
      writePortfolioDockviewLayout(layout)
    }

    const layoutChange = event.api.onDidLayoutChange(() => {
      pendingLayoutSnapshot = event.api.toJSON()
      if (pendingLayoutFrame !== undefined) {
        return
      }
      pendingLayoutFrame = window.requestAnimationFrame(() => {
        pendingLayoutFrame = undefined
        flushPendingLayoutWrite()
      })
    })
    layoutChangeDisposable = {
      dispose: () => {
        flushPendingLayoutWrite()
        layoutChange.dispose()
      },
    }

    const activeChange = event.api.onDidActivePanelChange(panel => {
      const panelId = panel?.id
      if (panelId !== undefined && isKeyboardPanelId(panelId)) {
        keyboardBridge?.onPanelActivated(panelId)
      }
    })
    activePanelChangeDisposable = activeChange
  }

  onCleanup(() => {
    defaultLayoutSizingCancelled = true
    if (defaultLayoutSizingTimeout !== undefined) {
      window.clearTimeout(defaultLayoutSizingTimeout)
      defaultLayoutSizingTimeout = undefined
    }
    layoutChangeDisposable?.dispose()
    activePanelChangeDisposable?.dispose()
  })

  const keyboardActions = (): PortfolioKeyboardActions => ({
    activatePanel: (panelId: KeyboardPanelId) => {
      dockviewApi()?.getPanel(panelId)?.api.setActive()
    },
    getPortfolioSymbols: () =>
      Object.keys({
        ...portfolio.currentPortfolio,
        ...portfolio.targetPortfolio,
      }),
    getAllSymbolSymbols: () => screenerSymbols(),
    isPinDialogOpen: () => pinDialogOpen(),
    connectionState: () => stagedConnectionState(),
    isDeriveSessionLocked: () => isDeriveLocked(),
    onRemove: portfolio.handleRemoveToken,
    onUndoRemove: portfolio.handleUndoRemoveToken,
    onSideChange: portfolio.handleSideChange,
    onLeverageChange: portfolio.handleLeverageChange,
    getPositionSide: symbol =>
      (
        portfolio.targetPortfolio[symbol] ??
        portfolio.deletedArchive[symbol] ??
        portfolio.currentPortfolio[symbol]
      )?.side,
    getPositionLeverage: symbol => {
      const position =
        portfolio.targetPortfolio[symbol] ??
        portfolio.deletedArchive[symbol] ??
        portfolio.currentPortfolio[symbol]
      return position?.kind === "perp" ? position.leverage : undefined
    },
    getMaxLeverage: symbol => portfolio.leverageLimitsMap[symbol],
    getCrossAccountLeverage: () => portfolio.targetCrossAccountLeverage,
    onCrossAccountLeverageChange: portfolio.handleCrossAccountLeverageChange,
    isPositionClosing: symbol =>
      positionStatus(
        symbol,
        portfolio.currentPortfolio,
        portfolio.targetPortfolio,
      ) === "closing",
    onAllSymbolEnter: symbol => {
      dispatchAllSymbolClick(
        symbol,
        portfolio.targetPortfolio,
        portfolio.deletedArchive,
        {
          onAdd: addSymbol => {
            portfolio.handleAddToken(addSymbol, "perp", "hyperliquid")
          },
          onRemove: portfolio.handleRemoveToken,
          onUndoRemove: portfolio.handleUndoRemoveToken,
        },
      )
    },
    onStagedSubmit: handlePrimaryStagedAction,
    onStagedClearAll: portfolio.handleResetToCurrent,
    onOpenWalletPinDialog: () => {
      beginHyperliquidTradingConnect()
    },
  })

  let keyboardBridge: ReturnType<typeof usePortfolioKeyboardContext> | undefined
  let activePanelChangeDisposable: { dispose: () => void } | undefined

  const KeyboardBridge = () => {
    keyboardBridge = usePortfolioKeyboardContext()
    return null
  }

  const ShellFocusBridge = () => {
    const shell = usePortfolioShell()

    // createEffect: activate the dockview panel when header/portfolio requests a venue.
    createEffect(() => {
      const request = shell.focusVenueRequest()
      if (request === null) {
        return
      }
      const panelId = request.venue === "hyperliquid" ? "hyperliquid" : "derive"
      dockviewApi()?.getPanel(panelId)?.api.setActive()
      keyboardBridge?.onPanelActivated(panelId)
    })

    return null
  }

  const HotkeyBarHost = () => {
    const keyboard = usePortfolioKeyboardContext()
    return <PortfolioHotkeyBar focusedPanel={keyboard.focusedPanel()} />
  }

  /** Bind dockview portals under the keyboard provider owner so panels see hotkeys. */
  const DockviewOwnerBinder = () => {
    const ownerToken = bindDockviewSolidOwner(getOwner())
    onCleanup(() => {
      releaseDockviewSolidOwner(ownerToken)
    })
    return null
  }

  return (
    <PortfolioKeyboardProvider actions={keyboardActions()}>
      <DockviewOwnerBinder />
      <KeyboardBridge />
      <ShellFocusBridge />
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header class="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
          <div class="flex items-center gap-5">
            <span class="font-semibold">Moneymentum</span>
            <div class="h-4 border-l border-border" />
            <WalletHeader
              handleDisconnect={portfolio.handleDisconnect}
              handleDisconnectDerive={portfolio.handleDisconnectDerive}
              handleNetworkSwitch={
                portfolio.resetPortfolioStateForNetworkChange
              }
            />
            <div class="h-4 border-l border-border" />
            <VenueBalancesHeader />
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
              hyperliquidTab: HyperliquidTab,
              deriveTab: DeriveTab,
              stagedTab: StagedTab,
              closableTab: ClosableTab,
            }}
            rightHeaderActionsComponent={AddPanelMenu}
            onReady={handleReady}
          />
        </div>

        <HotkeyBarHost />

        <WalletPinDialog
          open={pinDialogOpen()}
          mode={pinDialogMode()}
          onOpenChange={setPinDialogOpen}
        />
      </div>
    </PortfolioKeyboardProvider>
  )
}

const PortfolioRoute = () => (
  <WalletProvider>
    <PortfolioShellProvider>
      <PortfolioPage />
    </PortfolioShellProvider>
  </WalletProvider>
)

export default PortfolioRoute
