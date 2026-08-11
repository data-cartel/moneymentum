//! Hyperliquid API client and data ingesters.
//!
//! Provides market data fetching (candles, funding rates) from Hyperliquid's
//! perpetual futures exchange, with automatic retry and incremental ingestion.

use std::num::TryFromIntError;
use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use backon::{ExponentialBuilder, Retryable};
use chrono::{DateTime, Duration, Utc};
use futures::stream::{self, StreamExt, TryStreamExt};
use hyperliquid_rust_sdk::InfoClient;
use thiserror::Error;
use tracing::{debug, info, instrument};
use url::Url;

use rust_decimal::Decimal;
use std::str::FromStr;

use crate::candle::{Candle, CandleError, candles_to_dataframe};
use crate::dataframe::{self, DataFrameError};
use crate::finance::{self, Market, Symbol};
use crate::funding::{self, FundingError, FundingRate};
use crate::market_metadata::MarketMetadata;
use crate::timeframe::Timeframe;

/// Maximum number of data points returned by Hyperliquid's historical data endpoints.
///
/// Both `candleSnapshot` and `funding_history` endpoints cap results at 5000 entries.
/// See [candleSnapshot docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot)
/// and [funding_history docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-historical-funding-rates).
pub(crate) const MAX_HISTORY_ENTRIES: i64 = 5000;

