use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use event_sorcery::{Projection, Store, StoreBuilder};
use rust_decimal_macros::dec;
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use crate::candle::Candle;
use crate::finance::{Market, Symbol, hyperliquid_swap_ccxt_symbol};
use crate::funding::FundingRate;
use crate::hyperliquid::{Hyperliquid, HyperliquidError};
use crate::market_catalog::MarketCatalog;
use crate::market_enablement::MarketEnablement;
use crate::market_metadata::MarketMetadata;
use crate::timeframe::Timeframe;

use super::job::IngestionJobContext;
use super::run::IngestionRun;
use super::services::IngestionServices;

pub(crate) struct MockHyperliquid {
    pub(crate) fetch_market_metadata_calls: Option<Arc<AtomicU32>>,
    pub(crate) fetch_candles_calls: Option<Arc<AtomicU32>>,
}

pub(crate) struct FailingMockHyperliquid;

impl MockHyperliquid {
    pub(crate) fn without_call_counter() -> Self {
        Self {
            fetch_market_metadata_calls: None,
            fetch_candles_calls: None,
        }
    }

    pub(crate) fn with_call_counter(fetch_market_metadata_calls: Arc<AtomicU32>) -> Self {
        Self {
            fetch_market_metadata_calls: Some(fetch_market_metadata_calls),
            fetch_candles_calls: None,
        }
    }

    pub(crate) fn with_candle_call_counter(fetch_candles_calls: Arc<AtomicU32>) -> Self {
        Self {
            fetch_market_metadata_calls: None,
            fetch_candles_calls: Some(fetch_candles_calls),
        }
    }
}

#[async_trait]
impl Hyperliquid for MockHyperliquid {
    async fn fetch_market_metadata(&self) -> Result<Vec<MarketMetadata>, HyperliquidError> {
        if let Some(fetch_market_metadata_calls) = &self.fetch_market_metadata_calls {
            fetch_market_metadata_calls.fetch_add(1, Ordering::SeqCst);
        }
        Ok(vec![MarketMetadata {
            symbol: Market::new("BTC".into()),
            max_leverage: 50,
            asset_index: 0,
            only_isolated: false,
        }])
    }

    async fn fetch_candles(
        &self,
        market: &Market,
        _timeframe: Timeframe,
        _start: DateTime<Utc>,
    ) -> Result<Vec<Candle>, HyperliquidError> {
        if let Some(fetch_candles_calls) = &self.fetch_candles_calls {
            fetch_candles_calls.fetch_add(1, Ordering::SeqCst);
        }
        Ok(vec![Candle {
            timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
            open: 100.0,
            high: 105.0,
            low: 95.0,
            close: 102.0,
            volume: 1000.0,
            market: hyperliquid_swap_ccxt_symbol(market.as_str()),
            symbol: Symbol::from_raw(market.as_str()),
        }])
    }

    async fn fetch_funding_rates(
        &self,
        market: &Market,
        _start: DateTime<Utc>,
    ) -> Result<Vec<FundingRate>, HyperliquidError> {
        Ok(vec![FundingRate {
            timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
            rate: dec!(0.0001),
            symbol: Symbol::from_raw(market.as_str()),
        }])
    }
}

#[async_trait]
impl Hyperliquid for FailingMockHyperliquid {
    async fn fetch_market_metadata(&self) -> Result<Vec<MarketMetadata>, HyperliquidError> {
        Err(HyperliquidError::Url(url::ParseError::EmptyHost))
    }

    async fn fetch_candles(
        &self,
        _market: &Market,
        _timeframe: Timeframe,
        _start: DateTime<Utc>,
    ) -> Result<Vec<Candle>, HyperliquidError> {
        Err(HyperliquidError::Url(url::ParseError::EmptyHost))
    }

    async fn fetch_funding_rates(
        &self,
        _market: &Market,
        _start: DateTime<Utc>,
    ) -> Result<Vec<FundingRate>, HyperliquidError> {
        Err(HyperliquidError::Url(url::ParseError::EmptyHost))
    }
}

pub(crate) async fn test_services() -> IngestionServices {
    test_services_with_hyperliquid(Arc::new(MockHyperliquid::without_call_counter())).await
}

async fn in_memory_sqlite_pool() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap()
}

fn unique_test_data_dir() -> std::path::PathBuf {
    tempfile::tempdir().expect("test data dir").keep()
}

pub(crate) async fn test_services_with_hyperliquid(
    hyperliquid: Arc<dyn Hyperliquid>,
) -> IngestionServices {
    let pool = in_memory_sqlite_pool().await;
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let (market_catalog, market_catalog_projection) =
        StoreBuilder::<MarketCatalog>::new(pool.clone())
            .build()
            .await
            .unwrap();
    let (_enablement, market_enablement_projection) = StoreBuilder::<MarketEnablement>::new(pool)
        .build()
        .await
        .unwrap();

    IngestionServices {
        hyperliquid,
        data_dir: unique_test_data_dir(),
        max_concurrent_requests: 10,
        market_catalog,
        market_catalog_projection,
        market_enablement_projection,
    }
}

pub(crate) fn job_context(
    store: &Arc<Store<IngestionRun>>,
    projection: &Arc<Projection<IngestionRun>>,
    services: IngestionServices,
) -> IngestionJobContext {
    IngestionJobContext {
        run_store: Arc::clone(store),
        run_projection: Arc::clone(projection),
        services,
    }
}

pub(crate) async fn ingestion_store() -> (
    Arc<Store<IngestionRun>>,
    Arc<Projection<IngestionRun>>,
    SqlitePool,
) {
    let pool = in_memory_sqlite_pool().await;
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let (store, projection) = StoreBuilder::<IngestionRun>::new(pool.clone())
        .build()
        .await
        .unwrap();
    (store, projection, pool)
}

pub(crate) fn instant() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}
