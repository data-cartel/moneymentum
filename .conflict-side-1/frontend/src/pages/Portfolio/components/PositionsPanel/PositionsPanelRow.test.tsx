import { render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { PositionsPanelRow } from "./PositionsPanelRow"

const portfolioPosition = () => ({
  symbol: "ETH/USDC:USDC",
  side: "buy" as const,
  leverage: 2,
  notional: 500,
})

const defaultRowMetrics = {
  signedFundingRate: null,
  beta: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  momentum: null,
  carry: null,
}

describe("PositionsPanelRow", () => {
  it("replaces side through visible metric columns with a compact leverage editor", async () => {
    const user = userEvent.setup()

    render(() => (
      <table>
        <tbody>
          <PositionsPanelRow
            symbol="ETH/USDC:USDC"
            position={portfolioPosition}
            status="unchanged"
            visibleMetricColumns={["rate"]}
            rowMetrics={defaultRowMetrics}
            maxLeverage={5}
            leverageLimitsIsLoading={false}
            isPrecise={true}
            fundingIsLoading={false}
            factorsIsLoading={false}
            onRemove={vi.fn()}
            onUndoRemove={vi.fn()}
            onSideChange={vi.fn()}
            onLeverageChange={vi.fn()}
            onNotionalChange={vi.fn()}
            onWeightChange={vi.fn()}
            totalNotional={1000}
            symbolsBelowMinimum={[]}
            symbolsDeltaBelowMinimum={[]}
            symbolDelta={0}
          />
        </tbody>
      </table>
    ))

    const assetCell = screen.getByText("ETH").closest("td")
    if (assetCell === null) {
      throw new Error("asset cell not found")
    }
    expect(assetCell).not.toHaveAttribute("colspan")

    await user.click(screen.getByRole("button", { name: "2x" }))

    expect(assetCell).not.toHaveAttribute("colspan")
    expect(
      screen.queryByRole("button", { name: "Switch ETH side" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Remove ETH/USDC:USDC" }),
    ).not.toBeInTheDocument()
    const sliderCell = screen
      .getByLabelText("Leverage for ETH/USDC:USDC")
      .closest("td")
    if (sliderCell === null) {
      throw new Error("slider cell not found")
    }
    expect(sliderCell).toHaveAttribute("colspan", "4")

    await user.click(document.body)

    expect(assetCell).not.toHaveAttribute("colspan")
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Switch ETH side" }),
      ).toBeInTheDocument()
    })
  })

  it("uses numeric keyboard input while the leverage editor is open", async () => {
    const user = userEvent.setup()
    const onLeverageChange = vi.fn()

    render(() => (
      <table>
        <tbody>
          <PositionsPanelRow
            symbol="ETH/USDC:USDC"
            position={portfolioPosition}
            status="unchanged"
            visibleMetricColumns={["rate"]}
            rowMetrics={defaultRowMetrics}
            maxLeverage={40}
            leverageLimitsIsLoading={false}
            isPrecise={true}
            fundingIsLoading={false}
            factorsIsLoading={false}
            onRemove={vi.fn()}
            onUndoRemove={vi.fn()}
            onSideChange={vi.fn()}
            onLeverageChange={onLeverageChange}
            onNotionalChange={vi.fn()}
            onWeightChange={vi.fn()}
            totalNotional={1000}
            symbolsBelowMinimum={[]}
            symbolsDeltaBelowMinimum={[]}
            symbolDelta={0}
          />
        </tbody>
      </table>
    ))

    await user.click(screen.getByRole("button", { name: "2x" }))
    await user.keyboard("32")

    expect(onLeverageChange).toHaveBeenNthCalledWith(1, "ETH/USDC:USDC", 3)
    expect(onLeverageChange).toHaveBeenNthCalledWith(2, "ETH/USDC:USDC", 32)
  })

  it("ignores modified digit shortcuts while the leverage editor is open", async () => {
    const user = userEvent.setup()
    const onLeverageChange = vi.fn()

    render(() => (
      <table>
        <tbody>
          <PositionsPanelRow
            symbol="ETH/USDC:USDC"
            position={portfolioPosition}
            status="unchanged"
            visibleMetricColumns={["rate"]}
            rowMetrics={defaultRowMetrics}
            maxLeverage={40}
            leverageLimitsIsLoading={false}
            isPrecise={true}
            fundingIsLoading={false}
            factorsIsLoading={false}
            onRemove={vi.fn()}
            onUndoRemove={vi.fn()}
            onSideChange={vi.fn()}
            onLeverageChange={onLeverageChange}
            onNotionalChange={vi.fn()}
            onWeightChange={vi.fn()}
            totalNotional={1000}
            symbolsBelowMinimum={[]}
            symbolsDeltaBelowMinimum={[]}
            symbolDelta={0}
          />
        </tbody>
      </table>
    ))

    await user.click(screen.getByRole("button", { name: "2x" }))
    await user.keyboard("{Meta>}3{/Meta}")

    expect(onLeverageChange).not.toHaveBeenCalled()
  })

  it("closes the leverage editor on Escape", async () => {
    const user = userEvent.setup()

    render(() => (
      <table>
        <tbody>
          <PositionsPanelRow
            symbol="ETH/USDC:USDC"
            position={portfolioPosition}
            status="unchanged"
            visibleMetricColumns={["rate"]}
            rowMetrics={defaultRowMetrics}
            maxLeverage={5}
            leverageLimitsIsLoading={false}
            isPrecise={true}
            fundingIsLoading={false}
            factorsIsLoading={false}
            onRemove={vi.fn()}
            onUndoRemove={vi.fn()}
            onSideChange={vi.fn()}
            onLeverageChange={vi.fn()}
            onNotionalChange={vi.fn()}
            onWeightChange={vi.fn()}
            totalNotional={1000}
            symbolsBelowMinimum={[]}
            symbolsDeltaBelowMinimum={[]}
            symbolDelta={0}
          />
        </tbody>
      </table>
    ))

    const assetCell = screen.getByText("ETH").closest("td")
    if (assetCell === null) {
      throw new Error("asset cell not found")
    }

    await user.click(screen.getByRole("button", { name: "2x" }))

    const sliderCell = screen
      .getByLabelText("Leverage for ETH/USDC:USDC")
      .closest("td")
    if (sliderCell === null) {
      throw new Error("slider cell not found")
    }
    expect(sliderCell).toHaveAttribute("colspan", "4")

    await user.keyboard("{Escape}")

    expect(
      screen.getByRole("button", { name: "Switch ETH side" }),
    ).toBeInTheDocument()
    expect(assetCell).not.toHaveAttribute("colspan")
    expect(
      screen.queryByLabelText("Leverage for ETH/USDC:USDC"),
    ).not.toBeInTheDocument()
  })

  it("keeps the previous numeric keyboard input when the combined leverage is too high", async () => {
    const user = userEvent.setup()
    const onLeverageChange = vi.fn()

    render(() => (
      <table>
        <tbody>
          <PositionsPanelRow
            symbol="ETH/USDC:USDC"
            position={portfolioPosition}
            status="unchanged"
            visibleMetricColumns={["rate"]}
            rowMetrics={defaultRowMetrics}
            maxLeverage={5}
            leverageLimitsIsLoading={false}
            isPrecise={true}
            fundingIsLoading={false}
            factorsIsLoading={false}
            onRemove={vi.fn()}
            onUndoRemove={vi.fn()}
            onSideChange={vi.fn()}
            onLeverageChange={onLeverageChange}
            onNotionalChange={vi.fn()}
            onWeightChange={vi.fn()}
            totalNotional={1000}
            symbolsBelowMinimum={[]}
            symbolsDeltaBelowMinimum={[]}
            symbolDelta={0}
          />
        </tbody>
      </table>
    ))

    await user.click(screen.getByRole("button", { name: "2x" }))
    await user.keyboard("32")

    expect(onLeverageChange).toHaveBeenCalledOnce()
    expect(onLeverageChange).toHaveBeenLastCalledWith("ETH/USDC:USDC", 3)
  })
})
