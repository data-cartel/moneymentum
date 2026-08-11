//! Deterministic [`Wallet`] test doubles.

use std::convert::Infallible;
use tracing::debug;

use crate::Wallet;

/// Deterministic wallet for testing any [`Wallet`] associated-type pairing.
///
/// Use [`MockWallet::with`] to construct mocks for chain-specific address and
/// signature types (for example `MockWallet<alloy_primitives::Address,
/// alloy_primitives::Signature>`). [`MockWallet::new`] remains a convenience
/// constructor for the default `[u8; 32]` / `Vec<u8>` pairing used in crate
/// tests.
///
/// The default byte-signature scheme concatenates `b"sig:"`, the wallet's
/// address bytes, `b":"`, and the payload so different mock wallets produce
/// distinguishable signatures for the same payload. Custom closures passed to
/// [`MockWallet::with`] may use any deterministic scheme appropriate to the
/// target chain types.
///
/// Signatures from this mock are non-cryptographic and trivially forgeable --
/// never treat them as authentic.
pub struct MockWallet<Address, Signature> {
    address: Address,
    sign_payload: Box<dyn Fn(&[u8]) -> Signature + Send + Sync>,
}

impl<Address, Signature> MockWallet<Address, Signature> {
    /// Creates a mock from an address and a payload-to-signature function.
    ///
    /// The closure receives already-encoded payload bytes exactly as production
    /// [`Wallet::sign`] callers would pass them.
    pub fn with(
        address: Address,
        sign_payload: impl Fn(&[u8]) -> Signature + Send + Sync + 'static,
    ) -> Self {
        Self {
            address,
            sign_payload: Box::new(sign_payload),
        }
    }
}

impl MockWallet<[u8; 32], Vec<u8>> {
    /// Creates a mock wallet whose address is `[seed; 32]`.
    pub fn new(seed: u8) -> Self {
        let address = [seed; 32];
        Self::with(address, move |payload| byte_signature(address, payload))
    }
}

/// Builds the default byte-signature scheme used by [`MockWallet::new`].
fn byte_signature(address: [u8; 32], payload: &[u8]) -> Vec<u8> {
    let mut signature = b"sig:".to_vec();
    signature.extend_from_slice(&address);
    signature.push(b':');
    signature.extend_from_slice(payload);
    signature
}

#[async_trait::async_trait]
impl<Address, Signature> Wallet for MockWallet<Address, Signature>
where
    Address: Clone + Send + Sync,
    Signature: Clone + Send + Sync,
{
    type Address = Address;
    type Signature = Signature;
    /// The mock never fails, so its error type is uninhabitable.
    type Error = Infallible;

    /// Returns the wallet's configured address.
    async fn address(&self) -> Result<Self::Address, Self::Error> {
        debug!("mock wallet address resolved");
        Ok(self.address.clone())
    }

    /// Signs the payload with this wallet's configured signing function.
    async fn sign(&self, payload: &[u8]) -> Result<Self::Signature, Self::Error> {
        debug!(payload_bytes = payload.len(), "mock wallet signed payload");
        Ok((self.sign_payload)(payload))
    }
}

#[cfg(test)]
mod tests {
    use tracing::Level;
    use tracing_test::traced_test;

    use super::*;
    use crate::logs_contain_at;

    fn expected_signature(seed: u8, payload: &[u8]) -> Vec<u8> {
        byte_signature([seed; 32], payload)
    }

    async fn string_wallet_address<W>(wallet: &W) -> String
    where
        W: Wallet<Address = String, Signature = String>,
    {
        wallet.address().await.unwrap()
    }

    #[traced_test]
    #[tokio::test]
    async fn with_accepts_custom_address_and_signature_types() {
        let wallet = MockWallet::with("evm:0xabc".to_string(), |payload| {
            format!("sig:{}:{}", "evm:0xabc", String::from_utf8_lossy(payload))
        });

        assert_eq!(
            string_wallet_address(&wallet).await,
            "evm:0xabc".to_string()
        );
        assert_eq!(
            wallet.sign(b"hello").await.unwrap(),
            "sig:evm:0xabc:hello".to_string()
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet address resolved"]
        ));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet signed payload", "payload_bytes"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn address_returns_seed_filled_bytes() {
        let wallet = MockWallet::new(0xAB);
        let address = wallet.address().await.ok();

        assert_eq!(address, Some([0xAB; 32]));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet address resolved"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn sign_binds_signature_to_payload_and_address() {
        let wallet = MockWallet::new(1);
        let signature = wallet.sign(b"hello").await.ok();

        assert_eq!(signature, Some(expected_signature(1, b"hello")));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet signed payload", "payload_bytes"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn sign_empty_payload() {
        let wallet = MockWallet::new(0);
        let signature = wallet.sign(b"").await.ok();

        assert_eq!(signature, Some(expected_signature(0, b"")));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet signed payload", "payload_bytes"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn different_seeds_produce_different_addresses() {
        let wallet_a = MockWallet::new(1);
        let wallet_b = MockWallet::new(2);

        let addr_a = wallet_a.address().await.ok();
        let addr_b = wallet_b.address().await.ok();

        assert_ne!(addr_a, addr_b);
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet address resolved"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn different_seeds_produce_different_signatures() {
        let wallet_a = MockWallet::new(1);
        let wallet_b = MockWallet::new(2);

        let sig_a = wallet_a.sign(b"hello").await.ok();
        let sig_b = wallet_b.sign(b"hello").await.ok();

        assert_ne!(sig_a, sig_b);
        assert!(logs_contain_at(
            Level::DEBUG,
            &["mock wallet signed payload"]
        ));
    }
}
