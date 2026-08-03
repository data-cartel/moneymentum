import * as Effect from "effect/Effect"

import type { NetworkMode } from "@/contexts/wallet-context"
import {
  fetchStreamChecked,
  JsonParseError,
  type HttpStatusError,
  type NetworkError,
} from "@/lib/http"

export interface DeriveInstrument {
  instrumentName: string
  instrumentType: string
  baseCurrency: string
  quoteCurrency: string
  isActive: boolean
  optionType: string | null
  strike: string | null
  expiryUnix: number | null
}

export interface DeriveMarketsResponse {
  tickers: string[]
  instruments: DeriveInstrument[]
  refreshedAt: string
}

const DERIVE_MARKETS_TIMEOUT_MS = 60_000

/**
 * Fetches the Derive option + perp universe from the app API.
 * No max_leverage -- Derive margin is not a single leverage number.
 */
export const fetchDeriveMarkets = (
  network: NetworkMode,
  signal?: AbortSignal,
): Effect.Effect<
  DeriveMarketsResponse,
  NetworkError | HttpStatusError | JsonParseError
> => {
  const url = `${import.meta.env.BASE_URL}api/derive/markets?network=${network}`
  const timeoutSignal = AbortSignal.timeout(DERIVE_MARKETS_TIMEOUT_MS)
  const combined = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal

  return fetchStreamChecked(url, {
    cache: "no-store",
    signal: combined,
  }).pipe(
    Effect.flatMap(response =>
      Effect.tryPromise({
        try: () => response.json() as Promise<DeriveMarketsResponse>,
        catch: cause => new JsonParseError({ cause }),
      }),
    ),
  )
}
