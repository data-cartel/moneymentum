import * as Effect from "effect/Effect"
import { createMemo } from "solid-js"
import { useQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { useWallet } from "./useWallet"
import { getStoredEncryptedDeriveSession } from "@/contexts/wallet-context"
import type {
  OrderResult,
  CurrentPosition,
  OrderSide,
} from "@/services/hyperliquid-client"
import {
  fetchHyperliquidMarkets,
  millisecondsUntilNextUtcMidnight,
  type HyperliquidMarketsResponse,
  type LeverageLimit,
} from "@/services/hyperliquid-markets"
import * as Hyperliquid from "@/services/hyperliquid"
import {
  fetchDeriveAccountSnapshot,
  fetchDeriveBalance,
  type DeriveSessionCredentials,
} from "@/services/deriveAccount"
import {
  cancelDeriveOrder,
  fetchDeriveOpenOrders,
  placeAndMonitorDeriveOrders,
  type DeriveBatchOrderRequest,
} from "@/services/derive-client"
import { DeriveSessionMissing } from "@/services/deriveAccount"
import type { RebalanceAction } from "@/pages/Portfolio/hooks/portfolioRebalancer"

export type {
  OrderSide,
  OrderResult,
  CurrentPosition,
  LeverageLimit,
  HyperliquidMarketsResponse,
}

const QUERY_KEYS = {
  balance: ["hyperliquid", "balance"],
  accountSummary: ["hyperliquid", "account-summary"],
  positions: ["hyperliquid", "positions"],
  markets: ["hyperliquid", "markets"],
  fundingRates: ["hyperliquid", "funding-rates"],
  deriveBalance: ["derive", "balance"],
  deriveAccount: ["derive", "account"],
  deriveOpenOrders: ["derive", "open-orders"],
} as const

const DATA_STALE_TIME_MS = 30_000

export const useHyperliquidClient = () => {
  const { client, credentials, networkMode, isHyperliquidConnected } =
    useWallet()
  return {
    client,
    credentials,
    isConnected: isHyperliquidConnected,
    networkMode,
  }
}

export const useHyperliquidMarkets = () => {
  const { networkMode } = useHyperliquidClient()
  const network = createMemo(() => networkMode())

  return useQuery(() => {
    const marketsCacheDurationMs = millisecondsUntilNextUtcMidnight()

    return {
      queryKey: [...QUERY_KEYS.markets, network()],
      queryFn: ({ signal }) =>
        Effect.runPromise(fetchHyperliquidMarkets(network(), signal)),
      staleTime: marketsCacheDurationMs,
      gcTime: marketsCacheDurationMs,
    }
  })
}

export const useHyperliquidBalance = () => {
  const { client, credentials, networkMode, isConnected } =
    useHyperliquidClient()

  return useQuery(() => ({
    queryKey: [
      ...QUERY_KEYS.balance,
      credentials()?.accountAddress,
      networkMode(),
    ],
    queryFn: () => Effect.runPromise(Hyperliquid.getBalance(client())),
    enabled: isConnected() && client() !== null,
    staleTime: Infinity,
  }))
}

export interface AccountSummary {
  accountValue: number
  totalNotionalPosition: number
  withdrawable: number
  crossAccountLeverage: number
}

export const useHyperliquidAccountSummary = () => {
  const { client, credentials, networkMode, isConnected } =
    useHyperliquidClient()

  return useQuery(() => ({
    queryKey: [
      ...QUERY_KEYS.accountSummary,
      credentials()?.accountAddress,
      networkMode(),
    ],
    queryFn: (): Promise<AccountSummary> =>
      Effect.runPromise(
        Hyperliquid.getAccountSummary(client()).pipe(
          Effect.map(summary => {
            const crossAccountLeverage =
              summary.accountValue > 0
                ? summary.totalNotionalPosition / summary.accountValue
                : 0
            return { ...summary, crossAccountLeverage }
          }),
        ),
      ),
    enabled: isConnected() && client() !== null,
    staleTime: DATA_STALE_TIME_MS,
  }))
}

export const useHyperliquidPositions = () => {
  const { client, credentials, networkMode, isConnected } =
    useHyperliquidClient()

  return useQuery(() => ({
    queryKey: [
      ...QUERY_KEYS.positions,
      credentials()?.accountAddress,
      networkMode(),
    ],
    queryFn: () =>
      Effect.runPromise(
        Hyperliquid.getCurrentPositions(client()).pipe(
          Effect.map(positions => {
            const totalNotional = positions.reduce(
              (sum, pos) => sum + pos.notional,
              0,
            )
            return {
              positions: positions.map(pos => ({
                ...pos,
                percentage:
                  totalNotional > 0 ? (pos.notional / totalNotional) * 100 : 0,
              })),
              totalNotional,
            }
          }),
        ),
      ),
    enabled: isConnected() && client() !== null,
    staleTime: DATA_STALE_TIME_MS,
  }))
}

export const useHyperliquidTickers = () => {
  const marketsQuery = useHyperliquidMarkets()
  const tickers = createMemo(() => marketsQuery.data?.tickers)

  return {
    get data() {
      return tickers()
    },
    get isLoading() {
      return marketsQuery.isLoading
    },
    get isSuccess() {
      return marketsQuery.isSuccess
    },
    get isError() {
      return marketsQuery.isError
    },
    get error() {
      return marketsQuery.error
    },
  }
}

export const useHyperliquidLeverageLimits = () => {
  const marketsQuery = useHyperliquidMarkets()
  const leverageLimits = createMemo(() => marketsQuery.data?.leverageLimits)

  return {
    get data() {
      return leverageLimits()
    },
    get isLoading() {
      return marketsQuery.isLoading
    },
    get isSuccess() {
      return marketsQuery.isSuccess
    },
    get isError() {
      return marketsQuery.isError
    },
    get error() {
      return marketsQuery.error
    },
  }
}

export const useHyperliquidFundingRates = () => {
  const { client, networkMode, isConnected } = useHyperliquidClient()

  return useQuery(() => ({
    queryKey: [...QUERY_KEYS.fundingRates, networkMode()],
    queryFn: () => Effect.runPromise(Hyperliquid.getFundingRates(client())),
    enabled: isConnected() && client() !== null,
    staleTime: DATA_STALE_TIME_MS,
  }))
}

export interface RebalanceParams {
  actions: RebalanceAction[]
}

export const useRebalanceHyperliquidPositions = () => {
  const { client } = useHyperliquidClient()

  return useMutation(() => ({
    mutationFn: (params: RebalanceParams) =>
      Effect.runPromise(
        Hyperliquid.rebalancePositions(client(), params.actions),
      ),
    // Portfolio `finalizeRebalance` owns post-trade refresh. Invalidating here
    // races that settle and can briefly reapply a stale snapshot.
  }))
}

export interface DeriveRebalanceParams {
  requests: DeriveBatchOrderRequest[]
}

/**
 * Place + monitor Derive limit orders (same path as the Derive Test trading
 * tab). Callers map portfolio actions to requests before mutate.
 */
export const useRebalanceDerivePositions = () => {
  const session = useDeriveSessionCredentials()
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: (params: DeriveRebalanceParams) => {
      const credentials = session()
      if (credentials === null) {
        return Effect.runPromise(Effect.fail(new DeriveSessionMissing()))
      }
      if (credentials.subaccountId === null) {
        return Effect.runPromise(
          Effect.fail(
            new Error(
              "Select a Derive subaccount before rebalancing Derive positions",
            ),
          ),
        )
      }
      if (params.requests.length === 0) {
        return Promise.resolve([] as OrderResult[])
      }

      return Effect.runPromise(
        placeAndMonitorDeriveOrders(credentials, params.requests),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deriveOpenOrders,
      })
    },
  }))
}

