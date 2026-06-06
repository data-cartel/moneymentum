//! `MarketCatalog` aggregate: the exchange-listed universe of one venue.
//!
//! Pure observation -- each ingestion refresh records the full listed set, so
//! the latest snapshot fully describes the universe. It is `Retain` rather than
//! compacted because event-sorcery forbids compacting a `Table`-projected
//! aggregate (its rebuild path reads the event log); per-venue event growth is
//! one event per refresh, and `SNAPSHOT_SIZE = 1` keeps reload to a single
//! snapshot read regardless. The operator's disable decisions live in a separate
//! stream (`market_enablement`); the tradable set joins the two.

use chrono::{DateTime, Utc};
use event_sorcery::{DomainEvent, EventSourced, JobQueue, Nil, Table};
use serde::{Deserialize, Serialize};

use crate::finance::Symbol;
use crate::venue::VenueRef;

/// One listed market in a venue's catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogMarket {
    symbol: Symbol,
    max_leverage: u32,
}

impl CatalogMarket {
    pub(crate) fn new(symbol: Symbol, max_leverage: u32) -> Self {
        Self {
            symbol,
            max_leverage,
        }
    }

    pub(crate) fn symbol(&self) -> &Symbol {
        &self.symbol
    }

    pub(crate) fn max_leverage(&self) -> u32 {
        self.max_leverage
    }
}

/// The exchange-listed universe of one venue, keyed by [`VenueRef`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct MarketCatalog {
    markets: Vec<CatalogMarket>,
    observed_at: DateTime<Utc>,
}

impl MarketCatalog {
    pub(crate) fn markets(&self) -> &[CatalogMarket] {
        &self.markets
    }

    /// When the venue universe behind this snapshot was last observed.
    pub(crate) fn observed_at(&self) -> DateTime<Utc> {
        self.observed_at
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum MarketCatalogEvent {
    VenueUniverseObserved {
        markets: Vec<CatalogMarket>,
        observed_at: DateTime<Utc>,
    },
}

impl DomainEvent for MarketCatalogEvent {
    fn event_type(&self) -> String {
        "MarketCatalogEvent::VenueUniverseObserved".to_string()
    }

    fn event_version(&self) -> String {
        "1.0".to_string()
    }
}

#[derive(Debug, Clone)]
pub(crate) enum MarketCatalogCommand {
    RecordUniverse {
        markets: Vec<CatalogMarket>,
        observed_at: DateTime<Utc>,
    },
}

/// Why recording a venue's observed universe is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub(crate) enum MarketCatalogError {
    #[error("observed market universe is empty")]
    EmptyObservation,
}

impl EventSourced for MarketCatalog {
    type Id = VenueRef;
    type Event = MarketCatalogEvent;
    type Command = MarketCatalogCommand;
    type Error = MarketCatalogError;
    type Jobs = Nil;
    type Materialized = Table;

    const AGGREGATE_TYPE: &'static str = "MarketCatalog";
    const PROJECTION: Table = Table("market_catalog_view");
    const SCHEMA_VERSION: u64 = 2;
    const SNAPSHOT_SIZE: usize = 1;

    fn originate(event: &MarketCatalogEvent) -> Option<Self> {
        let MarketCatalogEvent::VenueUniverseObserved {
            markets,
            observed_at,
        } = event;
        Some(Self {
            markets: markets.clone(),
            observed_at: *observed_at,
        })
    }

    fn evolve(
        _entity: &Self,
        event: &MarketCatalogEvent,
    ) -> Result<Option<Self>, MarketCatalogError> {
        let MarketCatalogEvent::VenueUniverseObserved {
            markets,
            observed_at,
        } = event;
        Ok(Some(Self {
            markets: markets.clone(),
            observed_at: *observed_at,
        }))
    }

    fn initialize(
        command: MarketCatalogCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<MarketCatalogEvent>, MarketCatalogError> {
        let MarketCatalogCommand::RecordUniverse {
            markets,
            observed_at,
        } = command;
        if markets.is_empty() {
            return Err(MarketCatalogError::EmptyObservation);
        }

        Ok(vec![MarketCatalogEvent::VenueUniverseObserved {
            markets,
            observed_at,
        }])
    }

    fn transition(
        &self,
        command: MarketCatalogCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<MarketCatalogEvent>, MarketCatalogError> {
        let MarketCatalogCommand::RecordUniverse {
            markets,
            observed_at,
        } = command;
        if markets.is_empty() {
            return Err(MarketCatalogError::EmptyObservation);
        }

        Ok(vec![MarketCatalogEvent::VenueUniverseObserved {
            markets,
            observed_at,
        }])
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use event_sorcery::{LifecycleError, TestHarness, replay};

    use super::*;

    fn observed_at(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, day, 0, 0, 0).unwrap()
    }

    #[test]
    fn replay_records_the_only_observed_universe() {
        let catalog = replay::<MarketCatalog>(vec![MarketCatalogEvent::VenueUniverseObserved {
            markets: vec![CatalogMarket::new(Symbol::from_raw("BTC"), 50)],
            observed_at: observed_at(1),
        }])
        .unwrap()
        .unwrap();

        assert_eq!(
            catalog.markets(),
            &[CatalogMarket::new(Symbol::from_raw("BTC"), 50)]
        );
    }

    #[test]
    fn replay_reflects_only_the_latest_observed_universe() {
        let catalog = replay::<MarketCatalog>(vec![
            MarketCatalogEvent::VenueUniverseObserved {
                markets: vec![
                    CatalogMarket::new(Symbol::from_raw("BTC"), 50),
                    CatalogMarket::new(Symbol::from_raw("ETH"), 25),
                ],
                observed_at: observed_at(1),
            },
            MarketCatalogEvent::VenueUniverseObserved {
                markets: vec![CatalogMarket::new(Symbol::from_raw("SOL"), 20)],
                observed_at: observed_at(2),
            },
        ])
        .unwrap()
        .unwrap();

        assert_eq!(
            catalog.markets(),
            &[CatalogMarket::new(Symbol::from_raw("SOL"), 20)]
        );
    }

    #[test]
    fn replay_exposes_the_latest_observation_time() {
        let catalog = replay::<MarketCatalog>(vec![
            MarketCatalogEvent::VenueUniverseObserved {
                markets: vec![CatalogMarket::new(Symbol::from_raw("BTC"), 50)],
                observed_at: observed_at(1),
            },
            MarketCatalogEvent::VenueUniverseObserved {
                markets: vec![CatalogMarket::new(Symbol::from_raw("ETH"), 25)],
                observed_at: observed_at(2),
            },
        ])
        .unwrap()
        .unwrap();

        assert_eq!(catalog.observed_at(), observed_at(2));
    }

    #[tokio::test]
    async fn recording_an_empty_universe_is_refused() {
        let error = TestHarness::<MarketCatalog>::with()
            .given(vec![MarketCatalogEvent::VenueUniverseObserved {
                markets: vec![CatalogMarket::new(Symbol::from_raw("BTC"), 50)],
                observed_at: observed_at(1),
            }])
            .when(MarketCatalogCommand::RecordUniverse {
                markets: vec![],
                observed_at: observed_at(2),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(MarketCatalogError::EmptyObservation)
        ));
    }

    #[tokio::test]
    async fn recording_an_empty_universe_on_a_fresh_stream_is_refused() {
        let error = TestHarness::<MarketCatalog>::with()
            .given(vec![])
            .when(MarketCatalogCommand::RecordUniverse {
                markets: vec![],
                observed_at: observed_at(1),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(MarketCatalogError::EmptyObservation)
        ));
    }
}
