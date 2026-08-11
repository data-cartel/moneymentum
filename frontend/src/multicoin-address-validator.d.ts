declare module "multicoin-address-validator" {
  interface WalletAddressValidator {
    validate(
      address: string,
      currencyNameOrSymbol: string,
      networkType?: "prod" | "testnet",
    ): boolean
  }

  const validator: WalletAddressValidator
  export default validator
}
