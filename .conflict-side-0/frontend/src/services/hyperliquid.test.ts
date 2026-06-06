import { describe, it, expect, vi } from "vitest"
import * as Effect from "effect/Effect"
import {
  getBalance,
  getAccountSummary,
  getCurrentPositions,
  getFundingRates,
  rebalancePositions,
  WalletNotConnected,
  ExchangeRequestError,
} from "./hyperliquid"
import type { HyperliquidClient } from "./hyperliquid-client"
import type { RebalanceAction } from "@/pages/Portfolio/hooks/portfolioRebalancer"

const createMockClient = (
  overrides: Partial<HyperliquidClient> = {},
): HyperliquidClient =>
  ({
    getBalance: vi.fn(),
    getAccountSummary: vi.fn(),
    getCurrentPositions: vi.fn(),
    getFundingRates: vi.fn(),
    rebalancePositions: vi.fn(),
    getNetworkMode: vi.fn(),
    getWalletAddress: vi.fn(),
    ...overrides,
  }) as unknown as HyperliquidClient

const failureError = async <E>(
  effect: Effect.Effect<unknown, E>,
): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect)
  if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
    return exit.cause.error
  }
  throw new Error(`expected a tagged failure, got: ${JSON.stringify(exit)}`)
}

describe("hyperliquid Effect service", () => {
  describe("WalletNotConnected", () => {
    it("fails with WalletNotConnected when client is null", async () => {
      const error = await failureError(getBalance(null))
      expect(error).toBeInstanceOf(WalletNotConnected)
      expect(error._tag).toBe("WalletNotConnected")
    })

    it("fails with WalletNotConnected for every operation when client is null", async () => {
      const nullClientOperations = [
        getBalance(null),
        getAccountSummary(null),
        getCurrentPositions(null),
        getFundingRates(null),
        rebalancePositions(null, []),
      ]

      for (const operation of nullClientOperations) {
        const error = await failureError(operation)
        expect(error).toBeInstanceOf(WalletNotConnected)
      }
    })
  })

  describe("delegation to HyperliquidClient", () => {
    it("getBalance delegates and returns result", async () => {
      const mockClient = createMockClient({
        getBalance: vi.fn().mockResolvedValue(1500.5),
      })

      const result = await Effect.runPromise(getBalance(mockClient))

      expect(result).toBe(1500.5)
      expect(mockClient.getBalance).toHaveBeenCalled()
    })

    it("getAccountSummary delegates and returns result", async () => {
      const summary = {
        accountValue: 1000,
        totalNotionalPosition: 2000,
        withdrawable: 500,
      }
      const mockClient = createMockClient({
        getAccountSummary: vi.fn().mockResolvedValue(summary),
      })

      const result = await Effect.runPromise(getAccountSummary(mockClient))

      expect(result).toEqual(summary)
    })

    it("getCurrentPositions delegates and returns result", async () => {
      const positions = [
        {
          symbol: "BTC/USDC:USDC",
          side: "buy" as const,
          notional: 500,
          entryPrice: 45000,
          unrealizedPnl: 50,
          leverage: 2,
        },
      ]
      const mockClient = createMockClient({
        getCurrentPositions: vi.fn().mockResolvedValue(positions),
      })

      const result = await Effect.runPromise(getCurrentPositions(mockClient))

      expect(result).toEqual(positions)
    })

    it("getFundingRates delegates and returns result", async () => {
      const rates = { BTC: 0.0001, ETH: -0.0002 }
      const mockClient = createMockClient({
        getFundingRates: vi.fn().mockResolvedValue(rates),
      })

      const result = await Effect.runPromise(getFundingRates(mockClient))

      expect(result).toEqual(rates)
    })

    it("rebalancePositions delegates the actions and returns the orders", async () => {
      const orders = [
        {
          symbol: "BTC/USDC:USDC",
          side: "buy" as const,
          status: "filled" as const,
        },
      ]
      const mockRebalance = vi.fn().mockResolvedValue(orders)
      const mockClient = createMockClient({
        rebalancePositions: mockRebalance,
      })

      const actions: RebalanceAction[] = [
        {
          kind: "rebalance",
          symbol: "BTC/USDC:USDC",
          signedNotionalDelta: 100,
          leverage: 2,
          leverageChanged: false,
        },
      ]

      const result = await Effect.runPromise(
        rebalancePositions(mockClient, actions),
      )

      expect(result).toEqual(orders)
      expect(mockRebalance).toHaveBeenCalledWith(actions)
    })
  })

  describe("error wrapping", () => {
    it("wraps exchange exceptions as ExchangeRequestError", async () => {
      const ccxtError = new Error("Exchange timeout")
      const mockClient = createMockClient({
        getBalance: vi.fn().mockRejectedValue(ccxtError),
      })

      const error = await failureError(getBalance(mockClient))

      expect(error).toBeInstanceOf(ExchangeRequestError)
      expect((error as ExchangeRequestError).cause).toBe(ccxtError)
    })
  })
})
