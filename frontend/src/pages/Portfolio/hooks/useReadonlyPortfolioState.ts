import { createMemo, createSignal } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"

import type { NetworkMode } from "@/contexts/wallet-context"
import type { OrderSide } from "@/hooks/useTrading"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  validateBitcoinAddress,
  canonicalizeStoredBitcoinAddress,
} from "./bitcoinAddress"

const readonlyBtcStorageKey = (networkMode: NetworkMode): string =>
  `portfolio-readonly-btc-addresses:${networkMode}`

const canonicalizeStoredEntryAddress = (
  address: string,
  networkMode: NetworkMode,
): string | null => {
  const trimmedAddress = address.trim()
  if (trimmedAddress.length === 0) return null

  const lowercased = trimmedAddress.toLowerCase()
  const looksLikeMainnet =
    lowercased.startsWith("bc1") ||
    trimmedAddress.startsWith("1") ||
    trimmedAddress.startsWith("3")
  const looksLikeTestnet =
    lowercased.startsWith("tb1") || /^[mn2]/.test(trimmedAddress)

  if (networkMode === "mainnet" && !looksLikeMainnet) {
    return null
  }
  if (networkMode === "testnet" && !looksLikeTestnet) {
    return null
  }

  return canonicalizeStoredBitcoinAddress(trimmedAddress)
}

interface ReadonlyBtcEntry {
  address: string
  includeInBeta: boolean
}

// The backend serializes monetary values as exact decimal strings (rust_decimal),
// not JSON numbers, to avoid floating-point drift when aggregating server-side.
interface ExposureResponse {
  ubtc_price_usd: string
  positions: Array<{
    source: "hyperliquid" | "btc_address"
    source_id: string | null
    symbol: string
    side: OrderSide
    notional_usd: string
    quantity_btc: string | null
    is_tradable: boolean
    include_in_beta: boolean
  }>
  gross_long_usd: string
  gross_short_usd: string
  net_usd: string
}

interface ApiErrorResponse {
  error?: string
}

interface ReadonlyBtcRow {
  address: string
  includeInBeta: boolean
  quantityBtc: number
  notionalUsd: number
}

interface ReadonlyBetaPosition {
  symbol: string
  side: OrderSide
  notionalUsd: number
  includeInBeta: boolean
}

const deduplicateEntries = (entries: ReadonlyBtcEntry[]): ReadonlyBtcEntry[] =>
  entries.reduce<ReadonlyBtcEntry[]>(
    (uniqueEntries, entry) =>
      uniqueEntries.some(uniqueEntry => uniqueEntry.address === entry.address)
        ? uniqueEntries
        : [...uniqueEntries, entry],
    [],
  )

const readEntriesFromStorage = (
  networkMode: NetworkMode,
): ReadonlyBtcEntry[] => {
  if (typeof localStorage === "undefined") return []
  const rawValue = localStorage.getItem(readonlyBtcStorageKey(networkMode))
  if (!rawValue) return []

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) return []
    const restoredEntries = parsed
      .filter((candidate): candidate is ReadonlyBtcEntry => {
        if (typeof candidate !== "object" || candidate === null) return false
        const address = (candidate as { address?: unknown }).address
        const includeInBeta = (candidate as { includeInBeta?: unknown })
          .includeInBeta
        return typeof address === "string" && typeof includeInBeta === "boolean"
      })
      .flatMap(entry => {
        const canonicalAddress = canonicalizeStoredEntryAddress(
          entry.address,
          networkMode,
        )

        return canonicalAddress === null
          ? []
          : [
              {
                address: canonicalAddress,
                includeInBeta: entry.includeInBeta,
              },
            ]
      })

    return deduplicateEntries(restoredEntries)
  } catch {
    return []
  }
}

const writeEntriesToStorage = (
  networkMode: NetworkMode,
  entries: ReadonlyBtcEntry[],
): void => {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(
    readonlyBtcStorageKey(networkMode),
    JSON.stringify(entries),
  )
}

const clearEntriesFromStorage = (networkMode: NetworkMode): void => {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(readonlyBtcStorageKey(networkMode))
}

const fetchExposure = async (
  entries: ReadonlyBtcEntry[],
  networkMode: "testnet" | "mainnet",
  signal?: AbortSignal,
): Promise<ExposureResponse> => {
  const response = await fetch(
    `${import.meta.env.BASE_URL}api/portfolio/exposure`,
    {
      method: "POST",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        btc_network: networkMode,
        hyperliquid_positions: [],
        readonly_btc_entries: entries.map(entry => ({
          address: entry.address,
          include_in_beta: entry.includeInBeta,
        })),
      }),
    },
  )

  if (!response.ok) {
    const responseText = await response.text()
    let errorDetail = responseText.trim()
    if (errorDetail.length > 0) {
      try {
        const parsed = JSON.parse(responseText) as ApiErrorResponse
        if (
          typeof parsed.error === "string" &&
          parsed.error.trim().length > 0
        ) {
          errorDetail = parsed.error.trim()
        }
      } catch {
        // Keep raw response text as error details when body is not JSON.
      }
    }
    if (errorDetail.length === 0) {
      errorDetail = "no additional error details from server"
    }
    throw new Error(
      `readonly exposure request failed (${String(response.status)}): ${errorDetail}`,
    )
  }
  return response.json() as Promise<ExposureResponse>
}

