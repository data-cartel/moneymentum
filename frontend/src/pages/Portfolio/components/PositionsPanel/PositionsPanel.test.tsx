import { render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ParentProps } from "solid-js"

import type { FactorScore } from "../../hooks/useFactorScores"
import type { PortfolioInterface } from "../../hooks/usePortfolioState"
import { AllSymbolsPanel } from "../AllSymbolsPanel"
import { PortfolioSettingsMenu } from "../PortfolioSettingsMenu"
import {
  DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
  PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
  usePortfolioMetricVisibility,
} from "./portfolioMetricVisibility"
import { PositionsPanel } from "./PositionsPanel"

const useFactorScoresMock = vi.hoisted(() => vi.fn())

vi.mock("@tanstack/solid-virtual", () => ({
  createVirtualizer: (options: { count: number }) => {
    const resolveCount = () => options.count

    return {
      getVirtualItems: () =>
        Array.from({ length: resolveCount() }, (_, index) => ({
          index,
          start: index * 34,
          end: (index + 1) * 34,
          size: 34,
          key: index,
        })),
      getTotalSize: () => resolveCount() * 34,
      scrollToOffset: vi.fn(),
    }
  },
}))

const walletState = vi.hoisted(() => ({
  connection: "connected" as "connected" | "disconnected",
}))

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    isConnected: () => walletState.connection === "connected",
    mainAddress: () => null,
    setMainAddress: vi.fn(),
    deriveCredentials: () => null,
    networkMode: () => "testnet" as const,
    isDeriveConnected: () => false,
    isDeriveLocked: () => false,
  }),
}))

vi.mock("@/reown/evmAppKit", () => ({
  ensureEvmAppKit: async () => null,
  prefetchEvmAppKit: () => undefined,
  readEvmAddressFromAccountState: () => null,
  readEvmWalletConnectedFromAccountState: () => false,
  readReownProjectId: () => null,
}))

vi.mock("../../hooks/useFactorScores", () => ({
  useFactorScores: useFactorScoresMock,
}))

const btcFactorScore: FactorScore = {
  ticker: "BTC",
  beta: 1.1,
  annualized_volatility: 0.45,
  sharpe: 1.23,
  sortino: null,
  cum_return: null,
  carry: null,
}

const ethFactorScore: FactorScore = {
  ticker: "ETH",
  beta: 0.9,
  annualized_volatility: 0.55,
  sharpe: 0.87,
  sortino: null,
  cum_return: null,
  carry: null,
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}

const AllSymbolsWithSettings = () => {
  const { metricVisibility, setMetricColumnVisible } =
    usePortfolioMetricVisibility()
  const screenerSymbols = () => ["BTC/USDC:USDC", "ETH/USDC:USDC"]

  return (
    <>
      <PortfolioSettingsMenu
        isPrecise={false}
        onPreciseChange={vi.fn()}
        isManualWeightEntry={false}
        onManualWeightEntryChange={vi.fn()}
        metricVisibility={metricVisibility()}
        onMetricVisibilityChange={setMetricColumnVisible}
      />
      <AllSymbolsPanel
        screenerSymbols={screenerSymbols}
        targetPortfolio={{}}
        deletedArchive={{}}
        fundingIsLoading={false}
        fundingRatesByBaseSymbol={{ BTC: 0.00001, ETH: 0.00001 }}
        metricVisibility={metricVisibility()}
        onRemove={vi.fn()}
        onUndoRemove={vi.fn()}
        onAddSymbol={vi.fn()}
      />
    </>
  )
}

const bitcoinPosition: PortfolioInterface = {
  symbol: "BTC/USDC:USDC",
  side: "buy",
  leverage: 2,
  notional: 600,
}

const ethereumPosition: PortfolioInterface = {
  symbol: "ETH/USDC:USDC",
  side: "sell",
  leverage: 1,
  notional: 400,
}

type PositionsPanelProps = Parameters<typeof PositionsPanel>[0]

const positionsPanelProps = (
  overrides: Partial<PositionsPanelProps> = {},
): PositionsPanelProps => ({
  hasTotalWeightExceeded: false,
  hasUnderAllocation: false,
  currentPortfolio: { "BTC/USDC:USDC": bitcoinPosition },
  targetPortfolio: {
    "BTC/USDC:USDC": bitcoinPosition,
    "ETH/USDC:USDC": ethereumPosition,
  },
  deletedArchive: {},
  errorsBySymbol: {},
  isLoading: false,
  fundingIsLoading: false,
  leverageLimitsIsLoading: false,
  leverageLimitsMap: { "BTC/USDC:USDC": 40, "ETH/USDC:USDC": 25 },
  isPrecise: true,
  onRemove: vi.fn(),
  onUndoRemove: vi.fn(),
  onSideChange: vi.fn(),
  onLeverageChange: vi.fn(),
  onNotionalChange: vi.fn(),
  onWeightChange: vi.fn(),
  fundingRatesByBaseSymbol: { BTC: 0.00001, ETH: -0.00002 },
  targetTotalNotional: 1000,
  symbolsBelowMinimum: [],
  symbolsDeltaBelowMinimum: [],
  targetAllocationPercent: 100,
  readonlyBtcRows: [],
  isReadonlyBtcLoading: false,
  readonlyBtcError: null,
  readonlyBtcValidationError: null,
  onAddReadonlyBtcAddress: vi.fn(),
  onRemoveReadonlyBtcAddress: vi.fn(),
  onReadonlyBtcIncludeInBetaChange: vi.fn(),
  metricVisibility: DEFAULT_PORTFOLIO_METRIC_VISIBILITY,
  isBalanceLoading: false,
  targetCrossAccountLeverage: 1.5,
  onCrossAccountLeverageChange: vi.fn(),
  ...overrides,
})

