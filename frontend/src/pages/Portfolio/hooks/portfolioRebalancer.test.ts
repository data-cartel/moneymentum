import { describe, expect, it } from "vitest"

import {
  diffPortfolios,
  portfolioMapFromExchangePositions,
  preciseRebalanceLegs,
  targetAndArchiveAfterRebalance,
} from "./portfolioRebalancer"
import { MIN_USD, type PortfolioInterface } from "./usePortfolioState"

const buy = (notional: number, leverage = 2): PortfolioInterface => ({
  symbol: "BTC/USDC:USDC",
  side: "buy",
  leverage,
  notional,
})

const sell = (notional: number, leverage = 2): PortfolioInterface => ({
  symbol: "BTC/USDC:USDC",
  side: "sell",
  leverage,
  notional,
})

describe("preciseRebalanceLegs", () => {
  const m = MIN_USD
  const current = 100

  it("long increase by 2: close m then open m+2", () => {
    expect(preciseRebalanceLegs("buy", 2, current)).toEqual({
      closeNotional: m,
      openNotional: m + 2,
    })
  })

  it("long decrease by 2: close m+2 then open m", () => {
    expect(preciseRebalanceLegs("buy", -2, current)).toEqual({
      closeNotional: m + 2,
      openNotional: m,
    })
  })

  it("short deeper by 2 (signed delta -2): close m then open m+2", () => {
    expect(preciseRebalanceLegs("sell", -2, current)).toEqual({
      closeNotional: m,
      openNotional: m + 2,
    })
  })

  it("short reduce by 2 (signed delta +2): close m+2 then open m", () => {
    expect(preciseRebalanceLegs("sell", 2, current)).toEqual({
      closeNotional: m + 2,
      openNotional: m,
    })
  })

  it("caps close leg when current notional is below the planned close slice", () => {
    // Planned close slice is MIN_USD; current is 9, so close is capped to 9.
    // Open leg is 9 + 2 = 11, meeting MIN_USD. Smaller currents can yield open < MIN_USD;
    // that case should be blocked upstream (submit gates), not fixed inside this helper.
    expect(preciseRebalanceLegs("buy", 2, 9)).toEqual({
      closeNotional: 9,
      openNotional: m,
    })
  })
})

describe("diffPortfolios precise mode", () => {
  const sym = "BTC/USDC:USDC"

  it("uses preciseRebalance when precise, same side, delta below min order", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(102), symbol: sym },
    }

    const actions = diffPortfolios(current, target, true)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: "preciseRebalance",
      symbol: sym,
      side: "buy",
      closeNotional: MIN_USD,
      openNotional: MIN_USD + 2,
    })
  })

  it("uses single rebalance when precise but delta at or above min order", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100 + MIN_USD), symbol: sym },
    }

    const actions = diffPortfolios(current, target, true)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: "rebalance",
      signedNotionalDelta: MIN_USD,
    })
  })

  it("uses rebalance when not precise even if delta is small", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(102), symbol: sym },
    }

    const actions = diffPortfolios(current, target, false)
    expect(actions[0]).toMatchObject({
      kind: "rebalance",
      signedNotionalDelta: 2,
    })
  })

  it("never emits preciseRebalance when side flips (uses rebalance)", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...sell(100), symbol: sym },
    }

    const actions = diffPortfolios(current, target, true)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: "rebalance" })
  })

  it("emits preciseRebalance for short same-side delta below min order", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...sell(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...sell(102), symbol: sym },
    }

    const actions = diffPortfolios(current, target, true)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: "preciseRebalance",
      side: "sell",
      closeNotional: MIN_USD,
      openNotional: MIN_USD + 2,
    })
  })

  it("emits nothing when notional delta is within NOTIONAL_EPSILON", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100.05), symbol: sym },
    }

    expect(diffPortfolios(current, target, true)).toHaveLength(0)
  })

  it("emits rebalance with zero notional when only leverage changes", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym, leverage: 2 },
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym, leverage: 5 },
    }

    const actions = diffPortfolios(current, target, true)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: "rebalance",
      signedNotionalDelta: 0,
      leverage: 5,
      leverageChanged: true,
    })
  })

  it("emits close when symbol drops out of target portfolio", () => {
    const current: Record<string, PortfolioInterface | undefined> = {
      [sym]: { ...buy(100), symbol: sym },
    }
    const target: Record<string, PortfolioInterface | undefined> = {}

    const actions = diffPortfolios(current, target, false)
    expect(actions).toEqual([
      expect.objectContaining({
        kind: "close",
        symbol: sym,
        side: "buy",
      }),
    ])
  })
})

describe("portfolioMapFromExchangePositions", () => {
  it("builds portfolio map and total notional from exchange rows", () => {
    const snapshot = portfolioMapFromExchangePositions([
      {
        symbol: "BTC/USDC:USDC",
        side: "buy",
        leverage: 2,
        notional: 600,
      },
      {
        symbol: "ETH/USDC:USDC",
        side: "sell",
        leverage: 3,
        notional: 400,
      },
    ])

    expect(snapshot.totalNotional).toBe(1000)
    expect(snapshot.map["BTC/USDC:USDC"]).toMatchObject({
      symbol: "BTC/USDC:USDC",
      side: "buy",
      leverage: 2,
      notional: 600,
    })
  })
})

