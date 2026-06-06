use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use apalis::prelude::Data;
use chrono::Utc;
use cron::Schedule;
use event_sorcery::{EventSourced, Projection, ProjectionError, SendError, Store};
use futures::stream::{self, StreamExt, TryStreamExt};
use serde::Deserialize;
use sqlx::{AssertSqlSafe, SqlitePool};
use thiserror::Error;
use tracing::{debug, error, warn};

use super::run::{
    IngestionRun, IngestionRunCommand, IngestionRunStatus, running_runs, running_runs_for_work,
};
use super::run_id::{INGESTION_RUN_ID_PREFIX, IngestionRunId};
use super::work::IngestionWork;
use crate::timeframe::Timeframe;

pub(crate) const ABANDONED_RUN_REASON: &str = "backend restarted before ingestion completed";
pub(super) const LOST_RACE_REASON: &str = "lost the one-running race to a concurrent ingestion";

/// Why opening or recovering an ingestion run fails.
#[derive(Debug, Error)]
pub(crate) enum IngestionError {
    #[error("ingestion already running")]
    AlreadyRunning,
    #[error(transparent)]
    Send(#[from] SendError<IngestionRun>),
    #[error(transparent)]
    Projection(#[from] ProjectionError<IngestionRun>),
}

/// Why building the built-in ingestion schedules fails.
#[derive(Debug, Error)]
pub(crate) enum IngestionScheduleError {
    #[error(transparent)]
    Cron(#[from] cron::error::Error),
    #[error(transparent)]
    ScheduleKey(#[from] super::work::IngestionWorkParseError),
}

fn validate_production_schedule_definitions() -> Result<(), IngestionScheduleError> {
    for timeframe in Timeframe::all() {
        Schedule::from_str(timeframe.ingestion_cron_expression())?;
    }
    for work in IngestionWork::scheduled_units() {
        Schedule::from_str(work.production_cron_expression())?;
        IngestionWork::from_schedule_key(work.schedule_key())?;
    }
    Ok(())
}

/// Built-in apalis-cron schedules for each candle timeframe and funding refresh.
pub(crate) fn default_ingestion_schedules()
-> Result<Vec<(IngestionWork, Schedule)>, IngestionScheduleError> {
    validate_production_schedule_definitions()?;

    #[cfg(feature = "test-support")]
    let units: Vec<IngestionWork> = IngestionWork::test_e2e_scheduled_units().into();
    #[cfg(not(feature = "test-support"))]
    let units = IngestionWork::scheduled_units();

    units
        .into_iter()
        .map(|work| {
            let expression = work.default_cron_expression();
            Ok((work, Schedule::from_str(expression)?))
        })
        .collect()
}

/// Opens a new ingestion run and enqueues its job atomically with the
/// `Started` event through the aggregate's `Jobs` handle, refusing if one is
/// already active.
///
/// The active check reads the projection, so it is not atomic with the `Start`
/// event (event-sorcery commits projections just after the event, not in the
/// same transaction). For scheduled, sequential ingest this is sufficient: the
/// partial unique index on `ingestion_run_view` is a backstop,
/// and the startup reconciler guarantees a crashed run never wedges the slot.
pub(crate) async fn create_run(
    store: &Store<IngestionRun>,
    projection: &Projection<IngestionRun>,
    work: IngestionWork,
) -> Result<IngestionRunId, IngestionError> {
    if !running_runs_for_work(projection, work).await?.is_empty() {
        return Err(IngestionError::AlreadyRunning);
    }

    let started_at = Utc::now();
    let run_id = IngestionRunId::new(started_at);
    store
        .send(
            &run_id,
            IngestionRunCommand::Start {
                run_id: run_id.clone(),
                started_at,
                work,
            },
        )
        .await?;

    // The pre-send projection read is not atomic with the Start, so two callers
    // can both pass it and both persist a Start. event-sorcery commits the
    // projection within `send`, and the partial unique index on
    // `ingestion_run_view(status) WHERE status = 'Running'` admits at most one
    // Start as Running -- the losers' projection writes hit the constraint and
    // are dropped by the reactor. So after `send`, exactly one run holds the
    // Running slot. If it is not this one, we lost the race: abandon the orphan
    // stream and report AlreadyRunning, so only the winner proceeds.
    let running = running_runs_for_work(projection, work).await?;
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

/// apalis-cron handler: enqueues a scoped ingestion run on each schedule tick.
/// An already-running run is the normal skip-this-tick case, not a failure;
/// genuine failures increment a consecutive counter and warn so an operator can
/// spot a wedged scheduler.
pub(crate) async fn trigger_scheduled_ingestion(
    work: IngestionWork,
    _tick: apalis_cron::Tick<Utc>,
    store: Data<Arc<Store<IngestionRun>>>,
    projection: Data<Arc<Projection<IngestionRun>>>,
    consecutive_failures: Data<Arc<AtomicU32>>,
) -> Result<(), std::convert::Infallible> {
    match create_run(&store, &projection, work).await {
        Ok(run_id) => {
            consecutive_failures.store(0, Ordering::Relaxed);
            debug!(
                run_id = %run_id,
                work = work.schedule_key(),
                "scheduled ingestion run enqueued"
            );
        }
        Err(IngestionError::AlreadyRunning) => {
            consecutive_failures.store(0, Ordering::Relaxed);
            debug!(
                work = work.schedule_key(),
                "scheduled ingestion skipped; a run is already active"
            );
        }
        Err(err) => {
            let consecutive = consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
            warn!(
                error = %err,
                work = work.schedule_key(),
                consecutive,
                "scheduled ingestion run failed"
            );
        }
    }

    Ok(())
}

/// Abandons every still-running stream. Run unconditionally at startup, before
/// before schedulers enqueue work, so a crash mid-run cannot leave the one-running slot
/// permanently claimed (the regression that issue #339 fixed).
pub(crate) async fn recover_abandoned_runs(
    store: &Store<IngestionRun>,
    projection: &Projection<IngestionRun>,
) -> Result<u64, IngestionError> {
    let running = running_runs(projection).await?;
    let reconciled_at = Utc::now();

    // Abandon each run independently: one failed write must not block recovery
    // of the rest, since this completes before schedulers start.
    let (recovered, first_error) = stream::iter(running.iter())
        .fold(
            (0u64, None::<SendError<IngestionRun>>),
            |(recovered, first_error), (run_id, _)| {
                let run_id = run_id.clone();
                async move {
                    match store
                        .send(
                            &run_id,
                            IngestionRunCommand::Abandon {
                                reason: ABANDONED_RUN_REASON.to_string(),
                                reconciled_at,
                            },
                        )
                        .await
                    {
                        Ok(()) => (recovered + 1, first_error),
                        Err(err) => {
                            error!(
                                error = %err,
                                run_id = %run_id,
                                "failed to abandon a running ingestion run"
                            );
                            (recovered, first_error.or(Some(err)))
                        }
                    }
                }
            },
        )
        .await;

    if let Some(err) = first_error {
        return Err(IngestionError::Send(err));
    }

    if recovered > 0 {
        warn!(runs = recovered, "abandoned ingestion runs on startup");
    } else {
        debug!("no running ingestion runs to recover on startup");
    }

    Ok(recovered)
}

/// Materialized-view payload shape for a live [`IngestionRun`].
#[derive(Deserialize)]
struct LiveIngestionRunView {
    #[serde(rename = "Live")]
    live: IngestionRun,
}

/// The status of the most recently started run, or `None` if none exist.
///
/// Reads view rows ordered by [`IngestionRunId`] (microsecond start, then
/// nonce), matching the old `ORDER BY started_at DESC LIMIT 1` ledger query.
/// The cursor stops at the first live row, so at most the poisoned prefix is
/// scanned: a one-running race leaves the loser's row as a `Failed` lifecycle
/// payload (its dropped `Started` projection write means the `Abandoned` event
/// cannot originate a view state), and such rows carry no run status to
/// report.
pub(crate) async fn latest_status(
    pool: &SqlitePool,
) -> Result<Option<IngestionRunStatus>, IngestionError> {
    let event_sorcery::Table(table) = IngestionRun::PROJECTION;
    let micros_substr_start = INGESTION_RUN_ID_PREFIX.len() + 1;
    let query = format!(
        "SELECT view_id, payload FROM {table}
         ORDER BY
           CAST(substr(view_id, {micros_substr_start},
             instr(substr(view_id, {micros_substr_start}), '-') - 1) AS INTEGER) DESC,
           view_id DESC"
    );

    let mut rows = sqlx::query_as::<_, (String, String)>(AssertSqlSafe(query)).fetch(pool);
    while let Some((view_id, payload)) = rows
        .try_next()
        .await
        .map_err(|err| IngestionError::Projection(ProjectionError::from(err)))?
    {
        match serde_json::from_str::<LiveIngestionRunView>(&payload) {
            Ok(view) => return Ok(Some(view.live.status)),
            Err(error) => {
                warn!(
                    aggregate_id = %view_id,
                    error = %error,
                    "skipping non-live ingestion run view row"
                );
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    use apalis::prelude::Data;
    use chrono::Utc;
    use event_sorcery::{Projection, Store};
    use tracing::Level;
    use tracing_test::traced_test;

    use super::{
        IngestionError, create_run, latest_status, recover_abandoned_runs,
        trigger_scheduled_ingestion,
    };
    use crate::ingestion::fixtures::{ingestion_store, instant};
    use crate::ingestion::run::{
        IngestionRun, IngestionRunCommand, IngestionRunStatus, running_runs,
    };
    use crate::ingestion::work::IngestionWork;
    use crate::logs_contain_at;
    use crate::timeframe::Timeframe;

    async fn trigger_scheduled_ingestion_for_test(
        store: Arc<Store<IngestionRun>>,
        projection: Arc<Projection<IngestionRun>>,
        work: IngestionWork,
        consecutive_failures: Arc<AtomicU32>,
    ) {
        trigger_scheduled_ingestion(
            work,
            apalis_cron::Tick::<Utc>::default(),
            Data::new(Arc::clone(&store)),
            Data::new(Arc::clone(&projection)),
            Data::new(consecutive_failures),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn latest_status_returns_none_when_no_runs_exist() {
        let (_store, _projection, pool) = ingestion_store().await;

        let status = latest_status(&pool).await.unwrap();

        assert_eq!(status, None);
    }

    #[traced_test]
    #[tokio::test]
    async fn create_run_starts_a_running_run_and_logs() {
        let (store, projection, pool) = ingestion_store().await;

        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        let status = latest_status(&pool).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Running));
        let run_id = run_id.to_string();
        assert!(run_id.starts_with("ingestion-"));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion run created", run_id.as_str()]
        ));
    }

    #[tokio::test]
    async fn latest_status_prefers_the_latest_run_id_when_microseconds_match() {
        let (store, _projection, pool) = ingestion_store().await;
        let shared_start = instant();
        let shared_micros = shared_start.timestamp_micros();
        let first_id = format!("ingestion-{shared_micros}-00000000000000000000000000000001")
            .parse()
            .unwrap();
        let second_id = format!("ingestion-{shared_micros}-00000000000000000000000000000002")
            .parse()
            .unwrap();

        store
            .send(
                &first_id,
                IngestionRunCommand::Start {
                    run_id: first_id.clone(),
                    started_at: shared_start,
                    work: IngestionWork::candles(Timeframe::OneHour),
                },
            )
            .await
            .unwrap();
        store
            .send(
                &first_id,
                IngestionRunCommand::Complete {
                    last_record_at: shared_start,
                    completed_at: shared_start,
                },
            )
            .await
            .unwrap();
        store
            .send(
                &second_id,
                IngestionRunCommand::Start {
                    run_id: second_id.clone(),
                    started_at: shared_start,
                    work: IngestionWork::candles(Timeframe::OneHour),
                },
            )
            .await
            .unwrap();

        let status = latest_status(&pool).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Running));
    }

    #[traced_test]
    #[tokio::test]
    async fn create_run_rejects_a_second_sequential_run() {
        let (store, projection, _pool) = ingestion_store().await;

        create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        let duplicate = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await;

        assert!(matches!(duplicate, Err(IngestionError::AlreadyRunning)));
    }

    #[traced_test]
    #[tokio::test]
    async fn recover_abandons_running_runs_and_logs() {
        let (store, projection, pool) = ingestion_store().await;

        create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        let recovered = recover_abandoned_runs(&store, &projection).await.unwrap();
        let status = latest_status(&pool).await.unwrap();

        assert_eq!(recovered, 1);
        assert_eq!(status, Some(IngestionRunStatus::Abandoned));
        assert!(logs_contain_at(
            Level::WARN,
            &["abandoned ingestion runs on startup", "1"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn recover_with_no_running_runs_is_a_noop() {
        let (store, projection, _pool) = ingestion_store().await;

        let recovered = recover_abandoned_runs(&store, &projection).await.unwrap();

        assert_eq!(recovered, 0);
        assert!(logs_contain_at(
            Level::DEBUG,
            &["no running ingestion runs to recover on startup"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn concurrent_create_run_admits_exactly_one() {
        let (store, projection, _pool) = ingestion_store().await;

        let (first, second) = tokio::join!(
            create_run(
                &store,
                &projection,
                IngestionWork::candles(Timeframe::OneHour)
            ),
            create_run(
                &store,
                &projection,
                IngestionWork::candles(Timeframe::OneHour)
            ),
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
        assert!(logs_contain_at(
            Level::DEBUG,
            &["lost the one-running race", "abandoned the orphan run"]
        ));
    }

    /// The one-running race leaves the loser's view row as a `Failed`
    /// lifecycle payload: its `Started` projection write is dropped by the
    /// unique-index backstop, so the later `Abandoned` event cannot originate
    /// a view state. The latest-status query must skip such poisoned rows
    /// instead of failing the status endpoint whenever a race loser happens to
    /// sort newest.
    #[traced_test]
    #[tokio::test]
    async fn latest_status_skips_race_loser_view_rows() {
        let (store, projection, pool) = ingestion_store().await;

        let _ = tokio::join!(
            create_run(
                &store,
                &projection,
                IngestionWork::candles(Timeframe::OneHour)
            ),
            create_run(
                &store,
                &projection,
                IngestionWork::candles(Timeframe::OneHour)
            ),
        );

        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT view_id, payload FROM ingestion_run_view")
                .fetch_all(&pool)
                .await
                .unwrap();
        let poisoned = rows
            .iter()
            .find(|(_, payload)| !payload.contains("\"Live\""))
            .expect("the race loser must leave a non-live view row");

        // Whether the poisoned row sorts newest depends on race timing; pin the
        // deterministic case by inserting the observed poisoned payload under a
        // run id that always sorts newest.
        sqlx::query(
            "INSERT INTO ingestion_run_view (view_id, version, payload) VALUES (?1, 1, ?2)",
        )
        .bind("ingestion-9999999999999999-ffffffffffffffffffffffffffffffff")
        .bind(poisoned.1.clone())
        .execute(&pool)
        .await
        .unwrap();

        let status = latest_status(&pool).await.unwrap();

        assert_eq!(
            status,
            Some(IngestionRunStatus::Running),
            "latest_status must skip poisoned rows and report the winner"
        );
        assert!(
            logs_contain_at(Level::WARN, &["skipping non-live ingestion run view row"]),
            "each skipped poisoned row must be logged"
        );
    }

    #[tokio::test]
    async fn concurrent_create_run_for_different_work_admits_both() {
        let (store, projection, _pool) = ingestion_store().await;

        let (hourly, funding) = tokio::join!(
            create_run(
                &store,
                &projection,
                IngestionWork::candles(Timeframe::OneHour)
            ),
            create_run(&store, &projection, IngestionWork::Funding),
        );

        assert!(hourly.is_ok() && funding.is_ok());
        assert_eq!(running_runs(&projection).await.unwrap().len(), 2);
    }

    #[traced_test]
    #[tokio::test]
    async fn scheduled_ingestion_starts_a_scoped_run_when_idle() {
        let (store, projection, pool) = ingestion_store().await;
        let consecutive_failures = Arc::new(AtomicU32::new(5));

        trigger_scheduled_ingestion_for_test(
            Arc::clone(&store),
            Arc::clone(&projection),
            IngestionWork::candles(Timeframe::OneHour),
            Arc::clone(&consecutive_failures),
        )
        .await;

        assert_eq!(consecutive_failures.load(Ordering::Relaxed), 0);
        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Running)
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["scheduled ingestion run enqueued", "1h"]
        ));
    }

    #[test]
    fn default_ingestion_schedules_cover_all_scheduled_work() {
        let parsed = super::default_ingestion_schedules().unwrap();

        #[cfg(feature = "test-support")]
        assert_eq!(
            parsed.len(),
            IngestionWork::test_e2e_scheduled_units().len()
        );
        #[cfg(not(feature = "test-support"))]
        assert_eq!(parsed.len(), IngestionWork::scheduled_units().len());
    }

    #[traced_test]
    #[tokio::test]
    async fn scheduled_ingestion_starts_a_run_when_idle() {
        let (store, projection, pool) = ingestion_store().await;
        let consecutive_failures = Arc::new(AtomicU32::new(5));

        trigger_scheduled_ingestion_for_test(
            Arc::clone(&store),
            Arc::clone(&projection),
            IngestionWork::candles(Timeframe::OneHour),
            Arc::clone(&consecutive_failures),
        )
        .await;

        assert_eq!(consecutive_failures.load(Ordering::Relaxed), 0);
        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Running)
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["scheduled ingestion run enqueued"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn scheduled_ingestion_skips_when_a_run_is_already_active() {
        let (store, projection, _pool) = ingestion_store().await;
        let consecutive_failures = Arc::new(AtomicU32::new(3));

        create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        trigger_scheduled_ingestion_for_test(
            Arc::clone(&store),
            Arc::clone(&projection),
            IngestionWork::candles(Timeframe::OneHour),
            Arc::clone(&consecutive_failures),
        )
        .await;

        assert_eq!(
            consecutive_failures.load(Ordering::Relaxed),
            0,
            "an active run is a normal skip, not a failure"
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["scheduled ingestion skipped"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn scheduled_ingestion_warns_and_counts_consecutive_failures() {
        let (store, projection, pool) = ingestion_store().await;
        pool.close().await;
        let consecutive_failures = Arc::new(AtomicU32::new(0));

        trigger_scheduled_ingestion_for_test(
            Arc::clone(&store),
            Arc::clone(&projection),
            IngestionWork::candles(Timeframe::OneHour),
            Arc::clone(&consecutive_failures),
        )
        .await;
        trigger_scheduled_ingestion_for_test(
            Arc::clone(&store),
            Arc::clone(&projection),
            IngestionWork::candles(Timeframe::OneHour),
            Arc::clone(&consecutive_failures),
        )
        .await;

        assert_eq!(consecutive_failures.load(Ordering::Relaxed), 2);
        assert!(logs_contain_at(
            Level::WARN,
            &["scheduled ingestion run failed", "consecutive=2"]
        ));
    }
}
