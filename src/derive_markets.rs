//! Derive (Lyra) market universe: live fetch from `public/get_all_instruments`.
//!
//! Analogous to [`crate::hyperliquid::Hyperliquid::fetch_market_metadata`], but
//! Derive has no per-market `max_leverage` -- options and perps use margin
//! models that are not a single leverage number.

use std::sync::Arc;

use async_trait::async_trait;
use backon::{ExponentialBuilder, Retryable};
use chrono::{DateTime, Utc};
use derive::{DeriveNetwork, OptionKind};
use serde::{Deserialize, Serialize};
use tracing::{debug, instrument};
use url::Url;

use crate::dataframe::DataFrameError;

pub(crate) const DERIVE_MAINNET_BASE_URL: &str = "https://api.lyra.finance";
pub(crate) const DERIVE_TESTNET_BASE_URL: &str = "https://api-demo.lyra.finance";

const INSTRUMENT_PAGE_SIZE: u32 = 1000;

#[derive(Debug, thiserror::Error)]
pub(crate) enum DeriveMarketsError {
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
    #[error(transparent)]
    DataFrame(#[from] DataFrameError),
    #[error("derive pagination page overflow")]
    PageOverflow,
    #[error("unsupported derive instrument_type: {instrument_type}")]
    InvalidInstrumentType { instrument_type: String },
    #[error("unsupported derive option_type: {option_type}")]
    InvalidOptionType { option_type: String },
    #[error("failed to parse derive strike: {strike}")]
    InvalidStrike { strike: String },
    #[error("derive expiry {expiry} does not fit i64")]
    InvalidExpiry { expiry: u64 },
}

/// Option vs perpetual, matching Derive's `instrument_type` wire values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DeriveInstrumentType {
    Option,
    Perp,
}

impl DeriveInstrumentType {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Option => "option",
            Self::Perp => "perp",
        }
    }
}

/// Strike parsed from Derive's decimal string at the HTTP boundary.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(transparent)]
pub(crate) struct Strike(f64);

impl Strike {
    pub(crate) fn parse(raw: &str) -> Result<Self, DeriveMarketsError> {
        let value = raw
            .parse::<f64>()
            .map_err(|_| DeriveMarketsError::InvalidStrike {
                strike: raw.to_string(),
            })?;
        Ok(Self(value))
    }

    pub(crate) const fn get(self) -> f64 {
        self.0
    }
}

/// One active Derive instrument (option or perp).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeriveInstrument {
    pub(crate) instrument_name: String,
    pub(crate) instrument_type: DeriveInstrumentType,
    pub(crate) base_currency: String,
    pub(crate) quote_currency: String,
    pub(crate) is_active: bool,
    pub(crate) option_type: Option<derive::OptionKind>,
    pub(crate) strike: Option<Strike>,
    pub(crate) expiry_unix: Option<i64>,
}

/// `GET /derive/markets` response shape for the test page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeriveMarketsApiResponse {
    pub(crate) tickers: Vec<String>,
    pub(crate) instruments: Vec<DeriveInstrument>,
    pub(crate) refreshed_at: DateTime<Utc>,
}

pub(crate) fn markets_api_response(
    instruments: Vec<DeriveInstrument>,
    refreshed_at: DateTime<Utc>,
) -> DeriveMarketsApiResponse {
    let mut instruments = instruments;
    instruments.sort_unstable_by(|left, right| left.instrument_name.cmp(&right.instrument_name));
    let tickers = instruments
        .iter()
        .map(|instrument| instrument.instrument_name.clone())
        .collect();
    DeriveMarketsApiResponse {
        tickers,
        instruments,
        refreshed_at,
    }
}

/// Abstraction over Derive's public instrument catalogue.
#[async_trait]
pub(crate) trait DeriveMarkets: Send + Sync {
    async fn fetch_instruments(&self) -> Result<Vec<DeriveInstrument>, DeriveMarketsError>;
}

pub(crate) struct DeriveMarketsClients {
    pub(crate) mainnet: Arc<dyn DeriveMarkets>,
    pub(crate) testnet: Arc<dyn DeriveMarkets>,
}

impl DeriveMarketsClients {
    pub(crate) fn from_config(
        mainnet_base_url: Option<&Url>,
        testnet_base_url: Option<&Url>,
        max_retries: usize,
    ) -> Result<Self, DeriveMarketsError> {
        let mainnet_url = match mainnet_base_url {
            Some(url) => url.clone(),
            None => Url::parse(DERIVE_MAINNET_BASE_URL)?,
        };
        let testnet_url = match testnet_base_url {
            Some(url) => url.clone(),
            None => Url::parse(DERIVE_TESTNET_BASE_URL)?,
        };

        Ok(Self {
            mainnet: Arc::new(DeriveMarketsClient::new(mainnet_url, max_retries)?)
                as Arc<dyn DeriveMarkets>,
            testnet: Arc::new(DeriveMarketsClient::new(testnet_url, max_retries)?)
                as Arc<dyn DeriveMarkets>,
        })
    }

