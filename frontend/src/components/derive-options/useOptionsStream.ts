import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"

import type { NetworkMode } from "@/contexts/wallet-context"
import { getErrorMessage } from "@/lib/error-message"
import { NetworkError } from "@/lib/http"
import * as deriveService from "@/services/derive/options"

import { deriveOptionsBaseUrl } from "./deriveOptionsBaseUrl"
import { stabilizeExpiryTabs, type ExpiryTab } from "./expiryTabs"
import {
  decodeOptionsSnapshotEither,
  type ExpiryUnix,
  type OptionsBootstrap,
  type OptionsSnapshot,
} from "./optionsSnapshot"
import {
  applyOptionsSnapshot,
  emptyQuoteBook,
  skeletonizeQuoteBook,
} from "./quoteBook"

const COLD_GREEKS_MIN_INTERVAL_MS = 250

/**
 * Effect wraps an aborted fetch as a `NetworkError` whose `cause` is the
 * underlying `AbortError`; unwrap it so cancelled requests are not surfaced as
 * real failures.
 */
const isAbortError = (error: unknown): boolean => {
  const candidate = error instanceof NetworkError ? error.cause : error
  return (
    (candidate instanceof DOMException || candidate instanceof Error) &&
    candidate.name === "AbortError"
  )
}

const parseJsonUnknown = (text: string): unknown =>
  (JSON.parse as (input: string) => unknown)(text)

export type OptionsStreamClearSelection = {
  clear: () => void
}

