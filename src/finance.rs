//! Financial domain types for cross-exchange data normalization.
//!
//! Exchanges use inconsistent naming conventions for the same assets:
//! - Hyperliquid uses base symbol: `BTC`
//! - CCXT derivatives use full notation: `BTC/USDC:USDC`
//!
//! [`Symbol`] normalizes these representations for consistent storage and lookup.
//! [`Market`] preserves the exchange's native identifier for API calls.

use serde::{Deserialize, Deserializer, Serialize};

/// Normalized trading symbol (e.g., "BTC", "ETH").
///
/// Normalizes input like "BTC/USDC:USDC" to just "BTC".
///
/// Serialization is transparent (the inner ticker string). Deserialization
/// normalizes through [`Symbol::from_raw`], so a `Symbol` decoded at any boundary
/// -- a wire request or a persisted event -- is canonical.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub(crate) struct Symbol(String);

impl Symbol {
    pub(crate) fn from_raw(raw: &str) -> Self {
        let base = raw.split('/').next().unwrap_or(raw);
        Self(base.to_uppercase())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for Symbol {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(Self::from_raw(&raw))
    }
}

/// A tradeable market identifier from an exchange.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Market(String);

impl Market {
    pub(crate) fn new(name: String) -> Self {
        Self(name)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// CCXT unified swap symbol for a Hyperliquid perp (e.g., "BTC/USDC:USDC").
///
/// Serializes transparently as its string form, so API consumers still receive
/// a plain ticker string.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub(crate) struct CcxtSymbol(String);

impl CcxtSymbol {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for CcxtSymbol {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Builds the [`CcxtSymbol`] for a Hyperliquid main-meta perp.
///
/// Mirrors `ccxt` `hyperliquid.parseMarket` for the default-collateral case
/// (`quote` and `settle` are `USDC` when `collateralTokenName` is absent):
/// `safeCurrencyCode(baseName)`, then `:` -> `-` in the base, then
/// `{base}/{quote}:{settle}`.
pub(crate) fn hyperliquid_swap_ccxt_symbol(base_name: &str) -> CcxtSymbol {
    hyperliquid_swap_ccxt_symbol_with_collateral(base_name, "USDC")
}

fn hyperliquid_swap_ccxt_symbol_with_collateral(base_name: &str, collateral: &str) -> CcxtSymbol {
    let mut base = safe_currency_code(base_name);
    base = base.replace(':', "-");
    let quote = safe_currency_code(collateral);
    let settle = safe_currency_code(collateral);
    CcxtSymbol(format!("{base}/{quote}:{settle}"))
}

/// CCXT `safeCurrencyCode` for Hyperliquid meta asset names.
fn safe_currency_code(currency_code: &str) -> String {
    currency_code.to_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn symbol_normalization_is_idempotent(base in "[A-Z]{2,5}") {
            let raw = format!("{base}/USDC:USDC");
            let first = Symbol::from_raw(&raw);
            let second = Symbol::from_raw(first.as_str());
            prop_assert_eq!(first.as_str(), second.as_str());
        }

        #[test]
        fn symbol_handles_any_base_currency(base in "[A-Za-z]{1,10}") {
            let raw = format!("{base}/USDC:USDC");
            let symbol = Symbol::from_raw(&raw);
            prop_assert_eq!(symbol.as_str(), base.to_uppercase());
        }

        #[test]
        fn symbol_output_is_always_uppercase(input in "[a-zA-Z]{1,10}") {
            let symbol = Symbol::from_raw(&input);
            prop_assert!(symbol.as_str().chars().all(char::is_uppercase));
        }
    }

    #[test]
    fn normalizes_real_ccxt_formats() {
        assert_eq!(Symbol::from_raw("FRIEND/USDC:USDC").as_str(), "FRIEND");
        assert_eq!(Symbol::from_raw("BTC/USDC:USDC").as_str(), "BTC");
        assert_eq!(Symbol::from_raw("RNDR/USDC:USDC").as_str(), "RNDR");
        assert_eq!(Symbol::from_raw("SHIA/USDC:USDC").as_str(), "SHIA");
        assert_eq!(Symbol::from_raw("kDOGS/USDC:USDC").as_str(), "KDOGS");
        assert_eq!(Symbol::from_raw("CATI/USDC:USDC").as_str(), "CATI");
    }

    #[test]
    fn handles_simple_symbol() {
        assert_eq!(Symbol::from_raw("ETH").as_str(), "ETH");
        assert_eq!(Symbol::from_raw("BTC").as_str(), "BTC");
        assert_eq!(Symbol::from_raw("KPEPE").as_str(), "KPEPE");
    }

    #[test]
    fn uppercases() {
        assert_eq!(Symbol::from_raw("btc/usdc:usdc").as_str(), "BTC");
        assert_eq!(Symbol::from_raw("kdogs").as_str(), "KDOGS");
    }

    #[test]
    fn deserialize_normalizes_wire_symbol() {
        let symbol: Symbol = serde_json::from_str("\"btc/usdc:usdc\"").unwrap();
        assert_eq!(symbol.as_str(), "BTC");
    }

    #[test]
    fn serialize_round_trips_canonical_symbol() {
        let symbol = Symbol::from_raw("btc/usdc:usdc");
        let json = serde_json::to_string(&symbol).unwrap();
        let decoded: Symbol = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.as_str(), "BTC");
        assert_eq!(json, "\"BTC\"");
    }

    #[test]
    fn hyperliquid_swap_ccxt_symbol_matches_ccxt_parse_market() {
        assert_eq!(
            hyperliquid_swap_ccxt_symbol("BTC").as_str(),
            "BTC/USDC:USDC"
        );
        assert_eq!(
            hyperliquid_swap_ccxt_symbol("FRIEND").as_str(),
            "FRIEND/USDC:USDC"
        );
        assert_eq!(
            hyperliquid_swap_ccxt_symbol("kPEPE").as_str(),
            "KPEPE/USDC:USDC"
        );
        assert_eq!(
            hyperliquid_swap_ccxt_symbol("kDOGS").as_str(),
            "KDOGS/USDC:USDC"
        );
        assert_eq!(
            hyperliquid_swap_ccxt_symbol("flx:crcl").as_str(),
            "FLX-CRCL/USDC:USDC"
        );
    }

    #[test]
    fn hyperliquid_swap_ccxt_symbol_supports_non_usdc_collateral() {
        assert_eq!(
            hyperliquid_swap_ccxt_symbol_with_collateral("HYNA-BTC", "USDE").as_str(),
            "HYNA-BTC/USDE:USDE"
        );
    }
}
