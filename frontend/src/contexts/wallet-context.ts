import { createContext, type Accessor } from "solid-js"
import type * as Effect from "effect/Effect"
import type { HyperliquidClient } from "@/services/hyperliquid-client"
import type {
  WalletConnectError,
  WalletDisconnectFailed,
  WalletUnlockFailure,
} from "@/services/wallet"

export type NetworkMode = "testnet" | "mainnet"

export type PortfolioVenueId = "hyperliquid" | "derive"

export interface WalletCredentials {
  accountAddress: string // Main wallet where positions/funds are
  apiWalletAddress: string // API wallet authorized to trade
  privateKey: string // Private key of the API wallet
}

/** Unlocked Derive Developers session (session key plaintext in memory only). */
export interface DeriveWalletCredentials {
  deriveWallet: string
  sessionAddress: string
  sessionPrivateKey: `0x${string}`
  subaccountId: number | null
}

export interface WalletContextType {
  /** Public main wallet address from Reown (or restored agent session). */
  mainAddress: Accessor<string | null>
  credentials: Accessor<WalletCredentials | null>
  /** Unlocked Derive session credentials, or null when locked / disconnected. */
  deriveCredentials: Accessor<DeriveWalletCredentials | null>
  networkMode: Accessor<NetworkMode>
  /**
   * True when any venue is available (HL main address or stored Derive
   * session). Prefer venue-specific flags for exchange queries.
   */
  isConnected: Accessor<boolean>
  /** True when a Reown / stored HL main address is available. */
  isHyperliquidConnected: Accessor<boolean>
  /** True when an encrypted Derive session is stored (locked or unlocked). */
  isDeriveConnected: Accessor<boolean>
  /** True when an encrypted HL agent session exists but the key is not in memory. */
  isLocked: Accessor<boolean>
  /** True when an encrypted Derive session exists but the key is not in memory. */
  isDeriveLocked: Accessor<boolean>
  /** True when an encrypted Hyperliquid agent session is stored. */
  hasStoredSession: Accessor<boolean>
  /** True when an encrypted Derive session is stored. */
  hasStoredDeriveSession: Accessor<boolean>
  /** True when the agent private key is unlocked in memory (can submit HL trades). */
  canTrade: Accessor<boolean>
  /**
   * True when this browser tab has already verified the shared local PIN
   * (connect / unlock / authorize) and can reuse it without re-prompting.
   */
  hasVerifiedSessionPin: Accessor<boolean>
  client: Accessor<HyperliquidClient | null>
  /** Persist agent credentials encrypted with the local PIN (legacy + agent flows). */
  connect: (
    credentials: WalletCredentials,
    pin: string,
  ) => Effect.Effect<void, WalletConnectError>
  /**
   * Persist a Derive Developers session encrypted with the shared local PIN.
   * Pass `pin` when creating the first PIN or when the session PIN is unknown;
   * omit it to reuse the in-memory verified PIN.
   */
  connectDerive: (
    input: {
      deriveWallet: string
      sessionPrivateKey: string
      subaccountId?: number | null
    },
    pin?: string,
  ) => Effect.Effect<void, WalletConnectError>
  /**
   * Generate a Hyperliquid API agent, encrypt it with the PIN, then ask the
   * connected Reown wallet to approveAgent. Omitting `pin` reuses the
   * in-memory verified PIN when available.
   */
  authorizeAgent: (pin?: string) => Effect.Effect<void, WalletConnectError>
  /**
   * Ask the connected Reown wallet to revoke Moneymentum's Hyperliquid agent
   * on-chain, then clear the local encrypted agent session.
   */
  revokeAgent: () => Effect.Effect<void, WalletConnectError>
  /** Unlock all stored venue sessions that share this PIN. */
  unlock: (pin: string) => Effect.Effect<void, WalletUnlockFailure>
  /** Disconnect Hyperliquid (Reown + local agent session). */
  disconnect: () => Effect.Effect<void, WalletDisconnectFailed>
  /** Clear the local encrypted Derive session. */
  disconnectDerive: () => Effect.Effect<void, WalletDisconnectFailed>
  setNetworkMode: (mode: NetworkMode) => void
  /** Sync the Reown-connected main address into wallet state (read-only). */
  setMainAddress: (address: string | null) => void
  /** Persist the selected Derive subaccount id (encrypted blob metadata). */
  setDeriveSubaccountId: (subaccountId: number | null) => void
}

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined,
)

export const WALLET_STORAGE_KEY = "hyperliquid-wallet"
export const DERIVE_WALLET_STORAGE_KEY = "derive-wallet"
export const NETWORK_STORAGE_KEY = "hyperliquid-network"

