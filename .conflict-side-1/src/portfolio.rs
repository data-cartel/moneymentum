//! Portfolio aggregate: durable manager intent.
//!
//! A `Portfolio` is the centerpiece of the event-sourced persistence layer (see
//! `adrs/0001`). It owns a named portfolio's identity, lifecycle, and -- the
//! point of persisting it server-side -- the **target** as an immutable stream
//! of revisions. A target is proportions, not positions: signed weights (long
//! positive, short negative) whose absolute values sum to one, scaled by a
//! leverage multiplier (SPEC: "portfolios as proportions, not positions"). It
//! is the source of truth a future auto-rebalancer diffs current holdings
//! against.
//!
//! The aggregate is pure: a target is recorded intent, never a market read, so
//! handlers perform no I/O and carry no venue coupling. Instruments and venues
//! are [`InstrumentRef`]/[`VenueRef`] value objects in the event payload, never
//! aggregate keys or bare strings, so adding a venue or instrument class is one
//! enum variant plus an adapter with no change to this aggregate.

use std::collections::BTreeMap;
use std::fmt::{self, Display};
use std::str::FromStr;

use event_sorcery::{Column, DomainEvent, EventSourced, JobQueue, Nil, Table};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::finance::Symbol;
use crate::venue::VenueRef;

/// Opaque, server-minted identity for a portfolio.
///
/// A `Uuid` rather than a human name so a portfolio exists before any name or
/// chain binding and so the multi-portfolio future is just more ids, not a
/// schema change. `Display`/`FromStr` round-trip through the canonical hyphenated
/// form, which is the string written to the event store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct PortfolioId(Uuid);

impl PortfolioId {
    /// Mints a fresh random identity for a new portfolio.
    pub(crate) fn generate() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Display for PortfolioId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        Display::fmt(&self.0, formatter)
    }
}

impl FromStr for PortfolioId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self)
    }
}

/// Longest portfolio name we accept, in characters.
const MAX_PORTFOLIO_NAME_CHARS: usize = 128;

/// A portfolio's display name: non-empty once surrounding whitespace is
/// trimmed, and no longer than [`MAX_PORTFOLIO_NAME_CHARS`]. Construction is the
/// only way to get one, so a `PortfolioName` that exists is always presentable.
/// Replay deserializes stored names without re-checking -- they were valid when
/// first written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PortfolioName(String);

impl PortfolioName {
    /// Parses a raw name, trimming whitespace and rejecting empty or overlong
    /// input.
    pub(crate) fn new(raw: &str) -> Result<Self, PortfolioNameError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(PortfolioNameError::Empty);
        }

        let length = trimmed.chars().count();
        if length > MAX_PORTFOLIO_NAME_CHARS {
            return Err(PortfolioNameError::TooLong { length });
        }

        Ok(Self(trimmed.to_string()))
    }
}

/// Why a proposed portfolio name is rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum PortfolioNameError {
    #[error("portfolio name must not be empty")]
    Empty,
    #[error("portfolio name must be at most {MAX_PORTFOLIO_NAME_CHARS} characters, got {length}")]
    TooLong { length: usize },
}

/// The currency a portfolio's value is denominated in.
///
/// Only USDC is supported today; the enum keeps the denomination type-safe and
/// makes adding another base currency an additive change rather than a string
/// audit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum BaseCurrency {
    Usdc,
}

/// A venue-agnostic reference to a tradable instrument.
///
/// Embedded in event payloads, never used as an aggregate key. Only perpetual
/// futures exist today; spot and native-asset variants are added when a venue
/// that trades them is integrated, which is backward compatible because old
/// events never carry the new variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum InstrumentRef {
    Perp { venue: VenueRef, symbol: Symbol },
}

/// Total exposure as a multiple of net asset value. Strictly positive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Leverage(Decimal);

impl Leverage {
    /// Builds a leverage multiplier, rejecting anything not strictly positive.
    pub(crate) fn new(multiplier: Decimal) -> Result<Self, TargetError> {
        if multiplier <= Decimal::ZERO {
            return Err(TargetError::NonPositiveLeverage { multiplier });
        }

        Ok(Self(multiplier))
    }
}

/// A signed proportion of a portfolio: positive for a long leg, negative for a
/// short leg. `Decimal` makes the non-finite weights that an `f64` target would
/// admit unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SignedWeight(Decimal);