export const useReadonlyPortfolioState = () => {
  const { networkMode } = useWallet()
  const [entriesRevision, setEntriesRevision] = createSignal(0)
  const [validationError, setValidationError] = createSignal<string | null>(
    null,
  )
  const refreshEntries = () => setEntriesRevision(revision => revision + 1)
  const entries = createMemo<ReadonlyBtcEntry[]>(() => {
    entriesRevision()
    return readEntriesFromStorage(networkMode())
  })

  const query = useQuery(() => {
    const currentEntries = entries()
    const currentNetworkMode = networkMode()
    const readonlyAddresses = currentEntries.map(entry => entry.address)
    const enabled = readonlyAddresses.length > 0

    return {
      queryKey: [
        "readonly-btc-exposure",
        currentNetworkMode,
        readonlyAddresses,
      ] as const,
      queryFn: (ctx: { signal: AbortSignal }) =>
        fetchExposure(currentEntries, currentNetworkMode, ctx.signal),
      enabled,
      retry: 1,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }
  })

  const addAddress = async (rawAddress: string): Promise<boolean> => {
    const normalizedAddress = rawAddress.trim()
    if (!normalizedAddress) {
      setValidationError(null)
      return false
    }
    const validationOutcome = await Effect.runPromise(
      Effect.either(validateBitcoinAddress(normalizedAddress, networkMode())),
    )
    if (Either.isLeft(validationOutcome)) {
      const loadErrorMessage = getErrorMessage(validationOutcome.left)
      console.warn(loadErrorMessage, {
        error: validationOutcome.left,
        network: networkMode(),
      })
      setValidationError(loadErrorMessage)
      return false
    }

    const validation = validationOutcome.right
    if (!validation.ok) {
      console.warn(validation.error.message, {
        error: validation.error,
        network: networkMode(),
      })
      setValidationError(validation.error.message)
      return false
    }
    const canonicalAddress =
      validation.kind === "bech32"
        ? normalizedAddress.toLowerCase()
        : normalizedAddress

    const currentEntries = entries()
    if (currentEntries.some(entry => entry.address === canonicalAddress)) {
      setValidationError(null)
      return false
    }

    const nextEntries = [
      ...currentEntries,
      { address: canonicalAddress, includeInBeta: true },
    ]
    writeEntriesToStorage(networkMode(), nextEntries)
    refreshEntries()
    setValidationError(null)
    return true
  }

  const removeAddress = (address: string) => {
    const nextEntries = entries().filter(entry => entry.address !== address)
    writeEntriesToStorage(networkMode(), nextEntries)
    refreshEntries()
  }

  const setIncludeInBeta = (address: string, includeInBeta: boolean) => {
    const nextEntries = entries().map(entry =>
      entry.address === address ? { ...entry, includeInBeta } : entry,
    )
    writeEntriesToStorage(networkMode(), nextEntries)
    refreshEntries()
  }

  const clearAddresses = () => {
    clearEntriesFromStorage(networkMode())
    refreshEntries()
    setValidationError(null)
  }

  const readonlyRows = createMemo<ReadonlyBtcRow[]>(() => {
    const exposurePositions =
      query.data?.positions.filter(
        position => position.source === "btc_address",
      ) ?? []
    const byAddress = new Map(
      exposurePositions.map(position => [position.source_id ?? "", position]),
    )

    return entries().map(entry => {
      const position = byAddress.get(entry.address)
      return {
        address: entry.address,
        includeInBeta: entry.includeInBeta,
        quantityBtc: Number(position?.quantity_btc ?? 0),
        notionalUsd: Number(position?.notional_usd ?? 0),
      }
    })
  })

  const betaPositions = createMemo<ReadonlyBetaPosition[]>(() =>
    readonlyRows().map(row => ({
      symbol: "BTC",
      side: "buy",
      notionalUsd: row.notionalUsd,
      includeInBeta: row.includeInBeta,
    })),
  )

  return {
    get rows() {
      return readonlyRows()
    },
    get betaPositions() {
      return betaPositions()
    },
    get isLoading() {
      return query.isLoading
    },
    get error() {
      return query.error?.message ?? null
    },
    get validationError() {
      return validationError()
    },
    addAddress,
    removeAddress,
    setIncludeInBeta,
    clearAddresses,
  }
}

export type { ReadonlyBtcRow, ReadonlyBetaPosition }
