import WAValidator from "multicoin-address-validator"

import type { NetworkMode } from "@/contexts/wallet-context"

export const INVALID_BITCOIN_ADDRESS_MESSAGE = "Invalid Bitcoin address"
export const EMPTY_BITCOIN_ADDRESS_MESSAGE = "Bitcoin address is required."
export const MAINNET_ADDRESS_ON_TESTNET_MESSAGE =
  "This is a mainnet Bitcoin address, but the active network is testnet."
export const TESTNET_ADDRESS_ON_MAINNET_MESSAGE =
  "This is a testnet Bitcoin address, but the active network is mainnet."

export type BitcoinAddressKind = "p2pkh" | "p2sh" | "bech32"

export type BitcoinAddressValidationErrorKind =
  | "empty"
  | "invalid"
  | "wrong_network"

export interface BitcoinAddressValidationError {
  kind: BitcoinAddressValidationErrorKind
  message: string
}

export type BitcoinAddressValidationResult =
  | { ok: true; kind: BitcoinAddressKind }
  | { ok: false; error: BitcoinAddressValidationError }

const validatorNetwork = (network: NetworkMode): "prod" | "testnet" =>
  network === "mainnet" ? "prod" : "testnet"

const oppositeNetwork = (network: NetworkMode): NetworkMode =>
  network === "mainnet" ? "testnet" : "mainnet"

const wrongNetworkMessage = (addressNetwork: NetworkMode): string =>
  addressNetwork === "mainnet"
    ? MAINNET_ADDRESS_ON_TESTNET_MESSAGE
    : TESTNET_ADDRESS_ON_MAINNET_MESSAGE

const invalid = (
  kind: BitcoinAddressValidationErrorKind,
  message = INVALID_BITCOIN_ADDRESS_MESSAGE,
): BitcoinAddressValidationResult => ({
  ok: false,
  error: { kind, message },
})

const addressKind = (
  address: string,
  network: NetworkMode,
): BitcoinAddressKind => {
  const normalizedAddress = address.toLowerCase()
  if (
    normalizedAddress.startsWith("bc1") ||
    normalizedAddress.startsWith("tb1")
  ) {
    return "bech32"
  }
  if (network === "mainnet" && address.startsWith("1")) return "p2pkh"
  if (network === "testnet" && /^[mn]/.test(address)) return "p2pkh"
  return "p2sh"
}

export const validateBitcoinAddress = (
  address: string,
  network: NetworkMode,
): BitcoinAddressValidationResult => {
  const normalizedAddress = address.trim()
  if (normalizedAddress.length === 0) {
    return invalid("empty", EMPTY_BITCOIN_ADDRESS_MESSAGE)
  }

  const isValid = WAValidator.validate(
    normalizedAddress,
    "BTC",
    validatorNetwork(network),
  )
  if (!isValid) {
    const otherNetwork = oppositeNetwork(network)
    const isValidOnOtherNetwork = WAValidator.validate(
      normalizedAddress,
      "BTC",
      validatorNetwork(otherNetwork),
    )
    if (isValidOnOtherNetwork) {
      return invalid("wrong_network", wrongNetworkMessage(otherNetwork))
    }
    return invalid("invalid")
  }

  return { ok: true, kind: addressKind(normalizedAddress, network) }
}
