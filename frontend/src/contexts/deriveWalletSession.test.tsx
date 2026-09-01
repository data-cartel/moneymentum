import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import { renderHook } from "@solidjs/testing-library"
import type { ParentProps } from "solid-js"

import { useWallet } from "@/hooks/useWallet"
import { WalletProvider } from "@/contexts/WalletProvider"
import { DERIVE_WALLET_STORAGE_KEY } from "@/contexts/wallet-context"

vi.mock("@/services/hyperliquid-client", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@/services/hyperliquid-client")>()
  class MockHyperliquidClient {
    getBalance = vi.fn()
    getCurrentPositions = vi.fn()
    rebalancePositions = vi.fn()
    getNetworkMode = vi.fn()
    getWalletAddress = vi.fn()
  }
  return {
    ...actual,
    HyperliquidClient: MockHyperliquidClient,
  }
})

vi.mock("@/services/hyperliquidClientLoader", async () => {
  const clientModule = await import("@/services/hyperliquid-client")
  return {
    prefetchHyperliquidClientModule: () => undefined,
    ensureHyperliquidClientModule: async () => clientModule,
  }
})

vi.mock("@/reown/evmAppKit", () => ({
  ensureEvmAppKit: async () => null,
  prefetchEvmAppKit: () => undefined,
  readConnectedEip1193Provider: () => null,
  readEvmAddressFromAccountState: () => null,
  readEvmWalletConnectedFromAccountState: () => false,
  readReownProjectId: () => "test-project-id",
}))

const wrapper = (props: ParentProps) => (
  <WalletProvider>{props.children}</WalletProvider>
)

const TEST_PIN = "654321"
const SESSION_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const DERIVE_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

describe("Derive encrypted session via WalletProvider", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("encrypts a Derive session and unlocks it after remount", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    await Effect.runPromise(
      result.connectDerive(
        {
          deriveWallet: DERIVE_WALLET,
          sessionPrivateKey: SESSION_PRIVATE_KEY,
          subaccountId: 42,
        },
        TEST_PIN,
      ),
    )

    expect(result.isDeriveConnected()).toBe(true)
    expect(result.isDeriveLocked()).toBe(false)
    expect(result.deriveCredentials()?.sessionPrivateKey).toBe(
      SESSION_PRIVATE_KEY,
    )
    expect(result.deriveCredentials()?.subaccountId).toBe(42)
    expect(result.deriveCredentials()?.networkMode).toBe("testnet")
    expect(result.storedDeriveWallet()).toBe(DERIVE_WALLET)
    expect(localStorage.getItem(DERIVE_WALLET_STORAGE_KEY)).not.toBeNull()

    const reloaded = renderHook(() => useWallet(), { wrapper }).result
    expect(reloaded.isDeriveConnected()).toBe(true)
    expect(reloaded.isDeriveLocked()).toBe(true)
    expect(reloaded.storedDeriveWallet()).toBe(DERIVE_WALLET)

    await Effect.runPromise(reloaded.unlock(TEST_PIN))
    expect(reloaded.isDeriveLocked()).toBe(false)
    expect(reloaded.deriveCredentials()?.sessionPrivateKey).toBe(
      SESSION_PRIVATE_KEY,
    )
    expect(reloaded.deriveCredentials()?.subaccountId).toBe(42)
    expect(reloaded.deriveCredentials()?.networkMode).toBe("testnet")
  })

  it("treats a Derive session as disconnected when the network toggle differs", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    await Effect.runPromise(
      result.connectDerive(
        {
          deriveWallet: DERIVE_WALLET,
          sessionPrivateKey: SESSION_PRIVATE_KEY,
        },
        TEST_PIN,
      ),
    )

    expect(result.isDeriveConnected()).toBe(true)
    result.setNetworkMode("mainnet")
    expect(result.isDeriveConnected()).toBe(false)
    expect(result.deriveCredentials()).toBeNull()

    result.setNetworkMode("testnet")
    expect(result.isDeriveConnected()).toBe(true)
    expect(result.isDeriveLocked()).toBe(true)
  })

  it("clears the Derive session on disconnectDerive", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    await Effect.runPromise(
      result.connectDerive(
        {
          deriveWallet: DERIVE_WALLET,
          sessionPrivateKey: SESSION_PRIVATE_KEY,
        },
        TEST_PIN,
      ),
    )

    await Effect.runPromise(result.disconnectDerive())
    expect(result.isDeriveConnected()).toBe(false)
    expect(result.deriveCredentials()).toBeNull()
    expect(localStorage.getItem(DERIVE_WALLET_STORAGE_KEY)).toBeNull()
    expect(result.storedDeriveWallet()).toBeNull()
  })
})
