import * as Effect from "effect/Effect"

import { fetchJson, postEmpty } from "@/lib/http"
import type { HttpStatusError, JsonParseError, NetworkError } from "@/lib/http"
import type { NetworkMode } from "@/contexts/wallet-context"
import {
  decodeOptionsBootstrap,
  decodeOptionsSnapshot,
  OptionsPayloadDecodeError,
  type OptionsBootstrap,
  type OptionsSnapshot,
} from "@/components/derive-options/optionsSnapshot"

type DeriveFetchError =
  | NetworkError
  | HttpStatusError
  | JsonParseError
  | OptionsPayloadDecodeError

const mapDecodeError = (cause: unknown): OptionsPayloadDecodeError =>
  new OptionsPayloadDecodeError({ cause })

const withNetworkQuery = (path: string, network: NetworkMode): string => {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}network=${encodeURIComponent(network)}`
}

export const fetchBootstrap = (
  baseUrl: string,
  network: NetworkMode,
  signal?: AbortSignal,
): Effect.Effect<OptionsBootstrap, DeriveFetchError> =>
  fetchJson<unknown>(
    withNetworkQuery(`${baseUrl}/derive/options/bootstrap`, network),
    { signal },
  ).pipe(
    Effect.flatMap(payload =>
      decodeOptionsBootstrap(payload).pipe(Effect.mapError(mapDecodeError)),
    ),
  )

export const fetchSnapshot = (
  baseUrl: string,
  network: NetworkMode,
  signal?: AbortSignal,
): Effect.Effect<OptionsSnapshot, DeriveFetchError> =>
  fetchJson<unknown>(
    withNetworkQuery(`${baseUrl}/derive/options/snapshot`, network),
    { signal },
  ).pipe(
    Effect.flatMap(payload =>
      decodeOptionsSnapshot(payload).pipe(Effect.mapError(mapDecodeError)),
    ),
  )

export const postActiveExpiry = (
  baseUrl: string,
  network: NetworkMode,
  expiryUnix: number,
  signal?: AbortSignal,
): Effect.Effect<void, NetworkError | HttpStatusError> =>
  postEmpty(
    withNetworkQuery(`${baseUrl}/derive/options/active_expiry`, network),
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiry_unix: expiryUnix }),
      signal,
    },
  )

export const postActiveAsset = (
  baseUrl: string,
  network: NetworkMode,
  asset: string,
  signal?: AbortSignal,
): Effect.Effect<void, NetworkError | HttpStatusError> =>
  postEmpty(
    withNetworkQuery(`${baseUrl}/derive/options/active_asset`, network),
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asset }),
      signal,
    },
  )

export const deriveOptionsStreamUrl = (
  baseUrl: string,
  network: NetworkMode,
): string => withNetworkQuery(`${baseUrl}/derive/options/stream`, network)
