import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { useWallet } from "./useWallet"
import { WalletProvider } from "@/contexts/WalletProvider"
import type { ParentProps } from "solid-js"

vi.mock("@/services/hyperliquid-client", () => ({
  HyperliquidClient: class MockHyperliquidClient {
    getBalance = vi.fn()
    getCurrentPositions = vi.fn()
    listPerpTickers = vi.fn()
    getLeverageLimits = vi.fn()
    rebalancePositions = vi.fn()
    getNetworkMode = vi.fn()
    getWalletAddress = vi.fn()
  },
  preloadMarkets: vi.fn().mockResolvedValue(undefined),
}))

const wrapper = (props: ParentProps) => (
  <WalletProvider>{props.children}</WalletProvider>
)

describe("useWallet", () => {
  const ensureLocalStorage = () => {
    const globalAny = globalThis as { localStorage?: Storage }
    if (
      !globalAny.localStorage ||
      typeof globalAny.localStorage.clear !== "function"
    ) {
      const store = new Map<string, string>()
      globalAny.localStorage = {
        getItem: key => (store.has(key) ? store.get(key)! : null),
        setItem: (key, value) => {
          store.set(key, value)
        },
        removeItem: key => {
          store.delete(key)
        },
        clear: () => {
          store.clear()
        },
        key: index => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size
        },
      } as unknown as Storage
    }
  }

  beforeEach(() => {
    ensureLocalStorage()
    localStorage.clear()
  })

  afterEach(() => {
    ensureLocalStorage()
    localStorage.clear()
  })

  it("starts disconnected with default testnet mode", () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.credentials()).toBeNull()
    expect(result.isConnected()).toBe(false)
    expect(result.networkMode()).toBe("testnet")
  })

  it("restores credentials from localStorage on mount", () => {
    const storedMetadata = {
      accountAddress: "0xStoredAccountAddress",
      apiWalletAddress: "0xStoredApiWalletAddress",
      privateKey: "STORED_PRIVATE_KEY",
    }
    localStorage.setItem("hyperliquid-wallet", JSON.stringify(storedMetadata))

    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.credentials()).toEqual(storedMetadata)
    expect(result.isConnected()).toBe(true)
  })

  it("reads network mode from localStorage", () => {
    localStorage.setItem("hyperliquid-network", "mainnet")

    const { result } = renderHook(() => useWallet(), { wrapper })
    expect(result.networkMode()).toBe("mainnet")
  })

  it("connect stores credentials and disconnect clears them", () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const credentials = {
      accountAddress: "0xTestAccountAddress",
      apiWalletAddress: "0xTestApiWalletAddress",
      privateKey: "TEST_PRIVATE_KEY_PLACEHOLDER",
      vaultAddress: "0xVault",
    }

    result.connect(credentials)

    expect(result.isConnected()).toBe(true)
    expect(result.credentials()).toEqual(credentials)
    expect(
      JSON.parse(localStorage.getItem("hyperliquid-wallet") ?? "{}"),
    ).toEqual(credentials)

    result.disconnect()
    expect(result.isConnected()).toBe(false)
    expect(result.credentials()).toBeNull()
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
  })

  it("setNetworkMode updates signal and localStorage", () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    result.setNetworkMode("mainnet")
    expect(result.networkMode()).toBe("mainnet")
    expect(localStorage.getItem("hyperliquid-network")).toBe("mainnet")
  })

  describe("errors", () => {
    it("throws error when used outside WalletProvider", () => {
      const { result } = renderHook(() => useWallet(), { wrapper })
      expect(result).toBeDefined()
      expect(() => renderHook(() => useWallet())).toThrow(
        "useWallet must be used within a WalletProvider",
      )
    })
  })
})
