//! `MarketEnablement` aggregate: the operator's deliberate disable/enable
//! decisions for a single market, retained forever.
//!
//! A market with no stream is enabled by default; this aggregate records only
//! the operator's explicit actions, which survive every exchange refresh. The
//! tradable set (see `market_metadata`) is catalog listings minus the markets
//! whose enablement stream is currently `Disabled`.

use std::fmt::{self, Display};
use std::str::FromStr;

use event_sorcery::{Column, DomainEvent, EventSourced, JobQueue, Nil, Table};
use serde::{Deserialize, Serialize};

use crate::finance::Symbol;
use crate::venue::{UnknownVenue, VenueRef};

/// Identity of one market on one venue: the key of a [`MarketEnablement`]
/// stream. Encoded as `venue:symbol`; neither component contains `:`, so the
/// split is unambiguous.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MarketId {
    venue: VenueRef,
    symbol: Symbol,
}

impl MarketId {
    pub(crate) fn new(venue: VenueRef, symbol: Symbol) -> Self {
        Self { venue, symbol }
    }

    pub(crate) fn venue(&self) -> VenueRef {
        self.venue
    }

    pub(crate) fn into_symbol(self) -> Symbol {
        self.symbol
    }
}

impl Display for MarketId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{}", self.venue, self.symbol.as_str())
    }
}

impl FromStr for MarketId {
    type Err = ParseMarketIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (venue, symbol) = value
            .split_once(':')
            .ok_or(ParseMarketIdError::MissingSeparator)?;
        Ok(Self {
            venue: venue.parse()?,
            symbol: Symbol::from_raw(symbol),
        })
    }
}

/// Why a market id string cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum ParseMarketIdError {
    #[error("market id must be 'venue:symbol'")]
    MissingSeparator,
    #[error(transparent)]
    UnknownVenue(#[from] UnknownVenue),
}

/// Whether a market is tradable or has been retired by the operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT")]
pub(crate) enum MarketStatus {
    Enabled,
    Disabled,
}

/// The operator's enablement decision for one market.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct MarketEnablement {
    status: MarketStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum MarketEnablementEvent {
    DisabledByOperator { reason: Option<String> },
    EnabledByOperator,
}

impl DomainEvent for MarketEnablementEvent {
    fn event_type(&self) -> String {
        match self {
            Self::DisabledByOperator { .. } => "MarketEnablementEvent::DisabledByOperator",
            Self::EnabledByOperator => "MarketEnablementEvent::EnabledByOperator",
        }
        .to_string()
    }

    fn event_version(&self) -> String {
        "1.0".to_string()
    }
}

#[derive(Debug, Clone)]
pub(crate) enum MarketEnablementCommand {
    Disable { reason: Option<String> },
    Enable,
}

/// Why an enablement command is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub(crate) enum MarketEnablementError {
    #[error("market is already disabled")]
    AlreadyDisabled,
    #[error("market is already enabled")]
    AlreadyEnabled,
}

impl EventSourced for MarketEnablement {
    type Id = MarketId;
    type Event = MarketEnablementEvent;
    type Command = MarketEnablementCommand;
    type Error = MarketEnablementError;
    type Jobs = Nil;
    type Materialized = Table;

    const AGGREGATE_TYPE: &'static str = "MarketEnablement";
    const PROJECTION: Table = Table("market_enablement_view");
    const SCHEMA_VERSION: u64 = 1;
    const SNAPSHOT_SIZE: usize = 1;

    fn originate(event: &MarketEnablementEvent) -> Option<Self> {
        match event {
            MarketEnablementEvent::DisabledByOperator { .. } => Some(Self {
                status: MarketStatus::Disabled,
            }),
            MarketEnablementEvent::EnabledByOperator => None,
        }
    }

    fn evolve(
        _entity: &Self,
        event: &MarketEnablementEvent,
    ) -> Result<Option<Self>, MarketEnablementError> {
        Ok(Some(Self {
            status: status_after(event),
        }))
    }

