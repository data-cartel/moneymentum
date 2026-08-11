//! Chain-agnostic transaction signing abstractions.
//!
//! Execution code constrains on [`Wallet`] so signing can move from browser-held
//! keys to backend custody without rewriting call sites.

#[cfg(feature = "mock")]
mod mock;

#[cfg(feature = "mock")]
pub use mock::MockWallet;

/// Domain capability for transaction signing and address retrieval.
///
/// Each implementation targets a single chain and address. A Turnkey
/// organization with EVM + Solana accounts produces two wallet instances.
///
/// Consumers constrain to their chain via associated types:
/// `W: Wallet<Address = alloy_primitives::Address>`.
#[async_trait::async_trait]
pub trait Wallet: Send + Sync {
    /// Chain-specific address type (e.g., `alloy_primitives::Address` for EVM,
    /// `solana_pubkey::Pubkey` for Solana).
    type Address: Clone + Send + Sync;

    /// Chain-specific signature type (e.g., `alloy_primitives::Signature`
    /// for EVM, `solana_signature::Signature` for Solana).
    type Signature: Clone + Send + Sync;

    /// Implementation-specific error (e.g., `TurnkeyWalletError`).
    type Error: std::error::Error + Send + Sync;

    /// Returns the on-chain address managed by this wallet instance.
    async fn address(&self) -> Result<Self::Address, Self::Error>;

    /// Signs the given already-encoded payload bytes and returns a chain-valid
    /// signature. The signer signs these bytes as-is and applies no hashing of
    /// its own: callers are responsible for any chain-specific encoding and
    /// digest (the EIP-712 hash, the serialized Solana message, etc.) before
    /// passing the bytes.
    async fn sign(&self, payload: &[u8]) -> Result<Self::Signature, Self::Error>;
}

/// Asserts that a single log line at `level` contains all `snippets`.
///
/// Mirrors `moneymentum::logs_contain_at`; the wallet crate needs its own copy
/// because that helper is `pub(crate)` in the main crate. Used with
/// `tracing_test::traced_test` to verify observability at a specific level.
#[cfg(all(test, feature = "mock"))]
pub(crate) fn logs_contain_at(level: tracing::Level, snippets: &[&str]) -> bool {
    let logs = {
        let buffer = match tracing_test::internal::global_buf().lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        String::from_utf8_lossy(&buffer).into_owned()
    };

    let level_str = match level {
        tracing::Level::TRACE => "TRACE",
        tracing::Level::DEBUG => "DEBUG",
        tracing::Level::INFO => "INFO",
        tracing::Level::WARN => "WARN",
        tracing::Level::ERROR => "ERROR",
    };

    logs.lines().any(|line| {
        line.contains(level_str) && snippets.iter().all(|snippet| line.contains(snippet))
    })
}