export const useWalletSettings = () => {
  const {
    credentials,
    mainAddress,
    deriveCredentials,
    networkMode,
    isConnected,
    isHyperliquidConnected,
    isDeriveConnected,
    hasStoredSession,
    hasStoredDeriveSession,
    canTrade,
  } = useWallet()

  const hyperliquidSummary = useHyperliquidAccountSummary()
  const deriveBalance = useDeriveBalance()

  const data = createMemo(() => {
    const hyperliquidAddress =
      credentials()?.accountAddress ?? mainAddress() ?? null
    const deriveAddress =
      deriveCredentials()?.deriveWallet ??
      getStoredEncryptedDeriveSession()?.deriveWallet ??
      null

    return {
      isTestnet: networkMode() === "testnet",
      venues: [
        {
          id: "hyperliquid" as const,
          connected: isHyperliquidConnected(),
          address: hyperliquidAddress,
          balanceUsd: isHyperliquidConnected()
            ? (hyperliquidSummary.data?.accountValue ?? null)
            : null,
          canRevoke:
            isHyperliquidConnected() && (hasStoredSession() || canTrade()),
        },
        {
          id: "derive" as const,
          connected: isDeriveConnected(),
          address: deriveAddress,
          balanceUsd: isDeriveConnected()
            ? (deriveBalance.data?.accountValue ?? null)
            : null,
          canRevoke: false,
        },
      ],
    }
  })

  return {
    data,
    isConnected,
    isHyperliquidConnected,
    isDeriveConnected,
    hasStoredDeriveSession,
  }
}