describe("targetAndArchiveAfterRebalance", () => {
  const symBtc = "BTC/USDC:USDC"
  const symEth = "ETH/USDC:USDC"
  const symApt = "APT/USDC:USDC"
  const symAxs = "AXS/USDC:USDC"

  const btcTarget: PortfolioInterface = {
    symbol: symBtc,
    side: "buy",
    leverage: 2,
    notional: 800,
  }

  const ethCurrent: PortfolioInterface = {
    symbol: symEth,
    side: "buy",
    leverage: 2,
    notional: 400.03,
  }

  it("sets target to current when every order filled and clears archive", () => {
    const current = {
      [symBtc]: { ...btcTarget, notional: 700 },
    }

    const result = targetAndArchiveAfterRebalance(
      { [symBtc]: btcTarget },
      {
        [symEth]: {
          symbol: symEth,
          side: "buy",
          leverage: 2,
          notional: 400,
        },
      },
      current,
      [
        { kind: "close", symbol: symEth, side: "buy" },
        {
          kind: "rebalance",
          symbol: symBtc,
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
        },
      ],
      [
        { symbol: symEth, side: "sell", status: "filled" },
        { symbol: symBtc, side: "buy", status: "filled" },
      ],
    )

    expect(result.nextTarget).toEqual(current)
    expect(result.nextDeletedArchive).toEqual({})
    expect(result.errorsBySymbol).toEqual({})
  })

  it("uses current as base, overlays failed rebalance target, drops filled closes from archive", () => {
    const axsCurrent: PortfolioInterface = {
      symbol: symAxs,
      side: "buy",
      leverage: 5,
      notional: 15.7,
    }
    const atomTarget: PortfolioInterface = {
      symbol: "ATOM/USDC:USDC",
      side: "buy",
      leverage: 10,
      notional: 20,
    }
    const current = {
      [symAxs]: axsCurrent,
      [symEth]: ethCurrent,
      "ATOM/USDC:USDC": {
        symbol: "ATOM/USDC:USDC",
        side: "buy",
        leverage: 5,
        notional: 15,
      },
    }

    const result = targetAndArchiveAfterRebalance(
      {
        [symAxs]: {
          symbol: symAxs,
          side: "buy",
          leverage: 5,
          notional: 0.7,
        },
        [symEth]: {
          symbol: symEth,
          side: "buy",
          leverage: 2,
          notional: 400,
        },
        "ATOM/USDC:USDC": atomTarget,
      },
      {
        [symApt]: {
          symbol: symApt,
          side: "buy",
          leverage: 2,
          notional: 14,
        },
      },
      current,
      [
        { kind: "close", symbol: symApt, side: "buy" },
        {
          kind: "rebalance",
          symbol: symAxs,
          signedNotionalDelta: 15,
          leverage: 5,
          leverageChanged: true,
        },
        {
          kind: "rebalance",
          symbol: "ATOM/USDC:USDC",
          signedNotionalDelta: 5,
          leverage: 10,
          leverageChanged: true,
        },
      ],
      [
        { symbol: symApt, side: "sell", status: "filled" },
        { symbol: symAxs, side: "buy", status: "filled" },
        {
          symbol: "ATOM/USDC:USDC",
          side: "buy",
          status: "failed",
          message: "min notional",
        },
      ],
    )

    expect(result.nextTarget[symApt]).toBeUndefined()
    expect(result.nextTarget[symAxs]).toEqual(axsCurrent)
    expect(result.nextTarget[symEth]).toEqual(ethCurrent)
    expect(result.nextTarget["ATOM/USDC:USDC"]).toEqual(atomTarget)
    expect(result.nextDeletedArchive[symApt]).toBeUndefined()
    expect(result.errorsBySymbol).toEqual({
      "ATOM/USDC:USDC": "min notional",
    })
  })

  it("keeps pending close in archive when close order failed", () => {
    const current = {
      [symApt]: {
        symbol: symApt,
        side: "buy",
        leverage: 2,
        notional: 14,
      },
    }

    const result = targetAndArchiveAfterRebalance(
      {},
      {
        [symApt]: {
          symbol: symApt,
          side: "buy",
          leverage: 2,
          notional: 14,
        },
      },
      current,
      [{ kind: "close", symbol: symApt, side: "buy" }],
      [
        {
          symbol: symApt,
          side: "sell",
          status: "failed",
          message: "close rejected",
        },
      ],
    )

    expect(result.nextTarget[symApt]).toBeUndefined()
    expect(result.nextDeletedArchive[symApt]).toBeDefined()
    expect(result.errorsBySymbol).toEqual({
      [symApt]: "close rejected",
    })
  })
})
