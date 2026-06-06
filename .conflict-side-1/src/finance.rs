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
/// -- a wire request or a persisted event -- is canonical. `from_raw` is
/// idempotent, so re-normalizing an already-stored symbol is a no-op.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
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
    fn deserialize_normalizes_to_canonical_symbol() {
        let from_ccxt: Symbol = serde_json::from_str(r#""btc/USDC:USDC""#).unwrap();
        assert_eq!(from_ccxt.as_str(), "BTC");

        let from_lowercase: Symbol = serde_json::from_str(r#""eth""#).unwrap();
        assert_eq!(from_lowercase.as_str(), "ETH");

        let already_canonical: Symbol = serde_json::from_str(r#""BTC""#).unwrap();
        assert_eq!(already_canonical.as_str(), "BTC");
    }
}