const renderPositionsPanel = (overrides: Partial<PositionsPanelProps> = {}) =>
  render(() => <PositionsPanel {...positionsPanelProps(overrides)} />, {
    wrapper: createWrapper(),
  })

/** The footer row that holds the cross-account leverage slider and input. */
const leverageControls = (): HTMLElement => {
  const controls = screen.getByText("Leverage").parentElement
  if (controls === null) {
    throw new Error("leverage controls not found")
  }
  return controls
}

const toggleMetricVisibility = async (
  user: ReturnType<typeof userEvent.setup>,
  metricLabel: string,
) => {
  const menu = screen.getByRole("menu")
  const menuItem = within(menu).getByRole("menuitemcheckbox", {
    name: metricLabel,
  })

  await user.click(menuItem)
}

const allSymbolsTable = () => {
  const table = screen.getByRole("table", { hidden: true })
  return {
    table,
    headerCells: () =>
      within(table).getAllByRole("columnheader", { hidden: true }),
  }
}

describe("AllSymbolsPanel metric visibility", () => {
  beforeEach(() => {
    localStorage.clear()
    useFactorScoresMock.mockReturnValue({
      data: [btcFactorScore, ethFactorScore],
      isLoading: false,
      isFetching: false,
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it("keeps all symbols headers and row cells aligned when a metric is toggled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 2 })

    render(() => <AllSymbolsWithSettings />, { wrapper: createWrapper() })

    const { headerCells } = allSymbolsTable()

    expect(headerCells().map(cell => cell.textContent?.trim())).toEqual([
      "Asset",
      "Rate",
      "Beta",
      "Vol",
    ])
    expect(
      screen.queryByRole("button", { name: "Sort by Sharpe" }),
    ).not.toBeInTheDocument()

    const initialBtcRow = screen
      .getByRole("button", {
        name: "Add BTC to portfolio",
        hidden: true,
      })
      .closest("tr")
    if (initialBtcRow === null) {
      throw new Error("BTC row not found")
    }
    expect(within(initialBtcRow).queryByText("1.23")).not.toBeInTheDocument()
    expect(initialBtcRow.children.length).toBe(headerCells().length)

    await user.click(
      screen.getByRole("button", { name: "Open positions settings" }),
    )
    await toggleMetricVisibility(user, "Sharpe")

    expect(
      screen.getByRole("button", { name: "Sort by Sharpe", hidden: true }),
    ).toBeInTheDocument()
    expect(headerCells().map(cell => cell.textContent?.trim())).toEqual([
      "Asset",
      "Rate",
      "Beta",
      "Vol",
      "Sharpe",
    ])

    const btcRowWithSharpe = screen
      .getByRole("button", {
        name: "Add BTC to portfolio",
        hidden: true,
      })
      .closest("tr")
    if (btcRowWithSharpe === null) {
      throw new Error("BTC row not found after enabling Sharpe")
    }
    expect(within(btcRowWithSharpe).getByText("1.23")).toBeInTheDocument()
    expect(btcRowWithSharpe.children.length).toBe(headerCells().length)

    await toggleMetricVisibility(user, "Sharpe")

    expect(
      screen.queryByRole("button", { name: "Sort by Sharpe" }),
    ).not.toBeInTheDocument()
    expect(headerCells().map(cell => cell.textContent?.trim())).toEqual([
      "Asset",
      "Rate",
      "Beta",
      "Vol",
    ])

    const btcRowWithoutSharpe = screen
      .getByRole("button", {
        name: "Add BTC to portfolio",
        hidden: true,
      })
      .closest("tr")
    if (btcRowWithoutSharpe === null) {
      throw new Error("BTC row not found after disabling Sharpe")
    }
    expect(
      within(btcRowWithoutSharpe).queryByText("1.23"),
    ).not.toBeInTheDocument()
    expect(btcRowWithoutSharpe.children.length).toBe(headerCells().length)

    const storedVisibility = localStorage.getItem(
      PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY,
    )
    expect(storedVisibility).not.toBeNull()
    expect(JSON.parse(storedVisibility ?? "{}")).toMatchObject({
      sharpe: false,
    })
  })

  it("restores the persisted metric visibility on the next mount", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 2 })

    const firstMount = render(() => <AllSymbolsWithSettings />, {
      wrapper: createWrapper(),
    })

    await user.click(
      screen.getByRole("button", { name: "Open positions settings" }),
    )
    await toggleMetricVisibility(user, "Sharpe")

    expect(
      screen.getByRole("button", { name: "Sort by Sharpe", hidden: true }),
    ).toBeInTheDocument()

    firstMount.unmount()

    render(() => <AllSymbolsWithSettings />, { wrapper: createWrapper() })

    expect(
      screen.getByRole("button", { name: "Sort by Sharpe", hidden: true }),
    ).toBeInTheDocument()
    expect(allSymbolsTable().headerCells().at(-1)?.textContent?.trim()).toBe(
      "Sharpe",
    )
  })
})

