use std::str::FromStr;

use bitcoin::{Address, Network};
use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::Url;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use thiserror::Error;
use tracing::{debug, info, warn};

const DEFAULT_MEMPOOL_BASE_URL: &str = "https://mempool.space/api/";
const DEFAULT_TESTNET_MEMPOOL_BASE_URL: &str = "https://mempool.space/testnet/api/";
const DEFAULT_BLOCKCHAIN_INFO_BASE_URL: &str = "https://blockchain.info";
const DEFAULT_HYPERLIQUID_INFO_BASE_URL: &str = "https://api.hyperliquid.xyz";
const SATOSHIS_PER_BTC: f64 = 100_000_000.0;
const ADDRESS_FETCH_CONCURRENCY: usize = 8;
const BECH32_ADDRESS_MAX_LEN: usize = 90;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct BtcAddress {
    value: String,
    network: Network,
}

impl BtcAddress {
    pub(crate) fn as_str(&self) -> &str {
        &self.value
    }

    fn network(&self) -> Network {
        self.network
    }
}

impl FromStr for BtcAddress {
    type Err = ReadonlyPortfolioError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(ReadonlyPortfolioError::InvalidBtcAddress(value.to_string()));
        }
        if let Ok(unchecked_address) = Address::from_str(trimmed) {
            if let Ok(checked_address) = unchecked_address.clone().require_network(Network::Bitcoin)
            {
                return Ok(Self {
                    value: checked_address.to_string(),
                    network: Network::Bitcoin,
                });
            }
            if let Ok(checked_address) = unchecked_address.require_network(Network::Testnet) {
                return Ok(Self {
                    value: checked_address.to_string(),
                    network: Network::Testnet,
                });
            }
        }
        if let Some(bech32_address) = parse_provider_supported_bech32_address(trimmed) {
            return Ok(bech32_address);
        }
        Err(ReadonlyPortfolioError::InvalidBtcAddress(value.to_string()))
    }
}

impl Serialize for BtcAddress {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for BtcAddress {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Self::from_str(&raw).map_err(serde::de::Error::custom)
    }
}

