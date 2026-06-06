//! The markets domain orchestration: refreshing a venue's universe from the
//! exchange and deriving its tradable set.
//!
//! The universe and the operator disable decisions live in two separate
//! aggregates ([`crate::market_catalog`] and [`crate::market_enablement`]); this
//! module ties them together. The tradable set is catalog listings minus
//! operator disables -- a join over two projections, which makes "a refresh
//! never clobbers an operator disable" a structural guarantee rather than a
//! careful merge (the bug the old `markets.csv` left-join had to avoid by hand).

use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use event_sorcery::{Projection, ProjectionError, SendError, Store};
use serde::Serialize;
use tracing::{debug, info};

use crate::finance::{Market, Symbol};
use crate::hyperliquid::{Hyperliquid, HyperliquidError};
use crate::market_catalog::{CatalogMarket, MarketCatalog, MarketCatalogCommand};
use crate::market_enablement::{ENABLEMENT_STATUS, MarketEnablement, MarketId, MarketStatus};
use crate::venue::VenueRef;

/// A market's exchange metadata as fetched from a venue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MarketMetadata {
    pub(crate) symbol: Market,
    pub(crate) max_leverage: u32,
}

/// One market's max leverage, as served to clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeverageLimit {
    pub(crate) symbol: Symbol,
    pub(crate) max_leverage: u32,
}

/// A venue's per-market leverage limits plus the time the universe behind them
/// was last observed, so clients can reason about freshness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeverageLimits {
    pub(crate) limits: Vec<LeverageLimit>,
    pub(crate) fetched_at: DateTime<Utc>,
}

