import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"
import { WalletHeader } from "./wallet-header"
import { WalletProvider } from "@/contexts/WalletProvider"
import { NetworkProvider } from "@/contexts/NetworkContext"

const mockSwitchNetworkMutate = vi.fn()
const mockSwitchNetworkMutateAsync = vi.fn()
const mockUseWalletSettings = vi.fn()

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
    listPerpTickers = vi.fn()
    getLeverageLimits = vi.fn()
    rebalancePositions = vi.fn()
    getNetworkMode = vi.fn()
    getWalletAddress = vi.fn()
  },
  preloadMarkets: vi.fn().mockResolvedValue(undefined),
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

  describe("wallet configuration dialog", () => {
    it("opens dialog when clicking 'No wallet configured'", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      const walletButton = screen.getByText("No wallet configured")
      await user.click(walletButton)

      expect(screen.getByText("Connect Wallet")).toBeInTheDocument()
      expect(
        screen.getByText(
          "Enter your Hyperliquid API wallet credentials to connect.",
        ),
      ).toBeInTheDocument()
    })

    it("shows all credential input fields when not connected", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      expect(
        screen.getByLabelText("Hyperliquid main wallet address"),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText("Hyperliquid public API wallet address"),
      ).toBeInTheDocument()
      expect(
        screen.getByLabelText("Hyperliquid private API wallet key"),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Connect" }),
      ).toBeInTheDocument()
    })

    it("shows optional vault address field", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      expect(
        screen.getByLabelText("Vault Address (Optional)"),
      ).toBeInTheDocument()
    })

    it("shows error toast when trying to connect with empty required fields", async () => {
      const user = userEvent.setup()
      const { toast } = await import("solid-sonner")
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))
      await user.click(screen.getByRole("button", { name: "Connect" }))

      expect(toast.error).toHaveBeenCalledWith(
        "Please enter account address, API wallet address, and private key",
      )
    })

    it("connects wallet when valid credentials are provided", async () => {
      const user = userEvent.setup()
      const { toast } = await import("solid-sonner")
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      const accountAddressInput = screen.getByLabelText(
        "Hyperliquid main wallet address",
      )
      const apiWalletAddressInput = screen.getByLabelText(
        "Hyperliquid public API wallet address",
      )
      const privateKeyInput = screen.getByLabelText(
        "Hyperliquid private API wallet key",
      )

      await user.type(accountAddressInput, "0xMyAccountAddress")
      await user.type(apiWalletAddressInput, "0xMyApiWalletAddress")
      await user.type(privateKeyInput, "0xMyPrivateKey")
      await user.click(screen.getByRole("button", { name: "Connect" }))

      expect(toast.success).toHaveBeenCalledWith("Wallet connected")

      const stored = localStorage.getItem("hyperliquid-wallet")
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored ?? "{}")
      expect(parsed).toEqual({
        accountAddress: "0xMyAccountAddress",
        apiWalletAddress: "0xMyApiWalletAddress",
        privateKey: "0xMyPrivateKey",
      })
    }, 15000)

    it("stores vault address when provided", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      const accountAddressInput = screen.getByLabelText(
        "Hyperliquid main wallet address",
      )
      const apiWalletAddressInput = screen.getByLabelText(
        "Hyperliquid public API wallet address",
      )
      const privateKeyInput = screen.getByLabelText(
        "Hyperliquid private API wallet key",
      )
      const vaultAddressInput = screen.getByLabelText(
        "Vault Address (Optional)",
      )

      await user.type(accountAddressInput, "0xMyAccountAddress")
      await user.type(apiWalletAddressInput, "0xMyApiWalletAddress")
      await user.type(privateKeyInput, "0xMyPrivateKey")
      await user.type(vaultAddressInput, "0xMyVaultAddress")
      await user.click(screen.getByRole("button", { name: "Connect" }))

      const stored = localStorage.getItem("hyperliquid-wallet")
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored ?? "{}")
      expect(parsed).toEqual({
        accountAddress: "0xMyAccountAddress",
        apiWalletAddress: "0xMyApiWalletAddress",
        privateKey: "0xMyPrivateKey",
        vaultAddress: "0xMyVaultAddress",
      })
    }, 15000)

    it("connects without vault address when not provided", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      const accountAddressInput = screen.getByLabelText(
        "Hyperliquid main wallet address",
      )
      const apiWalletAddressInput = screen.getByLabelText(
        "Hyperliquid public API wallet address",
      )
      const privateKeyInput = screen.getByLabelText(
        "Hyperliquid private API wallet key",
      )

      await user.type(accountAddressInput, "0xMyAccountAddress")
      await user.type(apiWalletAddressInput, "0xMyApiWalletAddress")
      await user.type(privateKeyInput, "0xMyPrivateKey")
      await user.click(screen.getByRole("button", { name: "Connect" }))

      const stored = localStorage.getItem("hyperliquid-wallet")
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored ?? "{}")
      expect(parsed.vaultAddress).toBeUndefined()
    }, 10000)

    it("closes dialog after successful connection", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      const accountAddressInput = screen.getByLabelText(
        "Hyperliquid main wallet address",
      )
      const apiWalletAddressInput = screen.getByLabelText(
        "Hyperliquid public API wallet address",
      )
      const privateKeyInput = screen.getByLabelText(
        "Hyperliquid private API wallet key",
      )

      await user.type(accountAddressInput, "0xMyAccountAddress")
      await user.type(apiWalletAddressInput, "0xMyApiWalletAddress")
      await user.type(privateKeyInput, "0xMyPrivateKey")
      await user.click(screen.getByRole("button", { name: "Connect" }))

      // Kobalte keeps dialog content mounted during close animation;
      // jsdom never fires animationend, so check data-closed instead of DOM absence.
      await waitFor(() => {
        const dialog = screen.queryByRole("dialog")
        if (dialog) {
          expect(dialog).toHaveAttribute("data-closed")
        }
      })
    }, 20000)

    it("clears input fields after successful connection", async () => {
      const user = userEvent.setup()
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await user.click(screen.getByText("No wallet configured"))

      const accountAddressInput = screen.getByLabelText(
        "Hyperliquid main wallet address",
      )
      const apiWalletAddressInput = screen.getByLabelText(
        "Hyperliquid public API wallet address",
      )
      const privateKeyInput = screen.getByLabelText(
        "Hyperliquid private API wallet key",
      )

      await user.type(accountAddressInput, "0xMyAccountAddress")
      await user.type(apiWalletAddressInput, "0xMyApiWalletAddress")
      await user.type(privateKeyInput, "0xMyPrivateKey")
      await user.click(screen.getByRole("button", { name: "Connect" }))

      // Wait for dialog to enter closed state (jsdom: animationend never fires)
      await waitFor(() => {
        const dialog = screen.queryByRole("dialog")
        if (dialog) {
          expect(dialog).toHaveAttribute("data-closed")
        }
      })

      // In jsdom, Kobalte's closed overlay blocks pointer events because CSS
      // animations never complete. Use fireEvent to bypass this jsdom limitation.
      fireEvent.click(screen.getByText("No wallet configured"))

      const newAccountAddressInput = screen.getByLabelText(
        "Hyperliquid main wallet address",
      )
      const newApiWalletAddressInput = screen.getByLabelText(
        "Hyperliquid public API wallet address",
      )
      const newPrivateKeyInput = screen.getByLabelText(
        "Hyperliquid private API wallet key",
      )

      expect(newAccountAddressInput).toHaveValue("")
      expect(newApiWalletAddressInput).toHaveValue("")
      expect(newPrivateKeyInput).toHaveValue("")
    }, 20000)

    it("auto-opens dialog when autoOpen prop is true and not connected", async () => {
      render(() => <WalletHeader autoOpen handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(screen.getByText("Connect Wallet")).toBeInTheDocument()
      })
    })

    it("does not auto-open dialog when connected even with autoOpen prop", async () => {
      mockUseWalletSettings.mockReturnValue({
        data: () => ({
          accountAddress: "0xConnectedAccountAddress",
          isTestnet: true,
        }),
        isConnected: () => true,
      })

      render(() => <WalletHeader autoOpen handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(screen.queryByText("Connect Wallet")).not.toBeInTheDocument()
      })
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

  describe("wallet button styling", () => {
    it("has hover styling to indicate clickability", () => {
      render(() => <WalletHeader handleDisconnect={() => {}} />, {
        wrapper: createWrapper(),
      })

      const walletButton = screen.getByText("No wallet configured")
      expect(walletButton).toHaveClass("cursor-pointer")
    })
  })
})
