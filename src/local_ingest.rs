//! Standalone on-demand ingestion for the `moneymentum-ingest` CLI.
//!
//! Runs without the HTTP API or cron schedulers: boots its own stores and
//! ingestion worker, enqueues every idle work unit, waits for completion, then
//! exits. Intended for local operator use from a terminal when the main server
//! is not running.

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use event_sorcery::{Projection, Store, StoreBuilder};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use thiserror::Error;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};
use tracing_subscriber::EnvFilter;

use crate::Config;
use crate::hyperliquid::HyperliquidClients;
use crate::ingestion::{
    ActiveUnitsEnqueue, IngestionJobContext, IngestionOwnerLease, IngestionRun, IngestionRunId,
    IngestionRunStatus, IngestionServices, OwnerLeaseError, create_runs_for_active_units,
    recover_abandoned_runs,
};
use crate::market_catalog::MarketCatalog;
use crate::market_enablement::MarketEnablement;
use crate::{ensure_shared_database, spawn_ingestion_worker};

/// Upper bound for waiting on enqueued local-ingest runs before reporting the
/// unfinished set and exiting nonzero.
const LOCAL_INGEST_COMPLETION_TIMEOUT: Duration = Duration::from_mins(30);

/// Why a local on-demand ingestion pass fails.
#[derive(Debug, Error)]
pub enum LocalIngestError {
    #[error("no idle ingestion units available; every unit already has a running run")]
    NothingEnqueued,
    #[error("ingestion run {run_id} finished with status {status:?}, expected Completed")]
    RunNotCompleted {
        run_id: IngestionRunId,
        status: Option<IngestionRunStatus>,
    },
    #[error("ingestion worker exited before runs finished ({unfinished})")]
    WorkerExited { unfinished: String },
    #[error("timed out waiting for ingestion runs to finish ({unfinished})")]
    TimedOut { unfinished: String },
    #[error(transparent)]
    OwnerLease(#[from] OwnerLeaseError),
    #[error(transparent)]
    Bootstrap(#[from] Box<dyn std::error::Error + Send + Sync>),
}

/// Runs a full on-demand ingestion pass for every idle active work unit and
/// waits until those runs finish.
///
/// Boots stores and an ingestion worker only -- no HTTP server, no cron. For the
/// `moneymentum-ingest` CLI when the main backend is not running.
///
/// # Errors
///
/// Returns an error when bootstrap fails, every unit is already busy, a started
/// run does not complete successfully, the worker exits early, or the wait
/// times out.
pub async fn run_local_ingest(config: Config) -> Result<(), LocalIngestError> {
    run_local_ingest_inner(config).await
}

fn local_ingest_err(
    error: impl Into<Box<dyn std::error::Error + Send + Sync>>,
) -> LocalIngestError {
    LocalIngestError::Bootstrap(error.into())
}

struct LocalIngestRuntime {
    /// Held for the CLI lifetime so a concurrent server cannot steal schedule slots.
    owner_lease: IngestionOwnerLease,
    ingestion_store: Arc<Store<IngestionRun>>,
    ingestion_projection: Arc<Projection<IngestionRun>>,
    worker: JoinHandle<()>,
}

async fn bootstrap_local_ingest(config: &Config) -> Result<LocalIngestRuntime, LocalIngestError> {
    let filter = EnvFilter::new(format!("moneymentum={}", config.log_level.as_str()));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    ensure_shared_database(&config.database_url).map_err(local_ingest_err)?;

    // Exclusive ownership must be proven before abandoning Running streams: a
    // live server or another CLI still holds those jobs, and releasing their
    // slots would allow duplicate writers.
    let owner_lease = IngestionOwnerLease::try_acquire(&config.database_url).await?;

    let database_options = SqliteConnectOptions::from_str(&config.database_url)
        .map_err(local_ingest_err)?
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePool::connect_with(database_options)
        .await
        .map_err(local_ingest_err)?;
    debug!("database connected");

    let mut migrations = sqlx::migrate!("./migrations");
    migrations
        .set_ignore_missing(true)
        .run(&pool)
        .await
        .map_err(local_ingest_err)?;
    debug!(count = migrations.iter().count(), "migrations applied");

    let (ingestion_store, ingestion_projection) = StoreBuilder::<IngestionRun>::new(pool.clone())
        .build()
        .await
        .map_err(local_ingest_err)?;
    let (market_catalog, market_catalog_projection) =
        StoreBuilder::<MarketCatalog>::new(pool.clone())
            .build()
            .await
            .map_err(local_ingest_err)?;
    let (_market_enablement, market_enablement_projection) =
        StoreBuilder::<MarketEnablement>::new(pool)
            .build()
            .await
            .map_err(local_ingest_err)?;
    debug!("event-sourced stores ready");

    recover_abandoned_runs(&ingestion_store, &ingestion_projection)
        .await
        .map_err(local_ingest_err)?;

    let apalis_options = apalis_sqlite::SqliteConnectOptions::from_str(&config.database_url)
        .map_err(local_ingest_err)?
        .busy_timeout(Duration::from_secs(5));
    let apalis_pool = apalis_sqlite::SqlitePool::connect_with(apalis_options)
        .await
        .map_err(local_ingest_err)?;
    debug!("apalis storage pool connected");

    let hyperliquid_clients = HyperliquidClients::from_config(
        config.hyperliquid_base_url.as_ref(),
        config.hyperliquid_testnet_base_url.as_ref(),
        config.max_retries,
    )
    .await
    .map_err(local_ingest_err)?;
    let services = IngestionServices {
        hyperliquid: Arc::clone(&hyperliquid_clients.mainnet),
        data_dir: config.data_dir.clone(),
        max_concurrent_requests: config.max_concurrent_requests,
        market_catalog: Arc::clone(&market_catalog),
        market_catalog_projection: Arc::clone(&market_catalog_projection),
        market_enablement_projection: Arc::clone(&market_enablement_projection),
    };
    let worker = spawn_ingestion_worker(
        apalis_pool,
        Arc::new(IngestionJobContext {
            run_store: Arc::clone(&ingestion_store),
            run_projection: Arc::clone(&ingestion_projection),
            services,
        }),
    );
    debug!("ingestion worker started");

    Ok(LocalIngestRuntime {
        owner_lease,
        ingestion_store,
        ingestion_projection,
        worker,
    })
}

async fn unfinished_run_summary(
    runtime: &LocalIngestRuntime,
    started_run_ids: &[IngestionRunId],
) -> Result<String, LocalIngestError> {
    let mut parts = Vec::with_capacity(started_run_ids.len());
    for run_id in started_run_ids {
        let status = runtime
            .ingestion_store
            .load(run_id)
            .await
            .map_err(local_ingest_err)?
            .map(|loaded| loaded.status);
        parts.push(format!("{run_id}={status:?}"));
    }
    Ok(parts.join(", "))
}

async fn wait_for_local_ingest_completion(
    runtime: &mut LocalIngestRuntime,
    started_run_ids: &[IngestionRunId],
    timeout: Duration,
) -> Result<(), LocalIngestError> {
    // Poll only the runs this CLI enqueued. Unrelated Running rows (or busy
    // units that were never started here) must not keep the command waiting.
    // Race the poll against worker exit and a hard deadline so a hung worker
    // cannot leave the CLI blocked forever.
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let mut pending = false;
        for run_id in started_run_ids {
            let status = runtime
                .ingestion_store
                .load(run_id)
                .await
                .map_err(local_ingest_err)?
                .map(|loaded| loaded.status);
            if status == Some(IngestionRunStatus::Running) {
                pending = true;
                break;
            }
        }
        if !pending {
            break;
        }

        let now = tokio::time::Instant::now();
        if now >= deadline {
            let unfinished = unfinished_run_summary(runtime, started_run_ids).await?;
            warn!(unfinished = %unfinished, "local ingestion timed out");
            return Err(LocalIngestError::TimedOut { unfinished });
        }

        let sleep_until = deadline.min(now + Duration::from_millis(250));
        tokio::select! {
            () = tokio::time::sleep_until(sleep_until) => {}
            join_result = &mut runtime.worker => {
                let unfinished = unfinished_run_summary(runtime, started_run_ids).await?;
                match join_result {
                    Ok(()) => warn!(
                        unfinished = %unfinished,
                        "ingestion worker exited before local ingest finished"
                    ),
                    Err(join_error) => warn!(
                        error = %join_error,
                        unfinished = %unfinished,
                        "ingestion worker task failed before local ingest finished"
                    ),
                }
                return Err(LocalIngestError::WorkerExited { unfinished });
            }
        }
    }

    for run_id in started_run_ids {
        let run = runtime
            .ingestion_store
            .load(run_id)
            .await
            .map_err(local_ingest_err)?;
        let status = run.as_ref().map(|loaded| loaded.status);
        if status != Some(IngestionRunStatus::Completed) {
            warn!(
                run_id = %run_id,
                status = ?status,
                "local ingestion run did not complete successfully"
            );
            return Err(LocalIngestError::RunNotCompleted {
                run_id: run_id.clone(),
                status,
            });
        }
    }

    Ok(())
}

async fn finalize_enqueued_runs(
    runtime: &mut LocalIngestRuntime,
    outcome: ActiveUnitsEnqueue,
    timeout: Duration,
) -> Result<(), LocalIngestError> {
    if outcome.enqueued.is_empty() {
        return outcome.error.map_or_else(
            || {
                warn!("no idle ingestion units available; every unit already has a running run");
                Err(LocalIngestError::NothingEnqueued)
            },
            |err| {
                warn!(
                    error = %err,
                    "local ingestion enqueue failed with no runs started"
                );
                Err(local_ingest_err(err))
            },
        );
    }

    debug!(
        enqueued = outcome.enqueued.len(),
        "local ingestion runs enqueued; waiting for completion"
    );

    wait_for_local_ingest_completion(runtime, &outcome.enqueued, timeout).await?;

    if let Some(err) = outcome.error {
        warn!(
            error = %err,
            completed = outcome.enqueued.len(),
            "local ingestion finished enqueued runs after a partial enqueue failure"
        );
        return Err(local_ingest_err(err));
    }

    info!(
        completed = outcome.enqueued.len(),
        "local ingestion finished"
    );
    Ok(())
}

async fn run_local_ingest_inner(config: Config) -> Result<(), LocalIngestError> {
    let mut runtime = bootstrap_local_ingest(&config).await?;

    let outcome =
        create_runs_for_active_units(&runtime.ingestion_store, &runtime.ingestion_projection).await;

    let result =
        finalize_enqueued_runs(&mut runtime, outcome, LOCAL_INGEST_COMPLETION_TIMEOUT).await;

    // Close the sidecar lock before returning so a following CLI/server acquire
    // does not race sqlx's async Drop worker.
    runtime.owner_lease.release().await?;
    result
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tracing::Level;
    use tracing_test::traced_test;

    use super::{
        LocalIngestError, LocalIngestRuntime, finalize_enqueued_runs,
        wait_for_local_ingest_completion,
    };
    use crate::ingestion::fixtures::ingestion_store;
    use crate::ingestion::{
        ActiveUnitsEnqueue, IngestionError, IngestionOwnerLease, IngestionRunStatus, IngestionWork,
        complete_run, create_run, create_runs_for_active_units, fail_run,
    };
    use crate::logs_contain_at;
    use crate::timeframe::Timeframe;

    async fn test_runtime() -> LocalIngestRuntime {
        let data_dir = tempfile::TempDir::new().unwrap();
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("lease.db").display()
        );
        let owner_lease = IngestionOwnerLease::try_acquire(&database_url)
            .await
            .unwrap();
        let (ingestion_store, ingestion_projection, _pool) = ingestion_store().await;
        // Keep the tempdir alive for the lease sidecar path for the test body.
        std::mem::forget(data_dir);

        LocalIngestRuntime {
            owner_lease,
            ingestion_store,
            ingestion_projection,
            worker: tokio::spawn(std::future::pending()),
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn finalize_reports_nothing_enqueued_when_every_unit_is_busy() {
        let mut runtime = test_runtime().await;
        let first =
            create_runs_for_active_units(&runtime.ingestion_store, &runtime.ingestion_projection)
                .await;
        assert!(!first.enqueued.is_empty());

        let outcome =
            create_runs_for_active_units(&runtime.ingestion_store, &runtime.ingestion_projection)
                .await;
        let error = finalize_enqueued_runs(&mut runtime, outcome, Duration::from_secs(1))
            .await
            .unwrap_err();

        assert!(matches!(error, LocalIngestError::NothingEnqueued));
        assert!(logs_contain_at(
            Level::WARN,
            &["no idle ingestion units available"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn wait_rejects_a_failed_terminal_run() {
        let mut runtime = test_runtime().await;
        let run_id = create_run(
            &runtime.ingestion_store,
            &runtime.ingestion_projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        fail_run(&runtime.ingestion_store, &run_id, "boom")
            .await
            .unwrap();

        let error = wait_for_local_ingest_completion(
            &mut runtime,
            std::slice::from_ref(&run_id),
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();

        assert!(matches!(
            error,
            LocalIngestError::RunNotCompleted {
                status: Some(IngestionRunStatus::Failed),
                ..
            }
        ));
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::WARN,
            &[
                "local ingestion run did not complete successfully",
                run_id.as_str()
            ]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn finalize_surfaces_partial_enqueue_after_started_runs_complete() {
        let mut runtime = test_runtime().await;
        let run_id = create_run(
            &runtime.ingestion_store,
            &runtime.ingestion_projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        complete_run(&runtime.ingestion_store, &run_id, chrono::Utc::now())
            .await
            .unwrap();

        let error = finalize_enqueued_runs(
            &mut runtime,
            ActiveUnitsEnqueue {
                enqueued: vec![run_id],
                error: Some(IngestionError::AlreadyRunning),
            },
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();

        assert!(matches!(error, LocalIngestError::Bootstrap(_)));
        assert!(logs_contain_at(
            Level::WARN,
            &["local ingestion finished enqueued runs after a partial enqueue failure"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn wait_reports_worker_exit_while_runs_are_pending() {
        let data_dir = tempfile::TempDir::new().unwrap();
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("lease.db").display()
        );
        let owner_lease = IngestionOwnerLease::try_acquire(&database_url)
            .await
            .unwrap();
        let (ingestion_store, ingestion_projection, _pool) = ingestion_store().await;
        let run_id = create_run(
            &ingestion_store,
            &ingestion_projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();

        let mut runtime = LocalIngestRuntime {
            owner_lease,
            ingestion_store,
            ingestion_projection,
            worker: tokio::spawn(async {}),
        };
        std::mem::forget(data_dir);

        let error = wait_for_local_ingest_completion(
            &mut runtime,
            std::slice::from_ref(&run_id),
            Duration::from_secs(5),
        )
        .await
        .unwrap_err();

        assert!(matches!(error, LocalIngestError::WorkerExited { .. }));
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::WARN,
            &[
                "ingestion worker exited before local ingest finished",
                run_id.as_str()
            ]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn wait_times_out_while_runs_remain_running() {
        let mut runtime = test_runtime().await;
        let run_id = create_run(
            &runtime.ingestion_store,
            &runtime.ingestion_projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();

        let error = wait_for_local_ingest_completion(
            &mut runtime,
            std::slice::from_ref(&run_id),
            Duration::from_millis(50),
        )
        .await
        .unwrap_err();

        assert!(matches!(error, LocalIngestError::TimedOut { .. }));
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::WARN,
            &["local ingestion timed out", run_id.as_str()]
        ));
    }
}
