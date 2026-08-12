import { describe, expect, it } from "vitest"

import {
  captureStagedPortfolioOverlay,
  diffPortfolios,
  mergePortfolioMaps,
  portfolioMapFromDerivePositions,
  portfolioMapFromExchangePositions,
  preciseRebalanceLegs,
  syncDeletedArchiveWithCurrent,
  targetAndArchiveAfterRebalance,
} from "./portfolioRebalancer"
import { MIN_USD, type PortfolioInterface } from "./usePortfolioState"

const buy = (notional: number, leverage = 2): PortfolioInterface => ({
  kind: "perp",
  venue: "hyperliquid",
  symbol: "BTC/USDC:USDC",
  side: "buy",
  leverage,
  notional,
})

const sell = (notional: number, leverage = 2): PortfolioInterface => ({
  kind: "perp",
  venue: "hyperliquid",
  symbol: "BTC/USDC:USDC",
  side: "sell",
  leverage,
  notional,
})

const option = (
  symbol: string,
  notional: number,
  side: "buy" | "sell" = "buy",
): PortfolioInterface => ({
  kind: "option",
  venue: "derive",
  symbol,
  side,
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
      positionKind: "perp",
      venue: "hyperliquid",
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
      positionKind: "perp",
      venue: "hyperliquid",
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
      positionKind: "perp",
      venue: "hyperliquid",
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
      positionKind: "perp",
      venue: "hyperliquid",
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
      positionKind: "perp",
      venue: "hyperliquid",
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
        positionKind: "perp",
        venue: "hyperliquid",
      }),
    ])
  })

  it("emits derive rebalance for option notional delta without precise legs", () => {
    const instrument = "ETH-20260925-2000-C"
    const current: Record<string, PortfolioInterface | undefined> = {
      [instrument]: option(instrument, 100),
    }
    const target: Record<string, PortfolioInterface | undefined> = {
      [instrument]: option(instrument, 102),
    }

    const actions = diffPortfolios(current, target, true)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      kind: "rebalance",
      signedNotionalDelta: 2,
      positionKind: "option",
      venue: "derive",
      leverage: 1,
      leverageChanged: false,
    })
  })
})

describe("portfolioMapFromExchangePositions", () => {
  it("builds hyperliquid perp portfolio map and total notional from exchange rows", () => {
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
      kind: "perp",
      venue: "hyperliquid",
      symbol: "BTC/USDC:USDC",
      side: "buy",
      leverage: 2,
      notional: 600,
    })
  })
})

describe("portfolioMapFromDerivePositions", () => {
  it("maps derive options and perps into portfolio rows", () => {
    const snapshot = portfolioMapFromDerivePositions([
      {
        symbol: "ETH-20260327-2000-C",
        side: "buy",
        notional: 120,
        entryPrice: 100,
        unrealizedPnl: 20,
        leverage: 1,
        positionKind: "option",
      },
      {
        symbol: "ETH-PERP",
        side: "sell",
        notional: 500,
        entryPrice: 2000,
        unrealizedPnl: -10,
        leverage: 1,
        positionKind: "perp",
      },
    ])

    expect(snapshot.totalNotional).toBe(620)
    expect(snapshot.map["ETH-20260327-2000-C"]).toMatchObject({
      kind: "option",
      venue: "derive",
      notional: 120,
    })
    expect(snapshot.map["ETH-PERP"]).toMatchObject({
      kind: "perp",
      venue: "derive",
      side: "sell",
      notional: 500,
      leverage: 1,
    })
  })
})

describe("mergePortfolioMaps", () => {
  it("combines hyperliquid and derive maps", () => {
    const hyperliquid = portfolioMapFromExchangePositions([
      {
        symbol: "BTC/USDC:USDC",
        side: "buy",
        leverage: 2,
        notional: 600,
      },
    ])
    const derive = portfolioMapFromDerivePositions([
      {
        symbol: "ETH-20260327-2000-C",
        side: "buy",
        notional: 120,
        entryPrice: 100,
        unrealizedPnl: 0,
        leverage: 1,
        positionKind: "option",
      },
    ])

    const merged = mergePortfolioMaps(hyperliquid.map, derive.map)
    expect(merged.totalNotional).toBe(720)
    expect(merged.map["BTC/USDC:USDC"]?.venue).toBe("hyperliquid")
    expect(merged.map["ETH-20260327-2000-C"]?.venue).toBe("derive")
  })
})

