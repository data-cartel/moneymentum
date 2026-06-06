import { render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ParentProps } from "solid-js"

import type { FactorScore } from "../../hooks/useFactorScores"
import { PORTFOLIO_METRIC_COLUMNS_STORAGE_KEY } from "./portfolioMetricVisibility"
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

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    isConnected: () => true,
    mainAddress: () => null,
    setMainAddress: vi.fn(),
  }),
}))

vi.mock("@/reown/evmAppKit", () => ({
  getOrCreateEvmAppKit: () => null,
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

const renderPositionsPanel = () => {
  const screenerSymbols = () => ["BTC/USDC:USDC", "ETH/USDC:USDC"]

  return render(
    () => (
      <PositionsPanel
        hasTotalWeightExceeded={false}
        currentPortfolio={{}}
        targetPortfolio={{}}
        deletedArchive={{}}
        errorsBySymbol={{}}
        isLoading={false}
        fundingIsLoading={false}
        leverageLimitsIsLoading={false}
        leverageLimitsMap={{}}
        isPrecise={false}
        onPreciseChange={vi.fn()}
        isManualWeightEntry={false}
        onManualWeightEntryChange={vi.fn()}
        onRemove={vi.fn()}
        onUndoRemove={vi.fn()}
        onSideChange={vi.fn()}
        onLeverageChange={vi.fn()}
        onNotionalChange={vi.fn()}
        onWeightChange={vi.fn()}
        fundingRatesByBaseSymbol={{ BTC: 0.00001, ETH: 0.00001 }}
        targetTotalNotional={0}
        symbolsBelowMinimum={[]}
        symbolsDeltaBelowMinimum={[]}
        targetAllocationPercent={0}
        readonlyBtcRows={[]}
        isReadonlyBtcLoading={false}
        readonlyBtcError={null}
        readonlyBtcValidationError={null}
        onAddReadonlyBtcAddress={vi.fn(() => false)}
        onRemoveReadonlyBtcAddress={vi.fn()}
        onReadonlyBtcIncludeInBetaChange={vi.fn()}
        screenerSymbols={screenerSymbols}
        onAddSymbol={vi.fn()}
      />
    ),
    { wrapper: createWrapper() },
  )
}

const openAllSymbolsView = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Show all symbols" }))
  expect(screen.getByText("ALL SYMBOLS")).toBeInTheDocument()
}

const toggleMetricVisibility = async (
  user: ReturnType<typeof userEvent.setup>,
  metricLabel: string,
) => {
  const menu = screen.getByRole("menu")
  const metricLabelNode = within(menu).getByText(metricLabel)
  const menuItem = metricLabelNode.closest('[role="menuitem"]')
  if (!(menuItem instanceof HTMLElement)) {
    throw new Error(`${metricLabel} settings row not found`)
  }

  const switchInput = within(menuItem).getByRole("switch")
  const switchControl = switchInput.nextElementSibling
  if (!(switchControl instanceof HTMLElement)) {
    throw new Error(`${metricLabel} switch control not found`)
  }

  await user.click(switchControl)
}

const allSymbolsTable = () => {
  const table = screen.getByRole("table", { hidden: true })
  return {
    table,
    headerCells: () =>
      within(table).getAllByRole("columnheader", { hidden: true }),
  }
}

describe("PositionsPanel all symbols metric visibility", () => {
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

    renderPositionsPanel()
    await openAllSymbolsView(user)

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
})
