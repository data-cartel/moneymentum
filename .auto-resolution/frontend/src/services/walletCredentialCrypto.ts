import * as Effect from "effect/Effect"

import {
  WalletCredentialCryptoFailure,
  WalletIncorrectPin,
  type WalletDecryptFailure,
} from "./wallet"

export const WALLET_PIN_LENGTH = 6
export const PBKDF2_ITERATIONS = 100_000

export interface EncryptedWalletPrivateKey {
  encryptedPrivateKey: string
  salt: string
  iv: string
}

export class WalletCredentialCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WalletCredentialCryptoError"
  }
}

export class WalletCredentialDecryptError extends WalletCredentialCryptoError {
  constructor() {
    super("incorrect pin")
    this.name = "WalletCredentialDecryptError"
  }
}

export const validateWalletPin = (pin: string): boolean =>
  pin.length === WALLET_PIN_LENGTH && /^\d+$/.test(pin)

export const normalizeWalletPinInput = (value: string): string =>
  value.replace(/\D/g, "").slice(0, WALLET_PIN_LENGTH)

const assertWebCrypto = (): Crypto => {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoApi?.subtle === undefined) {
    throw new WalletCredentialCryptoError("web crypto is unavailable")
  }
  return cryptoApi
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")

const HEX_BYTE_PATTERN = /^[0-9a-fA-F]{2}$/

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) {
    throw new WalletCredentialCryptoError("invalid hex encoding")
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = hex.slice(index * 2, index * 2 + 2)
    if (!HEX_BYTE_PATTERN.test(pair)) {
      throw new WalletCredentialCryptoError("invalid hex encoding")
    }
    bytes[index] = Number.parseInt(pair, 16)
  }

  return bytes
}

const deriveKey = async (pin: string, salt: Uint8Array): Promise<CryptoKey> => {
  const cryptoApi = assertWebCrypto()
  const encoder = new TextEncoder()
  const baseKey = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  )

  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

export const encryptWalletPrivateKey = async (
  privateKeyText: string,
  pin: string,
): Promise<EncryptedWalletPrivateKey> => {
  if (!validateWalletPin(pin)) {
    throw new WalletCredentialCryptoError(
      `pin must be exactly ${String(WALLET_PIN_LENGTH)} characters`,
    )
  }

  const cryptoApi = assertWebCrypto()
  const encoder = new TextEncoder()
  const salt = cryptoApi.getRandomValues(new Uint8Array(16))
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const cryptoKey = await deriveKey(pin, salt)

  const encrypted = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, // Без лишних оберток
    cryptoKey,
    encoder.encode(privateKeyText),
  )

  return {
    encryptedPrivateKey: bytesToHex(new Uint8Array(encrypted)),
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
  }
}

export const decryptWalletPrivateKey = (
  encryptedHex: string,
  pin: string,
  saltHex: string,
  ivHex: string,
): Effect.Effect<string, WalletDecryptFailure> => {
  if (!validateWalletPin(pin)) {
    return Effect.fail(
      new WalletCredentialCryptoFailure({
        cause: new WalletCredentialCryptoError(
          `pin must be exactly ${String(WALLET_PIN_LENGTH)} characters`,
        ),
      }),
    )
  }

  return Effect.tryPromise({
    try: async () => {
      const cryptoApi = assertWebCrypto()
      const decoder = new TextDecoder()

      try {
        const cryptoKey = await deriveKey(pin, hexToBytes(saltHex))
        const decrypted = await cryptoApi.subtle.decrypt(
          { name: "AES-GCM", iv: hexToBytes(ivHex) },
          cryptoKey,
          hexToBytes(encryptedHex),
        )
        return decoder.decode(decrypted)
      } catch (error) {
        if (error instanceof WalletCredentialCryptoError) {
          throw error
        }
        throw new WalletCredentialDecryptError()
      }
    },
    catch: cause => {
      if (cause instanceof WalletCredentialDecryptError) {
        return new WalletIncorrectPin()
      }
      return new WalletCredentialCryptoFailure({ cause })
    },
  })
}
