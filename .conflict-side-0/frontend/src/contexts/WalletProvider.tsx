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
  WalletAuthorizationAccountChanged,
  WalletAuthorizationContextChanged,
  WalletAuthorizationNetworkChanged,
  WalletConnectError,
  WalletConnectionContextChanged,
  WalletDisconnectContextChanged,
  WalletDisconnectFailed,
  WalletOperationContextChanged,
  WalletSessionMissing,
  WalletUnlockContextChanged,
  type WalletDisconnectFailure,
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
  ReownWalletUnavailable,
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
  const leftMissing = left === null || left === undefined
  const rightMissing = right === null || right === undefined
  if (leftMissing || rightMissing) {
    return leftMissing && rightMissing
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
  let walletContextRevision = 0
  let activeWalletOperation: symbol | null = null

  const markWalletContextChanged = () => {
    walletContextRevision += 1
  }

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
    if (!sameWalletAddress(mainAddress(), address)) {
      markWalletContextChanged()
    }

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
  ): Effect.Effect<void, WalletConnectError> => {
    const contextRevision = walletContextRevision

    return Effect.tryPromise({
      try: () => encryptWalletPrivateKey(newCredentials.privateKey, pin),
      catch: cause => new WalletConnectError({ cause }),
    }).pipe(
      Effect.flatMap(encrypted => {
        if (walletContextRevision !== contextRevision) {
          return Effect.fail(
            new WalletConnectError({
              cause: new WalletConnectionContextChanged(),
            }),
          )
        }

        return Effect.sync(() => {
          markWalletContextChanged()
          persistEncryptedSession(newCredentials, encrypted)
          setMainAddressState(newCredentials.accountAddress)
          setCredentials(newCredentials)
          syncStoredSessionState()
        })
      }),
      Effect.asVoid,
    )
  }

  /**
   * PIN -> generate agent -> encrypt in memory -> approveAgent via Reown.
   * Persists the generated encrypted session only after approval succeeds.
   * Approval failure never mutates an existing encrypted session.
   */
  // Called only from UI event handlers; its signal snapshots deliberately bind
  // one authorization attempt to the account and network that started it.
  const authorizeAgent = (
    pin: string,
  ): Effect.Effect<void, WalletConnectError> => {
    const address = mainAddress()
    const mode = networkMode()
    const contextRevision = walletContextRevision
    const operationToken = Symbol("authorize-agent")

    // Effect.gen executes after an event handler starts this operation, outside
    // Solid tracking; subsequent reads intentionally detect account changes.
    // eslint-disable-next-line solid/reactivity
    return Effect.gen(function* () {
      if (activeWalletOperation !== null) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletOperationContextChanged(),
          }),
        )
      }
      activeWalletOperation = operationToken

      if (!address) {
        return yield* Effect.fail(
          new WalletConnectError({ cause: new ReownWalletUnavailable() }),
        )
      }

      const modal = getOrCreateEvmAppKit()
      const provider = modal ? readConnectedEip1193Provider(modal) : null
      if (!provider) {
        return yield* Effect.fail(
          new WalletConnectError({ cause: new ReownWalletUnavailable() }),
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

      if (walletContextRevision !== contextRevision) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletAuthorizationContextChanged(),
          }),
        )
      }

      const approveResult = yield* Effect.either(
        approveHyperliquidAgent(provider, address, agent.agentAddress, mode),
      )

      if (Either.isLeft(approveResult)) {
        return yield* Effect.fail(
          new WalletConnectError({ cause: approveResult.left }),
        )
      }

      if (!sameWalletAddress(mainAddress(), address)) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletAuthorizationAccountChanged(),
          }),
        )
      }

      if (networkMode() !== mode) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletAuthorizationNetworkChanged(),
          }),
        )
      }

      if (walletContextRevision !== contextRevision) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletAuthorizationContextChanged(),
          }),
        )
      }

      markWalletContextChanged()
      persistEncryptedSession(pendingCredentials, encrypted)
      syncStoredSessionState()
      setCredentials(pendingCredentials)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (activeWalletOperation === operationToken) {
            activeWalletOperation = null
          }
        }),
      ),
    )
  }

  /**
   * Reown-signed revoke on Hyperliquid, then drop the local agent session.
   * Main wallet address stays connected for read-only loads.
   */
  const revokeAgent = (): Effect.Effect<void, WalletConnectError> => {
    // Snapshot signals synchronously so Effect.gen is not a reactive scope.
    const address = mainAddress()
    const mode = networkMode()
    const contextRevision = walletContextRevision
    const operationToken = Symbol("revoke-agent")

    return Effect.gen(function* () {
      if (activeWalletOperation !== null) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletOperationContextChanged(),
          }),
        )
      }
      activeWalletOperation = operationToken

      if (!address) {
        return yield* Effect.fail(
          new WalletConnectError({ cause: new ReownWalletUnavailable() }),
        )
      }

      const modal = getOrCreateEvmAppKit()
      const provider = modal ? readConnectedEip1193Provider(modal) : null
      if (!provider) {
        return yield* Effect.fail(
          new WalletConnectError({ cause: new ReownWalletUnavailable() }),
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

      if (walletContextRevision !== contextRevision) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletOperationContextChanged(),
          }),
        )
      }

      markWalletContextChanged()
      setCredentials(null)
      clearEncryptedSession()
      syncStoredSessionState()
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (activeWalletOperation === operationToken) {
            activeWalletOperation = null
          }
        }),
      ),
    )
  }

  const unlock = (pin: string): Effect.Effect<void, WalletUnlockFailure> => {
    const session = getStoredEncryptedSession()
    if (!session) {
      return Effect.fail(new WalletSessionMissing())
    }
    const contextRevision = walletContextRevision

    return decryptWalletPrivateKey(
      session.encryptedPrivateKey,
      pin,
      session.salt,
      session.iv,
    ).pipe(
      Effect.flatMap(privateKey => {
        if (walletContextRevision !== contextRevision) {
          return Effect.fail(new WalletUnlockContextChanged())
        }

        return Effect.sync(() => {
          markWalletContextChanged()
          setMainAddressState(session.accountAddress)
          setCredentials(credentialsFromSession(session, privateKey))
        })
      }),
      Effect.asVoid,
    )
  }

  const disconnect = (): Effect.Effect<void, WalletDisconnectFailure> => {
    const contextRevision = walletContextRevision
    const operationToken = Symbol("disconnect")

    // Invoked from UI handlers; post-await signal reads validate AppKit events.
    // eslint-disable-next-line solid/reactivity
    return Effect.gen(function* () {
      if (activeWalletOperation !== null) {
        return yield* Effect.fail(new WalletDisconnectContextChanged())
      }
      activeWalletOperation = operationToken

      const modal = getOrCreateEvmAppKit()
      if (modal) {
        yield* Effect.tryPromise({
          try: () => modal.disconnect("eip155"),
          catch: cause => new WalletDisconnectFailed({ cause }),
        })
      }

      const revisionUnchanged = walletContextRevision === contextRevision
      const expectedDisconnectCallback =
        walletContextRevision === contextRevision + 1 && mainAddress() === null
      if (!revisionUnchanged && !expectedDisconnectCallback) {
        return yield* Effect.fail(new WalletDisconnectContextChanged())
      }

      markWalletContextChanged()
      setCredentials(null)
      setMainAddressState(null)
      clearEncryptedSession()
      syncStoredSessionState()
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (activeWalletOperation === operationToken) {
            activeWalletOperation = null
          }
        }),
      ),
    )
  }

  const setNetworkMode = (mode: NetworkMode) => {
    if (networkMode() !== mode) {
      markWalletContextChanged()
    }
    setNetworkModeState(mode)
    localStorage.setItem(NETWORK_STORAGE_KEY, mode)
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === WALLET_STORAGE_KEY) {
      markWalletContextChanged()
      setCredentials(null)
      const nextSession = getStoredEncryptedSession()
      syncStoredSessionState()
      if (nextSession) {
        setMainAddressState(nextSession.accountAddress)
      }
    }
    if (event.key === NETWORK_STORAGE_KEY) {
      const storedNetworkMode = getStoredNetworkMode()
      if (networkMode() !== storedNetworkMode) {
        markWalletContextChanged()
      }
      setNetworkModeState(storedNetworkMode)
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

      // AppKit invokes this external callback; signal reads intentionally use
      // the current wallet context when each account event arrives.
      // eslint-disable-next-line solid/reactivity
      unsubscribeAccount = modal.subscribeAccount(accountState => {
        const nextAddress = readEvmAddressFromAccountState(accountState)
        const connected =
          readEvmWalletConnectedFromAccountState(accountState) ||
          nextAddress !== null

        if (connected && nextAddress) {
          setMainAddress(nextAddress)
          return
        }

        const currentProviderAddress = modal.getAddress("eip155") ?? null
        if (currentProviderAddress !== null) {
          setMainAddress(currentProviderAddress)
          return
        }

        setMainAddress(null)
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
