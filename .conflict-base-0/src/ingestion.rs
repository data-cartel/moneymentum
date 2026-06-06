//! Ingestion orchestration and the event-sourced [`IngestionRun`] lifecycle.
//!
//! Each ingestion attempt is its own [`IngestionRun`] stream -- a monotone
//! `Running -> {Completed, Failed, Abandoned}` state machine -- so crashed and
//! abandoned runs stay visible without a database reset. The "one running"
//! invariant is the /ingest handler checking the projection plus a partial
//! unique index; an unconditional startup reconciler abandons every still-running
//! stream before /ingest is served, so a crash can never wedge the slot.

use std::convert::Infallible;
use std::fmt::{self, Display};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use apalis::prelude::{Data, TaskSink};
use apalis_sqlite::{SqlitePool, SqliteStorage};
use chrono::{DateTime, Utc};
use event_sorcery::{
    Column, DomainEvent, EventSourced, JobQueue, Nil, Projection, ProjectionError, SendError,
    Store, Table,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

use crate::hyperliquid::{CandleIngester, FundingRateIngester, Hyperliquid};
use crate::market_catalog::MarketCatalog;
use crate::market_enablement::MarketEnablement;
use crate::market_metadata::RefreshError;
use crate::timeframe::Timeframe;

const TIMEFRAMES: &[Timeframe] = &[
    Timeframe::FifteenMin,
    Timeframe::OneHour,
    Timeframe::OneDay,
    Timeframe::OneWeek,
];
const ABANDONED_RUN_REASON: &str = "backend restarted before ingestion completed";
const LOST_RACE_REASON: &str = "lost the one-running race to a concurrent ingestion";

/// Identity of a single ingestion attempt, permanent for the life of its event
/// stream. Derived from the start instant so it is unique per attempt and sorts
/// by start time. `Display`/`FromStr` round-trip the stored string losslessly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct IngestionRunId(String);

impl IngestionRunId {
    fn new(started_at: DateTime<Utc>) -> Self {
        // The timestamp prefix keeps ids sortable by start time; the random
        // suffix guarantees uniqueness so two runs started within the same
        // microsecond cannot collide onto one stream (which would surface a
        // legitimate concurrent /ingest as a spurious 500 rather than a 409).
        Self(format!(
            "ingestion-{}-{}",
            started_at.timestamp_micros(),
            uuid::Uuid::new_v4().simple()
        ))
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for IngestionRunId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for IngestionRunId {
    type Err = Infallible;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Ok(Self(value.to_string()))
    }
}

/// The lifecycle state of an ingestion run. `Running` is the only non-terminal
/// state; every other state is final.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "TEXT")]
pub(crate) enum IngestionRunStatus {
    Running,
    Completed,
    Failed,
    Abandoned,
}

/// An event-sourced ingestion attempt. The stream is an audit record of one
/// run's lifecycle; `Running -> {Completed, Failed, Abandoned}` is a monotone,
/// single-step terminal state machine, so a late or duplicated command can never
/// revive a finished run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct IngestionRun {
    status: IngestionRunStatus,
    started_at: DateTime<Utc>,
}

/// The immutable facts of an ingestion run's lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum IngestionRunEvent {
    Started {
        started_at: DateTime<Utc>,
    },
    Completed {
        last_record_at: DateTime<Utc>,
        completed_at: DateTime<Utc>,
    },
    Failed {
        reason: String,
        failed_at: DateTime<Utc>,
    },
    Abandoned {
        reason: String,
        reconciled_at: DateTime<Utc>,
    },
}

impl DomainEvent for IngestionRunEvent {
    fn event_type(&self) -> String {
        match self {
            Self::Started { .. } => "IngestionRunEvent::Started",
            Self::Completed { .. } => "IngestionRunEvent::Completed",
            Self::Failed { .. } => "IngestionRunEvent::Failed",
            Self::Abandoned { .. } => "IngestionRunEvent::Abandoned",
        }
        .to_string()
    }

    fn event_version(&self) -> String {
        "1.0".to_string()
    }
}

/// Intent expressed against an ingestion run.
#[derive(Debug, Clone)]
pub(crate) enum IngestionRunCommand {
    Start {
        started_at: DateTime<Utc>,
    },
    Complete {
        last_record_at: DateTime<Utc>,
        completed_at: DateTime<Utc>,
    },
    Fail {
        reason: String,
        failed_at: DateTime<Utc>,
    },
    Abandon {
        reason: String,
        reconciled_at: DateTime<Utc>,
    },
}

