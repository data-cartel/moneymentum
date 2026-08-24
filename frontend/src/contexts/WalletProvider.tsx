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
  MAIN_ADDRESS_STORAGE_KEY,
  getStoredEncryptedSession,
  getStoredEncryptedDeriveSession,
  getStoredNetworkMode,
  getRememberedMainAddress,
  rememberMainAddress,
  clearRememberedMainAddress,
  resolvePersistedMainAddress,
  type EncryptedDeriveSession,
  type EncryptedWalletSession,
  type DeriveWalletCredentials,
  type HyperliquidClientLoad,
  type NetworkMode,
  type WalletCredentials,
} from "./wallet-context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import {
  HyperliquidClientLoadFailed,
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
  networkMode: session.networkMode,
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
  const leftMissing = left === null || left === undefined
  const rightMissing = right === null || right === undefined
  if (leftMissing || rightMissing) {
    return leftMissing && rightMissing
  }

  return left.toLowerCase() === right.toLowerCase()
}

type HyperliquidClientConstructor =
  typeof import("@/services/hyperliquid-client").HyperliquidClient

export const WalletProvider = (props: ParentProps) => {
  const storedSession = getStoredEncryptedSession()
  const storedDeriveSession = getStoredEncryptedDeriveSession()
  const [mainAddress, setMainAddressState] = createSignal<string | null>(
    resolvePersistedMainAddress(),
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
  const [deriveSessionNetworkMode, setDeriveSessionNetworkMode] =
    createSignal<NetworkMode | null>(storedDeriveSession?.networkMode ?? null)
  const [hasVerifiedSessionPin, setHasVerifiedSessionPin] = createSignal(false)
  const [HyperliquidClientClass, setHyperliquidClientClass] =
    createSignal<HyperliquidClientConstructor | null>(null)
  const [hyperliquidClientLoad, setHyperliquidClientLoad] =
    createSignal<HyperliquidClientLoad>({ state: "loading" })
  let walletContextRevision = 0
  let activeWalletOperation: symbol | null = null

  // Verified PIN for this SPA session only (never persisted). Cleared on full
  // disconnect / storage wipes for both venues.
  let sessionPin: string | null = null

  const markWalletContextChanged = () => {
    walletContextRevision += 1
  }

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
    const deriveSession = getStoredEncryptedDeriveSession()
    setHasStoredDeriveSession(deriveSession !== null)
    setDeriveSessionNetworkMode(deriveSession?.networkMode ?? null)
  }

  const isHyperliquidConnected = createMemo(() => mainAddress() !== null)
  const isDeriveConnected = createMemo(
    () =>
      hasStoredDeriveSession() && deriveSessionNetworkMode() === networkMode(),
  )
  const isConnected = createMemo(
    () => isHyperliquidConnected() || isDeriveConnected(),
  )
  const isLocked = createMemo(
    () => hasStoredSession() && credentials() === null,
  )
  const isDeriveLocked = createMemo(
    () => isDeriveConnected() && deriveCredentials() === null,
  )

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

  // Unlocked credentials alone cannot place orders: the client module loads
  // lazily, so trading only becomes possible once that client exists.
  const canTrade = createMemo(() => credentials() !== null && client() !== null)

  const loadHyperliquidClientModule = () => {
    setHyperliquidClientLoad({ state: "loading" })
    prefetchHyperliquidClientModule()
    void ensureHyperliquidClientModule()
      .then(clientModule => {
        setHyperliquidClientClass(() => clientModule.HyperliquidClient)
        setHyperliquidClientLoad({ state: "ready" })
      })
      .catch((cause: unknown) => {
        setHyperliquidClientLoad({
          state: "failed",
          error: new HyperliquidClientLoadFailed({ cause }),
        })
      })
  }

  const retryHyperliquidClientLoad = () => {
    if (hyperliquidClientLoad().state !== "failed") {
      return
    }
    loadHyperliquidClientModule()
  }

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

    // Only wipe the encrypted agent when switching to a *different* account.
    // Transient Reown disconnect (null) must not clear a stored agent or the
    // remembered public address -- AppKit has enableReconnect: false and often
    // emits disconnected right after Connect closes.
    if (address !== null) {
      const stored = getStoredEncryptedSession()
      if (
        stored !== null &&
        !sameWalletAddress(stored.accountAddress, address)
      ) {
        clearEncryptedSession()
        syncStoredSessionState()
      }
      rememberMainAddress(address)
      setMainAddressState(address)
      return
    }

    setMainAddressState(null)
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
  ): Effect.Effect<void, WalletConnectError> => {
    const contextRevision = walletContextRevision

    return validatePinAgainstStoredSessions(pin).pipe(
      Effect.mapError(cause => new WalletConnectError({ cause })),
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () => encryptWalletPrivateKey(newCredentials.privateKey, pin),
          catch: cause => new WalletConnectError({ cause }),
        }),
      ),
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
          rememberSessionPin(pin)
          persistEncryptedSession(newCredentials, encrypted)
          rememberMainAddress(newCredentials.accountAddress)
          setMainAddressState(newCredentials.accountAddress)
          setCredentials(newCredentials)
          syncStoredSessionState()
        })
      }),
      Effect.asVoid,
    )
  }

  const connectDerive = (
    input: {
      deriveWallet: string
      sessionPrivateKey: string
      subaccountId?: number | null
    },
    pin?: string,
  ): Effect.Effect<void, WalletConnectError> => {
    const mode = networkMode()
    const contextRevision = walletContextRevision

    return Effect.gen(function* () {
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

      if (walletContextRevision !== contextRevision) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletConnectionContextChanged(),
          }),
        )
      }

      const existing = getStoredEncryptedDeriveSession()
      const subaccountId =
        input.subaccountId !== undefined
          ? input.subaccountId
          : existing?.networkMode === mode
            ? (existing.subaccountId ?? null)
            : null

      const session: EncryptedDeriveSession = {
        deriveWallet,
        sessionAddress: parsedKey.sessionAddress,
        encryptedPrivateKey: encrypted.encryptedPrivateKey,
        salt: encrypted.salt,
        iv: encrypted.iv,
        subaccountId,
        networkMode: mode,
      }

      markWalletContextChanged()
      rememberSessionPin(resolvedPin)
      persistEncryptedDeriveSession(session)
      setDeriveCredentials(
        deriveCredentialsFromSession(session, parsedKey.sessionPrivateKey),
      )
      syncStoredSessionState()
    })
  }

  /**
   * PIN -> generate agent -> encrypt in memory -> approveAgent via Reown.
   * Persists the generated encrypted session only after approval succeeds.
   * Approval failure never mutates an existing encrypted session.
   */
  // Called only from UI event handlers; its signal snapshots deliberately bind
  // one authorization attempt to the account and network that started it.
  const authorizeAgent = (
    pin?: string,
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

      const resolvedPin = yield* resolvePin(pin)

      yield* validatePinAgainstStoredSessions(resolvedPin).pipe(
        Effect.mapError(cause => new WalletConnectError({ cause })),
      )

      const agentModule = yield* Effect.tryPromise({
        try: () => import("@/services/hyperliquidAgent"),
        catch: cause => new WalletConnectError({ cause }),
      })

      if (!address) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new agentModule.ReownWalletUnavailable(),
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
            cause: new agentModule.ReownWalletUnavailable(),
          }),
        )
      }

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

      if (walletContextRevision !== contextRevision) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new WalletAuthorizationContextChanged(),
          }),
        )
      }

      const approveResult = yield* Effect.either(
        agentModule.approveHyperliquidAgent(
          provider,
          address,
          agent.agentAddress,
          mode,
        ),
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
      rememberSessionPin(resolvedPin)
      persistEncryptedSession(pendingCredentials, encrypted)
      rememberMainAddress(pendingCredentials.accountAddress)
      setMainAddressState(pendingCredentials.accountAddress)
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

      const agentModule = yield* Effect.tryPromise({
        try: () => import("@/services/hyperliquidAgent"),
        catch: cause => new WalletConnectError({ cause }),
      })

      if (!address) {
        return yield* Effect.fail(
          new WalletConnectError({
            cause: new agentModule.ReownWalletUnavailable(),
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
            cause: new agentModule.ReownWalletUnavailable(),
          }),
        )
      }

      const revokeResult = yield* Effect.either(
        agentModule.revokeHyperliquidAgent(provider, address, mode),
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
    const hyperliquidSession = getStoredEncryptedSession()
    const deriveSession = getStoredEncryptedDeriveSession()

    if (hyperliquidSession === null && deriveSession === null) {
      return Effect.fail(new WalletSessionMissing())
    }
    const contextRevision = walletContextRevision

    return Effect.gen(function* () {
      let hyperliquidPrivateKey: string | null = null
      let derivePrivateKey: string | null = null

      if (hyperliquidSession !== null) {
        hyperliquidPrivateKey = yield* decryptWalletPrivateKey(
          hyperliquidSession.encryptedPrivateKey,
          pin,
          hyperliquidSession.salt,
          hyperliquidSession.iv,
        )
      }

      if (deriveSession !== null) {
        derivePrivateKey = yield* decryptWalletPrivateKey(
          deriveSession.encryptedPrivateKey,
          pin,
          deriveSession.salt,
          deriveSession.iv,
        )
      }

      if (walletContextRevision !== contextRevision) {
        return yield* Effect.fail(new WalletUnlockContextChanged())
      }

      markWalletContextChanged()

      if (hyperliquidSession !== null && hyperliquidPrivateKey !== null) {
        rememberMainAddress(hyperliquidSession.accountAddress)
        setMainAddressState(hyperliquidSession.accountAddress)
        setCredentials(
          credentialsFromSession(hyperliquidSession, hyperliquidPrivateKey),
        )
      }

      if (deriveSession !== null && derivePrivateKey !== null) {
        setDeriveCredentials(
          deriveCredentialsFromSession(
            deriveSession,
            derivePrivateKey as `0x${string}`,
          ),
        )
      }

      rememberSessionPin(pin)
    }).pipe(Effect.asVoid)
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

      const revisionUnchanged = walletContextRevision === contextRevision
      const expectedDisconnectCallback =
        walletContextRevision === contextRevision + 1 && mainAddress() === null
      if (!revisionUnchanged && !expectedDisconnectCallback) {
        return yield* Effect.fail(new WalletDisconnectContextChanged())
      }

      markWalletContextChanged()
      setCredentials(null)
      setMainAddressState(null)
      clearRememberedMainAddress()
      clearEncryptedSession()
      syncStoredSessionState()
      if (getStoredEncryptedDeriveSession() === null) {
        clearSessionPin()
      }
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

  const disconnectDerive = (): Effect.Effect<void, WalletDisconnectFailed> => {
    const hyperliquidAddress = mainAddress()
    return Effect.sync(() => {
      markWalletContextChanged()
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
    if (stored?.networkMode !== networkMode()) {
      return
    }
    const nextSession: EncryptedDeriveSession = {
      ...stored,
      subaccountId,
    }
    persistEncryptedDeriveSession(nextSession)
    syncStoredSessionState()
    const unlocked = untrack(() => deriveCredentials())
    if (unlocked !== null && unlocked.networkMode === networkMode()) {
      setDeriveCredentials({
        ...unlocked,
        subaccountId,
      })
    }
  }

  const setNetworkMode = (mode: NetworkMode) => {
    if (networkMode() !== mode) {
      markWalletContextChanged()
    }
    setNetworkModeState(mode)
    localStorage.setItem(NETWORK_STORAGE_KEY, mode)
    const unlocked = untrack(() => deriveCredentials())
    if (unlocked !== null && unlocked.networkMode !== mode) {
      setDeriveCredentials(null)
    }
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === WALLET_STORAGE_KEY) {
      markWalletContextChanged()
      setCredentials(null)
      const nextSession = getStoredEncryptedSession()
      syncStoredSessionState()
      if (nextSession) {
        rememberMainAddress(nextSession.accountAddress)
        setMainAddressState(nextSession.accountAddress)
      }
    }
    if (event.key === MAIN_ADDRESS_STORAGE_KEY) {
      const remembered = getRememberedMainAddress()
      if (!sameWalletAddress(mainAddress(), remembered)) {
        markWalletContextChanged()
      }
      if (remembered !== null) {
        setMainAddressState(remembered)
      } else if (getStoredEncryptedSession() === null) {
        setMainAddressState(null)
      }
    }
    if (event.key === DERIVE_WALLET_STORAGE_KEY) {
      markWalletContextChanged()
      setDeriveCredentials(null)
      syncStoredSessionState()
    }
    if (event.key === NETWORK_STORAGE_KEY) {
      const storedNetworkMode = getStoredNetworkMode()
      if (networkMode() !== storedNetworkMode) {
        markWalletContextChanged()
      }
      setNetworkModeState(storedNetworkMode)
      const unlocked = untrack(() => deriveCredentials())
      if (unlocked !== null && unlocked.networkMode !== storedNetworkMode) {
        setDeriveCredentials(null)
      }
    }
  }

  onMount(() => {
    let idleCallbackId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let unsubscribeAccount: (() => void) | undefined
    let accountSubscriptionCancelled = false

    // Defer CCXT until after the first paint so dockview/UI can render without
    // competing with a ~500KB module download+eval on the same turn.
    if (typeof window.requestIdleCallback === "function") {
      idleCallbackId = window.requestIdleCallback(loadHyperliquidClientModule, {
        timeout: 2_000,
      })
    } else {
      timeoutId = setTimeout(loadHyperliquidClientModule, 0)
    }

    window.addEventListener("storage", handleStorageChange)

    // AppKit resolve/subscribe run outside Solid's tracked scope; signal writes
    // intentionally apply when each account event arrives.
    void ensureEvmAppKit()
      // eslint-disable-next-line solid/reactivity -- external AppKit callback
      .then(modal => {
        if (accountSubscriptionCancelled || modal === null) {
          return
        }

        const existingAddress =
          modal.getAddress("eip155") ?? resolvePersistedMainAddress()
        if (existingAddress) {
          setMainAddress(existingAddress)
        }

        unsubscribeAccount = modal.subscribeAccount(
          // eslint-disable-next-line solid/reactivity -- external AppKit callback
          accountState => {
            const nextAddress = readEvmAddressFromAccountState(accountState)
            const connected =
              readEvmWalletConnectedFromAccountState(accountState) ||
              nextAddress !== null

            if (connected && nextAddress !== null) {
              setMainAddress(nextAddress)
              return
            }

            const currentProviderAddress = modal.getAddress("eip155") ?? null
            if (currentProviderAddress !== null) {
              setMainAddress(currentProviderAddress)
              return
            }

            // Transient AppKit disconnect (enableReconnect is false): keep the
            // remembered / in-memory public account. Explicit disconnect()
            // clears storage itself -- do not call setMainAddress(null) here
            // or we race the disconnect revision check and wipe the agent.
            const persisted = resolvePersistedMainAddress()
            const current = untrack(() => mainAddress())
            if (persisted !== null || current !== null) {
              return
            }

            setMainAddress(null)
          },
          "eip155",
        )
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
        hyperliquidClientLoad,
        retryHyperliquidClientLoad,
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
