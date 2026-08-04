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
  DERIVE_WALLET_STORAGE_KEY,
  NETWORK_STORAGE_KEY,
  getStoredEncryptedSession,
  getStoredEncryptedDeriveSession,
  getStoredNetworkMode,
  getStoredWalletAddresses,
  type EncryptedDeriveSession,
  type EncryptedWalletSession,
  type DeriveWalletCredentials,
  type NetworkMode,
  type WalletCredentials,
} from "./wallet-context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import {
  WalletConnectError,
  WalletDisconnectFailed,
  WalletSessionMissing,
  type WalletUnlockFailure,
} from "@/services/wallet"
import type { HyperliquidClient } from "@/services/hyperliquid-client"
import {
  ensureHyperliquidClientModule,
  prefetchHyperliquidClientModule,
} from "@/services/hyperliquidClientLoader"
import {
  decryptWalletPrivateKey,
  encryptWalletPrivateKey,
} from "@/services/walletCredentialCrypto"
import {
  normalizeDeriveWallet,
  parseSessionPrivateKey,
} from "@/services/deriveAccount"
import {
  ensureEvmAppKit,
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

const deriveCredentialsFromSession = (
  session: EncryptedDeriveSession,
  sessionPrivateKey: `0x${string}`,
): DeriveWalletCredentials => ({
  deriveWallet: session.deriveWallet,
  sessionAddress: session.sessionAddress,
  sessionPrivateKey,
  subaccountId: session.subaccountId,
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

const persistEncryptedDeriveSession = (session: EncryptedDeriveSession) => {
  localStorage.setItem(DERIVE_WALLET_STORAGE_KEY, JSON.stringify(session))
}

const clearEncryptedSession = () => {
  localStorage.removeItem(WALLET_STORAGE_KEY)
}

const clearEncryptedDeriveSession = () => {
  localStorage.removeItem(DERIVE_WALLET_STORAGE_KEY)
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

type HyperliquidClientConstructor =
  typeof import("@/services/hyperliquid-client").HyperliquidClient

export const WalletProvider = (props: ParentProps) => {
  const storedSession = getStoredEncryptedSession()
  const storedDeriveSession = getStoredEncryptedDeriveSession()
  const [mainAddress, setMainAddressState] = createSignal<string | null>(
    storedSession?.accountAddress ?? null,
  )
  const [credentials, setCredentials] = createSignal<WalletCredentials | null>(
    null,
  )
  const [deriveCredentials, setDeriveCredentials] =
    createSignal<DeriveWalletCredentials | null>(null)
  const [networkMode, setNetworkModeState] = createSignal<NetworkMode>(
    getStoredNetworkMode(),
  )
  const [hasStoredSession, setHasStoredSession] = createSignal(
    storedSession !== null,
  )
  const [hasStoredDeriveSession, setHasStoredDeriveSession] = createSignal(
    storedDeriveSession !== null,
  )
  const [hasVerifiedSessionPin, setHasVerifiedSessionPin] = createSignal(false)
  const [HyperliquidClientClass, setHyperliquidClientClass] =
    createSignal<HyperliquidClientConstructor | null>(null)

  // Verified PIN for this SPA session only (never persisted). Cleared on full
  // disconnect / storage wipes for both venues.
  let sessionPin: string | null = null

  const rememberSessionPin = (pin: string) => {
    sessionPin = pin
    setHasVerifiedSessionPin(true)
  }

  const clearSessionPin = () => {
    sessionPin = null
    setHasVerifiedSessionPin(false)
  }

  const resolvePin = (
    pin: string | undefined,
  ): Effect.Effect<string, WalletConnectError> => {
    const resolved = pin ?? sessionPin
    if (resolved === null || resolved === "") {
      return Effect.fail(
        new WalletConnectError({
          cause: new Error("Local PIN is required"),
        }),
      )
    }
    return Effect.succeed(resolved)
  }

  const syncStoredSessionState = () => {
    setHasStoredSession(getStoredEncryptedSession() !== null)
    setHasStoredDeriveSession(getStoredEncryptedDeriveSession() !== null)
  }

  const isHyperliquidConnected = createMemo(() => mainAddress() !== null)
  const isDeriveConnected = createMemo(() => hasStoredDeriveSession())
  const isConnected = createMemo(
    () => isHyperliquidConnected() || isDeriveConnected(),
  )
  const isLocked = createMemo(
    () => hasStoredSession() && credentials() === null,
  )
  const isDeriveLocked = createMemo(
    () => hasStoredDeriveSession() && deriveCredentials() === null,
  )
  const canTrade = createMemo(() => credentials() !== null)

  const client = createMemo((): HyperliquidClient | null => {
    const Client = HyperliquidClientClass()
    if (Client === null) {
      return null
    }

    const unlocked = credentials()
    if (unlocked) {
      return new Client(unlocked, networkMode())
    }

    const address = mainAddress()
    if (!address) {
      return null
    }

    return new Client({ accountAddress: address }, networkMode())
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

  const validatePinAgainstStoredSessions = (
    pin: string,
  ): Effect.Effect<void, WalletUnlockFailure> => {
    const hyperliquidSession = getStoredEncryptedSession()
    const deriveSession = getStoredEncryptedDeriveSession()

    if (hyperliquidSession === null && deriveSession === null) {
      return Effect.void
    }

    return Effect.gen(function* () {
      if (hyperliquidSession !== null) {
        yield* decryptWalletPrivateKey(
          hyperliquidSession.encryptedPrivateKey,
          pin,
          hyperliquidSession.salt,
          hyperliquidSession.iv,
        )
      }

      if (deriveSession !== null) {
        yield* decryptWalletPrivateKey(
          deriveSession.encryptedPrivateKey,
          pin,
          deriveSession.salt,
          deriveSession.iv,
        )
      }
    }).pipe(Effect.asVoid)
  }

  const connect = (
    newCredentials: WalletCredentials,
    pin: string,
  ): Effect.Effect<void, WalletConnectError> =>
    validatePinAgainstStoredSessions(pin).pipe(
      Effect.mapError(cause => new WalletConnectError({ cause })),
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () => encryptWalletPrivateKey(newCredentials.privateKey, pin),
          catch: cause => new WalletConnectError({ cause }),
        }),
      ),
      Effect.tap(encrypted =>
        Effect.sync(() => {
          rememberSessionPin(pin)
          persistEncryptedSession(newCredentials, encrypted)
          setMainAddressState(newCredentials.accountAddress)
          setCredentials(newCredentials)
          syncStoredSessionState()
        }),
      ),
      Effect.asVoid,
    )

  const connectDerive = (
    input: {
      deriveWallet: string
      sessionPrivateKey: string
      subaccountId?: number | null
    },
    pin?: string,
  ): Effect.Effect<void, WalletConnectError> =>
    Effect.gen(function* () {
      const resolvedPin = yield* resolvePin(pin)

      yield* validatePinAgainstStoredSessions(resolvedPin).pipe(
        Effect.mapError(cause => new WalletConnectError({ cause })),
      )

      const deriveWallet = yield* normalizeDeriveWallet(
        input.deriveWallet,
      ).pipe(Effect.mapError(cause => new WalletConnectError({ cause })))
      const parsedKey = yield* parseSessionPrivateKey(
        input.sessionPrivateKey,
      ).pipe(Effect.mapError(cause => new WalletConnectError({ cause })))

      const encrypted = yield* Effect.tryPromise({
        try: () =>
          encryptWalletPrivateKey(parsedKey.sessionPrivateKey, resolvedPin),
        catch: cause => new WalletConnectError({ cause }),
      })

      const existing = getStoredEncryptedDeriveSession()
      const subaccountId =
        input.subaccountId !== undefined
          ? input.subaccountId
          : (existing?.subaccountId ?? null)

      const session: EncryptedDeriveSession = {
        deriveWallet,
        sessionAddress: parsedKey.sessionAddress,
        encryptedPrivateKey: encrypted.encryptedPrivateKey,
        salt: encrypted.salt,
        iv: encrypted.iv,
        subaccountId,
      }

      rememberSessionPin(resolvedPin)
      persistEncryptedDeriveSession(session)
      setDeriveCredentials(
        deriveCredentialsFromSession(session, parsedKey.sessionPrivateKey),
      )
      syncStoredSessionState()
    })

  /**
   * Generate agent + encrypt with PIN, then Reown-signed approveAgent.
   * Persists the encrypted session only after approval succeeds.
   * On approve failure any leftover encrypted session is cleared.
   */
  const authorizeAgent = (
    pin?: string,
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

      const resolvedPin = yield* resolvePin(pin)

      yield* validatePinAgainstStoredSessions(resolvedPin).pipe(
        Effect.mapError(cause => new WalletConnectError({ cause })),
      )

      const modal = yield* Effect.tryPromise({
        try: () => ensureEvmAppKit(),
        catch: cause => new WalletConnectError({ cause }),
      })
      const provider = modal ? readConnectedEip1193Provider(modal) : null
      if (!provider) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new Error("Reown wallet provider is unavailable"),
          }),
        )
      }

      const agentModule = yield* Effect.tryPromise({
        try: () => import("@/services/hyperliquidAgent"),
        catch: cause => new WalletConnectError({ cause }),
      })

      const agent = agentModule.generateHyperliquidAgent()
      const pendingCredentials: WalletCredentials = {
        accountAddress: address,
        apiWalletAddress: agent.agentAddress,
        privateKey: agent.agentPrivateKey,
      }

      const encrypted = yield* Effect.tryPromise({
        try: () =>
          encryptWalletPrivateKey(pendingCredentials.privateKey, resolvedPin),
        catch: cause => new WalletConnectError({ cause }),
      })

      const approveResult = yield* Effect.either(
        agentModule.approveHyperliquidAgent(
          provider,
          address,
          agent.agentAddress,
          mode,
        ),
      )

      if (Either.isLeft(approveResult)) {
        clearEncryptedSession()
        syncStoredSessionState()
        setCredentials(null)
        return yield* Effect.fail(
          new WalletConnectError({ cause: approveResult.left }),
        )
      }

      rememberSessionPin(resolvedPin)
      persistEncryptedSession(pendingCredentials, encrypted)
      syncStoredSessionState()
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

      const modal = yield* Effect.tryPromise({
        try: () => ensureEvmAppKit(),
        catch: cause => new WalletConnectError({ cause }),
      })
      const provider = modal ? readConnectedEip1193Provider(modal) : null
      if (!provider) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new Error("Reown wallet provider is unavailable"),
          }),
        )
      }

      const agentModule = yield* Effect.tryPromise({
        try: () => import("@/services/hyperliquidAgent"),
        catch: cause => new WalletConnectError({ cause }),
      })

      const revokeResult = yield* Effect.either(
        agentModule.revokeHyperliquidAgent(provider, address, mode),
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
    const hyperliquidSession = getStoredEncryptedSession()
    const deriveSession = getStoredEncryptedDeriveSession()

    if (hyperliquidSession === null && deriveSession === null) {
      return Effect.fail(new WalletSessionMissing())
    }

    return Effect.gen(function* () {
      if (hyperliquidSession !== null) {
        const privateKey = yield* decryptWalletPrivateKey(
          hyperliquidSession.encryptedPrivateKey,
          pin,
          hyperliquidSession.salt,
          hyperliquidSession.iv,
        )
        setMainAddressState(hyperliquidSession.accountAddress)
        setCredentials(credentialsFromSession(hyperliquidSession, privateKey))
      }

      if (deriveSession !== null) {
        const privateKey = yield* decryptWalletPrivateKey(
          deriveSession.encryptedPrivateKey,
          pin,
          deriveSession.salt,
          deriveSession.iv,
        )
        setDeriveCredentials(
          deriveCredentialsFromSession(
            deriveSession,
            privateKey as `0x${string}`,
          ),
        )
      }

      rememberSessionPin(pin)
    }).pipe(Effect.asVoid)
  }

  const disconnect = (): Effect.Effect<void, WalletDisconnectFailed> =>
    Effect.gen(function* () {
      const remoteDisconnect = Effect.gen(function* () {
        const modal = yield* Effect.tryPromise({
          try: () => ensureEvmAppKit(),
          catch: cause => new WalletDisconnectFailed({ cause }),
        })

        if (modal) {
          yield* Effect.tryPromise({
            try: () => modal.disconnect("eip155"),
            catch: cause => new WalletDisconnectFailed({ cause }),
          })
        }
      })

      const remoteResult = yield* Effect.either(remoteDisconnect)

      setCredentials(null)
      setMainAddressState(null)
      clearEncryptedSession()
      syncStoredSessionState()
      if (getStoredEncryptedDeriveSession() === null) {
        clearSessionPin()
      }

      if (Either.isLeft(remoteResult)) {
        return yield* Effect.fail(remoteResult.left)
      }
    })

  const disconnectDerive = (): Effect.Effect<void, WalletDisconnectFailed> => {
    // Snapshot before leaving the Solid reactive scope (Effect.sync is not tracked).
    const hyperliquidAddress = mainAddress()
    return Effect.sync(() => {
      setDeriveCredentials(null)
      clearEncryptedDeriveSession()
      syncStoredSessionState()
      if (getStoredEncryptedSession() === null && hyperliquidAddress === null) {
        clearSessionPin()
      }
    })
  }
  const setDeriveSubaccountId = (subaccountId: number | null) => {
    const stored = getStoredEncryptedDeriveSession()
    if (stored === null) {
      return
    }

    const nextSession: EncryptedDeriveSession = {
      ...stored,
      subaccountId,
    }
    persistEncryptedDeriveSession(nextSession)

    const unlocked = untrack(() => deriveCredentials())
    if (unlocked !== null) {
      setDeriveCredentials({
        ...unlocked,
        subaccountId,
      })
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
    if (event.key === DERIVE_WALLET_STORAGE_KEY) {
      setDeriveCredentials(null)
      syncStoredSessionState()
    }
    if (event.key === NETWORK_STORAGE_KEY) {
      setNetworkModeState(getStoredNetworkMode())
    }
  }

  onMount(() => {
    // Defer CCXT until after the first paint so dockview/UI can render without
    // competing with a ~500KB module download+eval on the same turn.
    const startClientLoad = () => {
      prefetchHyperliquidClientModule()
      void ensureHyperliquidClientModule()
        .then(clientModule => {
          setHyperliquidClientClass(() => clientModule.HyperliquidClient)
        })
        .catch((error: unknown) => {
          console.error("Failed to load Hyperliquid client module:", error)
        })
    }

    let idleCallbackId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let unsubscribeAccount: (() => void) | undefined
    let accountSubscriptionCancelled = false

    if (typeof window.requestIdleCallback === "function") {
      idleCallbackId = window.requestIdleCallback(startClientLoad, {
        timeout: 2_000,
      })
    } else {
      timeoutId = setTimeout(startClientLoad, 0)
    }

    window.addEventListener("storage", handleStorageChange)

    void ensureEvmAppKit()
      .then(modal => {
        if (accountSubscriptionCancelled || modal === null) {
          return
        }

        unsubscribeAccount = modal.subscribeAccount(accountState => {
          const nextAddress = readEvmAddressFromAccountState(accountState)
          const connected =
            readEvmWalletConnectedFromAccountState(accountState) ||
            nextAddress !== null

          if (connected && nextAddress !== null) {
            setMainAddress(nextAddress)
            return
          }

          const stored = getStoredWalletAddresses()
          setMainAddress(stored?.accountAddress ?? null)
        }, "eip155")
      })
      .catch((error: unknown) => {
        console.error("Failed to subscribe to wallet account changes:", error)
      })

    onCleanup(() => {
      accountSubscriptionCancelled = true
      unsubscribeAccount?.()
      if (idleCallbackId !== undefined) {
        window.cancelIdleCallback(idleCallbackId)
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      window.removeEventListener("storage", handleStorageChange)
    })
  })

  return (
    <WalletContext.Provider
      value={{
        mainAddress,
        credentials,
        deriveCredentials,
        networkMode,
        isConnected,
        isHyperliquidConnected,
        isDeriveConnected,
        isLocked,
        isDeriveLocked,
        hasStoredSession,
        hasStoredDeriveSession,
        hasVerifiedSessionPin,
        canTrade,
        client,
        connect,
        connectDerive,
        authorizeAgent,
        revokeAgent,
        unlock,
        disconnect,
        disconnectDerive,
        setNetworkMode,
        setMainAddress,
        setDeriveSubaccountId,
      }}
    >
      {props.children}
    </WalletContext.Provider>
  )
}
