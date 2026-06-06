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
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::finance::{self, CcxtSymbol, Market, Symbol};
use crate::hyperliquid::{Hyperliquid, HyperliquidError};
use crate::market_catalog::{CatalogMarket, MarketCatalog, MarketCatalogCommand};
use crate::market_enablement::{ENABLEMENT_STATUS, MarketEnablement, MarketId, MarketStatus};
use crate::venue::VenueRef;

/// A market's exchange metadata as fetched from a venue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MarketMetadata {
    pub(crate) symbol: Market,
    pub(crate) max_leverage: u32,
    pub(crate) asset_index: u32,
    /// `true` when the asset supports only isolated margin.
    pub(crate) only_isolated: bool,
}

/// One market's max leverage, as served to clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeverageLimit {
    pub(crate) symbol: Symbol,
    pub(crate) max_leverage: u32,
}

/// A venue's per-market leverage limits plus the time the universe behind them
/// was last observed, so clients can reason about freshness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeverageLimits {
    pub(crate) limits: Vec<LeverageLimit>,
    pub(crate) fetched_at: DateTime<Utc>,
}

/// One market's leverage limit and Hyperliquid asset index, in the ccxt-style
/// shape the frontend trading client consumes. The asset index routes orders,
/// so it must always reflect the exchange's current universe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeverageLimitEntry {
    pub(crate) symbol: CcxtSymbol,
    pub(crate) max_leverage: u32,
    pub(crate) asset_index: u32,
}

/// The `GET /hyperliquid/markets` response: the perp universe in the exact
/// shape `fetchHyperliquidMarkets` in the frontend expects (ccxt symbols,
/// camelCase keys).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarketsApiResponse {
    pub(crate) tickers: Vec<CcxtSymbol>,
    pub(crate) leverage_limits: Vec<LeverageLimitEntry>,
    pub(crate) refreshed_at: DateTime<Utc>,
}