export const useDeriveSessionCredentials = () => {
  const { deriveCredentials, networkMode } = useWallet()

  const sessionCredentials = createMemo((): DeriveSessionCredentials | null => {
    const unlocked = deriveCredentials()
    if (unlocked === null) {
      return null
    }
    if (unlocked.networkMode !== networkMode()) {
      return null
    }

    return {
      deriveWallet: unlocked.deriveWallet,
      sessionAddress: unlocked.sessionAddress,
      sessionPrivateKey: unlocked.sessionPrivateKey,
      networkMode: unlocked.networkMode,
      subaccountId: unlocked.subaccountId,
    }
  })

  return sessionCredentials
}

export const useDeriveBalance = () => {
  const session = useDeriveSessionCredentials()
  const { isDeriveConnected, isDeriveLocked } = useWallet()

  return useQuery(() => {
    const credentials = session()
    return {
      queryKey: [
        ...QUERY_KEYS.deriveBalance,
        credentials?.deriveWallet,
        credentials?.subaccountId,
        credentials?.networkMode,
      ],
      queryFn: () => Effect.runPromise(fetchDeriveBalance(credentials)),
      enabled: isDeriveConnected() && !isDeriveLocked() && credentials !== null,
      staleTime: DATA_STALE_TIME_MS,
    }
  })
}

export const useDeriveAccountSnapshot = () => {
  const session = useDeriveSessionCredentials()
  const { isDeriveConnected, isDeriveLocked } = useWallet()

  return useQuery(() => {
    const credentials = session()
    // Always list every subaccount for the picker; selected id only filters balance.
    const listCredentials =
      credentials === null
        ? null
        : {
            ...credentials,
            subaccountId: null,
          }
    return {
      queryKey: [
        ...QUERY_KEYS.deriveAccount,
        listCredentials?.deriveWallet,
        listCredentials?.networkMode,
      ],
      queryFn: () =>
        Effect.runPromise(fetchDeriveAccountSnapshot(listCredentials)),
      enabled:
        isDeriveConnected() && !isDeriveLocked() && listCredentials !== null,
      staleTime: DATA_STALE_TIME_MS,
    }
  })
}

export const useDeriveOpenOrders = () => {
  const session = useDeriveSessionCredentials()
  const { isDeriveConnected, isDeriveLocked } = useWallet()

  return useQuery(() => {
    const credentials = session()
    const canFetch =
      isDeriveConnected() &&
      !isDeriveLocked() &&
      credentials !== null &&
      credentials.subaccountId !== null

    return {
      queryKey: [
        ...QUERY_KEYS.deriveOpenOrders,
        credentials?.sessionAddress ?? null,
        credentials?.subaccountId ?? null,
        credentials?.networkMode ?? null,
      ],
      queryFn: () => {
        // Re-read session at fetch time -- refetch() ignores `enabled`.
        const current = session()
        const subaccountId = current?.subaccountId
        if (subaccountId === undefined || subaccountId === null) {
          return Effect.runPromise(Effect.fail(new DeriveSessionMissing()))
        }
        return Effect.runPromise(fetchDeriveOpenOrders(current))
      },
      enabled: canFetch,
      staleTime: DATA_STALE_TIME_MS,
      // Refresh cadence is owned by DeriveOpenOrdersPanel's timer ring.
      refetchInterval: false,
    }
  })
}

export const useCancelDeriveOrder = () => {
  const session = useDeriveSessionCredentials()
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: (params: { id: string; symbol: string }) => {
      const credentials = session()
      const subaccountId = credentials?.subaccountId
      if (subaccountId === undefined || subaccountId === null) {
        return Effect.runPromise(Effect.fail(new DeriveSessionMissing()))
      }
      return Effect.runPromise(cancelDeriveOrder(credentials, params))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deriveOpenOrders,
      })
    },
  }))
}

export const useFullHyperliquidRefresh = () => {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({ queryKey: ["hyperliquid"] })
    void queryClient.invalidateQueries({ queryKey: ["derive"] })
  }
}

export const useSwitchNetwork = () => {
  const { setNetworkMode } = useWallet()
  const queryClient = useQueryClient()

  return useMutation(() => ({
    mutationFn: async (network: "testnet" | "mainnet") => {
      await queryClient.cancelQueries({ queryKey: ["hyperliquid"] })
      await queryClient.cancelQueries({ queryKey: ["derive"] })
      setNetworkMode(network)
      await queryClient.invalidateQueries({ queryKey: ["hyperliquid"] })
      await queryClient.invalidateQueries({ queryKey: ["derive"] })
      return network
    },
  }))
}
