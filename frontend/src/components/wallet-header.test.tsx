import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"
import { WalletHeader } from "./wallet-header"
import { WalletProvider } from "@/contexts/WalletProvider"
import { NetworkProvider } from "@/contexts/NetworkContext"
import { encryptWalletPrivateKey } from "@/services/walletCredentialCrypto"

const mockSwitchNetworkMutate = vi.fn()
const mockSwitchNetworkMutateAsync = vi.fn()
const mockUseWalletSettings = vi.fn()

const TEST_PIN = "123456"

vi.mock("@/hooks/useTrading", () => ({
  useWalletSettings: () => mockUseWalletSettings(),
  useSwitchNetwork: vi.fn(() => ({
    mutate: mockSwitchNetworkMutate,
    mutateAsync: mockSwitchNetworkMutateAsync,
    isPending: false,
  })),
}))

vi.mock("solid-sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("@/services/hyperliquid-client", () => ({
  HyperliquidClient: class MockHyperliquidClient {
    getBalance = vi.fn()
    getCurrentPositions = vi.fn()
    rebalancePositions = vi.fn()
    getNetworkMode = vi.fn()
    getWalletAddress = vi.fn()
  },
}))

vi.mock("@/reown/evmAppKit", () => ({
  getOrCreateEvmAppKit: () => ({
    disconnect: vi.fn(),
    getAddress: () => null,
    subscribeAccount: () => () => {},
  }),
  readConnectedEip1193Provider: () => ({ request: vi.fn() }),
  readEvmAddressFromAccountState: () => null,
  readEvmWalletConnectedFromAccountState: () => false,
}))

vi.mock("@/services/hyperliquidAgent", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@/services/hyperliquidAgent")>()
  const Effect = await import("effect/Effect")
  return {
    ...actual,
    revokeHyperliquidAgent: vi.fn(() => Effect.void),
  }
})

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <NetworkProvider>{props.children}</NetworkProvider>
      </WalletProvider>
    </QueryClientProvider>
  )
}

const seedEncryptedSession = async (accountAddress: string) => {
  const encrypted = await encryptWalletPrivateKey("0xTestPrivateKey", TEST_PIN)
  localStorage.setItem(
    "hyperliquid-wallet",
    JSON.stringify({
      accountAddress,
      apiWalletAddress: "0xConnectedApiWallet",
      ...encrypted,
    }),
  )
}

