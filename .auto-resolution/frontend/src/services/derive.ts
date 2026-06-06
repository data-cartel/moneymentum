import * as Effect from "effect/Effect"

import { fetchJson, postEmpty } from "@/lib/http"
import type { HttpStatusError, JsonParseError, NetworkError } from "@/lib/http"
import type {
  OptionsBootstrap,
  OptionsSnapshot,
} from "@/pages/DeriveOptions/index"

type DeriveFetchError = NetworkError | HttpStatusError | JsonParseError

export const fetchBootstrap = (
  baseUrl: string,
  signal?: AbortSignal,
): Effect.Effect<OptionsBootstrap, DeriveFetchError> =>
  fetchJson<OptionsBootstrap>(`${baseUrl}/derive/options/bootstrap`, { signal })

export const fetchSnapshot = (
  baseUrl: string,
  signal?: AbortSignal,
): Effect.Effect<OptionsSnapshot, DeriveFetchError> =>
  fetchJson<OptionsSnapshot>(`${baseUrl}/derive/options/snapshot`, { signal })

export const postActiveExpiry = (
  baseUrl: string,
  expiryUnix: number,
  signal?: AbortSignal,
): Effect.Effect<void, NetworkError | HttpStatusError> =>
  postEmpty(`${baseUrl}/derive/options/active_expiry`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiry_unix: expiryUnix }),
    signal,
  })