export interface EncryptedWalletSession {
  accountAddress: string
  apiWalletAddress: string
  encryptedPrivateKey: string
  salt: string
  iv: string
}

export interface EncryptedDeriveSession {
  deriveWallet: string
  sessionAddress: string
  encryptedPrivateKey: string
  salt: string
  iv: string
  subaccountId: number | null
}

const HEX_ENCODING_PATTERN = /^[0-9a-fA-F]+$/
const SALT_BYTE_LENGTH = 16
const IV_BYTE_LENGTH = 12

const isHexEncoding = (value: string): boolean =>
  value.length > 0 && HEX_ENCODING_PATTERN.test(value)

const isFixedLengthHex = (value: string, byteLength: number): boolean =>
  value.length === byteLength * 2 && isHexEncoding(value)

const isEncryptedSession = (
  value: unknown,
): value is EncryptedWalletSession => {
  if (!value || typeof value !== "object") {
    return false
  }

  const sessionCandidate = value as Record<string, unknown>

  if (
    typeof sessionCandidate.accountAddress !== "string" ||
    sessionCandidate.accountAddress === "" ||
    typeof sessionCandidate.apiWalletAddress !== "string" ||
    sessionCandidate.apiWalletAddress === "" ||
    typeof sessionCandidate.encryptedPrivateKey !== "string" ||
    typeof sessionCandidate.salt !== "string" ||
    typeof sessionCandidate.iv !== "string"
  ) {
    return false
  }

  const { encryptedPrivateKey, salt, iv } = sessionCandidate

  return (
    isHexEncoding(encryptedPrivateKey) &&
    encryptedPrivateKey.length % 2 === 0 &&
    isFixedLengthHex(salt, SALT_BYTE_LENGTH) &&
    isFixedLengthHex(iv, IV_BYTE_LENGTH)
  )
}

const isEncryptedDeriveSession = (
  value: unknown,
): value is EncryptedDeriveSession => {
  if (!value || typeof value !== "object") {
    return false
  }

  const sessionCandidate = value as Record<string, unknown>

  if (
    typeof sessionCandidate.deriveWallet !== "string" ||
    sessionCandidate.deriveWallet === "" ||
    typeof sessionCandidate.sessionAddress !== "string" ||
    sessionCandidate.sessionAddress === "" ||
    typeof sessionCandidate.encryptedPrivateKey !== "string" ||
    typeof sessionCandidate.salt !== "string" ||
    typeof sessionCandidate.iv !== "string"
  ) {
    return false
  }

  const subaccountId = sessionCandidate.subaccountId
  if (
    subaccountId !== null &&
    (typeof subaccountId !== "number" || !Number.isInteger(subaccountId))
  ) {
    return false
  }

  const { encryptedPrivateKey, salt, iv } = sessionCandidate

  return (
    isHexEncoding(encryptedPrivateKey) &&
    encryptedPrivateKey.length % 2 === 0 &&
    isFixedLengthHex(salt, SALT_BYTE_LENGTH) &&
    isFixedLengthHex(iv, IV_BYTE_LENGTH)
  )
}

export const getStoredEncryptedSession = (): EncryptedWalletSession | null => {
  try {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY)
    if (!stored) return null

    const parsed: unknown = JSON.parse(stored)
    return isEncryptedSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const getStoredEncryptedDeriveSession =
  (): EncryptedDeriveSession | null => {
    try {
      const stored = localStorage.getItem(DERIVE_WALLET_STORAGE_KEY)
      if (!stored) return null

      const parsed: unknown = JSON.parse(stored)
      return isEncryptedDeriveSession(parsed) ? parsed : null
    } catch {
      return null
    }
  }

export const getStoredWalletAddresses = (): Pick<
  EncryptedWalletSession,
  "accountAddress" | "apiWalletAddress"
> | null => {
  const session = getStoredEncryptedSession()
  if (!session) return null

  return {
    accountAddress: session.accountAddress,
    apiWalletAddress: session.apiWalletAddress,
  }
}

export const getStoredNetworkMode = (): NetworkMode => {
  const stored = localStorage.getItem(NETWORK_STORAGE_KEY)
  if (stored === "mainnet" || stored === "testnet") {
    return stored
  }
  return "testnet"
}

/** True when any encrypted venue session exists (shared PIN already chosen). */
export const hasSharedWalletPin = (): boolean =>
  getStoredEncryptedSession() !== null ||
  getStoredEncryptedDeriveSession() !== null
