import { describe, it, expect } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { usePrototypeData } from "./usePrototypeData"

describe("usePrototypeData", () => {
  describe("positionsByUnderlying", () => {
    it("groups positions correctly by underlying", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      expect(btcGroup).toBeDefined()
      if (btcGroup) {
        expect(btcGroup.positions.length).toBeGreaterThan(1)
        expect(btcGroup.positions.every(p => p.symbol.includes("BTC"))).toBe(
          true,
        )
      }
    })

    it("sorts by total notional descending", () => {
      const { result } = renderHook(() => usePrototypeData())

      const groups = result.positionsByUnderlying()
      for (let i = 0; i < groups.length - 1; i++) {
        const currentTotal = groups[i].positions.reduce(
          (sum, p) => sum + p.notional,
          0,
        )
        const nextTotal = groups[i + 1].positions.reduce(
          (sum, p) => sum + p.notional,
          0,
        )
        expect(currentTotal).toBeGreaterThanOrEqual(nextTotal)
      }
    })

    it("includes weight field in positions", () => {
      const { result } = renderHook(() => usePrototypeData())

      const firstGroup = result.positionsByUnderlying()[0]
      expect(firstGroup.positions[0]).toHaveProperty("weight")
      expect(typeof firstGroup.positions[0].weight).toBe("number")
    })

    it("derives notional from weight, nav, and leverage", () => {
      const { result } = renderHook(() => usePrototypeData())

      const nav = result.nav
      const leverage = result.leverage()
      const firstGroup = result.positionsByUnderlying()[0]
      const firstPos = firstGroup.positions[0]

      const expectedNotional = nav * firstPos.weight * leverage
      expect(firstPos.notional).toBeCloseTo(expectedNotional)
    })
  })

  describe("leverage", () => {
    it("starts with leverage of 1.0", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.leverage()).toBe(1.0)
    })

    it("setLeverage updates leverage value", () => {
      const { result } = renderHook(() => usePrototypeData())

      result.setLeverage(2.0)

      expect(result.leverage()).toBe(2.0)
    })

    it("changing leverage scales all notionals proportionally", () => {
      const { result } = renderHook(() => usePrototypeData())

      const initialNotional = result.totalNotional()

      result.setLeverage(2.0)

      expect(result.totalNotional()).toBeCloseTo(initialNotional * 2)
    })

    it("effectiveLeverage equals totalNotional / nav", () => {
      const { result } = renderHook(() => usePrototypeData())

      const expected = result.totalNotional() / result.nav
      expect(result.effectiveLeverage()).toBeCloseTo(expected)
    })

    it("effectiveLeverage scales with leverage setting", () => {
      const { result } = renderHook(() => usePrototypeData())

      const initialEffective = result.effectiveLeverage()

      result.setLeverage(3.0)

      expect(result.effectiveLeverage()).toBeCloseTo(initialEffective * 3)
    })

    it("weights remain constant when leverage changes", () => {
      const { result } = renderHook(() => usePrototypeData())

      const initialWeights = result
        .positionsByUnderlying()
        .flatMap(g => g.positions.map(p => p.weight))

      result.setLeverage(2.5)

      const newWeights = result
        .positionsByUnderlying()
        .flatMap(g => g.positions.map(p => p.weight))

      expect(newWeights).toEqual(initialWeights)
    })
  })

  describe("stagedTrades", () => {
    it("starts with empty staged trades", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.stagedTrades()).toEqual([])
    })

    it("generates staged trades when weight changes", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      result.updateInstrumentWeight(btcPerp!.symbol, 0.3)

      // Should have staged trades generated from the weight change
      expect(result.stagedTrades().length).toBeGreaterThan(0)
    })

    it("generates staged trades when leverage changes", () => {
      const { result } = renderHook(() => usePrototypeData())

      result.setLeverage(1.5)

      // All positions should have leverage-driven trades
      expect(result.stagedTrades().length).toBeGreaterThan(0)
    })

    it("clearStagedTrades reverts to committed state", () => {
      const { result } = renderHook(() => usePrototypeData())

      result.setLeverage(2.0)

      expect(result.stagedTrades().length).toBeGreaterThan(0)

      result.clearStagedTrades()

      expect(result.stagedTrades()).toEqual([])
      expect(result.leverage()).toBe(1.0)
    })

    it("executeStagedTrades commits changes", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      const newWeight = 0.3
      result.updateInstrumentWeight(btcPerp!.symbol, newWeight)

      expect(result.stagedTrades().length).toBeGreaterThan(0)

      result.executeStagedTrades()

      expect(result.stagedTrades()).toEqual([])

      const updatedGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const updatedPerp = updatedGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(updatedPerp!.weight).toBeCloseTo(newWeight)
    })
  })

  describe("adjustPositionWeight", () => {
    it("increases weight by positive delta", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      const initialWeight = btcPerp!.weight

      result.adjustPositionWeight(btcPerp!.symbol, 0.01)

      const updatedGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const updatedPerp = updatedGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(updatedPerp!.weight).toBeCloseTo(initialWeight + 0.01)
    })

    it("decreases weight by negative delta", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      const initialWeight = btcPerp!.weight

      result.adjustPositionWeight(btcPerp!.symbol, -0.01)

      const updatedGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const updatedPerp = updatedGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(updatedPerp!.weight).toBeCloseTo(initialWeight - 0.01)
    })

    it("clamps weight to minimum of 0", () => {
      const { result } = renderHook(() => usePrototypeData())

      const apeGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "APE")
      const apePerp = apeGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(apePerp).toBeDefined()

      result.adjustPositionWeight(apePerp!.symbol, -1.0)

      const updatedGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "APE")
      const updatedPerp = updatedGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(updatedPerp!.weight).toBe(0)
    })

    it("clamps weight to maximum of 1", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      result.adjustPositionWeight(btcPerp!.symbol, 10.0)

      const updatedGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const updatedPerp = updatedGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(updatedPerp!.weight).toBe(1)
    })

    it("rebalances other weights proportionally when one weight increases", () => {
      const { result } = renderHook(() => usePrototypeData())

      const totalWeightBefore = result
        .positionsByUnderlying()
        .flatMap(g => g.positions)
        .reduce((sum, p) => sum + p.weight, 0)

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      result.updateInstrumentWeight(btcPerp!.symbol, 0.5)

      const totalWeightAfter = result
        .positionsByUnderlying()
        .flatMap(g => g.positions)
        .reduce((sum, p) => sum + p.weight, 0)

      expect(totalWeightAfter).toBeCloseTo(totalWeightBefore)
    })

    it("updates notional after weight change", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )
      expect(btcPerp).toBeDefined()

      result.adjustPositionWeight(btcPerp!.symbol, 0.05)

      const updatedGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const updatedPerp = updatedGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )

      const expectedNotional =
        result.nav * updatedPerp!.weight * result.leverage()
      expect(updatedPerp!.notional).toBeCloseTo(expectedNotional)
    })
  })

  describe("instrument costs", () => {
    it("includes funding rate for perp positions", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcPerp = btcGroup?.positions.find(p =>
        p.symbol.includes("/USDC:USDC"),
      )

      expect(btcPerp).toBeDefined()
      expect(btcPerp!.fundingRate).toBeDefined()
      expect(typeof btcPerp!.fundingRate).toBe("number")
    })

    it("includes carry rate for spot positions", () => {
      const { result } = renderHook(() => usePrototypeData())

      const btcGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "BTC")
      const btcSpot = btcGroup?.positions.find(p => p.symbol.includes("-SPOT"))

      expect(btcSpot).toBeDefined()
      expect(btcSpot!.carryRate).toBeDefined()
      expect(typeof btcSpot!.carryRate).toBe("number")
    })

    it("includes theta for option positions", () => {
      const { result } = renderHook(() => usePrototypeData())

      const ethGroup = result
        .positionsByUnderlying()
        .find(g => g.underlying === "ETH")
      const ethPut = ethGroup?.positions.find(p => p.symbol.includes("-PUT"))

      expect(ethPut).toBeDefined()
      expect(ethPut!.theta).toBeDefined()
      expect(typeof ethPut!.theta).toBe("number")
    })
  })

  describe("static data", () => {
    it("exposes NAV", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.nav).toBe(250000)
    })

    it("exposes greeks data", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.greeks).toBeDefined()
      expect(result.greeks.length).toBeGreaterThan(0)
      expect(result.greeks[0]).toHaveProperty("delta")
      expect(result.greeks[0]).toHaveProperty("gamma")
      expect(result.greeks[0]).toHaveProperty("theta")
    })

    it("exposes factor exposures", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.factorExposures).toBeDefined()
      expect(result.factorExposures.length).toBeGreaterThan(0)
    })

    it("exposes correlation matrix", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.correlationMatrix).toBeDefined()
      expect(result.correlationAssets).toBeDefined()
    })

    it("exposes risk metrics", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.riskMetrics).toBeDefined()
      expect(result.riskMetrics).toHaveProperty("var95")
      expect(result.riskMetrics).toHaveProperty("var99")
    })

    it("exposes performance data", () => {
      const { result } = renderHook(() => usePrototypeData())
      expect(result.backtestData).toBeDefined()
      expect(result.performanceStats).toBeDefined()
      expect(result.monteCarloData).toBeDefined()
    })
  })

  describe("committed vs target state", () => {
    it("exposes hasUnsavedChanges flag", () => {
      const { result } = renderHook(() => usePrototypeData())

      expect(result.hasUnsavedChanges()).toBe(false)

      result.setLeverage(2.0)

      expect(result.hasUnsavedChanges()).toBe(true)

      result.clearStagedTrades()

      expect(result.hasUnsavedChanges()).toBe(false)
    })

    it("exposes committedLeverage and targetLeverage", () => {
      const { result } = renderHook(() => usePrototypeData())

      expect(result.committedLeverage()).toBe(1.0)
      expect(result.targetLeverage()).toBe(1.0)

      result.setLeverage(2.0)

      expect(result.committedLeverage()).toBe(1.0)
      expect(result.targetLeverage()).toBe(2.0)

      result.executeStagedTrades()

      expect(result.committedLeverage()).toBe(2.0)
      expect(result.targetLeverage()).toBe(2.0)
    })
  })
})