impl SignedWeight {
    pub(crate) fn new(weight: Decimal) -> Self {
        Self(weight)
    }

    fn magnitude(self) -> Decimal {
        self.0.abs()
    }
}

/// A complete target portfolio: a non-empty set of weighted instruments whose
/// absolute weights sum to one, scaled by a leverage multiplier.
///
/// The normalization invariant is checked once, at construction (parse, don't
/// validate), so a `TargetRevision` that exists is always a valid target. Replay
/// deserializes stored revisions without re-checking: they were valid when first
/// written and events are immutable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TargetRevision {
    legs: Vec<TargetLeg>,
    leverage: Leverage,
}

/// One instrument's weight within a [`TargetRevision`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TargetLeg {
    instrument: InstrumentRef,
    weight: SignedWeight,
}

/// Largest absolute deviation of the summed weights from one that still counts
/// as normalized (1e-6), mirroring the tolerance the stateless beta/risk path
/// uses. A function because `Decimal` has no `const` constructor for this value.
fn normalization_tolerance() -> Decimal {
    Decimal::new(1, 6)
}

impl TargetRevision {
    /// Builds a target from weighted legs and a leverage multiplier.
    ///
    /// # Errors
    ///
    /// [`TargetError::EmptyTarget`] if there are no legs,
    /// [`TargetError::DuplicateInstrument`] if two legs name the same
    /// instrument, or [`TargetError::WeightsNotNormalized`] if the absolute
    /// weights do not sum to one within [`normalization_tolerance`].
    pub(crate) fn new(legs: Vec<TargetLeg>, leverage: Leverage) -> Result<Self, TargetError> {
        if legs.is_empty() {
            return Err(TargetError::EmptyTarget);
        }

        if let Some(duplicate) = legs.iter().enumerate().find_map(|(index, leg)| {
            legs.iter()
                .take(index)
                .any(|earlier| earlier.instrument == leg.instrument)
                .then(|| leg.instrument.clone())
        }) {
            return Err(TargetError::DuplicateInstrument {
                instrument: duplicate,
            });
        }

        let absolute_sum: Decimal = legs.iter().map(|leg| leg.weight.magnitude()).sum();
        if (absolute_sum - Decimal::ONE).abs() > normalization_tolerance() {
            return Err(TargetError::WeightsNotNormalized { absolute_sum });
        }

        Ok(Self { legs, leverage })
    }
}

impl TargetLeg {
    pub(crate) fn new(instrument: InstrumentRef, weight: SignedWeight) -> Self {
        Self { instrument, weight }
    }
}

/// Why a proposed target is rejected before it can be recorded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub(crate) enum TargetError {
    #[error("a target must hold at least one instrument")]
    EmptyTarget,
    #[error("leverage must be positive, got {multiplier}")]
    NonPositiveLeverage { multiplier: Decimal },
    #[error("absolute target weights must sum to 1, got {absolute_sum}")]
    WeightsNotNormalized { absolute_sum: Decimal },
    #[error("a target must not name the same instrument twice")]
    DuplicateInstrument { instrument: InstrumentRef },
}

/// Whether a portfolio is still managed or has been retired.
///
/// A field on the entity (rather than a `Lifecycle` variant) so the projection
/// can expose it as a generated column for status-filtered queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT")]
pub(crate) enum PortfolioStatus {
    Active,
    Archived,
}

impl PortfolioStatus {
    /// Parses the lowercase status names accepted as a list-filter query value.
    pub(crate) fn from_query(raw: &str) -> Option<Self> {
        match raw {
            "active" => Some(Self::Active),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
}

/// A managed portfolio's durable state: identity, lifecycle, and current target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Portfolio {
    name: PortfolioName,
    base_currency: BaseCurrency,
    status: PortfolioStatus,
    target: Option<TargetRevision>,
}

/// The immutable facts a portfolio's history is made of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PortfolioEvent {
    Opened {
        name: PortfolioName,
        base_currency: BaseCurrency,
    },
    TargetRevised {
        target: TargetRevision,
    },
    Renamed {
        name: PortfolioName,
    },
    Archived,
}

impl DomainEvent for PortfolioEvent {
    fn event_type(&self) -> String {
        match self {
            Self::Opened { .. } => "PortfolioEvent::Opened",
            Self::TargetRevised { .. } => "PortfolioEvent::TargetRevised",
            Self::Renamed { .. } => "PortfolioEvent::Renamed",
            Self::Archived => "PortfolioEvent::Archived",
        }
        .to_string()
    }