describe("targetAndArchiveAfterRebalance", () => {
  const symBtc = "BTC/USDC:USDC"
  const symEth = "ETH/USDC:USDC"
  const symApt = "APT/USDC:USDC"
  const symAxs = "AXS/USDC:USDC"

  const btcTarget: PortfolioInterface = {
    kind: "perp",
    venue: "hyperliquid",
    symbol: symBtc,
    side: "buy",
    leverage: 2,
    notional: 800,
  }

  const ethCurrent: PortfolioInterface = {
    kind: "perp",
    venue: "hyperliquid",
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
          kind: "perp",
          venue: "hyperliquid",
          symbol: symEth,
          side: "buy",
          leverage: 2,
          notional: 400,
        },
      },
      current,
      [
        {
          kind: "close",
          symbol: symEth,
          side: "buy",
          positionKind: "perp",
          venue: "hyperliquid",
        },
        {
          kind: "rebalance",
          symbol: symBtc,
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
          positionKind: "perp",
          venue: "hyperliquid",
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
      kind: "perp",
      venue: "hyperliquid",
      symbol: symAxs,
      side: "buy",
      leverage: 5,
      notional: 15.7,
    }
    const atomTarget: PortfolioInterface = {
      kind: "perp",
      venue: "hyperliquid",
      symbol: "ATOM/USDC:USDC",
      side: "buy",
      leverage: 10,
      notional: 20,
    }
    const current = {
      [symAxs]: axsCurrent,
      [symEth]: ethCurrent,
      "ATOM/USDC:USDC": {
        kind: "perp" as const,
        venue: "hyperliquid" as const,
        symbol: "ATOM/USDC:USDC",
        side: "buy" as const,
        leverage: 5,
        notional: 15,
      },
    }

    const result = targetAndArchiveAfterRebalance(
      {
        [symAxs]: {
          kind: "perp",
          venue: "hyperliquid",
          symbol: symAxs,
          side: "buy",
          leverage: 5,
          notional: 0.7,
        },
        [symEth]: {
          kind: "perp",
          venue: "hyperliquid",
          symbol: symEth,
          side: "buy",
          leverage: 2,
          notional: 400,
        },
        "ATOM/USDC:USDC": atomTarget,
      },
      {
        [symApt]: {
          kind: "perp",
          venue: "hyperliquid",
          symbol: symApt,
          side: "buy",
          leverage: 2,
          notional: 14,
        },
      },
      current,
      [
        {
          kind: "close",
          symbol: symApt,
          side: "buy",
          positionKind: "perp",
          venue: "hyperliquid",
        },
        {
          kind: "rebalance",
          symbol: symAxs,
          signedNotionalDelta: 15,
          leverage: 5,
          leverageChanged: true,
          positionKind: "perp",
          venue: "hyperliquid",
        },
        {
          kind: "rebalance",
          symbol: "ATOM/USDC:USDC",
          signedNotionalDelta: 5,
          leverage: 10,
          leverageChanged: true,
          positionKind: "perp",
          venue: "hyperliquid",
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
        kind: "perp" as const,
        venue: "hyperliquid" as const,
        symbol: symApt,
        side: "buy" as const,
        leverage: 2,
        notional: 14,
      },
    }

    const result = targetAndArchiveAfterRebalance(
      {},
      {
        [symApt]: {
          kind: "perp",
          venue: "hyperliquid",
          symbol: symApt,
          side: "buy",
          leverage: 2,
          notional: 14,
        },
      },
      current,
      [
        {
          kind: "close",
          symbol: symApt,
          side: "buy",
          positionKind: "perp",
          venue: "hyperliquid",
        },
      ],
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

  it("preserves untouched derive option rows after hyperliquid settle", () => {
    const instrument = "ETH-20260925-2000-C"
    const optionTarget = option(instrument, 250)
    const current = {
      [symBtc]: { ...btcTarget, notional: 700 },
    }

    const result = targetAndArchiveAfterRebalance(
      {
        [symBtc]: btcTarget,
        [instrument]: optionTarget,
      },
      {},
      current,
      [
        {
          kind: "rebalance",
          symbol: symBtc,
          signedNotionalDelta: -100,
          leverage: 2,
          leverageChanged: false,
          positionKind: "perp",
          venue: "hyperliquid",
        },
      ],
      [{ symbol: symBtc, side: "sell", status: "filled" }],
    )

    expect(result.nextTarget[symBtc]).toEqual(current[symBtc])
    expect(result.nextTarget[instrument]).toEqual(optionTarget)
  })
})

describe("syncDeletedArchiveWithCurrent", () => {
  const symbol = "BABY/USDC:USDC"

  it("refreshes archived closes to live exchange marks", () => {
    const archived = { ...buy(8.944566), symbol }
    const live = { ...buy(8.941198), symbol }

    expect(
      syncDeletedArchiveWithCurrent({ [symbol]: archived }, { [symbol]: live })[
        symbol
      ],
    ).toEqual(live)
  })

  it("keeps archive when the exchange position is gone", () => {
    const archived = { ...buy(8.94), symbol }

    expect(
      syncDeletedArchiveWithCurrent({ [symbol]: archived }, {})[symbol],
    ).toEqual(archived)
  })
})

describe("captureStagedPortfolioOverlay", () => {
  const symbol = "BABY/USDC:USDC"

  it("stores live current in deletedArchive for staged closes", () => {
    const live = { ...buy(8.941198), symbol }
    const overlay = captureStagedPortfolioOverlay(
      { [symbol]: live },
      { [symbol]: undefined },
      { [symbol]: { ...buy(8.944566), symbol } },
    )

    expect(overlay.deletedArchive[symbol]).toEqual(live)
  })
})
