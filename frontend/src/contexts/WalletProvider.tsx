import {
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  untrack,
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
import * as Either from "effect/Either"
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
import {
  approveHyperliquidAgent,
  generateHyperliquidAgent,
  revokeHyperliquidAgent,
} from "@/services/hyperliquidAgent"
import {
  getOrCreateEvmAppKit,
  readConnectedEip1193Provider,
  readEvmAddressFromAccountState,
  readEvmWalletConnectedFromAccountState,
} from "@/reown/evmAppKit"

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

const clearEncryptedSession = () => {
  localStorage.removeItem(WALLET_STORAGE_KEY)
}

const sameWalletAddress = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => {
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  ) {
    return false
  }

  return left.toLowerCase() === right.toLowerCase()
}

export const WalletProvider = (props: ParentProps) => {
  const storedSession = getStoredEncryptedSession()
  const [mainAddress, setMainAddressState] = createSignal<string | null>(
    storedSession?.accountAddress ?? null,
  )
  const [credentials, setCredentials] = createSignal<WalletCredentials | null>(
    null,
  )
  const [networkMode, setNetworkModeState] = createSignal<NetworkMode>(
    getStoredNetworkMode(),
  )
  const [hasStoredSession, setHasStoredSession] = createSignal(
    storedSession !== null,
  )

  const syncStoredSessionState = () => {
    setHasStoredSession(getStoredEncryptedSession() !== null)
  }

  const isConnected = createMemo(() => mainAddress() !== null)
  const isLocked = createMemo(
    () => hasStoredSession() && credentials() === null,
  )
  const canTrade = createMemo(() => credentials() !== null)

  const client = createMemo(() => {
    const unlocked = credentials()
    if (unlocked) {
      return new HyperliquidClient(unlocked, networkMode())
    }

    const address = mainAddress()
    if (!address) {
      return null
    }

    return new HyperliquidClient({ accountAddress: address }, networkMode())
  })

  const setMainAddress = (address: string | null) => {
    // Reown account callbacks are not Solid tracked scopes; read unlocked
    // credentials without subscribing so mismatch invalidation still runs.
    const unlocked = untrack(() => credentials())
    if (
      unlocked !== null &&
      !sameWalletAddress(unlocked.accountAddress, address)
    ) {
      setCredentials(null)
    }

    const stored = getStoredEncryptedSession()
    if (stored !== null && !sameWalletAddress(stored.accountAddress, address)) {
      clearEncryptedSession()
      syncStoredSessionState()
    }

    setMainAddressState(address)
  }

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
          setMainAddressState(newCredentials.accountAddress)
          setCredentials(newCredentials)
          syncStoredSessionState()
        }),
      ),
      Effect.asVoid,
    )

  /**
   * PIN -> generate agent -> encrypt/persist -> approveAgent via Reown.
   * On approve failure the encrypted session is cleared.
   */
  const authorizeAgent = (
    pin: string,
  ): Effect.Effect<void, WalletConnectError> => {
    // Snapshot signals synchronously so Effect.gen is not a reactive scope.
    const address = mainAddress()
    const mode = networkMode()

    return Effect.gen(function* () {
      if (!address) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new Error("Connect a wallet with Reown before authorizing"),
          }),
        )
      }

      const modal = getOrCreateEvmAppKit()
      const provider = modal ? readConnectedEip1193Provider(modal) : null
      if (!provider) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new Error("Reown wallet provider is unavailable"),
          }),
        )
      }

      const agent = generateHyperliquidAgent()
      const pendingCredentials: WalletCredentials = {
        accountAddress: address,
        apiWalletAddress: agent.agentAddress,
        privateKey: agent.agentPrivateKey,
      }

      const encrypted = yield* Effect.tryPromise({
        try: () => encryptWalletPrivateKey(pendingCredentials.privateKey, pin),
        catch: cause => new WalletConnectError({ cause }),
      })

      persistEncryptedSession(pendingCredentials, encrypted)
      syncStoredSessionState()

      const approveResult = yield* Effect.either(
        approveHyperliquidAgent(provider, address, agent.agentAddress, mode),
      )

      if (Either.isLeft(approveResult)) {
        clearEncryptedSession()
        syncStoredSessionState()
        setCredentials(null)
        return yield* Effect.fail(
          new WalletConnectError({ cause: approveResult.left }),
        )
      }

      setCredentials(pendingCredentials)
    })
  }

  /**
   * Reown-signed revoke on Hyperliquid, then drop the local agent session.
   * Main wallet address stays connected for read-only loads.
   */
  const revokeAgent = (): Effect.Effect<void, WalletConnectError> => {
    // Snapshot signals synchronously so Effect.gen is not a reactive scope.
    const address = mainAddress()
    const mode = networkMode()

    return Effect.gen(function* () {
      if (!address) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new Error("Connect a wallet with Reown before revoking"),
          }),
        )
      }

      const modal = getOrCreateEvmAppKit()
      const provider = modal ? readConnectedEip1193Provider(modal) : null
      if (!provider) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new Error("Reown wallet provider is unavailable"),
          }),
        )
      }

      const revokeResult = yield* Effect.either(
        revokeHyperliquidAgent(provider, address, mode),
      )

      if (Either.isLeft(revokeResult)) {
        return yield* Effect.fail(
          new WalletConnectError({ cause: revokeResult.left }),
        )
      }

      setCredentials(null)
      clearEncryptedSession()
      syncStoredSessionState()
    })
  }

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
          setMainAddressState(session.accountAddress)
          setCredentials(credentialsFromSession(session, privateKey))
        }),
      ),
      Effect.asVoid,
    )
  }

  const disconnect = () => {
    setCredentials(null)
    setMainAddressState(null)
    clearEncryptedSession()
    syncStoredSessionState()

    const modal = getOrCreateEvmAppKit()
    if (modal) {
      void modal.disconnect("eip155")
    }
  }

  const setNetworkMode = (mode: NetworkMode) => {
    setNetworkModeState(mode)
    localStorage.setItem(NETWORK_STORAGE_KEY, mode)
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === WALLET_STORAGE_KEY) {
      setCredentials(null)
      const nextSession = getStoredEncryptedSession()
      syncStoredSessionState()
      if (nextSession) {
        setMainAddressState(nextSession.accountAddress)
      }
    }
    if (event.key === NETWORK_STORAGE_KEY) {
      setNetworkModeState(getStoredNetworkMode())
    }
  }

  onMount(() => {
    window.addEventListener("storage", handleStorageChange)

    const modal = getOrCreateEvmAppKit()
    let unsubscribeAccount: (() => void) | undefined

    if (modal) {
      const existingAddress = modal.getAddress("eip155")
      if (existingAddress) {
        setMainAddress(existingAddress)
      }

      unsubscribeAccount = modal.subscribeAccount(accountState => {
        const nextAddress = readEvmAddressFromAccountState(accountState)
        const connected =
          readEvmWalletConnectedFromAccountState(accountState) ||
          nextAddress !== null

        if (connected && nextAddress) {
          setMainAddress(nextAddress)
          return
        }

        const stored = getStoredEncryptedSession()
        setMainAddress(stored?.accountAddress ?? null)
      }, "eip155")
    }

    onCleanup(() => {
      unsubscribeAccount?.()
      window.removeEventListener("storage", handleStorageChange)
    })
  })

  return (
    <WalletContext.Provider
      value={{
        mainAddress,
        credentials,
        networkMode,
        isConnected,
        isLocked,
        hasStoredSession,
        canTrade,
        client,
        connect,
        authorizeAgent,
        revokeAgent,
        unlock,
        disconnect,
        setNetworkMode,
        setMainAddress,
      }}
    >
      {props.children}
    </WalletContext.Provider>
  )
}