    pub(crate) fn for_network(&self, network: DeriveNetwork) -> &dyn DeriveMarkets {
        match network {
            DeriveNetwork::Mainnet => self.mainnet.as_ref(),
            DeriveNetwork::Testnet => self.testnet.as_ref(),
        }
    }
}

pub(crate) struct DeriveMarketsClient {
    base_url: Url,
    http: reqwest::Client,
    max_retries: usize,
}

impl DeriveMarketsClient {
    pub(crate) fn new(base_url: Url, max_retries: usize) -> Result<Self, DeriveMarketsError> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        debug!(base_url = %base_url, max_retries, "derive markets client ready");
        Ok(Self {
            base_url,
            http,
            max_retries,
        })
    }

    async fn fetch_instrument_type(
        &self,
        instrument_type: &str,
    ) -> Result<Vec<DeriveInstrument>, DeriveMarketsError> {
        let mut page: u32 = 1;
        let mut collected = Vec::new();

        loop {
            let page_snapshot = self
                .fetch_instrument_type_page(instrument_type, page)
                .await?;
            let num_pages = page_snapshot.pagination.num_pages.max(1);
            collected.extend(
                page_snapshot
                    .instruments
                    .into_iter()
                    .map(DeriveInstrument::try_from)
                    .collect::<Result<Vec<_>, _>>()?,
            );

            if page >= num_pages {
                break;
            }
            page = page
                .checked_add(1)
                .ok_or(DeriveMarketsError::PageOverflow)?;
        }

        Ok(collected)
    }

    async fn fetch_instrument_type_page(
        &self,
        instrument_type: &str,
        page: u32,
    ) -> Result<AllInstrumentsResult, DeriveMarketsError> {
        #[derive(Serialize)]
        struct RequestBody<'payload> {
            expired: bool,
            instrument_type: &'payload str,
            page: u32,
            page_size: u32,
        }

        let url = format!(
            "{}/public/get_all_instruments",
            self.base_url.as_str().trim_end_matches('/')
        );
        let body = RequestBody {
            expired: false,
            instrument_type,
            page,
            page_size: INSTRUMENT_PAGE_SIZE,
        };

        let response = (|| async {
            self.http
                .post(&url)
                .json(&body)
                .send()
                .await?
                .error_for_status()?
                .json::<RpcEnvelope<AllInstrumentsResult>>()
                .await
        })
        .retry(
            ExponentialBuilder::default()
                .with_jitter()
                .with_max_times(self.max_retries),
        )
        .notify(|error, duration| {
            debug!(
                error = %error,
                delay = ?duration,
                instrument_type,
                page,
                "retrying derive instruments fetch"
            );
        })
        .await?;

        Ok(response.result)
    }
}

#[async_trait]
impl DeriveMarkets for DeriveMarketsClient {
    #[instrument(skip(self))]
    async fn fetch_instruments(&self) -> Result<Vec<DeriveInstrument>, DeriveMarketsError> {
        // Options + perps cover the instruments portfolio cares about; erc20
        // collaterals are not "markets" in the trading-universe sense.
        let mut options = self.fetch_instrument_type("option").await?;
        let perps = self.fetch_instrument_type("perp").await?;
        options.extend(perps);

        let instruments: Vec<DeriveInstrument> = options
            .into_iter()
            .filter(|instrument| instrument.is_active)
            .collect();

        debug!(count = instruments.len(), "fetched derive instruments");
        Ok(instruments)
    }
}

#[derive(Debug, Deserialize)]
struct RpcEnvelope<ResultBody> {
    result: ResultBody,
}

#[derive(Debug, Deserialize)]
struct AllInstrumentsResult {
    instruments: Vec<RawInstrument>,
    pagination: PaginationInfo,
}

#[derive(Debug, Deserialize)]
struct PaginationInfo {
    num_pages: u32,
}

#[derive(Debug, Deserialize)]
struct RawInstrument {
    instrument_name: String,
    instrument_type: String,
    base_currency: String,
    quote_currency: String,
    is_active: bool,
    option_details: Option<RawOptionDetails>,
}

#[derive(Debug, Deserialize)]
struct RawOptionDetails {
    option_type: String,
    strike: String,
    expiry: u64,
}

impl TryFrom<RawInstrument> for DeriveInstrument {
    type Error = DeriveMarketsError;

