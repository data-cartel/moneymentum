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

      expect(screen.getByText("0xLock...ress")).toBeInTheDocument()
    })

    it("does not open unlock dialog when clicking locked address", async () => {
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

      await user.click(screen.getByText("0xLock...ress"))

      expect(screen.queryByText("Unlock Wallet")).not.toBeInTheDocument()
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })

  describe("wallet disconnect", () => {
    it("shows account summary dropdown when connected", async () => {
      const user = userEvent.setup()
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

      localStorage.setItem(
        "hyperliquid-wallet",
        JSON.stringify({
          accountAddress: "0xConnectedAccountAddress",
          apiWalletAddress: "0xConnectedApiWallet",
          privateKey: "0xConnectedSecret",
        }),
      )

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
      localStorage.setItem(
        "hyperliquid-wallet",
        JSON.stringify({
          accountAddress: "0xConnectedAccountAddress",
          apiWalletAddress: "0xConnectedApiWallet",
          privateKey: "0xConnectedSecret",
        }),
      )

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
