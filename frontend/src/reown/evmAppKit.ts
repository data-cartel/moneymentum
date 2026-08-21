/**
 * Lazy Reown AppKit for EVM wallet connect on the Portfolio tab.
 *
 * The AppKit + EthersAdapter modules are loaded only when the user intends to
 * connect, authorize, revoke, or disconnect -- never on initial page load.
 */

import type { AppKit } from "@reown/appkit"
import type { EIP1193Provider } from "viem"

let appKitSingleton: AppKit | null = null
let appKitLoadPromise: Promise<AppKit | null> | null = null

export const readReownProjectId = (): string | null => {
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim()
  return projectId && projectId.length > 0 ? projectId : null
}

/**
 * Starts loading AppKit in the background (e.g. on pointer enter). Safe to call
 * repeatedly; concurrent callers share one promise. Prefetch failures are
 * swallowed -- the click path surfaces errors via toast.
 */
export const prefetchEvmAppKit = (): void => {
  void ensureEvmAppKit().catch(() => undefined)
}

/**
 * Lazily creates the shared AppKit instance. Returns null when the Reown
 * project id is not configured.
 */
export const ensureEvmAppKit = (): Promise<AppKit | null> => {
  if (appKitSingleton) {
    return Promise.resolve(appKitSingleton)
  }

  if (appKitLoadPromise) {
    return appKitLoadPromise
  }

  appKitLoadPromise = loadEvmAppKit().catch((error: unknown) => {
    appKitLoadPromise = null
    throw error
  })
  return appKitLoadPromise
}

const loadEvmAppKit = async (): Promise<AppKit | null> => {
  const projectId = readReownProjectId()
  if (!projectId) {
    return null
  }

  const [{ createAppKit }, { EthersAdapter }, networks] = await Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit-adapter-ethers"),
    import("@reown/appkit/networks"),
  ])

  appKitSingleton = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [networks.arbitrum, networks.arbitrumSepolia],
    projectId,
    metadata: {
      name: "Moneymentum",
      description: "Moneymentum Hyperliquid portfolio rebalancer",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons:
        typeof window !== "undefined"
          ? [`${window.location.origin}/favicon.ico`]
          : [],
    },
    // Injected browser wallets only -- no WalletConnect QR / all-wallets catalog.
    enableWalletConnect: false,
    enableWalletGuide: false,
    enableReconnect: false,
    allWallets: "HIDE",
    features: {
      analytics: false,
      swaps: false,
      onramp: false,
      email: false,
      socials: false,
      history: false,
      allWallets: false,
      send: false,
      receive: false,
      smartSessions: false,
      connectorTypeOrder: ["injected"],
      connectMethodsOrder: ["wallet"],
    },
  })

  return appKitSingleton
}

type AppKitAccountState = {
  address?: unknown
  allAccounts?: unknown
  isConnected?: unknown
}

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  candidate !== null && typeof candidate === "object"

/**
 * Reads the EVM address from AppKit `subscribeAccount` payloads.
 */
export const readEvmAddressFromAccountState = (
  accountState: unknown,
): string | null => {
  if (!isRecord(accountState)) {
    return null
  }

  const { address, allAccounts } = accountState as AppKitAccountState
  if (typeof address === "string" && address.length > 0) {
    return address
  }

  if (!Array.isArray(allAccounts)) {
    return null
  }

  const matchingAccount = allAccounts.find(
    (account): account is Record<string, unknown> & { address: string } => {
      if (!isRecord(account)) {
        return false
      }

      const namespace = account["namespace"]
      const accountAddress = account["address"]
      return (
        (namespace === undefined || namespace === "eip155") &&
        typeof accountAddress === "string" &&
        accountAddress.length > 0
      )
    },
  )

  return matchingAccount?.address ?? null
}

export const readEvmWalletConnectedFromAccountState = (
  accountState: unknown,
): boolean => {
  if (!isRecord(accountState)) {
    return false
  }

  return (
    (typeof accountState["isConnected"] === "boolean" &&
      accountState["isConnected"]) ||
    readEvmAddressFromAccountState(accountState) !== null
  )
}

const isEip1193Provider = (value: unknown): value is EIP1193Provider => {
  if (!isRecord(value)) {
    return false
  }

  return typeof value["request"] === "function"
}

/**
 * Returns the EIP-1193 provider for the connected EVM wallet.
 */
export const readConnectedEip1193Provider = (
  modal: AppKit,
): EIP1193Provider | null => {
  const namespaced = modal.getProvider<EIP1193Provider>("eip155")
  if (isEip1193Provider(namespaced)) {
    return namespaced
  }

  const walletProvider = modal.getWalletProvider()
  if (isEip1193Provider(walletProvider)) {
    return walletProvider
  }

  return null
}
