/**
 * Shared Reown AppKit instance for EVM wallets on the Portfolio tab.
 * Pattern mirrors the Solana AppKit helpers in PR #224.
 */

import { createAppKit, type AppKit } from "@reown/appkit"
import { arbitrum, arbitrumSepolia } from "@reown/appkit/networks"
import { EthersAdapter } from "@reown/appkit-adapter-ethers"
import type { EIP1193Provider } from "viem"

let appKitSingleton: AppKit | null = null

export const readReownProjectId = (): string | null => {
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim()
  return projectId && projectId.length > 0 ? projectId : null
}

/**
 * Single shared AppKit instance for Hyperliquid main-wallet connect.
 */
export const getOrCreateEvmAppKit = (): AppKit | null => {
  if (appKitSingleton) {
    return appKitSingleton
  }

  const projectId = readReownProjectId()
  if (!projectId) {
    return null
  }

  appKitSingleton = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [arbitrum, arbitrumSepolia],
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
    features: {
      analytics: false,
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

  for (const entry of allAccounts) {
    if (!isRecord(entry)) {
      continue
    }

    const namespace = entry["namespace"]
    if (namespace !== undefined && namespace !== "eip155") {
      continue
    }

    const candidateAddress = entry["address"]
    if (typeof candidateAddress === "string" && candidateAddress.length > 0) {
      return candidateAddress
    }
  }

  return null
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