export const useOptionsStream = (
  networkMode: Accessor<NetworkMode>,
  streamEnabled: Accessor<boolean>,
  selectionBridge: OptionsStreamClearSelection,
) => {
  const [book, setBook] = createStore(emptyQuoteBook())
  const [bootstrap, setBootstrap] = createSignal<OptionsBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isLoading, setIsLoading] = createSignal(false)
  const [selectedExpiryUnix, setSelectedExpiryUnix] =
    createSignal<ExpiryUnix | null>(null)
  const [selectedAsset, setSelectedAsset] = createSignal<string | null>(null)

  const coldGreeksFlushAtRef: { ms: number } = { ms: 0 }

  const pushOptionsSnapshot = (next: OptionsSnapshot): void => {
    const nowMs = Date.now()
    const applyColdGreeks =
      nowMs - coldGreeksFlushAtRef.ms >= COLD_GREEKS_MIN_INTERVAL_MS
    const applied = applyOptionsSnapshot(setBook, next, book.byInstrument, {
      applyColdGreeks,
    })
    if (applied.coldGreeksApplied) {
      coldGreeksFlushAtRef.ms = nowMs
    }
  }

  const deriveBaseUrl = deriveOptionsBaseUrl()
  let streamRef: EventSource | null = null

  const expirySwitchInFlightRef: {
    postAbort: AbortController | undefined
    blockStreamUntilExpiryUnix: ExpiryUnix | null
  } = { postAbort: undefined, blockStreamUntilExpiryUnix: null }

  const assetSwitchInFlightRef: {
    postAbort: AbortController | undefined
    blockStreamUntilAsset: string | null
  } = { postAbort: undefined, blockStreamUntilAsset: null }

  const assetTabList = createMemo(() => {
    const boot = bootstrap()
    if (boot !== null && boot.assets.length > 0) {
      return boot.assets
    }
    if (book.loaded && book.asset.length > 0) {
      return [book.asset]
    }
    return [] as string[]
  })

  const expiryTabList = createMemo(
    (previous: ExpiryTab[] | undefined): ExpiryTab[] => {
      let tabs: ExpiryTab[] = []
      if (book.loaded && book.expiry_unixes.length > 0) {
        tabs = book.expiry_unixes.map((unix, index) => ({
          unix,
          iso: book.expiry_dates[index] ?? new Date(unix * 1000).toISOString(),
        }))
      } else {
        const boot = bootstrap()
        if (boot !== null && boot.tabs.length > 0) {
          tabs = boot.tabs.map(tab => ({
            unix: tab.expiry_unix,
            iso: new Date(tab.expiry_unix * 1000).toISOString(),
          }))
        }
      }
      return stabilizeExpiryTabs(
        previous,
        [...tabs].sort((left, right) => left.unix - right.unix),
      )
    },
  )

  const postActiveExpiry = (
    expiryUnix: ExpiryUnix,
    signal?: AbortSignal,
  ): Effect.Effect<void, string> =>
    deriveService
      .postActiveExpiry(deriveBaseUrl, networkMode(), expiryUnix, signal)
      .pipe(
        Effect.catchTag("NetworkError", error =>
          isAbortError(error)
            ? Effect.void
            : Effect.fail(getErrorMessage(error)),
        ),
        Effect.catchTag("HttpStatusError", error =>
          Effect.fail(getErrorMessage(error)),
        ),
      )

  const postActiveAsset = (
    asset: string,
    signal?: AbortSignal,
  ): Effect.Effect<void, string> =>
    deriveService
      .postActiveAsset(deriveBaseUrl, networkMode(), asset, signal)
      .pipe(
        Effect.catchTag("NetworkError", error =>
          isAbortError(error)
            ? Effect.void
            : Effect.fail(getErrorMessage(error)),
        ),
        Effect.catchTag("HttpStatusError", error =>
          Effect.fail(getErrorMessage(error)),
        ),
      )

  const clearQuotesForPendingSwitch = (
    nextExpiryUnix: ExpiryUnix | null,
    nextAsset: string | null,
  ): void => {
    if (!book.loaded) {
      return
    }
    // Keep previous strikes / instruments so the chain does not collapse;
    // prices show as em-dashes until the matching stream snapshot arrives.
    batch(() => {
      if (nextAsset !== null) {
        setBook("asset", nextAsset)
      }
      if (nextExpiryUnix !== null) {
        setBook("active_expiry_unix", nextExpiryUnix)
      }
      skeletonizeQuoteBook(setBook)
    })
  }

  const switchExpiryTab = (expiryUnix: ExpiryUnix): void => {
    if (assetSwitchInFlightRef.blockStreamUntilAsset !== null) {
      return
    }
    if (
      selectedExpiryUnix() === expiryUnix &&
      book.loaded &&
      book.active_expiry_unix === expiryUnix &&
      book.instrumentNamesAsc.length > 0
    ) {
      return
    }

    const previousExpiryUnix = selectedExpiryUnix()

    expirySwitchInFlightRef.postAbort?.abort()
    const controller = new AbortController()
    expirySwitchInFlightRef.postAbort = controller
    expirySwitchInFlightRef.blockStreamUntilExpiryUnix = expiryUnix

    setSelectedExpiryUnix(expiryUnix)
    clearQuotesForPendingSwitch(expiryUnix, null)
    selectionBridge.clear()

    void Effect.runPromise(
      postActiveExpiry(expiryUnix, controller.signal).pipe(
        Effect.match({
          onFailure: message => {
            expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
            setSelectedExpiryUnix(previousExpiryUnix)
            setErrorMessage(message)
          },
          onSuccess: () => {
            setErrorMessage(null)
          },
        }),
      ),
    )
  }

  const switchAssetTab = (asset: string): void => {
    if (
      selectedAsset() === asset &&
      book.loaded &&
      book.asset === asset &&
      book.instrumentNamesAsc.length > 0
    ) {
      return
    }

    const previousAsset = selectedAsset()
    const previousExpiryUnix = selectedExpiryUnix()

    assetSwitchInFlightRef.postAbort?.abort()
    expirySwitchInFlightRef.postAbort?.abort()
    const controller = new AbortController()
    assetSwitchInFlightRef.postAbort = controller
    assetSwitchInFlightRef.blockStreamUntilAsset = asset
    expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null

    setSelectedAsset(asset)
    setSelectedExpiryUnix(null)
    selectionBridge.clear()
    clearQuotesForPendingSwitch(null, asset)
    setIsLoading(true)

    void Effect.runPromise(
      postActiveAsset(asset, controller.signal).pipe(
        Effect.match({
          onFailure: message => {
            assetSwitchInFlightRef.blockStreamUntilAsset = null
            setSelectedAsset(previousAsset)
            setSelectedExpiryUnix(previousExpiryUnix)
            setIsLoading(false)
            setErrorMessage(message)
          },
          onSuccess: () => {
            setErrorMessage(null)
          },
        }),
      ),
    )
  }

  const loadSnapshot = (signal?: AbortSignal): Promise<OptionsSnapshot> =>
    Effect.runPromise(
      deriveService.fetchSnapshot(deriveBaseUrl, networkMode(), signal),
    )

  const startStream = (): void => {
    streamRef?.close()
    streamRef = new EventSource(
      deriveService.deriveOptionsStreamUrl(deriveBaseUrl, networkMode()),
    )
    streamRef.onmessage = event => {
      try {
        if (typeof event.data !== "string") {
          setErrorMessage("Stream parse error: expected string payload")
          return
        }
        const decoded = decodeOptionsSnapshotEither(
          parseJsonUnknown(event.data),
        )
        if (Either.isLeft(decoded)) {
          return
        }
        const next = decoded.right
        const pendingAsset = assetSwitchInFlightRef.blockStreamUntilAsset
        if (pendingAsset !== null) {
          if (next.asset !== pendingAsset) {
            return
          }
          assetSwitchInFlightRef.blockStreamUntilAsset = null
          setSelectedAsset(next.asset)
          setSelectedExpiryUnix(next.active_expiry_unix)
          setBootstrap(previous =>
            previous === null
              ? previous
              : {
                  ...previous,
                  asset: next.asset,
                  default_expiry_unix: next.active_expiry_unix,
                  tabs: next.expiry_unixes.map(expiryUnix => ({
                    expiry_unix: expiryUnix,
                    instruments: [],
                  })),
                },
          )
          batch(() => {
            pushOptionsSnapshot(next)
          })
          setErrorMessage(null)
          return
        }
        if (next.asset !== selectedAsset()) {
          return
        }
        const pendingExpiry = expirySwitchInFlightRef.blockStreamUntilExpiryUnix
        if (pendingExpiry !== null) {
          if (next.active_expiry_unix !== pendingExpiry) {
            return
          }
          expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
        } else {
          const selected = selectedExpiryUnix()
          const selectedStillListed =
            selected !== null && next.expiry_unixes.includes(selected)
          if (next.active_expiry_unix !== selected && selectedStillListed) {
            return
          }
          if (next.active_expiry_unix !== selected) {
            setSelectedExpiryUnix(next.active_expiry_unix)
          }
        }
        batch(() => {
          pushOptionsSnapshot(next)
        })
        setErrorMessage(null)
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Stream parse error",
        )
      } finally {
        setIsLoading(false)
      }
    }
    streamRef.onerror = () => {
      setErrorMessage("Stream disconnected. Waiting for reconnection...")
    }
  }

  // createEffect: open options EventSource only while streamEnabled is true.
  // Re-bind when networkMode changes so the chain follows the Testnet toggle.
  // Do not read selectedAsset/expiry here -- initialize sets them and would
  // re-trigger this effect into an abort loop.
  createEffect(() => {
    if (!streamEnabled()) {
      streamRef?.close()
      streamRef = null
      setIsLoading(false)
      return
    }

    const network = networkMode()
    const controller = new AbortController()
    const load: { cancelled: boolean } = { cancelled: false }
    const loadWasCancelled = (): boolean => load.cancelled
    setIsLoading(true)
    setBootstrap(null)
    selectionBridge.clear()
    setBook(reconcile(emptyQuoteBook()))

    const initialize = async () => {
      try {
        const boot = await Effect.runPromise(
          deriveService.fetchBootstrap(
            deriveBaseUrl,
            network,
            controller.signal,
          ),
        )
        if (loadWasCancelled()) {
          return
        }
        setBootstrap(boot)

        const userChoseAsset =
          assetSwitchInFlightRef.blockStreamUntilAsset !== null
        const userChoseExpiry =
          expirySwitchInFlightRef.blockStreamUntilExpiryUnix !== null

        if (!userChoseAsset) {
          setSelectedAsset(boot.asset)
        }
        if (!userChoseAsset && !userChoseExpiry) {
          const defaultUnix = boot.default_expiry_unix
          setSelectedExpiryUnix(defaultUnix)
          expirySwitchInFlightRef.postAbort?.abort()
          const expiryController = new AbortController()
          expirySwitchInFlightRef.postAbort = expiryController
          const postedExpiry = await Effect.runPromise(
            Effect.either(
              postActiveExpiry(defaultUnix, expiryController.signal),
            ),
          )
          if (loadWasCancelled()) {
            return
          }
          const userSwitchedDuringDefaultPost =
            expirySwitchInFlightRef.blockStreamUntilExpiryUnix !== null ||
            assetSwitchInFlightRef.blockStreamUntilAsset !== null
          if (Either.isLeft(postedExpiry) && !userSwitchedDuringDefaultPost) {
            setErrorMessage(postedExpiry.left)
            return
          }
        }

        if (loadWasCancelled()) {
          return
        }
        const data = await loadSnapshot(controller.signal)
        if (loadWasCancelled()) {
          return
        }

        const pendingAsset = assetSwitchInFlightRef.blockStreamUntilAsset
        const pendingExpiry = expirySwitchInFlightRef.blockStreamUntilExpiryUnix
        const snapshotMatchesPendingAsset =
          pendingAsset !== null && data.asset === pendingAsset
        const snapshotMatchesPendingExpiry =
          pendingExpiry !== null && data.active_expiry_unix === pendingExpiry
        const applySnapshot =
          (pendingAsset === null && pendingExpiry === null) ||
          snapshotMatchesPendingAsset ||
          snapshotMatchesPendingExpiry

        if (applySnapshot) {
          if (snapshotMatchesPendingAsset) {
            assetSwitchInFlightRef.blockStreamUntilAsset = null
          }
          if (snapshotMatchesPendingExpiry) {
            expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
          }
          batch(() => {
            pushOptionsSnapshot(data)
          })
          if (pendingAsset === null) {
            setSelectedAsset(data.asset)
          }
          if (pendingExpiry === null) {
            setSelectedExpiryUnix(data.active_expiry_unix)
          }
        }

        setErrorMessage(null)
        startStream()
      } catch (error) {
        if (loadWasCancelled() || isAbortError(error)) {
          return
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unknown derive options error",
        )
      } finally {
        if (!loadWasCancelled()) {
          setIsLoading(false)
        }
      }
    }

    void initialize()

    onCleanup(() => {
      load.cancelled = true
      controller.abort()
      expirySwitchInFlightRef.postAbort?.abort()
      expirySwitchInFlightRef.postAbort = undefined
      expirySwitchInFlightRef.blockStreamUntilExpiryUnix = null
      assetSwitchInFlightRef.postAbort?.abort()
      assetSwitchInFlightRef.postAbort = undefined
      assetSwitchInFlightRef.blockStreamUntilAsset = null
      streamRef?.close()
      streamRef = null
    })
  })

  return {
    book,
    isLoading,
    errorMessage,
    selectedAsset,
    selectedExpiryUnix,
    assetTabList,
    expiryTabList,
    switchAssetTab,
    switchExpiryTab,
  }
}
