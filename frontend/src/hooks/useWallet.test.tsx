import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import { renderHook } from "@solidjs/testing-library"
import { useWallet } from "./useWallet"
import { WalletProvider } from "@/contexts/WalletProvider"
import type { ParentProps } from "solid-js"
import { getErrorMessage } from "@/lib/error-message"

vi.mock("@/services/hyperliquid-client", () => ({
  HyperliquidClient: class MockHyperliquidClient {
    getBalance = vi.fn()
    getCurrentPositions = vi.fn()
    rebalancePositions = vi.fn()
    getNetworkMode = vi.fn()
    getWalletAddress = vi.fn()
  },
}))

const wrapper = (props: ParentProps) => (
  <WalletProvider>{props.children}</WalletProvider>
)

const TEST_PIN = "123456"

const validEncryptedSessionFixture = {
  accountAddress: "0xStoredAccountAddress",
  apiWalletAddress: "0xStoredApiWalletAddress",
  encryptedPrivateKey: "deadbeef".repeat(4),
  salt: "0123456789abcdef0123456789abcdef",
  iv: "0123456789abcdef01234567",
}

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
    expect(result.isLocked()).toBe(false)
    expect(result.networkMode()).toBe("testnet")
  })

  it("does not auto-restore plaintext private keys from legacy storage", () => {
    localStorage.setItem(
      "hyperliquid-wallet",
      JSON.stringify({
        accountAddress: "0xStoredAccountAddress",
        apiWalletAddress: "0xStoredApiWalletAddress",
        privateKey: "STORED_PRIVATE_KEY",
      }),
    )

    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.credentials()).toBeNull()
    expect(result.isConnected()).toBe(false)
    expect(result.isLocked()).toBe(false)
  })

  it("reports a locked session when encrypted credentials exist on disk", () => {
    localStorage.setItem(
      "hyperliquid-wallet",
      JSON.stringify(validEncryptedSessionFixture),
    )

    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.isLocked()).toBe(true)
    expect(result.hasStoredSession()).toBe(true)
    expect(result.isConnected()).toBe(false)
  })

  it("ignores malformed encrypted session payloads on disk", () => {
    localStorage.setItem(
      "hyperliquid-wallet",
      JSON.stringify({
        accountAddress: "0xStoredAccountAddress",
        apiWalletAddress: "0xStoredApiWalletAddress",
        encryptedPrivateKey: "abc",
        salt: "def",
        iv: "ghi",
      }),
    )

    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.isLocked()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
  })

  it("reads network mode from localStorage", () => {
    localStorage.setItem("hyperliquid-network", "mainnet")

    const { result } = renderHook(() => useWallet(), { wrapper })
    expect(result.networkMode()).toBe("mainnet")
  })

  it("encrypts the private key in localStorage and keeps plaintext in memory only", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const credentials = {
      accountAddress: "0xTestAccountAddress",
      apiWalletAddress: "0xTestApiWalletAddress",
      privateKey: "TEST_PRIVATE_KEY_PLACEHOLDER",
    }

    await Effect.runPromise(result.connect(credentials, TEST_PIN))

    expect(result.isConnected()).toBe(true)
    expect(result.credentials()).toEqual(credentials)
    const stored = JSON.parse(
      localStorage.getItem("hyperliquid-wallet") ?? "{}",
    )
    expect(stored.accountAddress).toBe("0xTestAccountAddress")
    expect(stored.apiWalletAddress).toBe("0xTestApiWalletAddress")
    expect(stored.encryptedPrivateKey).toBeTypeOf("string")
    expect(stored.salt).toBeTypeOf("string")
    expect(stored.iv).toBeTypeOf("string")
    expect(stored.privateKey).toBeUndefined()
    expect(stored.encryptedPrivateKey).not.toBe(credentials.privateKey)

    result.disconnect()
    expect(result.isConnected()).toBe(false)
    expect(result.isLocked()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
  })

  it("unlocks an encrypted session with the correct pin", async () => {
    const credentials = {
      accountAddress: "0xTestAccountAddress",
      apiWalletAddress: "0xTestApiWalletAddress",
      privateKey: "TEST_PRIVATE_KEY_PLACEHOLDER",
    }

    const { result: initial } = renderHook(() => useWallet(), { wrapper })
    await Effect.runPromise(initial.connect(credentials, TEST_PIN))
    expect(localStorage.getItem("hyperliquid-wallet")).not.toBeNull()

    const { result: reloaded } = renderHook(() => useWallet(), { wrapper })
    expect(reloaded.isLocked()).toBe(true)

    await Effect.runPromise(reloaded.unlock(TEST_PIN))

    expect(reloaded.isConnected()).toBe(true)
    expect(reloaded.credentials()?.privateKey).toBe(credentials.privateKey)
  })

  it("rejects unlock with the wrong pin", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    await Effect.runPromise(
      result.connect(
        {
          accountAddress: "0xTestAccountAddress",
          apiWalletAddress: "0xTestApiWalletAddress",
          privateKey: "TEST_PRIVATE_KEY_PLACEHOLDER",
        },
        TEST_PIN,
      ),
    )

    const { result: reloaded } = renderHook(() => useWallet(), { wrapper })

    let unlockFailure: unknown
    try {
      await Effect.runPromise(reloaded.unlock("999999"))
    } catch (error) {
      unlockFailure = error
    }

    expect(unlockFailure).toBeDefined()
    expect(getErrorMessage(unlockFailure)).toBe("Incorrect PIN")
    expect(reloaded.isConnected()).toBe(false)
    expect(reloaded.isLocked()).toBe(true)
    expect(reloaded.hasStoredSession()).toBe(true)
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