    fn event_version(&self) -> String {
        "1.0".to_string()
    }
}

/// Intent expressed against a portfolio. Routed to `initialize` before the
/// portfolio exists and to `transition` once it does.
#[derive(Debug, Clone)]
pub(crate) enum PortfolioCommand {
    Open {
        name: PortfolioName,
        base_currency: BaseCurrency,
    },
    ReviseTarget {
        target: TargetRevision,
    },
    Rename {
        name: PortfolioName,
    },
    Archive,
}

/// Why a command is refused by the portfolio state machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub(crate) enum PortfolioError {
    #[error("portfolio already exists")]
    AlreadyOpen,
    #[error("portfolio has not been opened")]
    NotOpen,
    #[error("portfolio is archived")]
    Archived,
}

impl EventSourced for Portfolio {
    type Id = PortfolioId;
    type Event = PortfolioEvent;
    type Command = PortfolioCommand;
    type Error = PortfolioError;
    type Jobs = Nil;
    type Materialized = Table;

    const AGGREGATE_TYPE: &'static str = "Portfolio";
    const PROJECTION: Table = Table("portfolio_view");
    const SCHEMA_VERSION: u64 = 1;

    fn originate(event: &PortfolioEvent) -> Option<Self> {
        match event {
            PortfolioEvent::Opened {
                name,
                base_currency,
            } => Some(Self {
                name: name.clone(),
                base_currency: *base_currency,
                status: PortfolioStatus::Active,
                target: None,
            }),
            PortfolioEvent::TargetRevised { .. }
            | PortfolioEvent::Renamed { .. }
            | PortfolioEvent::Archived => None,
        }
    }

    fn evolve(entity: &Self, event: &PortfolioEvent) -> Result<Option<Self>, PortfolioError> {
        match event {
            PortfolioEvent::Opened { .. } => Ok(None),
            PortfolioEvent::TargetRevised { target } => Ok(Some(Self {
                target: Some(target.clone()),
                ..entity.clone()
            })),
            PortfolioEvent::Renamed { name } => Ok(Some(Self {
                name: name.clone(),
                ..entity.clone()
            })),
            PortfolioEvent::Archived => Ok(Some(Self {
                status: PortfolioStatus::Archived,
                ..entity.clone()
            })),
        }
    }

    fn initialize(
        command: PortfolioCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<PortfolioEvent>, PortfolioError> {
        match command {
            PortfolioCommand::Open {
                name,
                base_currency,
            } => Ok(vec![PortfolioEvent::Opened {
                name,
                base_currency,
            }]),
            PortfolioCommand::ReviseTarget { .. }
            | PortfolioCommand::Rename { .. }
            | PortfolioCommand::Archive => Err(PortfolioError::NotOpen),
        }
    }

    fn transition(
        &self,
        command: PortfolioCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<PortfolioEvent>, PortfolioError> {
        match command {
            PortfolioCommand::Open { .. } => Err(PortfolioError::AlreadyOpen),
            _ if matches!(self.status, PortfolioStatus::Archived) => Err(PortfolioError::Archived),
            PortfolioCommand::ReviseTarget { target } => {
                Ok(vec![PortfolioEvent::TargetRevised { target }])
            }
            PortfolioCommand::Rename { name } => Ok(vec![PortfolioEvent::Renamed { name }]),
            PortfolioCommand::Archive => Ok(vec![PortfolioEvent::Archived]),
        }
    }
}

/// The generated `status` column on `portfolio_view`, for status-filtered reads.
pub(crate) const STATUS: Column = Column("status");

impl TargetRevision {
    /// Builds a target where every weight is a Hyperliquid perp keyed by ticker.
    ///
    /// The one venue/instrument shape the beachhead supports; the API speaks
    /// perp symbols, and this maps them onto the venue-agnostic event model.
    pub(crate) fn from_hyperliquid_perp_weights(
        weights: impl IntoIterator<Item = (Symbol, Decimal)>,
        leverage: Decimal,
    ) -> Result<Self, TargetError> {
        let leverage = Leverage::new(leverage)?;
        let legs = weights
            .into_iter()
            .map(|(symbol, weight)| {
                TargetLeg::new(
                    InstrumentRef::Perp {
                        venue: VenueRef::Hyperliquid,
                        symbol,
                    },
                    SignedWeight::new(weight),
                )
            })
            .collect();

        Self::new(legs, leverage)
    }
}

impl Portfolio {
    /// Renders the portfolio as the API presentation shape.
    pub(crate) fn to_view(&self, id: &PortfolioId) -> PortfolioView {
        PortfolioView {
            id: *id,
            name: self.name.clone(),
            status: self.status,
            target: self.target.as_ref().map(TargetView::from),
        }
    }
}

/// API presentation of a portfolio. Distinct from the persisted entity so the
/// event payload shape can evolve independently of the wire format.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortfolioView {
    id: PortfolioId,
    name: PortfolioName,
    status: PortfolioStatus,
    target: Option<TargetView>,
}

/// API presentation of a target: perp weights by ticker plus the leverage
/// multiplier. Weights and leverage serialize as decimal strings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetView {
    weights: BTreeMap<Symbol, Decimal>,
    leverage: Decimal,
}

