import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import { renderHook, waitFor } from "@solidjs/testing-library"
import { useWallet } from "./useWallet"
import { WalletProvider } from "@/contexts/WalletProvider"
import type { ParentProps } from "solid-js"
import { getErrorMessage } from "@/lib/error-message"
import { ApproveAgentFailed } from "@/services/hyperliquidAgent"

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

const mockEnsureHyperliquidClientModule = vi.hoisted(() => vi.fn())

vi.mock("@/services/hyperliquidClientLoader", () => ({
  prefetchHyperliquidClientModule: () => undefined,
  ensureHyperliquidClientModule: () => mockEnsureHyperliquidClientModule(),
}))

const mockEnsureEvmAppKit = vi.fn(
  async () =>
    null as null | {
      getAddress: () => null
      disconnect?: (namespace: "eip155") => Promise<void>
      subscribeAccount?: (
        subscriber: (accountState: unknown) => void,
        namespace?: "eip155",
      ) => () => void
    },
)
const mockReadConnectedEip1193Provider = vi.fn(
  (): { request: ReturnType<typeof vi.fn> } | null => null,
)

vi.mock("@/reown/evmAppKit", () => ({
  ensureEvmAppKit: () => mockEnsureEvmAppKit(),
  prefetchEvmAppKit: () => undefined,
  readConnectedEip1193Provider: () => mockReadConnectedEip1193Provider(),
  readEvmAddressFromAccountState: (accountState: unknown) =>
    typeof accountState === "object" &&
    accountState !== null &&
    "address" in accountState &&
    typeof accountState.address === "string"
      ? accountState.address
      : null,
  readEvmWalletConnectedFromAccountState: (accountState: unknown) =>
    typeof accountState === "object" &&
    accountState !== null &&
    "isConnected" in accountState &&
    accountState.isConnected === true,
}))

const mockApproveHyperliquidAgent = vi.fn(() => Effect.void)
const mockRevokeHyperliquidAgent = vi.fn(() => Effect.void)

