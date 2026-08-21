/**
 * Lazy loader for the CCXT-backed Hyperliquid client module.
 *
 * Prefetch on Portfolio mount so the UI can paint while the chunk downloads;
 * trading code awaits `ensureHyperliquidClientModule` only when building a
 * client instance.
 */

type HyperliquidClientModule = typeof import("@/services/hyperliquid-client")

let loadPromise: Promise<HyperliquidClientModule> | null = null

export const prefetchHyperliquidClientModule = (): void => {
  void ensureHyperliquidClientModule().catch(() => undefined)
}

export const ensureHyperliquidClientModule =
  (): Promise<HyperliquidClientModule> => {
    loadPromise ??= import("@/services/hyperliquid-client").catch(
      (error: unknown) => {
        loadPromise = null
        throw error
      },
    )
    return loadPromise
  }
