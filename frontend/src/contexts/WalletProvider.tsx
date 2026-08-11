import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  type ParentProps,
} from "solid-js"
import {
  WalletContext,
  WALLET_STORAGE_KEY,
  NETWORK_STORAGE_KEY,
  getStoredEncryptedSession,
  getStoredNetworkMode,
  type EncryptedWalletSession,
  type NetworkMode,
  type WalletCredentials,
} from "./wallet-context"
import * as Effect from "effect/Effect"
import {
  WalletConnectError,
  WalletSessionMissing,
  type WalletUnlockFailure,
} from "@/services/wallet"
import { HyperliquidClient } from "@/services/hyperliquid-client"
import {
  decryptWalletPrivateKey,
  encryptWalletPrivateKey,
} from "@/services/walletCredentialCrypto"

const credentialsFromSession = (
  session: EncryptedWalletSession,
  privateKey: string,
): WalletCredentials => ({
  accountAddress: session.accountAddress,
  apiWalletAddress: session.apiWalletAddress,
  privateKey,
})

const persistEncryptedSession = (
  credentials: WalletCredentials,
  encrypted: Pick<
    EncryptedWalletSession,
    "encryptedPrivateKey" | "salt" | "iv"
  >,
) => {
  const session: EncryptedWalletSession = {
    accountAddress: credentials.accountAddress,
    apiWalletAddress: credentials.apiWalletAddress,
    encryptedPrivateKey: encrypted.encryptedPrivateKey,
    salt: encrypted.salt,
    iv: encrypted.iv,
  }
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(session))
}

export const WalletProvider = (props: ParentProps) => {
  const [credentials, setCredentials] = createSignal<WalletCredentials | null>(
    null,
  )
  const [networkMode, setNetworkModeState] = createSignal<NetworkMode>(
    getStoredNetworkMode(),
  )
  const [hasStoredSession, setHasStoredSession] = createSignal(
    getStoredEncryptedSession() !== null,
  )

  const syncStoredSessionState = () => {
    setHasStoredSession(getStoredEncryptedSession() !== null)
  }

  const isConnected = createMemo(() => credentials() !== null)
  const isLocked = createMemo(
    () => hasStoredSession() && credentials() === null,
  )

  const client = createMemo(() => {
    const creds = credentials()
    if (!creds) return null
    return new HyperliquidClient(creds, networkMode())
  })

  const connect = (
    newCredentials: WalletCredentials,
    pin: string,
  ): Effect.Effect<void, WalletConnectError> =>
    Effect.tryPromise({
      try: () => encryptWalletPrivateKey(newCredentials.privateKey, pin),
      catch: cause => new WalletConnectError({ cause }),
    }).pipe(
      Effect.tap(encrypted =>
        Effect.sync(() => {
          persistEncryptedSession(newCredentials, encrypted)
          setCredentials(newCredentials)
          syncStoredSessionState()
        }),
      ),
      Effect.asVoid,
    )

  const unlock = (pin: string): Effect.Effect<void, WalletUnlockFailure> => {
    const session = getStoredEncryptedSession()
    if (!session) {
      return Effect.fail(new WalletSessionMissing())
    }

    return decryptWalletPrivateKey(
      session.encryptedPrivateKey,
      pin,
      session.salt,
      session.iv,
    ).pipe(
      Effect.tap(privateKey =>
        Effect.sync(() => {
          setCredentials(credentialsFromSession(session, privateKey))
        }),
      ),
      Effect.asVoid,
    )
  }

  const disconnect = () => {
    setCredentials(null)
    localStorage.removeItem(WALLET_STORAGE_KEY)
    syncStoredSessionState()
  }

  const setNetworkMode = (mode: NetworkMode) => {
    setNetworkModeState(mode)
    localStorage.setItem(NETWORK_STORAGE_KEY, mode)
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === WALLET_STORAGE_KEY) {
      setCredentials(null)
      syncStoredSessionState()
    }
    if (event.key === NETWORK_STORAGE_KEY) {
      setNetworkModeState(getStoredNetworkMode())
    }
  }

  onMount(() => {
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
        isLocked,
        hasStoredSession,
        client,
        connect,
        unlock,
        disconnect,
        setNetworkMode,
      }}
    >
      {props.children}
    </WalletContext.Provider>
  )
}
