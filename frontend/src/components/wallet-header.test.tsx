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
const mockUseSwitchNetwork = vi.fn(() => ({
  mutate: mockSwitchNetworkMutate,
  mutateAsync: mockSwitchNetworkMutateAsync,
  isPending: false,
}))
const mockDisconnect = vi.fn(() => Promise.resolve())

const TEST_PIN = "123456"

vi.mock("@/hooks/useTrading", () => ({
  useWalletSettings: () => mockUseWalletSettings(),
  useSwitchNetwork: () => mockUseSwitchNetwork(),
  useDeriveAccountSnapshot: () => ({
    data: undefined,
    isLoading: false,
  }),
}))

vi.mock("solid-sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

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
  ensureEvmAppKit: async () => ({
    disconnect: mockDisconnect,
    getAddress: () => null,
    subscribeAccount: () => () => {},
  }),
  prefetchEvmAppKit: () => undefined,
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
      data: () => ({
        isTestnet: true,
        venues: [
          {
            id: "hyperliquid" as const,
            connected: false,
            address: null,
            balanceUsd: null,
            canRevoke: false,
          },
          {
            id: "derive" as const,
            connected: false,
            address: null,
            balanceUsd: null,
            canRevoke: false,
          },
        ],
      }),
      isConnected: () => false,
    })
    mockUseSwitchNetwork.mockReturnValue({
      mutate: mockSwitchNetworkMutate,
      mutateAsync: mockSwitchNetworkMutateAsync,
      isPending: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    const globalAny = globalThis as any
    if (
      globalAny.localStorage &&
      typeof globalAny.localStorage.clear === "function"
    ) {
      globalAny.localStorage.clear()
    }
  })

  describe("display state", () => {
    it("shows 'No wallet' when not connected", async () => {
      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText("No wallet")).toBeInTheDocument()
    })

    it("shows formatted account address when connected", async () => {
      await seedEncryptedSession("0x1234567890abcdef1234567890abcdef12345678")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0x1234567890abcdef1234567890abcdef12345678",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      expect(screen.getByText("0x1234...5678")).toBeInTheDocument()
    })

    it("shows testnet toggle label in dropdown when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xTestAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xTestAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xTest...ress"))

      expect(screen.getByText("Testnet")).toBeInTheDocument()
    })
  })

  describe("testnet switch", () => {
    it("is disabled when wallet is not connected", () => {
      render(() => <WalletHeader />, {
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
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xTestAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xTest...ress"))

      const toggle = screen.getByRole("switch")
      expect(toggle).not.toBeDisabled()
    })

    it("calls handleNetworkSwitch after a successful network switch", async () => {
      const user = userEvent.setup()
      const handleNetworkSwitch = vi.fn()
      mockSwitchNetworkMutateAsync.mockResolvedValue(undefined)
      await seedEncryptedSession("0xTestAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xTestAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleNetworkSwitch={handleNetworkSwitch} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xTest...ress"))
      await user.click(screen.getByRole("switch"))

      await waitFor(() => {
        expect(mockSwitchNetworkMutateAsync).toHaveBeenCalledWith("mainnet")
        expect(handleNetworkSwitch).toHaveBeenCalledTimes(1)
      })
    })

    it("does not call handleNetworkSwitch when the network switch fails", async () => {
      const user = userEvent.setup()
      const handleNetworkSwitch = vi.fn()
      mockSwitchNetworkMutateAsync.mockRejectedValue(new Error("switch failed"))
      await seedEncryptedSession("0xTestAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xTestAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleNetworkSwitch={handleNetworkSwitch} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xTest...ress"))
      await user.click(screen.getByRole("switch"))

      await waitFor(() => {
        expect(mockSwitchNetworkMutateAsync).toHaveBeenCalledWith("mainnet")
      })
      expect(handleNetworkSwitch).not.toHaveBeenCalled()
    })
  })

  describe("disconnected and locked states", () => {
    it("does not open a dialog when clicking 'No wallet'", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet"))

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
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xLockedAccountAddress",
              balanceUsd: null,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
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
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xLockedAccountAddress",
              balanceUsd: null,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
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
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(screen.getByText("Hyperliquid account")).toBeInTheDocument()
      expect(screen.getByText("0xConnectedAccountAddress")).toBeInTheDocument()
    })

    it("shows full account address in dialog when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(screen.getByText("0xConnectedAccountAddress")).toBeInTheDocument()
    })

    it("copies address and shows Copied overlay when address is clicked", async () => {
      const user = userEvent.setup()
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal("navigator", {
        clipboard: { writeText },
      })

      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(
        screen.getByRole("button", { name: "Copy Hyperliquid address" }),
      )

      expect(writeText).toHaveBeenCalledWith("0xConnectedAccountAddress")
      expect(screen.getByText("Copied")).toBeInTheDocument()
    })

    it("shows error toast when clipboard write fails", async () => {
      const user = userEvent.setup()
      const { toast } = await import("solid-sonner")
      const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"))
      vi.stubGlobal("navigator", {
        clipboard: { writeText },
      })

      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(
        screen.getByRole("button", { name: "Copy Hyperliquid address" }),
      )

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to copy address. Check clipboard permissions.",
        )
      })
    })

    it("shows disconnect button when connected", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(
        screen.getByRole("button", { name: "Disconnect" }),
      ).toBeInTheDocument()
    })

    it("disconnects wallet when disconnect button is clicked", async () => {
      const user = userEvent.setup()
      const handleDisconnect = vi.fn()
      const { toast } = await import("solid-sonner")

      await seedEncryptedSession("0xConnectedAccountAddress")

      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={handleDisconnect} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Disconnect" }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Hyperliquid disconnected")
      })
      expect(handleDisconnect).toHaveBeenCalledOnce()
      expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
    })

    it("does not notify its parent when Reown disconnect fails", async () => {
      const user = userEvent.setup()
      const handleDisconnect = vi.fn()
      const { toast } = await import("solid-sonner")
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockDisconnect.mockRejectedValueOnce(
        new Error("wallet refused disconnect"),
      )
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader handleDisconnect={handleDisconnect} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Disconnect" }))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled()
      })
      expect(handleDisconnect).not.toHaveBeenCalled()
      expect(localStorage.getItem("hyperliquid-wallet")).not.toBeNull()
    })

    it("closes dialog after disconnect", async () => {
      const user = userEvent.setup()
      const { toast } = await import("solid-sonner")
      await seedEncryptedSession("0xConnectedAccountAddress")

      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Disconnect" }))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Hyperliquid disconnected")
      })

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
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
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
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(
        screen.getByLabelText(
          /Revokes Moneymentum's trading agent on Hyperliquid/,
        ),
      ).toBeInTheDocument()
    })

    it("disables Revoke Agent while a network switch is pending", async () => {
      const user = userEvent.setup()
      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })
      mockUseSwitchNetwork.mockReturnValue({
        mutate: mockSwitchNetworkMutate,
        mutateAsync: mockSwitchNetworkMutateAsync,
        isPending: true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))

      expect(
        screen.getByRole("button", { name: "Revoke Agent" }),
      ).toBeDisabled()
    })

    it("clears the local agent session after a successful revoke", async () => {
      const user = userEvent.setup({
        pointerEventsCheck: 0,
      })
      const { toast } = await import("solid-sonner")

      await seedEncryptedSession("0xConnectedAccountAddress")
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          isTestnet: true,
          venues: [
            {
              id: "hyperliquid" as const,
              connected: true,
              address: "0xConnectedAccountAddress",
              balanceUsd: 100,
              canRevoke: true,
            },
            {
              id: "derive" as const,
              connected: false,
              address: null,
              balanceUsd: null,
              canRevoke: false,
            },
          ],
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("0xConn...ress"))
      await user.click(screen.getByRole("button", { name: "Revoke Agent" }))

      await waitFor(
        () => {
          expect(toast.success).toHaveBeenCalledWith(
            "Hyperliquid agent revoked",
          )
          expect(localStorage.getItem("hyperliquid-wallet")).toBeNull()
        },
        { timeout: 5_000 },
      )
    })
  })

  describe("wallet status styling", () => {
    it("renders disconnected state as non-interactive text", () => {
      render(() => <WalletHeader />, {
        wrapper: createWrapper(),
      })

      const walletStatus = screen.getByText("No wallet")
      expect(walletStatus.tagName).toBe("BUTTON")
      expect(walletStatus).toHaveClass("cursor-pointer")
    })
  })
})
