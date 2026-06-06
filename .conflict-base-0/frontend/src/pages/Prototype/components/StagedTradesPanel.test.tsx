import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@solidjs/testing-library"
import { StagedTradesPanel } from "./StagedTradesPanel"
import type { ComputedTrade } from "../mockData"
import type { PositionsByUnderlying } from "../hooks/usePrototypeData"

const mockTrades: ComputedTrade[] = [
  {
    id: "1",
    symbol: "BTC/USDC:USDC",
    underlying: "BTC",
    side: "buy",
    notional: 1000,
    previousWeight: 0.2,
    newWeight: 0.25,
  },
  {
    id: "2",
    symbol: "ETH/USDC:USDC",
    underlying: "ETH",
    side: "sell",
    notional: 500,
    previousWeight: 0.15,
    newWeight: 0.12,
  },
]

const mockPositions: PositionsByUnderlying[] = [
  {
    underlying: "BTC",
    positions: [
      {
        symbol: "BTC/USDC:USDC",
        side: "long",
        weight: 0.2,
        notional: 50000,
        percentage: 25,
      },
    ],
  },
  {
    underlying: "ETH",
    positions: [
      {
        symbol: "ETH/USDC:USDC",
        side: "long",
        weight: 0.15,
        notional: 37500,
        percentage: 18.75,
      },
    ],
  },
]

const mockAssetFactors = [
  {
    ticker: "BTC",
    beta: 1.0,
    momentum: 0.5,
    volatility: 0.8,
    spyBeta: 0.3,
    carry: 0.02,
  },
  {
    ticker: "ETH",
    beta: 1.2,
    momentum: 0.4,
    volatility: 0.9,
    spyBeta: 0.25,
    carry: 0.015,
  },
]

describe("StagedTradesPanel", () => {
  const defaultProps = {
    stagedTrades: [] as ComputedTrade[],
    leverage: 1.0,
    effectiveLeverage: 0.8,
    nav: 250000,
    positions: mockPositions,
    assetFactors: mockAssetFactors,
    onLeverageChange: vi.fn(),
    onRemoveTrade: vi.fn(),
    onClearAll: vi.fn(),
    onExecute: vi.fn(),
  }

  it("shows empty state when no trades staged", () => {
    render(() => <StagedTradesPanel {...defaultProps} />)

    expect(screen.getByText(/No pending trades/)).toBeInTheDocument()
  })

  it("renders leverage control", () => {
    render(() => <StagedTradesPanel {...defaultProps} />)

    expect(screen.getByText("Leverage")).toBeInTheDocument()
    expect(screen.getByRole("slider")).toBeInTheDocument()
  })

  it("displays staged trades", () => {
    render(() => (
      <StagedTradesPanel {...defaultProps} stagedTrades={mockTrades} />
    ))

    expect(screen.getAllByText("BTC").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("ETH").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("BUY")).toBeInTheDocument()
    expect(screen.getByText("SELL")).toBeInTheDocument()
  })

  it("shows Clear all button when trades exist", () => {
    render(() => (
      <StagedTradesPanel {...defaultProps} stagedTrades={mockTrades} />
    ))

    expect(screen.getByText("Clear all")).toBeInTheDocument()
  })

  it("calls onClearAll when Clear all clicked", () => {
    const onClearAll = vi.fn()
    render(() => (
      <StagedTradesPanel
        {...defaultProps}
        stagedTrades={mockTrades}
        onClearAll={onClearAll}
      />
    ))

    fireEvent.click(screen.getByText("Clear all"))
    expect(onClearAll).toHaveBeenCalled()
  })

  it("calls onExecute when Execute button clicked", () => {
    const onExecute = vi.fn()
    render(() => (
      <StagedTradesPanel
        {...defaultProps}
        stagedTrades={mockTrades}
        onExecute={onExecute}
      />
    ))

    fireEvent.click(screen.getByText(/Execute 2 trades/))
    expect(onExecute).toHaveBeenCalled()
  })

  it("shows singular 'trade' when only one trade staged", () => {
    render(() => (
      <StagedTradesPanel {...defaultProps} stagedTrades={[mockTrades[0]]} />
    ))

    expect(screen.getByText(/Execute 1 trade$/)).toBeInTheDocument()
  })

  it("shows impact preview when trades are staged", () => {
    render(() => (
      <StagedTradesPanel {...defaultProps} stagedTrades={mockTrades} />
    ))

    expect(screen.getByText("IMPACT PREVIEW")).toBeInTheDocument()
    expect(screen.getByText("Notional")).toBeInTheDocument()
  })

  // Source badges have been removed in the production UI; prototype panel
  // no longer renders per-trade "source" labels.
})