describe("PositionsPanel", () => {
  beforeEach(() => {
    localStorage.clear()
    walletState.connection = "connected"
    useFactorScoresMock.mockReturnValue({
      data: [btcFactorScore, ethFactorScore],
      isLoading: false,
      isFetching: false,
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it("asks for a wallet connection instead of rendering positions", () => {
    walletState.connection = "disconnected"

    renderPositionsPanel()

    expect(screen.getByText("Connect a venue to start")).toBeInTheDocument()
    expect(
      screen.queryByRole("table", { hidden: true }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/READ-ONLY BTC/)).not.toBeInTheDocument()
  })

  it("shows placeholders instead of positions while the portfolio loads", () => {
    const { container } = renderPositionsPanel({ isLoading: true })

    expect(
      screen.queryByRole("table", { hidden: true }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/READ-ONLY BTC/)).not.toBeInTheDocument()
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    )
  })

  it("renders a row for every current and target position", () => {
    renderPositionsPanel()

    const positionsTable = screen.getByRole("table", { hidden: true })

    expect(within(positionsTable).getByText("BTC")).toBeInTheDocument()
    expect(within(positionsTable).getByText("ETH")).toBeInTheDocument()
    expect(
      within(positionsTable).getByRole("button", {
        name: "Switch BTC side",
        hidden: true,
      }),
    ).toHaveTextContent("LONG")
    expect(
      within(positionsTable).getByRole("button", {
        name: "Switch ETH side",
        hidden: true,
      }),
    ).toHaveTextContent("SHORT")
  })

  it("prompts to add positions when the portfolio is empty", () => {
    renderPositionsPanel({ currentPortfolio: {}, targetPortfolio: {} })

    expect(
      screen.getByText("Add positions from Hyperliquid or Derive."),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("table", { hidden: true }),
    ).not.toBeInTheDocument()
  })

  it("lists read-only BTC exposure below the tradable portfolio", () => {
    renderPositionsPanel({
      readonlyBtcRows: [
        {
          address: "bc1qexampleaddress",
          includeInBeta: true,
          quantityBtc: 0.5,
          notionalUsd: 30000,
        },
      ],
    })

    expect(screen.getByText("READ-ONLY BTC (1)")).toBeInTheDocument()
    expect(screen.getByTitle("bc1qexampleaddress")).toBeInTheDocument()
    expect(screen.getByText("0.500000 BTC")).toBeInTheDocument()
    expect(screen.getByText("$30,000")).toBeInTheDocument()
  })

  it("warns when target weights exceed the portfolio notional", () => {
    renderPositionsPanel({
      hasTotalWeightExceeded: true,
      targetAllocationPercent: 120,
    })

    const alerts = screen.getByRole("region", {
      name: "Portfolio validation messages",
    })

    expect(within(alerts).getByText("Allocation over 100%")).toBeInTheDocument()
    expect(within(alerts).getByText("120.0%")).toBeInTheDocument()
  })

  it("lists the target positions that sit below the exchange minimum", () => {
    renderPositionsPanel({ symbolsBelowMinimum: ["ETH/USDC:USDC"] })

    const alerts = screen.getByRole("region", {
      name: "Portfolio validation messages",
    })

    expect(
      within(alerts).getByText("ETH/USDC:USDC ($400.00)"),
    ).toBeInTheDocument()
  })

  it("edits the cross account leverage from the footer control", async () => {
    const user = userEvent.setup()
    const onCrossAccountLeverageChange = vi.fn()

    renderPositionsPanel({ onCrossAccountLeverageChange })

    const leverageInput = within(leverageControls()).getByRole("spinbutton")
    expect(leverageInput).toHaveValue(1.5)

    await user.clear(leverageInput)
    await user.type(leverageInput, "3")

    expect(onCrossAccountLeverageChange).toHaveBeenCalledWith(3)
  })

  it("hides the leverage control until the account balance resolves", () => {
    renderPositionsPanel({ isBalanceLoading: true })

    const controls = leverageControls()

    expect(within(controls).queryByRole("spinbutton")).not.toBeInTheDocument()
    expect(controls.querySelector(".animate-pulse")).not.toBeNull()
  })
})
