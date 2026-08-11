import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type {
  HyperliquidClient,
  CurrentPosition,
  OrderResult,
} from "./hyperliquid-client"
import type { RebalanceAction } from "@/pages/Portfolio/hooks/portfolioRebalancer"

export class WalletNotConnected extends Data.TaggedError("WalletNotConnected")<
  Record<string, never>
> {}

export class ExchangeRequestError extends Data.TaggedError(
  "ExchangeRequestError",
)<{
  readonly cause: unknown
}> {}

const wrapExchange = <A>(
  fn: () => Promise<A>,
): Effect.Effect<A, ExchangeRequestError> =>
  Effect.tryPromise({
    try: fn,
    catch: cause => new ExchangeRequestError({ cause }),
  })

const requireClient = (
  client: HyperliquidClient | null,
): Effect.Effect<HyperliquidClient, WalletNotConnected> =>
  client ? Effect.succeed(client) : Effect.fail(new WalletNotConnected())

export const getBalance = (
  client: HyperliquidClient | null,
): Effect.Effect<number, WalletNotConnected | ExchangeRequestError> =>
  requireClient(client).pipe(
    Effect.flatMap(hyperliquid => wrapExchange(() => hyperliquid.getBalance())),
  )

export interface AccountSummary {
  accountValue: number
  totalNotionalPosition: number
  withdrawable: number
}

export const getAccountSummary = (
  client: HyperliquidClient | null,
): Effect.Effect<AccountSummary, WalletNotConnected | ExchangeRequestError> =>
  requireClient(client).pipe(
    Effect.flatMap(hyperliquid =>
      wrapExchange(() => hyperliquid.getAccountSummary()),
    ),
  )

export const getCurrentPositions = (
  client: HyperliquidClient | null,
): Effect.Effect<
  CurrentPosition[],
  WalletNotConnected | ExchangeRequestError
> =>
  requireClient(client).pipe(
    Effect.flatMap(hyperliquid =>
      wrapExchange(() => hyperliquid.getCurrentPositions()),
    ),
  )

export const getFundingRates = (
  client: HyperliquidClient | null,
): Effect.Effect<
  Record<string, number>,
  WalletNotConnected | ExchangeRequestError
> =>
  requireClient(client).pipe(
    Effect.flatMap(hyperliquid =>
      wrapExchange(() => hyperliquid.getFundingRates()),
    ),
  )

export const rebalancePositions = (
  client: HyperliquidClient | null,
  actions: RebalanceAction[],
): Effect.Effect<OrderResult[], WalletNotConnected | ExchangeRequestError> =>
  requireClient(client).pipe(
    Effect.flatMap(hyperliquid =>
      wrapExchange(() => hyperliquid.rebalancePositions(actions)),
    ),
  )