#[derive(Debug, Error)]
pub(crate) enum HyperliquidError {
    #[error(transparent)]
    Candle(#[from] CandleError),
    #[error(transparent)]
    Funding(#[from] FundingError),
    #[error(transparent)]
    DataFrame(#[from] DataFrameError),
    #[error(transparent)]
    Sdk(#[from] hyperliquid_rust_sdk::Error),
    #[error(transparent)]
    IntConversion(#[from] TryFromIntError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
    #[error(transparent)]
    Polars(#[from] polars::prelude::PolarsError),
}

pub(crate) const HYPERLIQUID_TESTNET_BASE_URL: &str = "https://api.hyperliquid-testnet.xyz";

/// Hyperliquid deployment a request targets, as selected by the frontend
/// wallet's network mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HyperliquidNetwork {
    Mainnet,
    Testnet,
}

/// Mainnet and testnet Hyperliquid info clients, so the markets endpoint can
/// serve whichever deployment the frontend wallet targets while ingestion
/// keeps using mainnet.
pub(crate) struct HyperliquidClients {
    pub(crate) mainnet: Arc<dyn Hyperliquid>,
    pub(crate) testnet: Arc<dyn Hyperliquid>,
}

impl HyperliquidClients {
    pub(crate) async fn from_config(
        mainnet_base_url: Option<&Url>,
        testnet_base_url: Option<&Url>,
        max_retries: usize,
    ) -> Result<Self, HyperliquidError> {
        let mainnet = Arc::new(HyperliquidClient::new(mainnet_base_url, max_retries).await?)
            as Arc<dyn Hyperliquid>;
        let testnet_url = match testnet_base_url {
            Some(url) => url.clone(),
            None => Url::parse(HYPERLIQUID_TESTNET_BASE_URL)?,
        };
        let testnet = Arc::new(HyperliquidClient::new(Some(&testnet_url), max_retries).await?)
            as Arc<dyn Hyperliquid>;
        Ok(Self { mainnet, testnet })
    }

    pub(crate) fn for_network(&self, network: HyperliquidNetwork) -> &dyn Hyperliquid {
        match network {
            HyperliquidNetwork::Mainnet => self.mainnet.as_ref(),
            HyperliquidNetwork::Testnet => self.testnet.as_ref(),
        }
    }
}

/// Abstraction over Hyperliquid's market data API.
///
/// Enables testing with mock implementations.
#[async_trait]
pub(crate) trait Hyperliquid: Send + Sync {
    async fn fetch_market_metadata(&self) -> Result<Vec<MarketMetadata>, HyperliquidError>;

    async fn fetch_candles(
        &self,
        market: &Market,
        timeframe: Timeframe,
        start: DateTime<Utc>,
    ) -> Result<Vec<Candle>, HyperliquidError>;

    async fn fetch_funding_rates(
        &self,
        market: &Market,
        start: DateTime<Utc>,
    ) -> Result<Vec<FundingRate>, HyperliquidError>;
}

pub(crate) struct HyperliquidClient {
    info: InfoClient,
    /// Timeout-bounded HTTP client shared across raw info requests, so each
    /// fetch reuses pooled connections instead of paying TCP/TLS setup.
    http: reqwest::Client,
    max_retries: usize,
}

impl HyperliquidClient {
    pub(crate) async fn new(
        base_url: Option<&Url>,
        max_retries: usize,
    ) -> Result<Self, HyperliquidError> {
        let mut info = InfoClient::new(None, None).await?;
        if let Some(url) = base_url {
            url.to_string()
                .trim_end_matches('/')
                .clone_into(&mut info.http_client.base_url);
        }
        // Bound each attempt so a hung upstream cannot stall startup or the
        // markets endpoint indefinitely (matches the frontend's 10s guard).
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        debug!(
            base_url = %info.http_client.base_url,
            max_retries,
            "hyperliquid client ready"
        );
        Ok(Self {
            info,
            http,
            max_retries,
        })
    }
}

#[async_trait]
impl Hyperliquid for HyperliquidClient {
    #[instrument(skip(self))]
    async fn fetch_market_metadata(&self) -> Result<Vec<MarketMetadata>, HyperliquidError> {
        // The SDK's typed `meta()` drops `maxLeverage`, so request the raw `meta`
        // info payload and parse the fields we need ourselves.
        #[derive(serde::Serialize)]
        struct MetaRequest {
            #[serde(rename = "type")]
            request_type: &'static str,
        }
        #[derive(serde::Deserialize)]
        struct RawMeta {
            universe: Vec<RawAsset>,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawAsset {
            name: String,
            max_leverage: u32,
            is_delisted: Option<bool>,
            /// Omitted for cross-capable markets; `true` when cross margin is forbidden.
            only_isolated: Option<bool>,
        }

        let url = format!("{}/info", self.info.http_client.base_url);
        let raw = (|| async {
            self.http
                .post(&url)
                .json(&MetaRequest {
                    request_type: "meta",
                })
                .send()
                .await?
                .error_for_status()?
                .json::<RawMeta>()
                .await
        })
        .retry(
            ExponentialBuilder::default()
                .with_jitter()
                .with_max_times(self.max_retries),
        )
        .notify(|err, dur| {
            debug!(error = %err, delay = ?dur, "retrying market metadata fetch");
        })
        .await?;

        let metadata: Vec<MarketMetadata> = raw
            .universe
            .into_iter()
            .enumerate()
            .filter(|(_, asset)| asset.is_delisted != Some(true))
            .map(
                |(asset_index, asset)| -> Result<MarketMetadata, HyperliquidError> {
                    Ok(MarketMetadata {
                        symbol: Market::new(asset.name),
                        max_leverage: asset.max_leverage,
                        asset_index: u32::try_from(asset_index)
                            .map_err(HyperliquidError::IntConversion)?,
                        only_isolated: asset.only_isolated.unwrap_or(false),
                    })
                },
            )
            .collect::<Result<Vec<_>, _>>()?;
        debug!(count = metadata.len(), "fetched market metadata");
        Ok(metadata)
    }

    #[instrument(skip(self))]
    async fn fetch_candles(
        &self,
        market: &Market,
        timeframe: Timeframe,
        start: DateTime<Utc>,
    ) -> Result<Vec<Candle>, HyperliquidError> {
        let start_ms = u64::try_from(start.timestamp_millis())?;
        let end_ms = u64::try_from(Utc::now().timestamp_millis())?;

        let response = (|| async {
            self.info
                .candles_snapshot(
                    market.as_str().to_string(),
                    timeframe.interval_string().to_string(),
                    start_ms,
                    end_ms,
                )
                .await
        })
        .retry(
            ExponentialBuilder::default()
                .with_jitter()
                .with_max_times(self.max_retries),
        )
        .notify(|err, dur| {
            debug!(error = %err, delay = ?dur, "retrying candle fetch");
        })
        .await?;

        let candles = response
            .into_iter()
            .filter_map(|snapshot| {
                let time_open = snapshot.time_open.cast_signed();
                let timestamp = DateTime::from_timestamp_millis(time_open)?;

                let open = snapshot.open.parse().ok()?;
                let high = snapshot.high.parse().ok()?;
                let low = snapshot.low.parse().ok()?;
                let close = snapshot.close.parse().ok()?;
                let volume = snapshot.vlm.parse().ok()?;

                Some(Candle {
                    timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume,
                    market: finance::hyperliquid_swap_ccxt_symbol(market.as_str()),
                    symbol: Symbol::from_raw(market.as_str()),
                })
            })
            .collect();

        Ok(candles)
    }

    #[instrument(skip(self))]
    async fn fetch_funding_rates(
        &self,
        market: &Market,
        start: DateTime<Utc>,
    ) -> Result<Vec<FundingRate>, HyperliquidError> {
        let start_ms = u64::try_from(start.timestamp_millis())?;
        let end_ms = u64::try_from(Utc::now().timestamp_millis())?;

        let response = (|| async {
            self.info
                .funding_history(market.as_str().to_string(), start_ms, Some(end_ms))
                .await
        })
        .retry(
            ExponentialBuilder::default()
                .with_jitter()
                .with_max_times(self.max_retries),
        )
        .notify(|err, dur| {
            debug!(error = %err, delay = ?dur, "retrying funding rate fetch");
        })
        .await?;

        let rates = response
            .into_iter()
            .filter_map(|entry| {
                let timestamp = DateTime::from_timestamp_millis(entry.time.cast_signed())?;
                let rate = Decimal::from_str(&entry.funding_rate).ok()?;

                Some(FundingRate {
                    timestamp,
                    rate,
                    symbol: Symbol::from_raw(market.as_str()),
                })
            })
            .collect();

        Ok(rates)
    }
}

/// Fetches and persists OHLCV candle data for all markets.
///
/// Performs incremental ingestion: reads existing data, fetches only new
/// candles since the last timestamp per symbol, merges, deduplicates, and
/// writes back to CSV.
pub(crate) struct CandleIngester<H: ?Sized> {
    client: Arc<H>,
    max_concurrent_requests: usize,
}

impl<H: ?Sized + Hyperliquid> CandleIngester<H> {
    pub(crate) fn new(client: Arc<H>, max_concurrent_requests: usize) -> Self {
        Self {
            client,
            max_concurrent_requests,
        }
    }

    #[instrument(skip(self, data_dir, markets), fields(timeframe = ?timeframe))]
    pub(crate) async fn ingest_with_markets(
        &self,
        timeframe: Timeframe,
        data_dir: &Path,
        markets: &[Market],
    ) -> Result<(), HyperliquidError> {
        let path = data_dir.join(timeframe.file_name());
        let existing = dataframe::read_csv(path.clone()).await?;

        info!(
            markets = markets.len(),
            timeframe = %timeframe.interval_string(),
            "starting candle ingestion"
        );

        // Hyperliquid candleSnapshot returns at most 5000 candles per request
        // for any interval ([docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#candle-snapshot)).
        // To always fetch the maximum available history per symbol, we ignore
        // existing data for the start time and request a 5000-candle window
        // ending at "now". Any overlap with existing data is handled by
        // merge_and_deduplicate.
        let start_for_all_markets = Utc::now() - timeframe.window_duration(MAX_HISTORY_ENTRIES);

        let market_starts: Vec<(Market, DateTime<Utc>)> = markets
            .iter()
            .map(|market| (market.clone(), start_for_all_markets))
            .collect();

        let candle_batches: Vec<Vec<Candle>> = stream::iter(market_starts)
            .map(|(market, start)| {
                let client = Arc::clone(&self.client);
                async move {
                    debug!(market = market.as_str(), "fetching candles");
                    let candles = client.fetch_candles(&market, timeframe, start).await?;
                    debug!(
                        market = market.as_str(),
                        count = candles.len(),
                        "fetched candles"
                    );
                    Ok::<_, HyperliquidError>(candles)
                }
            })
            .buffer_unordered(self.max_concurrent_requests)
            .try_collect()
            .await?;

        let all_candles: Vec<Candle> = candle_batches.into_iter().flatten().collect();
        if all_candles.is_empty() {
            info!("no new candles");
            return Ok(());
        }

        let market_count = markets.len();
        let candle_count = all_candles.len();

        let new_df = candles_to_dataframe(all_candles).await?;
        let merged = dataframe::merge_and_deduplicate(existing, new_df).await?;
        let row_count = merged.height();

        let csv_path = path.display().to_string();
        dataframe::write_csv(path, merged).await?;
        info!(rows = row_count, path = csv_path, "candles csv written");

        info!(
            markets = market_count,
            candles = candle_count,
            "ingestion complete"
        );

        Ok(())
    }
}

/// Fetches and persists funding rate data for all markets.
///
/// Same incremental pattern as [`CandleIngester`].
pub(crate) struct FundingRateIngester<H: ?Sized> {
    client: Arc<H>,
    max_concurrent_requests: usize,
}

impl<H: ?Sized + Hyperliquid> FundingRateIngester<H> {
    pub(crate) fn new(client: Arc<H>, max_concurrent_requests: usize) -> Self {
        Self {
            client,
            max_concurrent_requests,
        }
    }

    #[instrument(skip(self, data_dir, markets))]
    pub(crate) async fn ingest_with_markets(
        &self,
        data_dir: &Path,
        markets: &[Market],
    ) -> Result<(), HyperliquidError> {
        let path = data_dir.join(funding::file_name());
        let existing = dataframe::read_csv(path.clone()).await?;

        info!(markets = markets.len(), "starting funding rate ingestion");
        // Funding history endpoint returns a bounded window of historical
        // funding rates. To always fetch the maximum available history per
        // market, we ignore existing data for the start time and request a
        // fixed window ending at "now". Any overlap with existing data is
        // handled by merge_and_deduplicate.
        let window = Duration::hours(MAX_HISTORY_ENTRIES);
        let start_for_all_markets = Utc::now() - window;

        let market_starts: Vec<(Market, DateTime<Utc>)> = markets
            .iter()
            .map(|market| (market.clone(), start_for_all_markets))
            .collect();

        let rate_batches: Vec<Vec<FundingRate>> = stream::iter(market_starts)
            .map(|(market, start)| {
                let client = Arc::clone(&self.client);
                async move {
                    debug!(market = market.as_str(), "fetching funding rates");
                    let rates = client.fetch_funding_rates(&market, start).await?;
                    debug!(
                        market = market.as_str(),
                        count = rates.len(),
                        "fetched funding rates"
                    );
                    Ok::<_, HyperliquidError>(rates)
                }
            })
            .buffer_unordered(self.max_concurrent_requests)
            .try_collect()
            .await?;

        let all_rates: Vec<FundingRate> = rate_batches.into_iter().flatten().collect();
        if all_rates.is_empty() {
            info!("no new funding rates");
            return Ok(());
        }

        let market_count = markets.len();
        let rate_count = all_rates.len();

        let new_df = funding::funding_rates_to_dataframe(all_rates).await?;
        let merged = dataframe::merge_and_deduplicate(existing, new_df).await?;
        let row_count = merged.height();

        let csv_path = path.display().to_string();
        dataframe::write_csv(path, merged).await?;
        info!(
            rows = row_count,
            path = csv_path,
            "funding rates csv written"
        );

        info!(
            markets = market_count,
            rates = rate_count,
            "funding rate ingestion complete"
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use rust_decimal_macros::dec;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;
    use tracing::Level;
    use tracing_test::traced_test;

    use crate::logs_contain_at;

    struct MockHyperliquid {
        market_metadata: Vec<MarketMetadata>,
        candles: Vec<Candle>,
        funding_rates: Vec<FundingRate>,
        fetch_candles_calls: AtomicUsize,
        fetch_funding_calls: AtomicUsize,
    }

    fn btc_markets() -> Vec<Market> {
        vec![Market::new("BTC".to_string())]
    }

    impl MockHyperliquid {
        fn new() -> Self {
            Self {
                market_metadata: vec![MarketMetadata {
                    symbol: Market::new("BTC".to_string()),
                    max_leverage: 50,
                    asset_index: 0,
                    only_isolated: false,
                }],
                candles: vec![Candle {
                    timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
                    open: 42000.0,
                    high: 43000.0,
                    low: 41000.0,
                    close: 42500.0,
                    volume: 1000.0,
                    market: finance::hyperliquid_swap_ccxt_symbol("BTC"),
                    symbol: Symbol::from_raw("BTC"),
                }],
                funding_rates: vec![FundingRate {
                    timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
                    rate: dec!(0.0001),
                    symbol: Symbol::from_raw("BTC"),
                }],
                fetch_candles_calls: AtomicUsize::new(0),
                fetch_funding_calls: AtomicUsize::new(0),
            }
        }

        fn with_empty_data(mut self) -> Self {
            self.candles = vec![];
            self.funding_rates = vec![];
            self
        }
    }

    #[async_trait]
    impl Hyperliquid for MockHyperliquid {
        async fn fetch_market_metadata(&self) -> Result<Vec<MarketMetadata>, HyperliquidError> {
            Ok(self.market_metadata.clone())
        }

        async fn fetch_candles(
            &self,
            _market: &Market,
            _timeframe: Timeframe,
            _start: DateTime<Utc>,
        ) -> Result<Vec<Candle>, HyperliquidError> {
            self.fetch_candles_calls.fetch_add(1, Ordering::Relaxed);
            Ok(self.candles.clone())
        }

        async fn fetch_funding_rates(
            &self,
            _market: &Market,
            _start: DateTime<Utc>,
        ) -> Result<Vec<FundingRate>, HyperliquidError> {
            self.fetch_funding_calls.fetch_add(1, Ordering::Relaxed);
            Ok(self.funding_rates.clone())
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn candle_ingester_writes_csv_and_logs() {
        let data_dir = TempDir::new().unwrap();
        let mock = Arc::new(MockHyperliquid::new());
        let ingester = CandleIngester::new(mock, 10);

        ingester
            .ingest_with_markets(Timeframe::OneHour, data_dir.path(), &btc_markets())
            .await
            .unwrap();

        let csv_path = data_dir.path().join("ohlcv_1h.csv");
        assert!(csv_path.exists(), "CSV file should be created");

        assert!(logs_contain_at(Level::DEBUG, &["fetching candles", "BTC"]));
        assert!(logs_contain_at(Level::DEBUG, &["fetched candles", "1"]));
        assert!(logs_contain_at(Level::INFO, &["ingestion complete", "1"]));
    }

    #[traced_test]
    #[tokio::test]
    async fn candle_ingester_logs_when_no_new_candles() {
        let data_dir = TempDir::new().unwrap();
        let mock = Arc::new(MockHyperliquid::new().with_empty_data());
        let ingester = CandleIngester::new(mock, 10);

        ingester
            .ingest_with_markets(Timeframe::OneHour, data_dir.path(), &btc_markets())
            .await
            .unwrap();

        assert!(logs_contain_at(Level::INFO, &["no new candles"]));
    }

    #[traced_test]
    #[tokio::test]
    async fn funding_ingester_writes_csv_and_logs() {
        let data_dir = TempDir::new().unwrap();
        let mock = Arc::new(MockHyperliquid::new());
        let ingester = FundingRateIngester::new(mock, 10);

        ingester
            .ingest_with_markets(data_dir.path(), &btc_markets())
            .await
            .unwrap();

        let csv_path = data_dir.path().join("funding_rate1h.csv");
        assert!(csv_path.exists(), "CSV file should be created");

        assert!(logs_contain_at(
            Level::DEBUG,
            &["fetching funding rates", "BTC"]
        ));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["fetched funding rates", "1"]
        ));
        assert!(logs_contain_at(
            Level::INFO,
            &["funding rate ingestion complete", "1"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn funding_ingester_logs_when_no_new_rates() {
        let data_dir = TempDir::new().unwrap();
        let mock = Arc::new(MockHyperliquid::new().with_empty_data());
        let ingester = FundingRateIngester::new(mock, 10);

        ingester
            .ingest_with_markets(data_dir.path(), &btc_markets())
            .await
            .unwrap();

        assert!(logs_contain_at(Level::INFO, &["no new funding rates"]));
    }

    #[tokio::test]
    async fn candle_ingester_fetches_for_each_market() {
        let data_dir = TempDir::new().unwrap();
        let markets = vec![
            Market::new("BTC".to_string()),
            Market::new("ETH".to_string()),
            Market::new("SOL".to_string()),
        ];
        let mock = Arc::new(MockHyperliquid::new());
        let call_count = Arc::clone(&mock);
        let ingester = CandleIngester::new(mock, 10);

        ingester
            .ingest_with_markets(Timeframe::OneHour, data_dir.path(), &markets)
            .await
            .unwrap();

        assert_eq!(
            call_count.fetch_candles_calls.load(Ordering::Relaxed),
            3,
            "should fetch candles for each market"
        );
    }

    #[tokio::test]
    async fn funding_ingester_fetches_for_each_market() {
        let data_dir = TempDir::new().unwrap();
        let markets = vec![
            Market::new("BTC".to_string()),
            Market::new("ETH".to_string()),
        ];
        let mock = Arc::new(MockHyperliquid::new());
        let call_count = Arc::clone(&mock);
        let ingester = FundingRateIngester::new(mock, 10);

        ingester
            .ingest_with_markets(data_dir.path(), &markets)
            .await
            .unwrap();

        assert_eq!(
            call_count.fetch_funding_calls.load(Ordering::Relaxed),
            2,
            "should fetch funding rates for each market"
        );
    }

    #[tokio::test]
    async fn candle_ingester_merges_with_legacy_python_format() {
        // Copy fixture (8-column legacy format from Python pipeline) to temp dir
        let data_dir = TempDir::new().unwrap();
        let fixture = std::path::Path::new("fixtures/ohlcv_1h.csv");
        let target = data_dir.path().join("ohlcv_1h.csv");
        std::fs::copy(fixture, &target).unwrap();

        // Ingest new candles (should merge with existing legacy data)
        let mock = Arc::new(MockHyperliquid::new());
        let ingester = CandleIngester::new(mock, 10);

        let result = ingester
            .ingest_with_markets(Timeframe::OneHour, data_dir.path(), &btc_markets())
            .await;

        assert!(
            result.is_ok(),
            "should merge with legacy Python format: {:?}",
            result.err()
        );
    }

    #[tokio::test]
    async fn candle_output_matches_python_schema() {
        // Python pipeline produces: timestamp (ISO 8601), open, high, low, close, volume, symbol, ticker
        let data_dir = TempDir::new().unwrap();
        let mock = Arc::new(MockHyperliquid::new());
        let ingester = CandleIngester::new(mock, 10);

        ingester
            .ingest_with_markets(Timeframe::OneHour, data_dir.path(), &btc_markets())
            .await
            .unwrap();

        let csv_content = std::fs::read_to_string(data_dir.path().join("ohlcv_1h.csv")).unwrap();
        let header = csv_content.lines().next().unwrap();

        assert_eq!(
            header, "timestamp,open,high,low,close,volume,symbol,ticker",
            "schema must match Python pipeline output"
        );

        // Check timestamp format is ISO 8601, not milliseconds
        let first_row = csv_content.lines().nth(1).unwrap();
        let timestamp = first_row.split(',').next().unwrap();
        assert!(
            timestamp.contains('T') && timestamp.contains('Z'),
            "timestamp should be ISO 8601 format like '2024-01-01T00:00:00.000Z', got: {timestamp}"
        );
    }

    #[tokio::test]
    async fn funding_ingester_merges_with_legacy_python_format() {
        // Copy fixture (legacy format from Python pipeline) to temp dir
        let data_dir = TempDir::new().unwrap();
        let fixture = std::path::Path::new("fixtures/funding_rate1h.csv");
        let target = data_dir.path().join("funding_rate1h.csv");
        std::fs::copy(fixture, &target).unwrap();

        // Ingest new funding rates (should merge with existing legacy data)
        let mock = Arc::new(MockHyperliquid::new());
        let ingester = FundingRateIngester::new(mock, 10);

        let result = ingester
            .ingest_with_markets(data_dir.path(), &btc_markets())
            .await;

        assert!(
            result.is_ok(),
            "should merge with legacy Python format: {:?}",
            result.err()
        );
    }

    #[tokio::test]
    async fn funding_output_matches_python_schema() {
        // Python pipeline produces: timestamp (ISO 8601), funding_rate, symbol
        let data_dir = TempDir::new().unwrap();
        let mock = Arc::new(MockHyperliquid::new());
        let ingester = FundingRateIngester::new(mock, 10);

        ingester
            .ingest_with_markets(data_dir.path(), &btc_markets())
            .await
            .unwrap();

        let csv_content =
            std::fs::read_to_string(data_dir.path().join("funding_rate1h.csv")).unwrap();
        let header = csv_content.lines().next().unwrap();

        assert_eq!(
            header, "timestamp,funding_rate,symbol",
            "schema must match Python pipeline output"
        );

        // Check timestamp format is ISO 8601, not milliseconds
        let first_row = csv_content.lines().nth(1).unwrap();
        let timestamp = first_row.split(',').next().unwrap();
        assert!(
            timestamp.contains('T') && timestamp.contains('Z'),
            "timestamp should be ISO 8601 format like '2024-01-01T00:00:00.000Z', got: {timestamp}"
        );
    }
}