describe("WalletHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const globalAny = globalThis as any
    if (
      !globalAny.localStorage ||
      typeof globalAny.localStorage.getItem !== "function" ||
      typeof globalAny.localStorage.clear !== "function"
    ) {
      const store = new Map<string, string>()
      globalAny.localStorage = {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
        clear: () => {
          store.clear()
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size
        },
      }
    }
    if (
      globalAny.localStorage &&
      typeof globalAny.localStorage.clear === "function"
    ) {
      globalAny.localStorage.clear()
    }
    mockUseWalletSettings.mockReturnValue({
      data: () => null,
      isConnected: () => false,
    })
  })

  afterEach(() => {
    const globalAny = globalThis as any
    if (
      globalAny.localStorage &&
      typeof globalAny.localStorage.clear === "function"
    ) {
      globalAny.localStorage.clear()
    }
  })

  describe("display state", () => {
    it("shows 'No wallet configured' when not connected", async () => {
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText("No wallet configured")).toBeInTheDocument()
    })

    it("shows formatted account address when connected", async () => {
      await seedEncryptedSession("0x1234567890abcdef1234567890abcdef12345678")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0x1234567890abcdef1234567890abcdef12345678",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText("0x1234...5678")).toBeInTheDocument()
    })

    it("shows testnet toggle label in dropdown when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xTestAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xTestAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xTest...ress"))

      expect(screen.getByText("Testnet")).toBeInTheDocument()
    })
  })

  describe("testnet switch", () => {
    it("is disabled when wallet is not connected", () => {
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      // When not connected, the testnet switch is not rendered at all.
      expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    })

    it("is enabled when wallet is connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xTestAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xTestAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xTest...ress"))

      const toggle = screen.getByRole("switch")
      expect(toggle).not.toBeDisabled()
    })
  })

  describe("disconnected and locked states", () => {
    it("does not open a dialog when clicking 'No wallet configured'", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument()
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })

    it("shows formatted address when wallet is locked", async () => {
      const encrypted = await encryptWalletPrivateKey(
        "0xMyPrivateKey",
        TEST_PIN,
      )
      localStorage.setItem(
        "hyperliquid-wallet",
        JSON.stringify({
          accountAddress: "0xLockedAccountAddress",
          apiWalletAddress: "0xLockedApiWalletAddress",
          ...encrypted,
        }),
      )

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText(/0xLock\.\.\.ress/)).toBeInTheDocument()
      expect(screen.getByText("(locked)")).toBeInTheDocument()
    })

    it("opens account menu when clicking locked address", async () => {
      const user = userEvent.setup()
      const encrypted = await encryptWalletPrivateKey(
        "0xMyPrivateKey",
        TEST_PIN,
      )
      localStorage.setItem(
        "hyperliquid-wallet",
        JSON.stringify({
          accountAddress: "0xLockedAccountAddress",
          apiWalletAddress: "0xLockedApiWalletAddress",
          ...encrypted,
        }),
      )

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText(/0xLock\.\.\.ress/))

      expect(
        screen.getByText("Agent locked — enter PIN to trade"),
      ).toBeInTheDocument()
      expect(screen.queryByText("Unlock Wallet")).not.toBeInTheDocument()
    })
  })

  describe("wallet disconnect", () => {
    it("shows account summary dropdown when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(screen.getByText("Account")).toBeInTheDocument()
      expect(screen.getByText("0xConnectedAccountAddress")).toBeInTheDocument()
    })

    it("shows full account address in dialog when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(screen.getByText("0xConnectedAccountAddress")).toBeInTheDocument()
    })

    it("shows disconnect button when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(
        screen.getByRole("button", { name: "Disconnect" }),
      ).toBeInTheDocument()
    })

    it("disconnects wallet when disconnect button is clicked", async () => {
      const user = userEvent.setup()
      const { toast } = await import("solid-sonner")

      await seedEncryptedSession("0xConnectedAccountAddress")

      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Disconnect" }))

      expect(toast.success).toHaveBeenCalledWith("Wallet disconnected")
      expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
    })

    it("closes dialog after disconnect", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")

      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Disconnect" }))

      // Dropdown content stays mounted in jsdom (no animationend fires).
      // Check the full address is either absent or inside a closed container.
      await waitFor(() => {
        const fullAddress = screen.queryByText("0xConnectedAccountAddress")
        if (fullAddress) {
          expect(fullAddress.closest("[data-closed]")).not.toBeNull()
        }
      })
    })
  })

  describe("revoke agent", () => {
    it("shows Revoke Agent above Disconnect when connected with a session", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      const revokeButton = screen.getByRole("button", { name: "Revoke Agent" })
      const disconnectButton = screen.getByRole("button", {
        name: "Disconnect",
      })
      expect(revokeButton.compareDocumentPosition(disconnectButton)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    })

    it("exposes revoke explanation for screen readers and tooltip", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(
        screen.getByLabelText(
          /Revokes Moneymentum's trading agent on Hyperliquid/,
        ),
      ).toBeInTheDocument()
    })

    it("clears the local agent session after a successful revoke", async () => {
      const user = userEvent.setup()
      const { toast } = await import("solid-sonner")

      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Revoke Agent" }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Hyperliquid agent revoked")
        expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
      })
    })
  })

  describe("wallet status styling", () => {
    it("renders disconnected state as non-interactive text", () => {
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      const walletStatus = screen.getByText("No wallet configured")
      expect(walletStatus.tagName).toBe("SPAN")
      expect(walletStatus).not.toHaveClass("cursor-pointer")
    })
  })
})