    fn try_from(raw: RawInstrument) -> Result<Self, Self::Error> {
        let instrument_type = match raw.instrument_type.as_str() {
            "option" => DeriveInstrumentType::Option,
            "perp" => DeriveInstrumentType::Perp,
            other => {
                return Err(DeriveMarketsError::InvalidInstrumentType {
                    instrument_type: other.to_string(),
                });
            }
        };

        let (option_type, strike, expiry_unix) = match raw.option_details {
            Some(details) => {
                let option_type = match details.option_type.as_str() {
                    "C" => OptionKind::Call,
                    "P" => OptionKind::Put,
                    other => {
                        return Err(DeriveMarketsError::InvalidOptionType {
                            option_type: other.to_string(),
                        });
                    }
                };
                (
                    Some(option_type),
                    Some(Strike::parse(&details.strike)?),
                    Some(i64::try_from(details.expiry).map_err(|_| {
                        DeriveMarketsError::InvalidExpiry {
                            expiry: details.expiry,
                        }
                    })?),
                )
            }
            None => (None, None, None),
        };

        Ok(Self {
            instrument_name: raw.instrument_name,
            instrument_type,
            base_currency: raw.base_currency,
            quote_currency: raw.quote_currency,
            is_active: raw.is_active,
            option_type,
            strike,
            expiry_unix,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markets_api_response_sorts_tickers() {
        let response = markets_api_response(
            vec![
                DeriveInstrument {
                    instrument_name: "ETH-PERP".to_string(),
                    instrument_type: DeriveInstrumentType::Perp,
                    base_currency: "ETH".to_string(),
                    quote_currency: "USD".to_string(),
                    is_active: true,
                    option_type: None,
                    strike: None,
                    expiry_unix: None,
                },
                DeriveInstrument {
                    instrument_name: "ETH-20260829-2000-C".to_string(),
                    instrument_type: DeriveInstrumentType::Option,
                    base_currency: "ETH".to_string(),
                    quote_currency: "USDC".to_string(),
                    is_active: true,
                    option_type: Some(OptionKind::Call),
                    strike: Some(Strike::parse("2000").unwrap()),
                    expiry_unix: Some(1_788_000_000),
                },
            ],
            Utc::now(),
        );

        assert_eq!(response.tickers, vec!["ETH-20260829-2000-C", "ETH-PERP"]);
        assert!(response.instruments[0].option_type.is_some());
        assert!(response.instruments.iter().all(|row| row.is_active));
    }

    fn sample_raw_option() -> RawInstrument {
        RawInstrument {
            instrument_name: "ETH-20260829-2000-C".to_string(),
            instrument_type: "option".to_string(),
            base_currency: "ETH".to_string(),
            quote_currency: "USDC".to_string(),
            is_active: true,
            option_details: Some(RawOptionDetails {
                option_type: "C".to_string(),
                strike: "2000".to_string(),
                expiry: 1_788_000_000,
            }),
        }
    }

    #[test]
    fn try_from_parses_option_kind_and_numeric_strike() {
        let instrument = DeriveInstrument::try_from(sample_raw_option()).unwrap();

        assert_eq!(instrument.instrument_type, DeriveInstrumentType::Option);
        assert_eq!(instrument.option_type, Some(OptionKind::Call));
        assert_eq!(instrument.strike, Some(Strike::parse("2000").unwrap()));
        assert_eq!(instrument.expiry_unix, Some(1_788_000_000));
    }

    #[test]
    fn try_from_rejects_unknown_instrument_type() {
        let error = DeriveInstrument::try_from(RawInstrument {
            instrument_name: "USDC".to_string(),
            instrument_type: "erc20".to_string(),
            base_currency: "USDC".to_string(),
            quote_currency: "USDC".to_string(),
            is_active: true,
            option_details: None,
        })
        .unwrap_err();

        assert!(matches!(
            error,
            DeriveMarketsError::InvalidInstrumentType { .. }
        ));
    }

    #[test]
    fn try_from_rejects_non_numeric_strike() {
        let mut raw = sample_raw_option();
        if let Some(details) = raw.option_details.as_mut() {
            details.strike = "not-a-number".to_string();
        }

        let error = DeriveInstrument::try_from(raw).unwrap_err();
        assert!(matches!(error, DeriveMarketsError::InvalidStrike { .. }));
    }

    #[test]
    fn try_from_rejects_expiry_that_does_not_fit_i64() {
        let mut raw = sample_raw_option();
        if let Some(details) = raw.option_details.as_mut() {
            details.expiry = u64::MAX;
        }

        let error = DeriveInstrument::try_from(raw).unwrap_err();
        assert!(matches!(
            error,
            DeriveMarketsError::InvalidExpiry { expiry: u64::MAX }
        ));
    }
}