/// Why refreshing the market universe fails.
#[derive(Debug, thiserror::Error)]
pub(crate) enum RefreshError {
    #[error(transparent)]
    Hyperliquid(#[from] HyperliquidError),
    #[error(transparent)]
    RecordUniverse(#[from] SendError<MarketCatalog>),
    #[error(transparent)]
    Catalog(#[from] ProjectionError<MarketCatalog>),
    #[error(transparent)]
    Enablement(#[from] ProjectionError<MarketEnablement>),
}

/// Refreshes the Hyperliquid universe from the live exchange and returns the
/// tradable markets: every listed market the operator has not disabled.
pub(crate) async fn refresh_markets(
    client: &dyn Hyperliquid,
    catalog: &Store<MarketCatalog>,
    catalog_projection: &Projection<MarketCatalog>,
    enablement_projection: &Projection<MarketEnablement>,
) -> Result<Vec<Market>, RefreshError> {
    let fetched = client.fetch_market_metadata().await?;
    let observed: Vec<CatalogMarket> = fetched
        .iter()
        .map(|market| {
            CatalogMarket::new(
                Symbol::from_raw(market.symbol.as_str()),
                market.max_leverage,
            )
        })
        .collect();

    catalog
        .send(
            &VenueRef::Hyperliquid,
            MarketCatalogCommand::RecordUniverse {
                markets: observed,
                observed_at: Utc::now(),
            },
        )
        .await?;

    let tradable = tradable_markets(
        VenueRef::Hyperliquid,
        catalog_projection,
        enablement_projection,
    )
    .await?;
    info!(
        markets = fetched.len(),
        tradable = tradable.len(),
        "markets metadata refreshed"
    );
    Ok(tradable)
}

/// The tradable markets of a venue: catalog listings minus operator disables.
pub(crate) async fn tradable_markets(
    venue: VenueRef,
    catalog_projection: &Projection<MarketCatalog>,
    enablement_projection: &Projection<MarketEnablement>,
) -> Result<Vec<Market>, RefreshError> {
    let Some(catalog) = catalog_projection.load(&venue).await? else {
        return Ok(Vec::new());
    };

    let disabled: BTreeSet<Symbol> = enablement_projection
        .filter(ENABLEMENT_STATUS, &MarketStatus::Disabled)
        .await?
        .into_iter()
        .filter(|(id, _)| id.venue() == venue)
        .map(|(id, _): (MarketId, MarketEnablement)| id.into_symbol())
        .collect();

    let tradable = catalog
        .markets()
        .iter()
        .filter(|market| !disabled.contains(market.symbol()))
        .map(|market| Market::new(market.symbol().as_str().to_string()))
        .collect();
    Ok(tradable)
}

/// A venue's per-market max-leverage limits, read straight from the catalog
/// snapshot. Unlike [`tradable_markets`], operator disable flags do not apply:
/// leverage is venue metadata a client may need for any position it holds.
/// `None` when the venue has never been observed.
pub(crate) async fn leverage_limits(
    venue: VenueRef,
    catalog_projection: &Projection<MarketCatalog>,
) -> Result<Option<LeverageLimits>, ProjectionError<MarketCatalog>> {
    let Some(catalog) = catalog_projection.load(&venue).await? else {
        return Ok(None);
    };

    let limits: Vec<LeverageLimit> = catalog
        .markets()
        .iter()
        .map(|market| LeverageLimit {
            symbol: market.symbol().clone(),
            max_leverage: market.max_leverage(),
        })
        .collect();
    debug!(venue = %venue, markets = limits.len(), "leverage limits read");
    Ok(Some(LeverageLimits {
        limits,
        fetched_at: catalog.observed_at(),
    }))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use async_trait::async_trait;
    use chrono::{DateTime, Utc};
    use sqlx::SqlitePool;
    use tracing::Level;
    use tracing_test::traced_test;

    use event_sorcery::StoreBuilder;

    use super::*;
    use crate::candle::Candle;
    use crate::funding::FundingRate;
    use crate::market_enablement::MarketEnablementCommand;
    use crate::timeframe::Timeframe;

    fn metadata(symbol: &str, max_leverage: u32) -> MarketMetadata {
        MarketMetadata {
            symbol: Market::new(symbol.to_string()),
            max_leverage,
        }
    }

    struct StubClient {
        metadata: Vec<MarketMetadata>,
    }

    #[async_trait]
    impl Hyperliquid for StubClient {
        async fn fetch_market_metadata(&self) -> Result<Vec<MarketMetadata>, HyperliquidError> {
            Ok(self.metadata.clone())
        }

        async fn fetch_candles(
            &self,
            _market: &Market,
            _timeframe: Timeframe,
            _start: DateTime<Utc>,
        ) -> Result<Vec<Candle>, HyperliquidError> {
            Ok(vec![])
        }

        async fn fetch_funding_rates(
            &self,
            _market: &Market,
            _start: DateTime<Utc>,
        ) -> Result<Vec<FundingRate>, HyperliquidError> {
            Ok(vec![])
        }
    }

    async fn market_stores() -> (
        Arc<Store<MarketCatalog>>,
        Arc<Projection<MarketCatalog>>,
        Arc<Store<MarketEnablement>>,
        Arc<Projection<MarketEnablement>>,
    ) {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (catalog, catalog_projection) = StoreBuilder::<MarketCatalog>::new(pool.clone())
            .build()
            .await
            .unwrap();
        let (enablement, enablement_projection) = StoreBuilder::<MarketEnablement>::new(pool)
            .build()
            .await
            .unwrap();
        (
            catalog,
            catalog_projection,
            enablement,
            enablement_projection,
        )
    }

    fn symbols(markets: &[Market]) -> Vec<&str> {
        markets.iter().map(Market::as_str).collect()
    }

    #[traced_test]
    #[tokio::test]
    async fn refresh_records_the_universe_and_excludes_operator_disables() {
        let (catalog, catalog_projection, enablement, enablement_projection) =
            market_stores().await;
        let client = StubClient {
            metadata: vec![metadata("BTC", 50), metadata("ETH", 25)],
        };

        let tradable = refresh_markets(
            &client,
            &catalog,
            &catalog_projection,
            &enablement_projection,
        )
        .await
        .unwrap();
        assert_eq!(symbols(&tradable), vec!["BTC", "ETH"]);
        assert!(crate::logs_contain_at(
            Level::INFO,
            &["markets metadata refreshed"]
        ));

        // The operator disables BTC; a later refresh keeps it excluded.
        enablement
            .send(
                &MarketId::new(VenueRef::Hyperliquid, Symbol::from_raw("BTC")),
                MarketEnablementCommand::Disable { reason: None },
            )
            .await
            .unwrap();

        let tradable = refresh_markets(
            &client,
            &catalog,
            &catalog_projection,
            &enablement_projection,
        )
        .await
        .unwrap();
        assert_eq!(symbols(&tradable), vec!["ETH"]);
    }

    #[traced_test]
    #[tokio::test]
    async fn refresh_discovers_newly_listed_markets() {
        let (catalog, catalog_projection, _enablement, enablement_projection) =
            market_stores().await;
        let client = StubClient {
            metadata: vec![
                metadata("BTC", 50),
                metadata("ETH", 25),
                metadata("SOL", 20),
            ],
        };

        let tradable = refresh_markets(
            &client,
            &catalog,
            &catalog_projection,
            &enablement_projection,
        )
        .await
        .unwrap();

        let mut discovered = symbols(&tradable);
        discovered.sort_unstable();
        assert_eq!(discovered, vec!["BTC", "ETH", "SOL"]);
        assert!(crate::logs_contain_at(
            Level::INFO,
            &["markets metadata refreshed"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn leverage_limits_reports_every_listed_market_ignoring_disables() {
        let (catalog, catalog_projection, enablement, enablement_projection) =
            market_stores().await;
        let client = StubClient {
            metadata: vec![metadata("BTC", 50), metadata("ETH", 25)],
        };
        refresh_markets(
            &client,
            &catalog,
            &catalog_projection,
            &enablement_projection,
        )
        .await
        .unwrap();

        // Disabling a market removes it from the tradable set but not from the
        // leverage limits -- leverage is venue metadata, not a trading decision.
        enablement
            .send(
                &MarketId::new(VenueRef::Hyperliquid, Symbol::from_raw("BTC")),
                MarketEnablementCommand::Disable { reason: None },
            )
            .await
            .unwrap();

        let limits = leverage_limits(VenueRef::Hyperliquid, &catalog_projection)
            .await
            .unwrap()
            .unwrap();

        let mut by_symbol: Vec<(&str, u32)> = limits
            .limits
            .iter()
            .map(|limit| (limit.symbol.as_str(), limit.max_leverage))
            .collect();
        by_symbol.sort_unstable();
        assert_eq!(by_symbol, vec![("BTC", 50), ("ETH", 25)]);
        assert!(crate::logs_contain_at(
            Level::DEBUG,
            &["leverage limits read", "markets=2"]
        ));
    }

    #[tokio::test]
    async fn leverage_limits_returns_none_for_an_unobserved_venue() {
        let (_catalog, catalog_projection, _enablement, _enablement_projection) =
            market_stores().await;

        let limits = leverage_limits(VenueRef::Hyperliquid, &catalog_projection)
            .await
            .unwrap();

        assert!(limits.is_none());
    }
}