/// Why the run state machine refuses a command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub(crate) enum IngestionRunError {
    #[error("ingestion run already started")]
    AlreadyStarted,
    #[error("ingestion run has not started")]
    NotStarted,
    #[error("ingestion run has already finished")]
    AlreadyTerminal,
}

impl EventSourced for IngestionRun {
    type Id = IngestionRunId;
    type Event = IngestionRunEvent;
    type Command = IngestionRunCommand;
    type Error = IngestionRunError;
    type Jobs = Nil;
    type Materialized = Table;

    const AGGREGATE_TYPE: &'static str = "IngestionRun";
    const PROJECTION: Table = Table("ingestion_run_view");
    const SCHEMA_VERSION: u64 = 1;

    fn originate(event: &IngestionRunEvent) -> Option<Self> {
        match event {
            IngestionRunEvent::Started { started_at } => Some(Self {
                status: IngestionRunStatus::Running,
                started_at: *started_at,
            }),
            IngestionRunEvent::Completed { .. }
            | IngestionRunEvent::Failed { .. }
            | IngestionRunEvent::Abandoned { .. } => None,
        }
    }

    fn evolve(entity: &Self, event: &IngestionRunEvent) -> Result<Option<Self>, IngestionRunError> {
        let terminal = |status| {
            Ok(Some(Self {
                status,
                ..entity.clone()
            }))
        };

        match event {
            IngestionRunEvent::Started { .. } => Ok(None),
            IngestionRunEvent::Completed { .. } => terminal(IngestionRunStatus::Completed),
            IngestionRunEvent::Failed { .. } => terminal(IngestionRunStatus::Failed),
            IngestionRunEvent::Abandoned { .. } => terminal(IngestionRunStatus::Abandoned),
        }
    }