/// Builds the markets API response from freshly fetched exchange metadata,
/// with tickers and leverage limits sorted by ccxt symbol.
pub(crate) fn markets_api_response(
    metadata: &[MarketMetadata],
    refreshed_at: DateTime<Utc>,
) -> MarketsApiResponse {
    let mut leverage_limits: Vec<LeverageLimitEntry> = metadata
        .iter()
        .map(|market| LeverageLimitEntry {
            symbol: finance::hyperliquid_swap_ccxt_symbol(market.symbol.as_str()),
            max_leverage: market.max_leverage,
            asset_index: market.asset_index,
        })
        .collect();
    leverage_limits.sort_unstable_by(|left, right| left.symbol.cmp(&right.symbol));

    let tickers = leverage_limits
        .iter()
        .map(|entry| entry.symbol.clone())
        .collect();

    MarketsApiResponse {
        tickers,
        leverage_limits,
        refreshed_at,
    }
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
    let observed_at = catalog_projection
        .load(&VenueRef::Hyperliquid)
        .await?
        .map(|catalog| catalog.observed_at());
    info!(
        markets = fetched.len(),
        observed_at = ?observed_at,
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
    use chrono::{DateTime, TimeZone, Utc};
    use proptest::prelude::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use tracing::Level;
    use tracing_test::traced_test;

    use event_sorcery::StoreBuilder;

    use super::*;
    use crate::candle::Candle;
    use crate::funding::FundingRate;
    use crate::market_catalog::{CatalogMarket, MarketCatalogCommand};
    use crate::market_enablement::MarketEnablementCommand;
    use crate::timeframe::Timeframe;

    fn metadata(symbol: &str, max_leverage: u32, asset_index: u32) -> MarketMetadata {
        MarketMetadata {
            symbol: Market::new(symbol.to_string()),
            max_leverage,
            asset_index,
            only_isolated: false,
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
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();
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
            metadata: vec![metadata("BTC", 50, 0), metadata("ETH", 25, 1)],
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
                metadata("BTC", 50, 0),
                metadata("ETH", 25, 1),
                metadata("SOL", 20, 2),
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
            metadata: vec![metadata("BTC", 50, 0), metadata("ETH", 25, 1)],
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

        let catalog = catalog_projection
            .load(&VenueRef::Hyperliquid)
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
        assert_eq!(limits.fetched_at, catalog.observed_at());
        assert!(crate::logs_contain_at(
            Level::DEBUG,
            &["leverage limits read", "markets=2"]
        ));
    }

    #[tokio::test]
    async fn leverage_limits_reflects_latest_catalog_observation_time() {
        let (catalog, catalog_projection, _enablement, _enablement_projection) =
            market_stores().await;
        let first_observed = Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap();
        let second_observed = Utc.with_ymd_and_hms(2026, 3, 16, 8, 30, 0).unwrap();

        catalog
            .send(
                &VenueRef::Hyperliquid,
                MarketCatalogCommand::RecordUniverse {
                    markets: vec![CatalogMarket::new(Symbol::from_raw("BTC"), 50)],
                    observed_at: first_observed,
                },
            )
            .await
            .unwrap();

        let first_limits = leverage_limits(VenueRef::Hyperliquid, &catalog_projection)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first_limits.fetched_at, first_observed);
        assert_eq!(first_limits.limits.len(), 1);
        assert_eq!(first_limits.limits[0].max_leverage, 50);

        catalog
            .send(
                &VenueRef::Hyperliquid,
                MarketCatalogCommand::RecordUniverse {
                    markets: vec![CatalogMarket::new(Symbol::from_raw("ETH"), 40)],
                    observed_at: second_observed,
                },
            )
            .await
            .unwrap();

        let latest_limits = leverage_limits(VenueRef::Hyperliquid, &catalog_projection)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest_limits.fetched_at, second_observed);
        assert_eq!(latest_limits.limits.len(), 1);
        assert_eq!(latest_limits.limits[0].symbol.as_str(), "ETH");
        assert_eq!(latest_limits.limits[0].max_leverage, 40);
    }

    #[test]
    fn leverage_limits_serialize_with_camel_case_fields() {
        let limits = LeverageLimits {
            limits: vec![LeverageLimit {
                symbol: Symbol::from_raw("BTC"),
                max_leverage: 50,
            }],
            fetched_at: Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap(),
        };

        let json = serde_json::to_value(&limits).unwrap();
        assert_eq!(json["limits"][0]["symbol"], "BTC");
        assert_eq!(json["limits"][0]["maxLeverage"], 50);
        assert_eq!(json["fetchedAt"], "2026-03-15T12:00:00Z");

        let roundtrip: LeverageLimits = serde_json::from_value(json).unwrap();
        assert_eq!(roundtrip, limits);
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

    #[test]
    fn markets_api_response_maps_metadata_to_sorted_ccxt_symbols() {
        let refreshed_at = Utc.with_ymd_and_hms(2026, 7, 11, 12, 0, 0).unwrap();
        let response = markets_api_response(
            &[
                metadata("kPEPE", 10, 2),
                metadata("BTC", 50, 0),
                metadata("ETH", 25, 1),
            ],
            refreshed_at,
        );

        let tickers: Vec<&str> = response.tickers.iter().map(CcxtSymbol::as_str).collect();
        assert_eq!(
            tickers,
            vec!["BTC/USDC:USDC", "ETH/USDC:USDC", "KPEPE/USDC:USDC"]
        );

        assert_eq!(response.leverage_limits.len(), 3);
        assert_eq!(response.leverage_limits[0].symbol.as_str(), "BTC/USDC:USDC");
        assert_eq!(response.leverage_limits[0].max_leverage, 50);
        assert_eq!(response.leverage_limits[0].asset_index, 0);
        assert_eq!(
            response.leverage_limits[2].symbol.as_str(),
            "KPEPE/USDC:USDC"
        );
        assert_eq!(response.leverage_limits[2].asset_index, 2);
        assert_eq!(response.refreshed_at, refreshed_at);
    }

    #[test]
    fn markets_api_response_serializes_with_camel_case_fields() {
        let refreshed_at = Utc.with_ymd_and_hms(2026, 7, 11, 12, 0, 0).unwrap();
        let response = markets_api_response(&[metadata("BTC", 50, 7)], refreshed_at);

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["tickers"][0], "BTC/USDC:USDC");
        assert_eq!(json["leverageLimits"][0]["symbol"], "BTC/USDC:USDC");
        assert_eq!(json["leverageLimits"][0]["maxLeverage"], 50);
        assert_eq!(json["leverageLimits"][0]["assetIndex"], 7);
        assert_eq!(json["refreshedAt"], "2026-07-11T12:00:00Z");
    }

    proptest! {
        /// Every fetched market must appear exactly once with its leverage and
        /// asset index intact, tickers must mirror the leverage limits, and
        /// both must come out sorted -- for any universe the exchange serves.
        #[test]
        fn markets_api_response_preserves_every_market_sorted(
            names in prop::collection::hash_set("[A-Z]{2,8}", 1..40)
        ) {
            let universe: Vec<MarketMetadata> = names
                .iter()
                .enumerate()
                .map(|(position, name)| MarketMetadata {
                    symbol: Market::new(name.clone()),
                    max_leverage: u32::try_from(position).unwrap() % 100 + 1,
                    asset_index: u32::try_from(position).unwrap(),
                    only_isolated: false,
                })
                .collect();
            let refreshed_at = Utc.with_ymd_and_hms(2026, 7, 11, 0, 0, 0).unwrap();

            let response = markets_api_response(&universe, refreshed_at);

            prop_assert_eq!(response.leverage_limits.len(), universe.len());

            let tickers: Vec<&str> = response.tickers.iter().map(CcxtSymbol::as_str).collect();
            let limit_symbols: Vec<&str> = response
                .leverage_limits
                .iter()
                .map(|entry| entry.symbol.as_str())
                .collect();
            prop_assert_eq!(&tickers, &limit_symbols);

            let mut sorted_tickers = tickers.clone();
            sorted_tickers.sort_unstable();
            prop_assert_eq!(&tickers, &sorted_tickers);

            for market in &universe {
                let ccxt_symbol = finance::hyperliquid_swap_ccxt_symbol(market.symbol.as_str());
                let entry = response
                    .leverage_limits
                    .iter()
                    .find(|entry| entry.symbol == ccxt_symbol);
                let entry = entry.expect("every fetched market must appear in the response");
                prop_assert_eq!(entry.max_leverage, market.max_leverage);
                prop_assert_eq!(entry.asset_index, market.asset_index);
                prop_assert!(entry.symbol.as_str().ends_with("/USDC:USDC"));
            }
        }
    }
}