    fn initialize(
        command: MarketEnablementCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<MarketEnablementEvent>, MarketEnablementError> {
        match command {
            MarketEnablementCommand::Disable { reason } => {
                Ok(vec![MarketEnablementEvent::DisabledByOperator { reason }])
            }
            // A market with no stream is enabled by default, so Enable is a
            // no-op that has nothing to record -- refuse it like enabling an
            // already-Enabled market.
            MarketEnablementCommand::Enable => Err(MarketEnablementError::AlreadyEnabled),
        }
    }

    fn transition(
        &self,
        command: MarketEnablementCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<MarketEnablementEvent>, MarketEnablementError> {
        match (command, self.status) {
            (MarketEnablementCommand::Disable { .. }, MarketStatus::Disabled) => {
                Err(MarketEnablementError::AlreadyDisabled)
            }
            (MarketEnablementCommand::Enable, MarketStatus::Enabled) => {
                Err(MarketEnablementError::AlreadyEnabled)
            }
            (MarketEnablementCommand::Disable { reason }, MarketStatus::Enabled) => {
                Ok(vec![MarketEnablementEvent::DisabledByOperator { reason }])
            }
            (MarketEnablementCommand::Enable, MarketStatus::Disabled) => {
                Ok(vec![MarketEnablementEvent::EnabledByOperator])
            }
        }
    }
}

/// The status an enablement event puts the market into.
fn status_after(event: &MarketEnablementEvent) -> MarketStatus {
    match event {
        MarketEnablementEvent::DisabledByOperator { .. } => MarketStatus::Disabled,
        MarketEnablementEvent::EnabledByOperator => MarketStatus::Enabled,
    }
}

/// The generated `status` column on `market_enablement_view`.
pub(crate) const ENABLEMENT_STATUS: Column = Column("status");

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use event_sorcery::{LifecycleError, StoreBuilder, TestHarness};
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    #[test]
    fn market_id_round_trips_through_its_string_encoding() {
        let id = MarketId::new(VenueRef::Hyperliquid, Symbol::from_raw("BTC"));
        let parsed: MarketId = id.to_string().parse().unwrap();
        assert_eq!(parsed, id);
    }

    #[test]
    fn market_id_rejects_a_string_without_a_separator() {
        let error = "BTC".parse::<MarketId>().unwrap_err();
        assert_eq!(error, ParseMarketIdError::MissingSeparator);
    }

    #[tokio::test]
    async fn disabling_an_enabled_market_emits_disabled() {
        TestHarness::<MarketEnablement>::with()
            .given(vec![
                MarketEnablementEvent::DisabledByOperator { reason: None },
                MarketEnablementEvent::EnabledByOperator,
            ])
            .when(MarketEnablementCommand::Disable {
                reason: Some("delisting soon".to_string()),
            })
            .await
            .then_expect_events(&[MarketEnablementEvent::DisabledByOperator {
                reason: Some("delisting soon".to_string()),
            }]);
    }

    #[tokio::test]
    async fn disabling_an_already_disabled_market_is_refused() {
        let error = TestHarness::<MarketEnablement>::with()
            .given(vec![MarketEnablementEvent::DisabledByOperator {
                reason: None,
            }])
            .when(MarketEnablementCommand::Disable { reason: None })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(MarketEnablementError::AlreadyDisabled)
        ));
    }

    #[tokio::test]
    async fn enabling_an_already_enabled_market_is_refused() {
        let error = TestHarness::<MarketEnablement>::with()
            .given(vec![
                MarketEnablementEvent::DisabledByOperator { reason: None },
                MarketEnablementEvent::EnabledByOperator,
            ])
            .when(MarketEnablementCommand::Enable)
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(MarketEnablementError::AlreadyEnabled)
        ));
    }

    #[tokio::test]
    async fn enabling_a_market_with_no_stream_is_refused() {
        let error = TestHarness::<MarketEnablement>::with()
            .given(vec![])
            .when(MarketEnablementCommand::Enable)
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(MarketEnablementError::AlreadyEnabled)
        ));
    }

    #[tokio::test]
    async fn enablement_view_status_column_filters_disabled_markets() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (store, projection) = StoreBuilder::<MarketEnablement>::new(pool.clone())
            .build()
            .await
            .unwrap();

        let btc_id = MarketId::new(VenueRef::Hyperliquid, Symbol::from_raw("BTC"));
        let eth_id = MarketId::new(VenueRef::Hyperliquid, Symbol::from_raw("ETH"));

        store
            .send(
                &btc_id,
                MarketEnablementCommand::Disable {
                    reason: Some("maintenance".to_string()),
                },
            )
            .await
            .unwrap();
        store
            .send(&eth_id, MarketEnablementCommand::Disable { reason: None })
            .await
            .unwrap();
        store
            .send(&eth_id, MarketEnablementCommand::Enable)
            .await
            .unwrap();

        let disabled = projection
            .filter(ENABLEMENT_STATUS, &MarketStatus::Disabled)
            .await
            .unwrap();
        assert_eq!(disabled.len(), 1);
        assert_eq!(disabled[0].0, btc_id);
    }

    #[tokio::test]
    async fn enablement_snapshot_persists_the_latest_status() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let store = Arc::new(
            StoreBuilder::<MarketEnablement>::new(pool.clone())
                .build()
                .await
                .unwrap()
                .0,
        );

        let market_id = MarketId::new(VenueRef::Hyperliquid, Symbol::from_raw("BTC"));
        store
            .send(
                &market_id,
                MarketEnablementCommand::Disable { reason: None },
            )
            .await
            .unwrap();
        store
            .send(&market_id, MarketEnablementCommand::Enable)
            .await
            .unwrap();
        store
            .send(
                &market_id,
                MarketEnablementCommand::Disable {
                    reason: Some("delisting soon".to_string()),
                },
            )
            .await
            .unwrap();

        let payload: String = sqlx::query_scalar(
            "SELECT payload FROM snapshots
             WHERE aggregate_type = 'MarketEnablement' AND aggregate_id = ?1",
        )
        .bind(market_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        let snapshot: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(snapshot["Live"]["status"], "Disabled");
    }
}