vi.mock("@/services/hyperliquidAgent", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@/services/hyperliquidAgent")>()
  return {
    ...actual,
    approveHyperliquidAgent: (...args: unknown[]) =>
      mockApproveHyperliquidAgent(...args),
    revokeHyperliquidAgent: (...args: unknown[]) =>
      mockRevokeHyperliquidAgent(...args),
    generateHyperliquidAgent: () => ({
      agentAddress: "0xGeneratedAgentAddress",
      agentPrivateKey:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    }),
  }
})

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
    mockEnsureHyperliquidClientModule.mockImplementation(
      () => import("@/services/hyperliquid-client"),
    )
    mockEnsureEvmAppKit.mockResolvedValue(null)
    mockReadConnectedEip1193Provider.mockReturnValue(null)
    mockApproveHyperliquidAgent.mockReturnValue(Effect.void)
    mockRevokeHyperliquidAgent.mockReturnValue(Effect.void)
  })

  afterEach(() => {
    ensureLocalStorage()
    localStorage.clear()
  })

  it("starts disconnected with default testnet mode", () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.credentials()).toBeNull()
    expect(result.mainAddress()).toBeNull()
    expect(result.isConnected()).toBe(false)
    expect(result.isLocked()).toBe(false)
    expect(result.canTrade()).toBe(false)
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
    expect(result.canTrade()).toBe(false)
    expect(result.mainAddress()).toBe("0xStoredAccountAddress")
    expect(result.isConnected()).toBe(true)
    expect(result.credentials()).toBeNull()
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
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
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

    await Effect.runPromise(result.disconnect())
    expect(result.isConnected()).toBe(false)
    expect(result.isLocked()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
  })

  it("does not let a stale connect overwrite a newer account", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const connecting = Effect.runPromise(
      result.connect(
        {
          accountAddress: "0xAccountAAAA",
          apiWalletAddress: "0xAgentAAAA",
          privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
        },
        TEST_PIN,
      ),
    )

    result.setMainAddress("0xAccountBBBB")

    await expect(connecting).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Wallet changed while credentials were connecting. Please try again.",
    )
    expect(result.mainAddress()).toBe("0xAccountBBBB")
    expect(result.credentials()).toBeNull()
    expect(result.hasStoredSession()).toBe(false)
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
    expect(reloaded.isConnected()).toBe(true)
    expect(reloaded.canTrade()).toBe(false)

    await Effect.runPromise(reloaded.unlock(TEST_PIN))

    expect(reloaded.credentials()?.privateKey).toBe(credentials.privateKey)
    await waitFor(() => {
      expect(reloaded.canTrade()).toBe(true)
    })
  })

  it("does not let a stale unlock restore a replaced account", async () => {
    const accountA = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xAgentAAAA",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
    }
    const { result: initial } = renderHook(() => useWallet(), { wrapper })
    await Effect.runPromise(initial.connect(accountA, TEST_PIN))

    const { result } = renderHook(() => useWallet(), { wrapper })
    const unlocking = Effect.runPromise(result.unlock(TEST_PIN))
    result.setMainAddress("0xAccountBBBB")

    await expect(unlocking).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Wallet changed while unlocking. Please try again.",
    )
    expect(result.mainAddress()).toBe("0xAccountBBBB")
    expect(result.credentials()).toBeNull()
    expect(result.canTrade()).toBe(false)
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
    expect(reloaded.canTrade()).toBe(false)
    expect(reloaded.isLocked()).toBe(true)
    expect(reloaded.hasStoredSession()).toBe(true)
  })

  it("setNetworkMode updates signal and localStorage", () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    result.setNetworkMode("mainnet")
    expect(result.networkMode()).toBe("mainnet")
    expect(localStorage.getItem("hyperliquid-network")).toBe("mainnet")
  })

  it("setMainAddress marks the wallet connected for read-only loads", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })

    result.setMainAddress("0xMainFromReown")
    expect(result.mainAddress()).toBe("0xMainFromReown")
    expect(result.isConnected()).toBe(true)
    expect(result.canTrade()).toBe(false)
    expect(localStorage.getItem("hyperliquid-main-address")).toBe(
      "0xMainFromReown",
    )
    await waitFor(() => {
      expect(result.client()).not.toBeNull()
    })
  })

  it("restores the remembered public main address after remount", () => {
    localStorage.setItem("hyperliquid-main-address", "0xRememberedMain")

    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.mainAddress()).toBe("0xRememberedMain")
    expect(result.isHyperliquidConnected()).toBe(true)
    expect(result.hasStoredSession()).toBe(false)
  })

  it("keeps the remembered address and agent session when setMainAddress receives null", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const accountA = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xAgentAAAA",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
    }

    await Effect.runPromise(result.connect(accountA, TEST_PIN))
    result.setMainAddress(null)

    expect(result.mainAddress()).toBeNull()
    expect(result.hasStoredSession()).toBe(true)
    expect(localStorage.getItem("hyperliquid-wallet")).not.toBeNull()
    expect(localStorage.getItem("hyperliquid-main-address")).toBe(
      "0xAccountAAAA",
    )
  })

  it("keeps the remembered public address when Reown reports a transient disconnect", async () => {
    let accountSubscriber: ((accountState: unknown) => void) | undefined
    const modal = {
      getAddress: () => null as string | null,
      subscribeAccount: (subscriber: (accountState: unknown) => void) => {
        accountSubscriber = subscriber
        return () => {}
      },
    }
    mockEnsureEvmAppKit.mockResolvedValue(modal)

    const { result } = renderHook(() => useWallet(), { wrapper })
    result.setMainAddress("0xMainFromReown")
    await vi.waitFor(() => {
      expect(accountSubscriber).toBeDefined()
    })

    accountSubscriber?.({ isConnected: false })

    expect(result.mainAddress()).toBe("0xMainFromReown")
    expect(result.isHyperliquidConnected()).toBe(true)
    expect(localStorage.getItem("hyperliquid-main-address")).toBe(
      "0xMainFromReown",
    )
  })

  it("clears unlocked account A credentials when switching main address to account B", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const accountA = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xAgentAAAA",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
    }

    await Effect.runPromise(result.connect(accountA, TEST_PIN))
    expect(result.credentials()).toEqual(accountA)
    expect(localStorage.getItem("hyperliquid-wallet")).not.toBeNull()
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })

    result.setMainAddress("0xAccountBBBB")

    expect(result.mainAddress()).toBe("0xAccountBBBB")
    expect(result.credentials()).toBeNull()
    expect(result.canTrade()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
    await waitFor(() => {
      expect(result.client()).not.toBeNull()
    })
  })

  it("keeps the unlocked session when setMainAddress receives the same account", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const accountA = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xAgentAAAA",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
    }

    await Effect.runPromise(result.connect(accountA, TEST_PIN))
    result.setMainAddress("0xaccountaaaa")

    expect(result.credentials()).toEqual(accountA)
    expect(result.hasStoredSession()).toBe(true)
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
  })

  it("does not persist an encrypted session when agent approval fails", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })
    mockApproveHyperliquidAgent.mockReturnValue(
      Effect.fail(new ApproveAgentFailed({ cause: new Error("rejected") })),
    )

    result.setMainAddress("0xMainFromReown")

    let authorizeFailure: unknown
    try {
      await Effect.runPromise(result.authorizeAgent(TEST_PIN))
    } catch (error) {
      authorizeFailure = error
    }

    expect(authorizeFailure).toBeDefined()
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
    expect(result.hasStoredSession()).toBe(false)
    expect(result.credentials()).toBeNull()
    expect(result.canTrade()).toBe(false)
  })

  it("persists the encrypted session only after agent approval succeeds", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })
    mockApproveHyperliquidAgent.mockReturnValue(Effect.void)

    result.setMainAddress("0xMainFromReown")
    await Effect.runPromise(result.authorizeAgent(TEST_PIN))

    expect(result.hasStoredSession()).toBe(true)
    expect(result.credentials()?.accountAddress).toBe("0xMainFromReown")
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
    expect(result.credentials()?.apiWalletAddress).toBe(
      "0xGeneratedAgentAddress",
    )
    const stored = JSON.parse(
      localStorage.getItem("hyperliquid-wallet") ?? "{}",
    )
    expect(stored.accountAddress).toBe("0xMainFromReown")
    expect(stored.apiWalletAddress).toBe("0xGeneratedAgentAddress")
    expect(stored.encryptedPrivateKey).toBeTypeOf("string")
  })

  it("does not restore account A credentials after approval finishes on account B", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })

    let finishApproval: (() => void) | undefined
    mockApproveHyperliquidAgent.mockReturnValue(
      Effect.promise(
        () =>
          new Promise<void>(resolve => {
            finishApproval = resolve
          }),
      ),
    )

    result.setMainAddress("0xAccountAAAA")
    const authorization = Effect.runPromise(result.authorizeAgent(TEST_PIN))
    await vi.waitFor(() => {
      expect(finishApproval).toBeDefined()
    })

    result.setMainAddress("0xAccountBBBB")
    finishApproval?.()
    await expect(authorization).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Wallet changed during agent authorization. Please try again.",
    )

    expect(result.mainAddress()).toBe("0xAccountBBBB")
    expect(result.credentials()).toBeNull()
    expect(result.canTrade()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
  })

  it("rejects account A authorization after the wallet changes away and back", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })

    let finishApproval: (() => void) | undefined
    mockApproveHyperliquidAgent.mockReturnValue(
      Effect.promise(
        () =>
          new Promise<void>(resolve => {
            finishApproval = resolve
          }),
      ),
    )

    result.setMainAddress("0xAccountAAAA")
    const authorization = Effect.runPromise(result.authorizeAgent(TEST_PIN))
    await vi.waitFor(() => {
      expect(finishApproval).toBeDefined()
    })

    result.setMainAddress("0xAccountBBBB")
    result.setMainAddress("0xAccountAAAA")
    finishApproval?.()
    await expect(authorization).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Wallet context changed during agent authorization. Please try again.",
    )

    expect(result.mainAddress()).toBe("0xAccountAAAA")
    expect(result.credentials()).toBeNull()
    expect(result.canTrade()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
  })

  it("preserves account B credentials when account A approval later fails", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })

    let rejectApproval: (() => void) | undefined
    mockApproveHyperliquidAgent.mockReturnValue(
      Effect.tryPromise({
        try: () =>
          new Promise<void>((_, reject) => {
            rejectApproval = () => {
              reject(new Error("approval rejected"))
            }
          }),
        catch: cause => new ApproveAgentFailed({ cause }),
      }),
    )

    result.setMainAddress("0xAccountAAAA")
    const authorization = Effect.runPromise(result.authorizeAgent(TEST_PIN))
    await vi.waitFor(() => {
      expect(rejectApproval).toBeDefined()
    })

    const accountB = {
      accountAddress: "0xAccountBBBB",
      apiWalletAddress: "0xAgentBBBB",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_B",
    }
    await Effect.runPromise(result.connect(accountB, TEST_PIN))
    rejectApproval?.()
    await expect(authorization).rejects.toBeDefined()

    expect(result.mainAddress()).toBe(accountB.accountAddress)
    expect(result.credentials()).toEqual(accountB)
    expect(result.hasStoredSession()).toBe(true)
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
    const stored = JSON.parse(
      localStorage.getItem("hyperliquid-wallet") ?? "{}",
    )
    expect(stored.accountAddress).toBe(accountB.accountAddress)
    expect(stored.apiWalletAddress).toBe(accountB.apiWalletAddress)
  })

  it("preserves replacement credentials when an older same-account approval fails", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })

    let rejectApproval: (() => void) | undefined
    mockApproveHyperliquidAgent.mockReturnValue(
      Effect.tryPromise({
        try: () =>
          new Promise<void>((_, reject) => {
            rejectApproval = () => {
              reject(new Error("approval rejected"))
            }
          }),
        catch: cause => new ApproveAgentFailed({ cause }),
      }),
    )

    result.setMainAddress("0xAccountAAAA")
    const authorization = Effect.runPromise(result.authorizeAgent(TEST_PIN))
    await vi.waitFor(() => {
      expect(rejectApproval).toBeDefined()
    })

    const replacement = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xReplacementAgent",
      privateKey: "TEST_REPLACEMENT_PRIVATE_KEY",
    }
    await Effect.runPromise(result.connect(replacement, TEST_PIN))
    rejectApproval?.()
    await expect(authorization).rejects.toBeDefined()

    expect(result.mainAddress()).toBe(replacement.accountAddress)
    expect(result.credentials()).toEqual(replacement)
    expect(result.hasStoredSession()).toBe(true)
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
    const stored = JSON.parse(
      localStorage.getItem("hyperliquid-wallet") ?? "{}",
    )
    expect(stored.accountAddress).toBe(replacement.accountAddress)
    expect(stored.apiWalletAddress).toBe(replacement.apiWalletAddress)
  })

  it("does not persist testnet credentials after approval finishes on mainnet", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })

    let finishApproval: (() => void) | undefined
    mockApproveHyperliquidAgent.mockReturnValue(
      Effect.promise(
        () =>
          new Promise<void>(resolve => {
            finishApproval = resolve
          }),
      ),
    )

    result.setMainAddress("0xAccountAAAA")
    const authorization = Effect.runPromise(result.authorizeAgent(TEST_PIN))
    await vi.waitFor(() => {
      expect(finishApproval).toBeDefined()
    })

    result.setNetworkMode("mainnet")
    finishApproval?.()
    await expect(authorization).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Network changed during agent authorization. Please try again.",
    )

    expect(result.networkMode()).toBe("mainnet")
    expect(result.credentials()).toBeNull()
    expect(result.canTrade()).toBe(false)
    expect(result.hasStoredSession()).toBe(false)
    expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
  })

  it("preserves a replacement session when an older revoke completes", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    mockEnsureEvmAppKit.mockResolvedValue({ getAddress: () => null })
    mockReadConnectedEip1193Provider.mockReturnValue({ request: vi.fn() })

    let finishRevoke: (() => void) | undefined
    mockRevokeHyperliquidAgent.mockReturnValue(
      Effect.promise(
        () =>
          new Promise<void>(resolve => {
            finishRevoke = resolve
          }),
      ),
    )

    result.setMainAddress("0xAccountAAAA")
    const revoking = Effect.runPromise(result.revokeAgent())
    await vi.waitFor(() => {
      expect(finishRevoke).toBeDefined()
    })

    const replacement = {
      accountAddress: "0xAccountBBBB",
      apiWalletAddress: "0xAgentBBBB",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_B",
    }
    await Effect.runPromise(result.connect(replacement, TEST_PIN))
    finishRevoke?.()

    await expect(revoking).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Wallet changed before the operation completed. Please try again.",
    )
    expect(result.credentials()).toEqual(replacement)
    expect(result.hasStoredSession()).toBe(true)
  })

  it("clears the local session when Reown emits its disconnect callback", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    let accountSubscriber: ((accountState: unknown) => void) | undefined
    const disconnect = vi.fn(async () => {
      accountSubscriber?.({ isConnected: false })
    })
    const modal = {
      getAddress: () => null,
      disconnect,
      subscribeAccount: (subscriber: (accountState: unknown) => void) => {
        accountSubscriber = subscriber
        return () => {}
      },
    }
    mockEnsureEvmAppKit.mockResolvedValue(modal)

    const credentials = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xAgentAAAA",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
    }
    await Effect.runPromise(result.connect(credentials, TEST_PIN))
    const { result: mounted } = renderHook(() => useWallet(), { wrapper })
    await vi.waitFor(() => {
      expect(accountSubscriber).toBeDefined()
    })
    await Effect.runPromise(mounted.disconnect())

    expect(disconnect).toHaveBeenCalledWith("eip155")
    expect(mounted.mainAddress()).toBeNull()
    expect(mounted.credentials()).toBeNull()
    expect(mounted.hasStoredSession()).toBe(false)
  })

  it("preserves a replacement session when an older disconnect completes", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    let finishDisconnect: (() => void) | undefined
    const disconnect = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishDisconnect = resolve
        }),
    )
    mockEnsureEvmAppKit.mockResolvedValue({
      getAddress: () => null,
      disconnect,
    })

    const disconnecting = Effect.runPromise(result.disconnect())
    await vi.waitFor(() => {
      expect(finishDisconnect).toBeDefined()
    })

    const replacement = {
      accountAddress: "0xAccountBBBB",
      apiWalletAddress: "0xAgentBBBB",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_B",
    }
    await Effect.runPromise(result.connect(replacement, TEST_PIN))
    finishDisconnect?.()

    await expect(disconnecting).rejects.toSatisfy(
      error =>
        getErrorMessage(error) ===
        "Wallet changed while disconnecting. Please try again.",
    )
    expect(result.credentials()).toEqual(replacement)
    expect(result.hasStoredSession()).toBe(true)
  })

  it("preserves local credentials when Reown disconnect fails", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper })
    const disconnectFailure = new Error("wallet refused disconnect")
    const disconnect = vi.fn().mockRejectedValue(disconnectFailure)
    mockEnsureEvmAppKit.mockResolvedValue({
      getAddress: () => null,
      disconnect,
    })
    const credentials = {
      accountAddress: "0xAccountAAAA",
      apiWalletAddress: "0xAgentAAAA",
      privateKey: "TEST_PRIVATE_KEY_ACCOUNT_A",
    }
    await Effect.runPromise(result.connect(credentials, TEST_PIN))

    await expect(Effect.runPromise(result.disconnect())).rejects.toBeDefined()

    expect(disconnect).toHaveBeenCalledWith("eip155")
    expect(result.mainAddress()).toBe(credentials.accountAddress)
    expect(result.credentials()).toEqual(credentials)
    expect(result.hasStoredSession()).toBe(true)
    expect(localStorage.getItem("hyperliquid-wallet")).not.toBeNull()
    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
  })

  it("keeps canTrade false until the lazy hyperliquid client module resolves", async () => {
    let resolveClientModule:
      | ((clientModule: typeof import("@/services/hyperliquid-client")) => void)
      | undefined
    mockEnsureHyperliquidClientModule.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveClientModule = resolve
        }),
    )

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

    expect(result.credentials()).not.toBeNull()
    expect(result.client()).toBeNull()
    expect(result.canTrade()).toBe(false)
    expect(result.hyperliquidClientLoad().state).toBe("loading")

    await vi.waitFor(() => {
      expect(resolveClientModule).toBeDefined()
    })
    resolveClientModule?.(await import("@/services/hyperliquid-client"))

    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
    expect(result.hyperliquidClientLoad().state).toBe("ready")
  })

  it("surfaces a typed hyperliquid client load failure and recovers on retry", async () => {
    mockEnsureHyperliquidClientModule.mockRejectedValueOnce(
      new Error("chunk load failed"),
    )

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

    await waitFor(() => {
      expect(result.hyperliquidClientLoad().state).toBe("failed")
    })

    const failedLoad = result.hyperliquidClientLoad()
    if (failedLoad.state !== "failed") {
      throw new Error("expected the hyperliquid client load to have failed")
    }
    expect(getErrorMessage(failedLoad.error)).toBe(
      "Could not load Hyperliquid trading. Please try again.",
    )
    expect(result.canTrade()).toBe(false)

    result.retryHyperliquidClientLoad()

    await waitFor(() => {
      expect(result.canTrade()).toBe(true)
    })
    expect(result.hyperliquidClientLoad().state).toBe("ready")
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
