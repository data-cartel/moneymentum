import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"

import {
  EMPTY_BITCOIN_ADDRESS_MESSAGE,
  INVALID_BITCOIN_ADDRESS_MESSAGE,
  MAINNET_ADDRESS_ON_TESTNET_MESSAGE,
  TESTNET_ADDRESS_ON_MAINNET_MESSAGE,
  validateBitcoinAddress,
  type BitcoinAddressKind,
} from "./bitcoinAddress"
import type { NetworkMode } from "@/contexts/wallet-context"

interface ValidAddressCase {
  address: string
  network: NetworkMode
  kind: BitcoinAddressKind
}

const validAddressCases: ValidAddressCase[] = [
  {
    address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
    network: "mainnet",
    kind: "p2pkh",
  },
  {
    address: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    network: "mainnet",
    kind: "p2sh",
  },
  {
    address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    network: "mainnet",
    kind: "bech32",
  },
  {
    address: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
    network: "testnet",
    kind: "p2pkh",
  },
  {
    address: "2N2JD6wb56AfK4tfmM6PwdVmoYk2dCKf4Br",
    network: "testnet",
    kind: "p2sh",
  },
  {
    address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    network: "testnet",
    kind: "bech32",
  },
]

describe("validateBitcoinAddress", () => {
  it.each(validAddressCases)(
    "accepts $kind addresses on $network",
    async validAddressCase => {
      await expect(
        Effect.runPromise(
          validateBitcoinAddress(
            validAddressCase.address,
            validAddressCase.network,
          ),
        ),
      ).resolves.toEqual({
        ok: true,
        kind: validAddressCase.kind,
      })
    },
  )

  it("rejects empty addresses with the exact empty-address message", async () => {
    const validation = await Effect.runPromise(
      validateBitcoinAddress("   ", "mainnet"),
    )

    expect(validation).toEqual({
      ok: false,
      error: {
        kind: "empty",
        message: EMPTY_BITCOIN_ADDRESS_MESSAGE,
      },
    })
  })

  it("rejects truncated addresses with the exact UI error message", async () => {
    const validation = await Effect.runPromise(
      validateBitcoinAddress("1BoatSLR", "mainnet"),
    )

    expect(validation).toEqual({
      ok: false,
      error: {
        kind: "invalid",
        message: INVALID_BITCOIN_ADDRESS_MESSAGE,
      },
    })
  })

  it("rejects wrong checksums with the exact UI error message", async () => {
    const validation = await Effect.runPromise(
      validateBitcoinAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyU", "mainnet"),
    )

    expect(validation).toEqual({
      ok: false,
      error: {
        kind: "invalid",
        message: INVALID_BITCOIN_ADDRESS_MESSAGE,
      },
    })
  })

  it("rejects testnet addresses on mainnet with the exact network mismatch message", async () => {
    const validation = await Effect.runPromise(
      validateBitcoinAddress("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", "mainnet"),
    )

    expect(validation).toEqual({
      ok: false,
      error: {
        kind: "wrong_network",
        message: TESTNET_ADDRESS_ON_MAINNET_MESSAGE,
      },
    })
  })

  it("rejects mainnet addresses on testnet with the exact network mismatch message", async () => {
    const validation = await Effect.runPromise(
      validateBitcoinAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "testnet"),
    )

    expect(validation).toEqual({
      ok: false,
      error: {
        kind: "wrong_network",
        message: MAINNET_ADDRESS_ON_TESTNET_MESSAGE,
      },
    })
  })
})