    fn initialize(
        command: IngestionRunCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<IngestionRunEvent>, IngestionRunError> {
        match command {
            IngestionRunCommand::Start { started_at } => {
                Ok(vec![IngestionRunEvent::Started { started_at }])
            }
            IngestionRunCommand::Complete { .. }
            | IngestionRunCommand::Fail { .. }
            | IngestionRunCommand::Abandon { .. } => Err(IngestionRunError::NotStarted),
        }
    }

    fn transition(
        &self,
        command: IngestionRunCommand,
        _jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<IngestionRunEvent>, IngestionRunError> {
        match command {
            IngestionRunCommand::Start { .. } => Err(IngestionRunError::AlreadyStarted),
            IngestionRunCommand::Complete { .. }
            | IngestionRunCommand::Fail { .. }
            | IngestionRunCommand::Abandon { .. }
                if !matches!(self.status, IngestionRunStatus::Running) =>
            {
                Err(IngestionRunError::AlreadyTerminal)
            }
            IngestionRunCommand::Complete {
                last_record_at,
                completed_at,
            } => Ok(vec![IngestionRunEvent::Completed {
                last_record_at,
                completed_at,
            }]),
            IngestionRunCommand::Fail { reason, failed_at } => {
                Ok(vec![IngestionRunEvent::Failed { reason, failed_at }])
            }
            IngestionRunCommand::Abandon {
                reason,
                reconciled_at,
            } => Ok(vec![IngestionRunEvent::Abandoned {
                reason,
                reconciled_at,
            }]),
        }
    }
}

/// The generated `status` column on `ingestion_run_view`, for status-filtered
/// reads (the "is anything running?" check and the recovery sweep).
pub(crate) const RUN_STATUS: Column = Column("status");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct IngestionJob {
    run_id: IngestionRunId,
}

impl IngestionJob {
    pub(crate) fn new(run_id: IngestionRunId) -> Self {
        Self { run_id }
    }

    pub(crate) async fn run(
        self,
        store: Data<Arc<Store<IngestionRun>>>,
        services: Data<Arc<IngestionServices>>,
    ) -> Result<(), SendError<IngestionRun>> {
        // A run abandoned by startup recovery must not resurrect: skip the work
        // and leave its terminal state untouched.
        match store.load(&self.run_id).await {
            Ok(Some(run)) if matches!(run.status, IngestionRunStatus::Running) => {}
            Ok(_) => {
                warn!(run_id = %self.run_id, "skipping ingestion for a finished run");
                return Ok(());
            }
            // A load failure leaves the run's state unknown -- surface it so the
            // worker retries rather than silently marking the job done.
            Err(err) => {
                error!(error = %err, run_id = %self.run_id, "failed to load ingestion run");
                return Err(err);
            }
        }

        let candle_ingester = CandleIngester::new(
            Arc::clone(&services.hyperliquid),
            services.max_concurrent_requests,
        );
        let funding_ingester = FundingRateIngester::new(
            Arc::clone(&services.hyperliquid),
            services.max_concurrent_requests,
        );

        match ingest_all(
            services.hyperliquid.as_ref(),
            &candle_ingester,
            &funding_ingester,
            &services.data_dir,
            &services.market_catalog,
            &services.market_catalog_projection,
            &services.market_enablement_projection,
        )
        .await
        {
            Ok(last_record) => {
                // The run stays Running until this commits; surface a
                // terminalization failure so the worker retries instead of
                // leaving the slot wedged until the next startup reconcile.
                if let Err(err) = complete_run(&store, &self.run_id, last_record).await {
                    error!(error = %err, run_id = self.run_id.as_str(), "failed to record ingestion completion");
                    return Err(err);
                }
                info!(run_id = self.run_id.as_str(), "ingestion complete");
            }
            Err(err) => {
                error!(error = %err, run_id = self.run_id.as_str(), "ingestion failed");
                // If we cannot even record the failure the run stays Running;
                // surface it so the worker retries rather than wedging the slot.
                if let Err(record_err) = fail_run(&store, &self.run_id, &err.to_string()).await {
                    error!(
                        error = %record_err,
                        run_id = self.run_id.as_str(),
                        "failed to record ingestion failure"
                    );
                    return Err(record_err);
                }
            }
        }

        Ok(())
    }
}

async fn ingest_all(
    client: &dyn Hyperliquid,
    candle_ingester: &CandleIngester<dyn Hyperliquid>,
    funding_ingester: &FundingRateIngester<dyn Hyperliquid>,
    data_dir: &Path,
    market_catalog: &Store<MarketCatalog>,
    market_catalog_projection: &Projection<MarketCatalog>,
    market_enablement_projection: &Projection<MarketEnablement>,
) -> Result<DateTime<Utc>, RefreshError> {
    let markets = crate::market_metadata::refresh_markets(
        client,
        market_catalog,
        market_catalog_projection,
        market_enablement_projection,
    )
    .await?;

    funding_ingester
        .ingest_with_markets(data_dir, &markets)
        .await?;

    for timeframe in TIMEFRAMES {
        candle_ingester
            .ingest_with_markets(*timeframe, data_dir, &markets)
            .await?;
    }

    Ok(Utc::now())
}

/// Why opening or recovering an ingestion run fails.
#[derive(Debug, Error)]
pub(crate) enum IngestionError {
    #[error("ingestion already running")]
    AlreadyRunning,
    #[error(transparent)]
    Send(#[from] SendError<IngestionRun>),
    #[error(transparent)]
    Projection(#[from] ProjectionError<IngestionRun>),
    #[error("failed to queue ingestion job")]
    Queue,
}

pub(crate) struct IngestionServices {
    pub(crate) hyperliquid: Arc<dyn Hyperliquid>,
    pub(crate) data_dir: PathBuf,
    pub(crate) max_concurrent_requests: usize,
    pub(crate) market_catalog: Arc<Store<MarketCatalog>>,
    pub(crate) market_catalog_projection: Arc<Projection<MarketCatalog>>,
    pub(crate) market_enablement_projection: Arc<Projection<MarketEnablement>>,
}

/// Opens a new ingestion run, refusing if one is already active.
///
/// The active check reads the projection, so it is not atomic with the `Start`
/// event (event-sorcery commits projections just after the event, not in the
/// same transaction). For operator-triggered, sequential ingest this is
/// sufficient: the partial unique index on `ingestion_run_view` is a backstop,
/// and the startup reconciler guarantees a crashed run never wedges the slot.
pub(crate) async fn create_run(
    store: &Store<IngestionRun>,
    projection: &Projection<IngestionRun>,
) -> Result<IngestionRunId, IngestionError> {
    if !running_runs(projection).await?.is_empty() {
        return Err(IngestionError::AlreadyRunning);
    }

    let started_at = Utc::now();
    let run_id = IngestionRunId::new(started_at);
    store
        .send(&run_id, IngestionRunCommand::Start { started_at })
        .await?;

    // The pre-send projection read is not atomic with the Start, so two callers
    // can both pass it and both persist a Start. event-sorcery commits the
    // projection within `send`, and the partial unique index on
    // `ingestion_run_view(status) WHERE status = 'Running'` admits at most one
    // Start as Running -- the losers' projection writes hit the constraint and
    // are dropped by the reactor. So after `send`, exactly one run holds the
    // Running slot. If it is not this one, we lost the race: abandon the orphan
    // stream and report AlreadyRunning, so only the winner proceeds.
    let running = running_runs(projection).await?;
    let won = matches!(running.as_slice(), [(winner, _)] if *winner == run_id);
    if !won {
        store
            .send(
                &run_id,
                IngestionRunCommand::Abandon {
                    reason: LOST_RACE_REASON.to_string(),
                    reconciled_at: Utc::now(),
                },
            )
            .await?;
        debug!(run_id = %run_id, "lost the one-running race; abandoned the orphan run");
        return Err(IngestionError::AlreadyRunning);
    }

    debug!(run_id = %run_id, "ingestion run created");
    Ok(run_id)
}

/// Abandons every still-running stream. Run unconditionally at startup, before
/// `/ingest` is served, so a crash mid-run cannot leave the one-running slot
/// permanently claimed (the regression that issue #339 fixed).
pub(crate) async fn recover_abandoned_runs(
    store: &Store<IngestionRun>,
    projection: &Projection<IngestionRun>,
) -> Result<u64, IngestionError> {
    let running = running_runs(projection).await?;
    let reconciled_at = Utc::now();

    let mut recovered = 0u64;
    for (run_id, _) in &running {
        // Abandon each run independently: one failed write must not block
        // recovery of the rest, since this completes before /ingest is served.
        if let Err(err) = store
            .send(
                run_id,
                IngestionRunCommand::Abandon {
                    reason: ABANDONED_RUN_REASON.to_string(),
                    reconciled_at,
                },
            )
            .await
        {
            error!(error = %err, run_id = %run_id, "failed to abandon a running ingestion run");
            continue;
        }
        recovered += 1;
    }

    if recovered > 0 {
        warn!(runs = recovered, "abandoned ingestion runs on startup");
    }

    Ok(recovered)
}

/// The status of the most recently started run, or `None` if none exist.
pub(crate) async fn latest_status(
    projection: &Projection<IngestionRun>,
) -> Result<Option<IngestionRunStatus>, IngestionError> {
    let runs = projection.load_all().await?;
    Ok(runs
        .into_iter()
        .max_by_key(|(_, run)| run.started_at)
        .map(|(_, run)| run.status))
}

async fn running_runs(
    projection: &Projection<IngestionRun>,
) -> Result<Vec<(IngestionRunId, IngestionRun)>, ProjectionError<IngestionRun>> {
    projection
        .filter(RUN_STATUS, &IngestionRunStatus::Running)
        .await
}

async fn complete_run(
    store: &Store<IngestionRun>,
    run_id: &IngestionRunId,
    last_record_at: DateTime<Utc>,
) -> Result<(), SendError<IngestionRun>> {
    store
        .send(
            run_id,
            IngestionRunCommand::Complete {
                last_record_at,
                completed_at: Utc::now(),
            },
        )
        .await?;

    debug!(run_id = %run_id, "ingestion run completed");
    Ok(())
}

pub(crate) async fn fail_run(
    store: &Store<IngestionRun>,
    run_id: &IngestionRunId,
    reason: &str,
) -> Result<(), SendError<IngestionRun>> {
    store
        .send(
            run_id,
            IngestionRunCommand::Fail {
                reason: reason.to_string(),
                failed_at: Utc::now(),
            },
        )
        .await?;

    debug!(run_id = %run_id, "ingestion run failed");
    Ok(())
}

/// Opens an ingestion run and enqueues its job, recording the run as failed if
/// the enqueue itself fails. Shared by the `/ingest` handler and the scheduler.
pub(crate) async fn enqueue_run(
    store: &Store<IngestionRun>,
    projection: &Projection<IngestionRun>,
    apalis_pool: &SqlitePool,
) -> Result<IngestionRunId, IngestionError> {
    let run_id = create_run(store, projection).await?;

    let mut job_queue = SqliteStorage::<IngestionJob, (), ()>::new(apalis_pool);
    if let Err(err) = job_queue.push(IngestionJob::new(run_id.clone())).await {
        error!(error = %err, "failed to queue ingestion job");
        if let Err(record_err) = fail_run(store, &run_id, "failed to queue ingestion job").await {
            error!(error = %record_err, "failed to record ingestion queue failure");
        }
        return Err(IngestionError::Queue);
    }

    Ok(run_id)
}

/// Runs one scheduled ingestion attempt. An already-running run is the normal
/// skip-this-tick case, not a failure; genuine failures increment a consecutive
/// counter and warn so an operator can spot a wedged scheduler.
pub(crate) async fn trigger_scheduled_ingestion(
    store: &Store<IngestionRun>,
    projection: &Projection<IngestionRun>,
    apalis_pool: &SqlitePool,
    consecutive_failures: &AtomicU32,
) {
    match enqueue_run(store, projection, apalis_pool).await {
        Ok(run_id) => {
            consecutive_failures.store(0, Ordering::Relaxed);
            debug!(run_id = %run_id, "scheduled ingestion run enqueued");
        }
        Err(IngestionError::AlreadyRunning) => {
            consecutive_failures.store(0, Ordering::Relaxed);
            debug!("scheduled ingestion skipped; a run is already active");
        }
        Err(err) => {
            let consecutive = consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
            warn!(error = %err, consecutive, "scheduled ingestion run failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use chrono::{DateTime, TimeZone, Utc};
    use rust_decimal_macros::dec;
    use sqlx::SqlitePool;
    use tracing::Level;
    use tracing_test::traced_test;

    use event_sorcery::{LifecycleError, StoreBuilder, TestHarness, replay};

    use super::*;
    use crate::candle::Candle;
    use crate::finance::{Market, Symbol};
    use crate::funding::FundingRate;
    use crate::hyperliquid::HyperliquidError;
    use crate::logs_contain_at;
    use crate::timeframe::Timeframe;

    struct MockHyperliquid;

    #[async_trait]
    impl Hyperliquid for MockHyperliquid {
        async fn fetch_market_metadata(
            &self,
        ) -> Result<Vec<crate::market_metadata::MarketMetadata>, HyperliquidError> {
            Ok(vec![crate::market_metadata::MarketMetadata {
                symbol: Market::new("BTC".into()),
                max_leverage: 50,
            }])
        }

        async fn fetch_candles(
            &self,
            market: &Market,
            _timeframe: Timeframe,
            _start: DateTime<Utc>,
        ) -> Result<Vec<Candle>, HyperliquidError> {
            Ok(vec![Candle {
                timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
                open: 100.0,
                high: 105.0,
                low: 95.0,
                close: 102.0,
                volume: 1000.0,
                symbol: Market::new(format!("{}/USDC:USDC", market.as_str())),
                ticker: Symbol::from_raw(market.as_str()),
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

    async fn test_services() -> IngestionServices {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (market_catalog, market_catalog_projection) =
            StoreBuilder::<MarketCatalog>::new(pool.clone())
                .build()
                .await
                .unwrap();
        let (_enablement, market_enablement_projection) =
            StoreBuilder::<MarketEnablement>::new(pool)
                .build()
                .await
                .unwrap();

        IngestionServices {
            hyperliquid: Arc::new(MockHyperliquid),
            data_dir: std::env::temp_dir(),
            max_concurrent_requests: 10,
            market_catalog,
            market_catalog_projection,
            market_enablement_projection,
        }
    }

    async fn ingestion_store() -> (Arc<Store<IngestionRun>>, Arc<Projection<IngestionRun>>) {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        StoreBuilder::<IngestionRun>::new(pool)
            .build()
            .await
            .unwrap()
    }

    fn instant() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
    }

    #[test]
    fn replay_reconstructs_a_running_run() {
        let run = replay::<IngestionRun>(vec![IngestionRunEvent::Started {
            started_at: instant(),
        }])
        .unwrap()
        .unwrap();

        assert_eq!(run.status, IngestionRunStatus::Running);
    }

    #[test]
    fn replay_rejects_history_starting_with_a_terminal_event() {
        // A terminal event with no preceding Started cannot originate the
        // stream; replay rejects the invalid history loudly rather than
        // fabricating a phantom run.
        let result = replay::<IngestionRun>(vec![IngestionRunEvent::Completed {
            last_record_at: instant(),
            completed_at: instant(),
        }]);

        assert!(
            result.is_err(),
            "a history starting with a terminal event must not originate a run"
        );
    }

    #[tokio::test]
    async fn completing_a_running_run_emits_completed() {
        TestHarness::<IngestionRun>::with()
            .given(vec![IngestionRunEvent::Started {
                started_at: instant(),
            }])
            .when(IngestionRunCommand::Complete {
                last_record_at: instant(),
                completed_at: instant(),
            })
            .await
            .then_expect_events(&[IngestionRunEvent::Completed {
                last_record_at: instant(),
                completed_at: instant(),
            }]);
    }

    #[tokio::test]
    async fn finalizing_a_finished_run_is_refused() {
        let error = TestHarness::<IngestionRun>::with()
            .given(vec![
                IngestionRunEvent::Started {
                    started_at: instant(),
                },
                IngestionRunEvent::Completed {
                    last_record_at: instant(),
                    completed_at: instant(),
                },
            ])
            .when(IngestionRunCommand::Fail {
                reason: "boom".to_string(),
                failed_at: instant(),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(IngestionRunError::AlreadyTerminal)
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn create_run_starts_a_running_run_and_logs() {
        let (store, projection) = ingestion_store().await;

        let run_id = create_run(&store, &projection).await.unwrap();
        let status = latest_status(&projection).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Running));
        assert!(run_id.as_str().starts_with("ingestion-"));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion run created", run_id.as_str()]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn create_run_rejects_a_second_sequential_run() {
        // The sequential case: the projection already reflects the first run, so
        // the pre-send guard rejects. The concurrent race is covered by
        // `concurrent_create_run_admits_exactly_one`.
        let (store, projection) = ingestion_store().await;

        create_run(&store, &projection).await.unwrap();
        let duplicate = create_run(&store, &projection).await;

        assert!(matches!(duplicate, Err(IngestionError::AlreadyRunning)));
    }

    #[traced_test]
    #[tokio::test]
    async fn recover_abandons_running_runs_and_logs() {
        let (store, projection) = ingestion_store().await;

        create_run(&store, &projection).await.unwrap();
        let recovered = recover_abandoned_runs(&store, &projection).await.unwrap();
        let status = latest_status(&projection).await.unwrap();

        assert_eq!(recovered, 1);
        assert_eq!(status, Some(IngestionRunStatus::Abandoned));
        assert!(logs_contain_at(
            Level::WARN,
            &["abandoned ingestion runs on startup", "1"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn stale_job_for_recovered_run_does_not_execute() {
        let (store, projection) = ingestion_store().await;
        let run_id = create_run(&store, &projection).await.unwrap();
        recover_abandoned_runs(&store, &projection).await.unwrap();
        let job = IngestionJob::new(run_id.clone());

        job.run(
            Data::new(Arc::clone(&store)),
            Data::new(Arc::new(test_services().await)),
        )
        .await
        .unwrap();

        let status = latest_status(&projection).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Abandoned));
        assert!(logs_contain_at(
            Level::WARN,
            &["skipping ingestion for a finished run", run_id.as_str()]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn job_completes_a_running_run_and_logs() {
        let (store, projection) = ingestion_store().await;
        let run_id = create_run(&store, &projection).await.unwrap();
        let job = IngestionJob::new(run_id.clone());

        job.run(
            Data::new(Arc::clone(&store)),
            Data::new(Arc::new(test_services().await)),
        )
        .await
        .unwrap();

        let status = latest_status(&projection).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Completed));
        assert!(logs_contain_at(
            Level::INFO,
            &["ingestion complete", run_id.as_str()]
        ));
    }

    #[tokio::test]
    async fn failing_a_running_run_emits_failed() {
        TestHarness::<IngestionRun>::with()
            .given(vec![IngestionRunEvent::Started {
                started_at: instant(),
            }])
            .when(IngestionRunCommand::Fail {
                reason: "boom".to_string(),
                failed_at: instant(),
            })
            .await
            .then_expect_events(&[IngestionRunEvent::Failed {
                reason: "boom".to_string(),
                failed_at: instant(),
            }]);
    }

    #[tokio::test]
    async fn abandoning_a_running_run_emits_abandoned() {
        TestHarness::<IngestionRun>::with()
            .given(vec![IngestionRunEvent::Started {
                started_at: instant(),
            }])
            .when(IngestionRunCommand::Abandon {
                reason: ABANDONED_RUN_REASON.to_string(),
                reconciled_at: instant(),
            })
            .await
            .then_expect_events(&[IngestionRunEvent::Abandoned {
                reason: ABANDONED_RUN_REASON.to_string(),
                reconciled_at: instant(),
            }]);
    }

    #[test]
    fn replay_reconstructs_a_failed_run() {
        let run = replay::<IngestionRun>(vec![
            IngestionRunEvent::Started {
                started_at: instant(),
            },
            IngestionRunEvent::Failed {
                reason: "boom".to_string(),
                failed_at: instant(),
            },
        ])
        .unwrap()
        .unwrap();

        assert_eq!(run.status, IngestionRunStatus::Failed);
    }

    #[test]
    fn replay_reconstructs_an_abandoned_run() {
        let run = replay::<IngestionRun>(vec![
            IngestionRunEvent::Started {
                started_at: instant(),
            },
            IngestionRunEvent::Abandoned {
                reason: ABANDONED_RUN_REASON.to_string(),
                reconciled_at: instant(),
            },
        ])
        .unwrap()
        .unwrap();

        assert_eq!(run.status, IngestionRunStatus::Abandoned);
    }

    #[traced_test]
    #[tokio::test]
    async fn recover_with_no_running_runs_is_a_noop() {
        let (store, projection) = ingestion_store().await;

        let recovered = recover_abandoned_runs(&store, &projection).await.unwrap();

        assert_eq!(recovered, 0);
        assert!(!logs_contain_at(
            Level::WARN,
            &["abandoned ingestion runs on startup"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn concurrent_create_run_admits_exactly_one() {
        let (store, projection) = ingestion_store().await;

        // Two callers race create_run on the same store. The one-running
        // invariant must admit exactly one and reject the loser with
        // AlreadyRunning -- never leave two Running runs.
        let (first, second) = tokio::join!(
            create_run(&store, &projection),
            create_run(&store, &projection),
        );

        let winner_then_loser =
            first.is_ok() && matches!(second, Err(IngestionError::AlreadyRunning));
        let loser_then_winner =
            matches!(first, Err(IngestionError::AlreadyRunning)) && second.is_ok();

        assert!(
            winner_then_loser || loser_then_winner,
            "exactly one concurrent run must be admitted and the other rejected \
             with AlreadyRunning; got {first:?} and {second:?}"
        );

        let running = running_runs(&projection).await.unwrap();
        assert_eq!(
            running.len(),
            1,
            "exactly one run remains in the Running slot"
        );
    }

    #[traced_test]
    #[tokio::test]
    async fn scheduled_ingestion_skips_when_a_run_is_already_active() {
        let (store, projection) = ingestion_store().await;
        // The push is never reached on the already-running path, so an
        // unmigrated apalis pool is sufficient.
        let apalis_pool = apalis_sqlite::SqlitePool::connect(":memory:")
            .await
            .unwrap();
        let consecutive_failures = AtomicU32::new(3);

        create_run(&store, &projection).await.unwrap();
        trigger_scheduled_ingestion(&store, &projection, &apalis_pool, &consecutive_failures).await;

        assert_eq!(
            consecutive_failures.load(Ordering::Relaxed),
            0,
            "an active run is a normal skip, not a failure"
        );
        assert!(crate::logs_contain_at(
            Level::DEBUG,
            &["scheduled ingestion skipped"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn scheduled_ingestion_warns_and_counts_consecutive_failures() {
        let (store, projection) = ingestion_store().await;
        // A closed apalis pool makes every enqueue's push fail -- the failure
        // path under test. create_run/fail_run use the separate event store, so
        // each tick still opens a run and marks it failed, freeing the next tick.
        let apalis_pool = apalis_sqlite::SqlitePool::connect(":memory:")
            .await
            .unwrap();
        apalis_pool.close().await;
        let consecutive_failures = AtomicU32::new(0);

        trigger_scheduled_ingestion(&store, &projection, &apalis_pool, &consecutive_failures).await;
        trigger_scheduled_ingestion(&store, &projection, &apalis_pool, &consecutive_failures).await;

        assert_eq!(consecutive_failures.load(Ordering::Relaxed), 2);
        assert!(crate::logs_contain_at(
            Level::WARN,
            &["scheduled ingestion run failed", "consecutive=2"]
        ));
    }
}
