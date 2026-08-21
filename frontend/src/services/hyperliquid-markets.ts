import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { NetworkMode } from "@/contexts/wallet-context"
import {
  fetchStreamChecked,
  JsonParseError,
  type HttpStatusError,
  type NetworkError,
} from "@/lib/http"

const LeverageLimitPayload = Schema.Struct({
  symbol: Schema.String,
  maxLeverage: Schema.Number,
  assetIndex: Schema.Number,
  /** `true` when Hyperliquid forbids cross margin; always a boolean from the backend. */
  onlyIsolated: Schema.Boolean,
})

const HyperliquidMarketsPayload = Schema.Struct({
  tickers: Schema.Array(Schema.String),
  leverageLimits: Schema.Array(LeverageLimitPayload),
  refreshedAt: Schema.NullOr(Schema.String),
})

const decodeMarketsPayload = Schema.decodeUnknown(HyperliquidMarketsPayload)

export type LeverageLimit = typeof LeverageLimitPayload.Type

export type HyperliquidMarketsResponse =
  typeof HyperliquidMarketsPayload.Type & {
    /** How long the catalog stays fresh, derived from the response headers. */
    readonly marketsMaxAgeMs?: number
  }

const HYPERLIQUID_REQUEST_TIMEOUT_MS = 10_000
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export const millisecondsUntilNextUtcMidnight = (
  now: Date = new Date(),
): number => {
  const millisecondsIntoDay = now.getTime() % MILLISECONDS_PER_DAY
  return Math.max(MILLISECONDS_PER_DAY - millisecondsIntoDay, 1)
}

const parseCacheMaxAgeMs = (cacheControl: string | null): number | null => {
  if (!cacheControl) return null
  const match = cacheControl.match(/max-age=(\d+)/)
  if (!match) return null
  const maxAgeSeconds = Number(match[1])
  return Number.isFinite(maxAgeSeconds) ? maxAgeSeconds * 1000 : null
}

const combinedAbortSignal = (signal?: AbortSignal): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(HYPERLIQUID_REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

/**
 * Fetches the Hyperliquid markets catalog from the app API (no ccxt).
 *
 * The payload is decoded against the backend contract, so a response that
 * drifts from it fails as a `JsonParseError` instead of flowing through the app
 * as a mistyped catalog.
 */
export const fetchHyperliquidMarkets = (
  network: NetworkMode,
  signal?: AbortSignal,
): Effect.Effect<
  HyperliquidMarketsResponse,
  NetworkError | HttpStatusError | JsonParseError
> => {
  const url = `${import.meta.env.BASE_URL}api/hyperliquid/markets?network=${network}`

  return fetchStreamChecked(url, {
    cache: "no-store",
    signal: combinedAbortSignal(signal),
  }).pipe(
    Effect.flatMap(response =>
      Effect.tryPromise({
        try: (): Promise<unknown> => response.json(),
        catch: cause => new JsonParseError({ cause }),
      }).pipe(
        Effect.flatMap(payload =>
          decodeMarketsPayload(payload).pipe(
            Effect.mapError(cause => new JsonParseError({ cause })),
          ),
        ),
        Effect.map(markets => {
          const marketsMaxAgeMs =
            parseCacheMaxAgeMs(response.headers.get("cache-control")) ??
            millisecondsUntilNextUtcMidnight()
          return { ...markets, marketsMaxAgeMs }
        }),
      ),
    ),
  )
}
