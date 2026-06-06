import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  type ParentProps,
} from "solid-js"
import {
  WalletContext,
  WALLET_STORAGE_KEY,
  NETWORK_STORAGE_KEY,
  getStoredWalletMetadata,
  getStoredNetworkMode,
  type NetworkMode,
  type WalletCredentials,
} from "./wallet-context"
import {
  HyperliquidClient,
  preloadMarkets,
} from "@/services/hyperliquid-client"

export const WalletProvider = (props: ParentProps) => {
  const [credentials, setCredentials] = createSignal<WalletCredentials | null>(
    null,
  )
  const [networkMode, setNetworkModeState] = createSignal<NetworkMode>(
    getStoredNetworkMode(),
  )

  // createEffect: eagerly preload market metadata whenever networkMode changes
  createEffect(() => {
    void preloadMarkets(networkMode())
  })

  const isConnected = createMemo(() => credentials() !== null)

  const client = createMemo(() => {
    const creds = credentials()
    if (!creds) return null
    return new HyperliquidClient(creds, networkMode())
  })

  const connect = (newCredentials: WalletCredentials) => {
    setCredentials(newCredentials)
    const { accountAddress, apiWalletAddress, privateKey, vaultAddress } =
      newCredentials
    localStorage.setItem(
      WALLET_STORAGE_KEY,
      JSON.stringify({
        accountAddress,
        apiWalletAddress,
        privateKey,
        vaultAddress,
      }),
    )
  }

  const disconnect = () => {
    setCredentials(null)
    localStorage.removeItem(WALLET_STORAGE_KEY)
  }

  const setNetworkMode = (mode: NetworkMode) => {
    setNetworkModeState(mode)
    localStorage.setItem(NETWORK_STORAGE_KEY, mode)
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === WALLET_STORAGE_KEY) {
      setCredentials(null)
    }
    if (event.key === NETWORK_STORAGE_KEY) {
      setNetworkModeState(getStoredNetworkMode())
    }
  }

  onMount(() => {
    const stored = getStoredWalletMetadata()
    if (stored?.privateKey) {
      setCredentials({
        accountAddress: stored.accountAddress,
        apiWalletAddress: stored.apiWalletAddress,
        privateKey: stored.privateKey,
        vaultAddress: stored.vaultAddress,
      })
    }

    window.addEventListener("storage", handleStorageChange)
  })
  onCleanup(() => {
    window.removeEventListener("storage", handleStorageChange)
  })

  return (
    <WalletContext.Provider
      value={{
        credentials,
        networkMode,
        isConnected,
        client,
        connect,
        disconnect,
        setNetworkMode,
      }}
    >
      {props.children}
    </WalletContext.Provider>
  )
}