fn parse_provider_supported_bech32_address(value: &str) -> Option<BtcAddress> {
    if value.len() > BECH32_ADDRESS_MAX_LEN {
        return None;
    }
    if value != value.to_lowercase() && value != value.to_uppercase() {
        return None;
    }

    let normalized = value.to_lowercase();
    let (hrp, _data) = match bitcoin::bech32::decode(&normalized) {
        Ok(decoded) => decoded,
        Err(error) => {
            debug!(
                error = %error,
                "provider-supported bech32 address rejected"
            );
            return None;
        }
    };
    let network = if hrp == bitcoin::bech32::hrp::BC {
        Network::Bitcoin
    } else if hrp == bitcoin::bech32::hrp::TB {
        Network::Testnet
    } else {
        return None;
    };

    Some(BtcAddress {
        value: normalized,
        network,
    })
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BetaInclusion {
    Included,
    Excluded,
}

impl From<bool> for BetaInclusion {
    fn from(value: bool) -> Self {
        if value {
            Self::Included
        } else {
            Self::Excluded
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Tradability {
    Tradable,
    ReadOnly,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReadonlyBtcBalancesRequest {
    pub(crate) addresses: Vec<BtcAddress>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReadonlyBtcEntryRequest {
    pub(crate) address: BtcAddress,
    #[serde(deserialize_with = "deserialize_beta_inclusion")]
    pub(crate) include_in_beta: BetaInclusion,
}

fn deserialize_beta_inclusion<'de, D>(deserializer: D) -> Result<BetaInclusion, D::Error>
where
    D: Deserializer<'de>,
{
    // Accept either the snake_case enum form ("included"/"excluded") or a bool
    // for backwards compatibility with existing frontend payloads.
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Bool(bool),
        Tag(BetaInclusion),
    }

    Ok(match Raw::deserialize(deserializer)? {
        Raw::Bool(value) => BetaInclusion::from(value),
        Raw::Tag(tag) => tag,
    })
}

#[derive(Debug, Deserialize)]
pub(crate) struct HyperliquidPositionInput {
    pub(crate) symbol: String,
    pub(crate) side: Side,
    pub(crate) notional_usd: f64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PortfolioExposureRequest {
    pub(crate) hyperliquid_positions: Vec<HyperliquidPositionInput>,
    pub(crate) readonly_btc_entries: Vec<ReadonlyBtcEntryRequest>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct ReadonlyBtcHolding {
    pub(crate) address: String,
    pub(crate) confirmed_btc: f64,
    pub(crate) pending_btc: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct ReadonlyBtcBalancesResponse {
    pub(crate) holdings: Vec<ReadonlyBtcHolding>,
    pub(crate) total_confirmed_btc: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct ExposurePosition {
    pub(crate) source: ExposureSource,
    pub(crate) source_id: Option<String>,
    pub(crate) symbol: String,
    pub(crate) side: Side,
    pub(crate) notional_usd: f64,
    pub(crate) quantity_btc: Option<f64>,
    pub(crate) tradability: Tradability,
    pub(crate) include_in_beta: BetaInclusion,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExposureSource {
    Hyperliquid,
    BtcAddress,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct PortfolioExposureResponse {
    pub(crate) ubtc_price_usd: f64,
    pub(crate) positions: Vec<ExposurePosition>,
    pub(crate) gross_long_usd: f64,
    pub(crate) gross_short_usd: f64,
    pub(crate) net_usd: f64,
}

#[derive(Debug, Error)]
pub(crate) enum ReadonlyPortfolioError {
    #[error("invalid btc address: {0}")]
    InvalidBtcAddress(String),
    #[error("address list is empty")]
    EmptyAddressList,
    #[error("ubtc price is missing or invalid")]
    MissingUbtcPrice,
    #[error("invalid hyperliquid notional for {symbol}")]
    InvalidNotional { symbol: String },
    #[error("mempool response decode failed for {address}")]
    MempoolDecode { address: String },
    #[error("provider returned invalid json: {provider}")]
    InvalidProviderJson { provider: &'static str },
    #[error(
        "btc providers failed for {address}: primary={primary_error}; fallback={fallback_error}"
    )]
    BtcProvidersFailed {
        address: String,
        primary_error: String,
        fallback_error: String,
    },
    #[error("negative confirmed sats from provider for {address}: {sats}")]
    NegativeConfirmedSats { address: String, sats: i128 },
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

#[derive(Debug, Deserialize)]
struct HyperliquidMeta {
    universe: Vec<HyperliquidAsset>,
}

#[derive(Debug, Deserialize)]
struct HyperliquidAsset {
    name: String,
}

pub(crate) fn default_btc_base_url() -> Result<Url, ReadonlyPortfolioError> {
    Ok(Url::parse(DEFAULT_MEMPOOL_BASE_URL)?)
}

pub(crate) fn default_blockchain_info_base_url() -> Result<Url, ReadonlyPortfolioError> {
    Ok(Url::parse(DEFAULT_BLOCKCHAIN_INFO_BASE_URL)?)
}

fn btc_base_url_for_address(
    btc_base_url: &Url,
    btc_address: &BtcAddress,
) -> Result<Url, ReadonlyPortfolioError> {
    if btc_address.network() == Network::Testnet
        && btc_base_url.as_str() == DEFAULT_MEMPOOL_BASE_URL
    {
        return Ok(Url::parse(DEFAULT_TESTNET_MEMPOOL_BASE_URL)?);
    }
    Ok(btc_base_url.clone())
}

pub(crate) async fn load_readonly_btc_balances(
    http_client: &reqwest::Client,
    btc_base_url: &Url,
    blockchain_info_base_url: &Url,
    request: &ReadonlyBtcBalancesRequest,
) -> Result<ReadonlyBtcBalancesResponse, ReadonlyPortfolioError> {
    if request.addresses.is_empty() {
        return Err(ReadonlyPortfolioError::EmptyAddressList);
    }

    let fetch_futures: Vec<_> = request
        .addresses
        .iter()
        .map(|btc_address| {
            load_single_address_holding(
                http_client,
                btc_base_url,
                blockchain_info_base_url,
                btc_address,
            )
        })
        .collect();
    let holdings: Vec<ReadonlyBtcHolding> = stream::iter(fetch_futures)
        .buffered(ADDRESS_FETCH_CONCURRENCY)
        .try_collect()
        .await?;

    let total_confirmed_btc = holdings
        .iter()
        .map(|holding| holding.confirmed_btc)
        .sum::<f64>();
    debug!(
        addresses = holdings.len(),
        total_confirmed_btc, "readonly btc balances loaded"
    );

    Ok(ReadonlyBtcBalancesResponse {
        holdings,
        total_confirmed_btc,
    })
}

pub(crate) async fn load_portfolio_exposure(
    http_client: &reqwest::Client,
    btc_base_url: &Url,
    blockchain_info_base_url: &Url,
    hyperliquid_base_url: Option<&Url>,
    request: &PortfolioExposureRequest,
) -> Result<PortfolioExposureResponse, ReadonlyPortfolioError> {
    let mut merged_positions = validate_hyperliquid_positions(&request.hyperliquid_positions)?;

    let ubtc_price_usd = if request.readonly_btc_entries.is_empty() {
        0.0
    } else {
        let readonly_balance_request = ReadonlyBtcBalancesRequest {
            addresses: request
                .readonly_btc_entries
                .iter()
                .map(|entry| entry.address.clone())
                .collect(),
        };
        let readonly_balances = load_readonly_btc_balances(
            http_client,
            btc_base_url,
            blockchain_info_base_url,
            &readonly_balance_request,
        )
        .await?;
        let price = fetch_ubtc_price_usd(http_client, hyperliquid_base_url).await?;

        // The order of `holdings` mirrors `readonly_btc_entries` because
        // `load_readonly_btc_balances` preserves input order via `buffered`,
        // so we can pair by index. This avoids fragile address-string lookups
        // (canonicalization can rewrite the address representation).
        for (entry, holding) in request
            .readonly_btc_entries
            .iter()
            .zip(readonly_balances.holdings)
        {
            merged_positions.push(ExposurePosition {
                source: ExposureSource::BtcAddress,
                source_id: Some(holding.address),
                symbol: "BTC".to_string(),
                side: Side::Buy,
                notional_usd: holding.confirmed_btc * price,
                quantity_btc: Some(holding.confirmed_btc),
                tradability: Tradability::ReadOnly,
                include_in_beta: entry.include_in_beta,
            });
        }
        price
    };

    let gross_long_usd = merged_positions
        .iter()
        .filter(|position| position.side == Side::Buy)
        .map(|position| position.notional_usd)
        .sum::<f64>();
    let gross_short_usd = merged_positions
        .iter()
        .filter(|position| position.side == Side::Sell)
        .map(|position| position.notional_usd)
        .sum::<f64>();
    let net_usd = gross_long_usd - gross_short_usd;

    info!(
        positions = merged_positions.len(),
        gross_long_usd, gross_short_usd, net_usd, "portfolio exposure loaded"
    );

    Ok(PortfolioExposureResponse {
        ubtc_price_usd,
        positions: merged_positions,
        gross_long_usd,
        gross_short_usd,
        net_usd,
    })
}

fn validate_hyperliquid_positions(
    positions: &[HyperliquidPositionInput],
) -> Result<Vec<ExposurePosition>, ReadonlyPortfolioError> {
    positions
        .iter()
        .map(|position| {
            if !position.notional_usd.is_finite() || position.notional_usd < 0.0 {
                return Err(ReadonlyPortfolioError::InvalidNotional {
                    symbol: position.symbol.clone(),
                });
            }
            Ok(ExposurePosition {
                source: ExposureSource::Hyperliquid,
                source_id: None,
                symbol: position.symbol.clone(),
                side: position.side,
                notional_usd: position.notional_usd,
                quantity_btc: None,
                tradability: Tradability::Tradable,
                include_in_beta: BetaInclusion::Included,
            })
        })
        .collect()
}

async fn load_single_address_holding(
    http_client: &reqwest::Client,
    btc_base_url: &Url,
    blockchain_info_base_url: &Url,
    btc_address: &BtcAddress,
) -> Result<ReadonlyBtcHolding, ReadonlyPortfolioError> {
    match load_mempool_address_holding(http_client, btc_base_url, btc_address).await {
        Ok(holding) => Ok(holding),
        Err(primary_error) => {
            if btc_address.network() == Network::Testnet {
                return Err(ReadonlyPortfolioError::BtcProvidersFailed {
                    address: btc_address.as_str().to_string(),
                    primary_error: primary_error.to_string(),
                    fallback_error: "blockchain.info does not support testnet addresses"
                        .to_string(),
                });
            }
            warn!(
                address = btc_address.as_str(),
                error = %primary_error,
                "primary btc provider failed, falling back to blockchain.info"
            );
            load_blockchain_info_holding(http_client, blockchain_info_base_url, btc_address)
                .await
                .map_err(|fallback_error| {
                    warn!(
                        address = btc_address.as_str(),
                        error = %fallback_error,
                        "fallback btc provider failed"
                    );
                    ReadonlyPortfolioError::BtcProvidersFailed {
                        address: btc_address.as_str().to_string(),
                        primary_error: primary_error.to_string(),
                        fallback_error: fallback_error.to_string(),
                    }
                })
        }
    }
}

async fn load_mempool_address_holding(
    http_client: &reqwest::Client,
    btc_base_url: &Url,
    btc_address: &BtcAddress,
) -> Result<ReadonlyBtcHolding, ReadonlyPortfolioError> {
    let address_base_url = btc_base_url_for_address(btc_base_url, btc_address)?;
    let endpoint = address_base_url.join(&format!("address/{}", btc_address.as_str()))?;
    let response_text = http_client
        .get(endpoint)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let response_body = serde_json::from_str::<Value>(&response_text).map_err(|_| {
        ReadonlyPortfolioError::InvalidProviderJson {
            provider: "mempool.space",
        }
    })?;
    let confirmed_sats = parse_sats_delta(&response_body, "chain_stats", btc_address.as_str())?;
    let pending_sats = parse_sats_delta(&response_body, "mempool_stats", btc_address.as_str())?;

    if confirmed_sats < 0 {
        warn!(
            address = btc_address.as_str(),
            confirmed_sats, "negative confirmed sats from provider"
        );
        return Err(ReadonlyPortfolioError::NegativeConfirmedSats {
            address: btc_address.as_str().to_string(),
            sats: confirmed_sats,
        });
    }

    Ok(ReadonlyBtcHolding {
        address: btc_address.as_str().to_string(),
        confirmed_btc: sats_to_btc(confirmed_sats),
        pending_btc: sats_to_btc(pending_sats),
    })
}

async fn load_blockchain_info_holding(
    http_client: &reqwest::Client,
    blockchain_info_base_url: &Url,
    btc_address: &BtcAddress,
) -> Result<ReadonlyBtcHolding, ReadonlyPortfolioError> {
    let endpoint = blockchain_info_base_url.join(&format!("rawaddr/{}", btc_address.as_str()))?;
    let response_text = http_client
        .get(endpoint)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let response_body = serde_json::from_str::<Value>(&response_text).map_err(|_| {
        ReadonlyPortfolioError::InvalidProviderJson {
            provider: "blockchain.info",
        }
    })?;
    let final_balance_sats =
        parse_i128_field(&response_body, "final_balance").ok_or_else(|| {
            ReadonlyPortfolioError::MempoolDecode {
                address: btc_address.as_str().to_string(),
            }
        })?;
    if final_balance_sats < 0 {
        warn!(
            address = btc_address.as_str(),
            final_balance_sats, "negative confirmed sats from provider"
        );
        return Err(ReadonlyPortfolioError::NegativeConfirmedSats {
            address: btc_address.as_str().to_string(),
            sats: final_balance_sats,
        });
    }
    Ok(ReadonlyBtcHolding {
        address: btc_address.as_str().to_string(),
        confirmed_btc: sats_to_btc(final_balance_sats),
        pending_btc: 0.0,
    })
}

fn parse_sats_delta(
    payload: &Value,
    field_name: &str,
    address: &str,
) -> Result<i128, ReadonlyPortfolioError> {
    let Some(stats) = payload.get(field_name) else {
        return Err(ReadonlyPortfolioError::MempoolDecode {
            address: address.to_string(),
        });
    };
    let funded_sats = parse_i128_field(stats, "funded_txo_sum").ok_or_else(|| {
        ReadonlyPortfolioError::MempoolDecode {
            address: address.to_string(),
        }
    })?;
    let spent_sats = parse_i128_field(stats, "spent_txo_sum").ok_or_else(|| {
        ReadonlyPortfolioError::MempoolDecode {
            address: address.to_string(),
        }
    })?;
    Ok(funded_sats - spent_sats)
}

fn parse_i128_field(value: &Value, field_name: &str) -> Option<i128> {
    let field = value.get(field_name)?;
    match field {
        Value::String(text) => text.parse::<i128>().ok(),
        Value::Number(number) => {
            if let Some(unsigned) = number.as_u64() {
                return Some(i128::from(unsigned));
            }
            number.as_i64().map(i128::from)
        }
        _ => None,
    }
}

fn sats_to_btc(satoshis: i128) -> f64 {
    // f64 here is a known financial-math wart tracked in #220 — the whole
    // readonly_portfolio pipeline needs to move off floats. Allow the cast
    // until that refactor lands.
    #[allow(clippy::cast_precision_loss)]
    let satoshis_as_f64 = satoshis as f64;
    satoshis_as_f64 / SATOSHIS_PER_BTC
}

async fn fetch_ubtc_price_usd(
    http_client: &reqwest::Client,
    hyperliquid_base_url: Option<&Url>,
) -> Result<f64, ReadonlyPortfolioError> {
    let endpoint = resolve_hyperliquid_info_endpoint(hyperliquid_base_url)?;
    let response_text = http_client
        .post(endpoint)
        .json(&serde_json::json!({ "type": "metaAndAssetCtxs" }))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let response = serde_json::from_str::<serde_json::Value>(&response_text).map_err(|_| {
        ReadonlyPortfolioError::InvalidProviderJson {
            provider: "hyperliquid-info",
        }
    })?;

    let (Some(meta_value), Some(asset_ctxs_value)) = (response.get(0), response.get(1)) else {
        return Err(ReadonlyPortfolioError::MissingUbtcPrice);
    };

    let meta: HyperliquidMeta = serde_json::from_value(meta_value.clone())
        .map_err(|_| ReadonlyPortfolioError::MissingUbtcPrice)?;
    let price_asset_candidates = ["UBTC", "BTC"];
    let Some((price_asset_name, price_asset_index)) =
        price_asset_candidates.iter().find_map(|asset_name| {
            meta.universe
                .iter()
                .position(|asset| asset.name == *asset_name)
                .map(|asset_index| (*asset_name, asset_index))
        })
    else {
        return Err(ReadonlyPortfolioError::MissingUbtcPrice);
    };
    if price_asset_name != "UBTC" {
        warn!(
            fallback_asset = price_asset_name,
            "ubtc not found in universe, using fallback asset for btc pricing"
        );
    }
    let Some(asset_ctxs) = asset_ctxs_value.as_array() else {
        return Err(ReadonlyPortfolioError::MissingUbtcPrice);
    };
    let Some(ubtc_ctx) = asset_ctxs.get(price_asset_index) else {
        return Err(ReadonlyPortfolioError::MissingUbtcPrice);
    };

    parse_ubtc_price_from_context(ubtc_ctx)
}

fn resolve_hyperliquid_info_endpoint(
    hyperliquid_base_url: Option<&Url>,
) -> Result<Url, ReadonlyPortfolioError> {
    let base_url = match hyperliquid_base_url {
        Some(provided_url) => provided_url.clone(),
        None => Url::parse(DEFAULT_HYPERLIQUID_INFO_BASE_URL)?,
    };

    let already_targets_info = base_url
        .path_segments()
        .and_then(|mut segments| {
            segments
                .rfind(|segment| !segment.is_empty())
                .map(|segment| segment == "info")
        })
        .unwrap_or(false);
    if already_targets_info {
        return Ok(base_url);
    }
    Ok(base_url.join("info")?)
}

fn parse_ubtc_price_from_context(
    context: &serde_json::Value,
) -> Result<f64, ReadonlyPortfolioError> {
    let candidate_keys = ["midPx", "markPx", "oraclePx"];

    for candidate_key in candidate_keys {
        let maybe_price = context
            .get(candidate_key)
            .and_then(serde_json::Value::as_str)
            .and_then(|value| value.parse::<f64>().ok());
        if let Some(parsed_price) = maybe_price.filter(|price| price.is_finite() && *price > 0.0) {
            return Ok(parsed_price);
        }
    }
    Err(ReadonlyPortfolioError::MissingUbtcPrice)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing::Level;
    use tracing_test::traced_test;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::logs_contain_at;

    fn client() -> reqwest::Client {
        reqwest::Client::new()
    }

    fn parsed(value: &str) -> BtcAddress {
        BtcAddress::from_str(value).unwrap()
    }

    #[test]
    fn btc_address_accepts_common_mainnet_formats() {
        assert!(BtcAddress::from_str("1BoatSLRHtKNngkdXEeobR76b53LETtpyT").is_ok());
        assert!(BtcAddress::from_str("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy").is_ok());
        assert!(BtcAddress::from_str("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh").is_ok());
    }

    #[test]
    fn btc_address_accepts_common_testnet_formats() {
        assert!(BtcAddress::from_str("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn").is_ok());
        assert!(BtcAddress::from_str("2N2JD6wb56AfK4tfmM6PwdVmoYk2dCKf4Br").is_ok());
        assert!(BtcAddress::from_str("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").is_ok());
    }

    #[test]
    fn btc_address_accepts_testnet_bech32_address_supported_by_provider() {
        let address =
            BtcAddress::from_str("tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5e")
                .unwrap();

        assert_eq!(
            address.as_str(),
            "tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5e"
        );
        assert_eq!(address.network(), Network::Testnet);
    }

    #[traced_test]
    #[test]
    fn provider_supported_bech32_parser_rejects_invalid_checksum() {
        assert!(
            parse_provider_supported_bech32_address(
                "tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5f"
            )
            .is_none()
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["provider-supported bech32 address rejected", "checksum"]
        ));
    }

    #[test]
    fn testnet_mempool_base_url_keeps_api_path_for_address_endpoint() {
        let base_url = default_btc_base_url().unwrap();
        let address =
            BtcAddress::from_str("tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5e")
                .unwrap();

        let address_base_url = btc_base_url_for_address(&base_url, &address).unwrap();
        let endpoint = address_base_url
            .join(&format!("address/{}", address.as_str()))
            .unwrap();

        assert_eq!(
            endpoint.as_str(),
            "https://mempool.space/testnet/api/address/tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5e"
        );
    }

    #[tokio::test]
    async fn testnet_mempool_failure_does_not_fallback_to_blockchain_info() {
        let mock_server = MockServer::start().await;
        let address =
            BtcAddress::from_str("tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5e")
                .unwrap();
        let btc_base_url = Url::parse(&format!("{}/testnet/api/", mock_server.uri())).unwrap();
        let blockchain_info_base_url = Url::parse(&mock_server.uri()).unwrap();
        let address_base_url = btc_base_url_for_address(&btc_base_url, &address).unwrap();
        let mempool_path = address_base_url
            .join(&format!("address/{}", address.as_str()))
            .unwrap()
            .path()
            .to_string();

        Mock::given(method("GET"))
            .and(path(mempool_path))
            .respond_with(ResponseTemplate::new(503))
            .mount(&mock_server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!("/rawaddr/{}", address.as_str())))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "final_balance": 0_u64
            })))
            .expect(0)
            .mount(&mock_server)
            .await;

        let result = load_single_address_holding(
            &client(),
            &btc_base_url,
            &blockchain_info_base_url,
            &address,
        )
        .await;

        assert!(matches!(
            result,
            Err(ReadonlyPortfolioError::BtcProvidersFailed {
                ref fallback_error,
                ..
            }) if fallback_error == "blockchain.info does not support testnet addresses"
        ));
        mock_server.verify().await;
    }

    #[test]
    fn btc_address_rejects_empty_string() {
        assert!(matches!(
            BtcAddress::from_str("   "),
            Err(ReadonlyPortfolioError::InvalidBtcAddress(_))
        ));
    }

    #[test]
    fn beta_inclusion_deserializes_from_bool_and_tag() {
        #[derive(Deserialize)]
        struct Wrap {
            #[serde(deserialize_with = "deserialize_beta_inclusion")]
            value: BetaInclusion,
        }

        let from_bool: Wrap = serde_json::from_str(r#"{"value": true}"#).unwrap();
        assert_eq!(from_bool.value, BetaInclusion::Included);
        let from_tag: Wrap = serde_json::from_str(r#"{"value": "excluded"}"#).unwrap();
        assert_eq!(from_tag.value, BetaInclusion::Excluded);
    }

    #[traced_test]
    #[tokio::test]
    async fn load_readonly_btc_balances_aggregates_confirmed_btc() {
        let mock_server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/address/1FfmbHfnpaZjKFvyi1okTjJJusN455paPH"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "chain_stats": {"funded_txo_sum": 210_000_000_u64, "spent_txo_sum": 110_000_000_u64},
                "mempool_stats": {"funded_txo_sum": 10_000_u64, "spent_txo_sum": 4_000_u64}
            })))
            .mount(&mock_server)
            .await;

        let response = load_readonly_btc_balances(
            &client(),
            &Url::parse(&mock_server.uri()).unwrap(),
            &Url::parse(&mock_server.uri()).unwrap(),
            &ReadonlyBtcBalancesRequest {
                addresses: vec![parsed("1FfmbHfnpaZjKFvyi1okTjJJusN455paPH")],
            },
        )
        .await
        .unwrap();

        assert_eq!(response.holdings.len(), 1);
        assert!((response.total_confirmed_btc - 1.0).abs() < 1e-9);
        assert!(logs_contain_at(
            Level::DEBUG,
            &["readonly btc balances loaded", "addresses=1"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn load_readonly_btc_balances_rejects_negative_confirmed_sats() {
        let mock_server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/address/1FfmbHfnpaZjKFvyi1okTjJJusN455paPH"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "chain_stats": {"funded_txo_sum": 100_u64, "spent_txo_sum": 200_u64},
                "mempool_stats": {"funded_txo_sum": 0_u64, "spent_txo_sum": 0_u64}
            })))
            .mount(&mock_server)
            .await;
        // Mock blockchain.info fallback with a negative balance too so both
        // providers fail deterministically without depending on outbound
        // network.
        Mock::given(method("GET"))
            .and(path("/rawaddr/1FfmbHfnpaZjKFvyi1okTjJJusN455paPH"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "final_balance": -100_i64
            })))
            .mount(&mock_server)
            .await;

        let result = load_readonly_btc_balances(
            &client(),
            &Url::parse(&mock_server.uri()).unwrap(),
            &Url::parse(&mock_server.uri()).unwrap(),
            &ReadonlyBtcBalancesRequest {
                addresses: vec![parsed("1FfmbHfnpaZjKFvyi1okTjJJusN455paPH")],
            },
        )
        .await;

        assert!(result.is_err());
        assert!(logs_contain_at(
            Level::WARN,
            &["negative confirmed sats from provider"]
        ));
    }

    #[tokio::test]
    async fn load_readonly_btc_balances_rejects_empty_addresses() {
        let result = load_readonly_btc_balances(
            &client(),
            &Url::parse("https://example.invalid").unwrap(),
            &Url::parse("https://example.invalid").unwrap(),
            &ReadonlyBtcBalancesRequest { addresses: vec![] },
        )
        .await;
        assert!(matches!(
            result,
            Err(ReadonlyPortfolioError::EmptyAddressList)
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn load_portfolio_exposure_uses_ubtc_price_for_readonly_notional() {
        let mock_server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/address/1FfmbHfnpaZjKFvyi1okTjJJusN455paPH"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "chain_stats": {"funded_txo_sum": 200_000_000_u64, "spent_txo_sum": 100_000_000_u64},
                "mempool_stats": {"funded_txo_sum": 0_u64, "spent_txo_sum": 0_u64}
            })))
            .mount(&mock_server)
            .await;
        Mock::given(method("POST"))
            .and(path("/info"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                { "universe": [{ "name": "UBTC" }] },
                [{ "midPx": "80000.0" }]
            ])))
            .mount(&mock_server)
            .await;

        let exposure = load_portfolio_exposure(
            &client(),
            &Url::parse(&mock_server.uri()).unwrap(),
            &Url::parse(&mock_server.uri()).unwrap(),
            Some(&Url::parse(&mock_server.uri()).unwrap()),
            &PortfolioExposureRequest {
                hyperliquid_positions: vec![HyperliquidPositionInput {
                    symbol: "ETH".to_string(),
                    side: Side::Sell,
                    notional_usd: 2000.0,
                }],
                readonly_btc_entries: vec![ReadonlyBtcEntryRequest {
                    address: parsed("1FfmbHfnpaZjKFvyi1okTjJJusN455paPH"),
                    include_in_beta: BetaInclusion::Included,
                }],
            },
        )
        .await
        .unwrap();

        assert_eq!(exposure.positions.len(), 2);
        let btc_position = exposure
            .positions
            .iter()
            .find(|position| position.source == ExposureSource::BtcAddress)
            .unwrap();
        assert!((btc_position.notional_usd - 80_000.0).abs() < 1e-9);
        assert_eq!(btc_position.tradability, Tradability::ReadOnly);
        assert_eq!(btc_position.include_in_beta, BetaInclusion::Included);
        assert!(logs_contain_at(
            Level::INFO,
            &["portfolio exposure loaded", "positions=2"]
        ));
    }

    #[test]
    fn resolve_hyperliquid_info_endpoint_appends_info() {
        let url = Url::parse("https://api.example.com/").unwrap();
        let resolved = resolve_hyperliquid_info_endpoint(Some(&url)).unwrap();
        assert_eq!(resolved.as_str(), "https://api.example.com/info");
    }

    #[test]
    fn resolve_hyperliquid_info_endpoint_keeps_existing_info() {
        let url = Url::parse("https://api.example.com/info").unwrap();
        let resolved = resolve_hyperliquid_info_endpoint(Some(&url)).unwrap();
        assert_eq!(resolved.as_str(), "https://api.example.com/info");
    }

    #[test]
    fn resolve_hyperliquid_info_endpoint_handles_trailing_slash_after_info() {
        let url = Url::parse("https://api.example.com/info/").unwrap();
        let resolved = resolve_hyperliquid_info_endpoint(Some(&url)).unwrap();
        assert_eq!(resolved.as_str(), "https://api.example.com/info/");
    }
}
