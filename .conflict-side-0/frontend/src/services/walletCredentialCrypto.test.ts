import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"

import { WalletCredentialCryptoFailure, WalletIncorrectPin } from "./wallet"
import {
  decryptWalletPrivateKey,
  encryptWalletPrivateKey,
  normalizeWalletPinInput,
  validateWalletPin,
  WALLET_PIN_LENGTH,
} from "./walletCredentialCrypto"

const failureError = async <ErrorType>(
  effect: Effect.Effect<unknown, ErrorType>,
): Promise<ErrorType> => {
  const exit = await Effect.runPromiseExit(effect)
  if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
    return exit.cause.error
  }
  throw new Error(`expected a tagged failure, got: ${JSON.stringify(exit)}`)
}

describe("walletCredentialCrypto", () => {
  it("round-trips a private key with the same pin", async () => {
    const privateKey = "0xabc123privatekey"
    const pin = "654321"

    const encrypted = await encryptWalletPrivateKey(privateKey, pin)
    const decrypted = await Effect.runPromise(
      decryptWalletPrivateKey(
        encrypted.encryptedPrivateKey,
        pin,
        encrypted.salt,
        encrypted.iv,
      ),
    )

    expect(decrypted).toBe(privateKey)
    expect(encrypted.encryptedPrivateKey).not.toContain(privateKey)
  })

  it("accepts only six numeric digits as a valid pin", () => {
    expect(validateWalletPin("123456")).toBe(true)
    expect(validateWalletPin("12ab34")).toBe(false)
    expect(validateWalletPin("12 345")).toBe(false)
    expect(validateWalletPin("12345")).toBe(false)
    expect(validateWalletPin("1234567")).toBe(false)
  })

  it("strips non-digit characters before truncating pin input", () => {
    expect(normalizeWalletPinInput("12ab34")).toBe("1234")
    expect(normalizeWalletPinInput("12 345")).toBe("12345")
    expect(normalizeWalletPinInput("1234567890")).toBe("123456")
  })

  it("rejects pins that are not exactly six digits", async () => {
    const shortPin = "1".repeat(WALLET_PIN_LENGTH - 1)
    const longPin = "1".repeat(WALLET_PIN_LENGTH + 1)

    await expect(
      encryptWalletPrivateKey("0xsecret", shortPin),
    ).rejects.toMatchObject({
      name: "WalletCredentialCryptoError",
    })
    await expect(
      encryptWalletPrivateKey("0xsecret", longPin),
    ).rejects.toMatchObject({
      name: "WalletCredentialCryptoError",
    })
    await expect(
      encryptWalletPrivateKey("0xsecret", "12ab34"),
    ).rejects.toMatchObject({
      name: "WalletCredentialCryptoError",
    })
  })

  it("rejects decryption with malformed hex encodings", async () => {
    const encrypted = await encryptWalletPrivateKey("0xsecret", "123456")

    const error = await failureError(
      decryptWalletPrivateKey(
        encrypted.encryptedPrivateKey,
        "123456",
        `${encrypted.salt.slice(0, 30)}fg`,
        encrypted.iv,
      ),
    )

    expect(error).toBeInstanceOf(WalletCredentialCryptoFailure)
    expect(error._tag).toBe("WalletCredentialCryptoFailure")
  })

  it("rejects decryption with the wrong pin", async () => {
    const encrypted = await encryptWalletPrivateKey("0xsecret", "123456")

    const error = await failureError(
      decryptWalletPrivateKey(
        encrypted.encryptedPrivateKey,
        "999999",
        encrypted.salt,
        encrypted.iv,
      ),
    )

    expect(error).toBeInstanceOf(WalletIncorrectPin)
    expect(error._tag).toBe("WalletIncorrectPin")
  })

  it("produces different ciphertext for the same key on each encryption", async () => {
    const first = await encryptWalletPrivateKey("0xsecret", "123456")
    const second = await encryptWalletPrivateKey("0xsecret", "123456")

    expect(first.encryptedPrivateKey).not.toBe(second.encryptedPrivateKey)
    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
  })
})