impl From<&TargetRevision> for TargetView {
    fn from(target: &TargetRevision) -> Self {
        let weights = target
            .legs
            .iter()
            .map(|leg| {
                let InstrumentRef::Perp { symbol, .. } = &leg.instrument;
                (symbol.clone(), leg.weight.0)
            })
            .collect();

        Self {
            weights,
            leverage: target.leverage.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;
    use sqlx::SqlitePool;

    use event_sorcery::{LifecycleError, StoreBuilder, TestHarness, TestStore, replay};

    use super::*;

    fn name(raw: &str) -> PortfolioName {
        PortfolioName::new(raw).unwrap()
    }

    fn perp(symbol: &str, weight: Decimal) -> TargetLeg {
        TargetLeg::new(
            InstrumentRef::Perp {
                venue: VenueRef::Hyperliquid,
                symbol: Symbol::from_raw(symbol),
            },
            SignedWeight::new(weight),
        )
    }

    fn long_short_target() -> TargetRevision {
        TargetRevision::new(
            vec![perp("BTC", dec!(0.6)), perp("ETH", dec!(-0.4))],
            Leverage::new(dec!(2)).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn target_rejects_weights_that_do_not_normalize() {
        let error = TargetRevision::new(
            vec![perp("BTC", dec!(0.6)), perp("ETH", dec!(0.6))],
            Leverage::new(dec!(1)).unwrap(),
        )
        .unwrap_err();

        assert_eq!(
            error,
            TargetError::WeightsNotNormalized {
                absolute_sum: dec!(1.2)
            }
        );
    }

    #[test]
    fn target_accepts_signed_weights_summing_to_one_in_magnitude() {
        let target = long_short_target();
        assert_eq!(target.legs.len(), 2);
    }

    #[test]
    fn target_rejects_non_positive_leverage() {
        assert_eq!(
            Leverage::new(dec!(0)).unwrap_err(),
            TargetError::NonPositiveLeverage {
                multiplier: dec!(0)
            }
        );
    }

    #[test]
    fn target_rejects_empty_legs() {
        let error = TargetRevision::new(vec![], Leverage::new(dec!(1)).unwrap()).unwrap_err();
        assert_eq!(error, TargetError::EmptyTarget);
    }

    #[test]
    fn target_rejects_duplicate_instruments() {
        let error = TargetRevision::new(
            vec![perp("BTC", dec!(0.5)), perp("BTC", dec!(0.5))],
            Leverage::new(dec!(1)).unwrap(),
        )
        .unwrap_err();

        assert_eq!(
            error,
            TargetError::DuplicateInstrument {
                instrument: InstrumentRef::Perp {
                    venue: VenueRef::Hyperliquid,
                    symbol: Symbol::from_raw("BTC"),
                },
            }
        );
    }

    #[test]
    fn portfolio_name_trims_surrounding_whitespace_and_rejects_empty() {
        assert_eq!(PortfolioName::new("  macro  ").unwrap(), name("macro"));
        assert_eq!(
            PortfolioName::new("   ").unwrap_err(),
            PortfolioNameError::Empty
        );
    }

    #[test]
    fn portfolio_name_rejects_overlong_input() {
        let overlong = "x".repeat(MAX_PORTFOLIO_NAME_CHARS + 1);
        assert_eq!(
            PortfolioName::new(&overlong).unwrap_err(),
            PortfolioNameError::TooLong {
                length: MAX_PORTFOLIO_NAME_CHARS + 1
            }
        );
    }

    #[test]
    fn replay_reconstructs_the_current_target() {
        let portfolio = replay::<Portfolio>(vec![
            PortfolioEvent::Opened {
                name: name("macro"),
                base_currency: BaseCurrency::Usdc,
            },
            PortfolioEvent::TargetRevised {
                target: long_short_target(),
            },
        ])
        .unwrap()
        .unwrap();

        assert_eq!(portfolio.status, PortfolioStatus::Active);
        assert_eq!(portfolio.target, Some(long_short_target()));
    }

    #[test]
    fn replay_rejects_history_without_an_opening_event() {
        let error = replay::<Portfolio>(vec![PortfolioEvent::Archived]).unwrap_err();
        assert!(matches!(error, LifecycleError::EventCantOriginate { .. }));
    }

    #[tokio::test]
    async fn opening_then_revising_emits_a_target_revision() {
        TestHarness::<Portfolio>::with()
            .given(vec![PortfolioEvent::Opened {
                name: name("macro"),
                base_currency: BaseCurrency::Usdc,
            }])
            .when(PortfolioCommand::ReviseTarget {
                target: long_short_target(),
            })
            .await
            .then_expect_events(&[PortfolioEvent::TargetRevised {
                target: long_short_target(),
            }]);
    }

    #[tokio::test]
    async fn revising_an_archived_portfolio_is_refused() {
        let error = TestHarness::<Portfolio>::with()
            .given(vec![
                PortfolioEvent::Opened {
                    name: name("macro"),
                    base_currency: BaseCurrency::Usdc,
                },
                PortfolioEvent::Archived,
            ])
            .when(PortfolioCommand::ReviseTarget {
                target: long_short_target(),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(PortfolioError::Archived)
        ));
    }

    #[tokio::test]
    async fn renaming_an_archived_portfolio_is_refused() {
        let error = TestHarness::<Portfolio>::with()
            .given(vec![
                PortfolioEvent::Opened {
                    name: name("macro"),
                    base_currency: BaseCurrency::Usdc,
                },
                PortfolioEvent::Archived,
            ])
            .when(PortfolioCommand::Rename {
                name: name("renamed"),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(PortfolioError::Archived)
        ));
    }

    #[tokio::test]
    async fn archiving_an_archived_portfolio_is_refused() {
        let error = TestHarness::<Portfolio>::with()
            .given(vec![
                PortfolioEvent::Opened {
                    name: name("macro"),
                    base_currency: BaseCurrency::Usdc,
                },
                PortfolioEvent::Archived,
            ])
            .when(PortfolioCommand::Archive)
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(PortfolioError::Archived)
        ));
    }

    #[tokio::test]
    async fn revising_before_opening_is_refused() {
        let error = TestHarness::<Portfolio>::with()
            .given(vec![])
            .when(PortfolioCommand::ReviseTarget {
                target: long_short_target(),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(PortfolioError::NotOpen)
        ));
    }

    #[tokio::test]
    async fn test_store_round_trips_the_latest_target() {
        let store = TestStore::<Portfolio>::new();
        let id = PortfolioId::generate();

        store
            .send(
                &id,
                PortfolioCommand::Open {
                    name: name("macro"),
                    base_currency: BaseCurrency::Usdc,
                },
            )
            .await
            .unwrap();
        store
            .send(
                &id,
                PortfolioCommand::ReviseTarget {
                    target: long_short_target(),
                },
            )
            .await
            .unwrap();

        let portfolio = store.load(&id).await.unwrap().unwrap();
        assert_eq!(portfolio.target, Some(long_short_target()));
    }

    #[tokio::test]
    async fn projection_filters_active_portfolios_by_status() {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        let (store, projection) = StoreBuilder::<Portfolio>::new(pool.clone())
            .build()
            .await
            .unwrap();

        let kept = PortfolioId::generate();
        let retired = PortfolioId::generate();

        for id in [kept, retired] {
            store
                .send(
                    &id,
                    PortfolioCommand::Open {
                        name: name("macro"),
                        base_currency: BaseCurrency::Usdc,
                    },
                )
                .await
                .unwrap();
        }
        store
            .send(&retired, PortfolioCommand::Archive)
            .await
            .unwrap();

        let active = projection
            .filter(super::STATUS, &PortfolioStatus::Active)
            .await
            .unwrap();
        let active_ids: Vec<PortfolioId> = active.iter().map(|(id, _)| *id).collect();
        assert_eq!(active_ids, vec![kept]);
    }
}
