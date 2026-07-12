use chrono::{DateTime, Utc};
use event_sorcery::{Job, Label, Projection, ProjectionError, SendError, Store};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{error, info, warn};

use crate::hyperliquid::{CandleIngester, FundingRateIngester, Hyperliquid};
use crate::market_metadata::RefreshError;

use super::orchestration::LOST_RACE_REASON;
use super::run::{
    IngestionRun, IngestionRunCommand, IngestionRunStatus, complete_run, fail_run,
    running_runs_for_work,
};
use super::run_id::IngestionRunId;
use super::services::IngestionServices;
use super::work::IngestionWork;

#[derive(Debug, thiserror::Error)]
pub(crate) enum IngestionJobError {
    #[error(transparent)]
    Send(#[from] SendError<IngestionRun>),
    #[error(transparent)]
    Projection(#[from] ProjectionError<IngestionRun>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct IngestionJob {
    run_id: IngestionRunId,
    work: IngestionWork,
}

impl IngestionJob {
    pub(crate) fn new(run_id: IngestionRunId, work: IngestionWork) -> Self {
        Self { run_id, work }
    }
}

/// Everything the ingestion worker needs to drive a run to a terminal state:
/// the run's own event store (to load state and record completion or failure)
/// and the fetch/catalog services that do the ingestion work. Built once at
/// startup and shared as the worker's [`Job::Input`].
pub(crate) struct IngestionJobContext {
    pub(crate) run_store: Arc<Store<IngestionRun>>,
    pub(crate) run_projection: Arc<Projection<IngestionRun>>,
    pub(crate) services: IngestionServices,
}

impl Job for IngestionJob {
    type Input = IngestionJobContext;
    type Output = ();
    type Error = IngestionJobError;

    const WORKER_NAME: &'static str = "ingestion";
    const KIND: &'static str = "ingestion";

    fn label(&self) -> Label {
        Label::new(format!(
            "ingestion:{}:{}",
            self.work.schedule_key(),
            self.run_id
        ))
    }

    async fn perform(&self, context: &IngestionJobContext) -> Result<(), IngestionJobError> {
        let store = &context.run_store;
        let services = &context.services;

        // A run abandoned by startup recovery must not resurrect: skip the work
        // and leave its terminal state untouched.
        match store.load(&self.run_id).await {
            Ok(Some(run)) if run.status == IngestionRunStatus::Running => {}
            Ok(_) => {
                warn!(run_id = %self.run_id, "skipping ingestion for a finished run");
                return Ok(());
            }
            // A load failure leaves the run's state unknown -- surface it so the
            // worker retries rather than silently marking the job done.
            Err(err) => {
                error!(error = %err, run_id = %self.run_id, "failed to load ingestion run");
                return Err(err.into());
            }
        }

        // Both concurrent `create_run` losers and winners enqueue a job atomically
        // with `Start`. The aggregate can still read Running for a loser until its
        // `Abandon` commits, so verify this run_id is the projection's sole winner
        // before any ingestion I/O.
        let holds_slot =
            match holds_one_running_slot(&context.run_projection, &self.run_id, self.work).await {
                Ok(holds_slot) => holds_slot,
                Err(err) => {
                    error!(
                        error = %err,
                        run_id = %self.run_id,
                        "failed to verify the one-running slot"
                    );
                    return Err(err.into());
                }
            };
        if !holds_slot {
            match store.load(&self.run_id).await {
                Ok(Some(run)) if run.status == IngestionRunStatus::Running => {
                    store
                        .send(
                            &self.run_id,
                            IngestionRunCommand::Abandon {
                                reason: LOST_RACE_REASON.to_string(),
                                reconciled_at: Utc::now(),
                            },
                        )
                        .await?;
                }
                Ok(_) => {}
                Err(err) => {
                    error!(
                        error = %err,
                        run_id = %self.run_id,
                        "failed to load ingestion run before abandoning race loser"
                    );
                    return Err(err.into());
                }
            }
            warn!(
                run_id = %self.run_id,
                "skipping ingestion for a run that lost the one-running race"
            );
            return Ok(());
        }

        let candle_ingester = CandleIngester::new(
            Arc::clone(&services.hyperliquid),
            services.max_concurrent_requests,
        );
        let funding_ingester = FundingRateIngester::new(
            Arc::clone(&services.hyperliquid),
            services.max_concurrent_requests,
        );

        match ingest_work(self.work, &candle_ingester, &funding_ingester, services).await {
            Ok(last_record) => {
                // The run stays Running until this commits; surface a
                // terminalization failure so the worker retries instead of
                // leaving the slot wedged until the next startup reconcile.
                if let Err(err) = complete_run(store, &self.run_id, last_record).await {
                    error!(error = %err, run_id = %self.run_id, "failed to record ingestion completion");
                    return Err(err.into());
                }
                info!(
                    run_id = %self.run_id,
                    work = self.work.schedule_key(),
                    "ingestion complete"
                );
            }
            Err(err) => {
                error!(
                    error = %err,
                    run_id = %self.run_id,
                    work = self.work.schedule_key(),
                    "ingestion failed"
                );
                // If we cannot even record the failure the run stays Running;
                // surface it so the worker retries rather than wedging the slot.
                if let Err(record_err) = fail_run(store, &self.run_id, &err.to_string()).await {
                    error!(
                        error = %record_err,
                        run_id = %self.run_id,
                        "failed to record ingestion failure"
                    );
                    return Err(record_err.into());
                }
            }
        }

        Ok(())
    }
}

async fn ingest_work(
    work: IngestionWork,
    candle_ingester: &CandleIngester<dyn Hyperliquid>,
    funding_ingester: &FundingRateIngester<dyn Hyperliquid>,
    services: &IngestionServices,
) -> Result<DateTime<Utc>, RefreshError> {
    let markets = crate::market_metadata::refresh_markets(
        services.hyperliquid.as_ref(),
        &services.market_catalog,
        &services.market_catalog_projection,
        &services.market_enablement_projection,
    )
    .await?;

    match work {
        IngestionWork::Funding => {
            funding_ingester
                .ingest_with_markets(&services.data_dir, &markets)
                .await?;
        }
        IngestionWork::Candles { timeframe } => {
            candle_ingester
                .ingest_with_markets(timeframe, &services.data_dir, &markets)
                .await?;
        }
    }

    Ok(Utc::now())
}

async fn holds_one_running_slot(
    projection: &Projection<IngestionRun>,
    run_id: &IngestionRunId,
    work: IngestionWork,
) -> Result<bool, ProjectionError<IngestionRun>> {
    Ok(matches!(
        running_runs_for_work(projection, work).await?.as_slice(),
        [(winner, _)] if winner == run_id
    ))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    use event_sorcery::Job;
    use tracing::Level;
    use tracing_test::traced_test;

    use super::IngestionJob;
    use crate::ingestion::fixtures::{
        FailingMockHyperliquid, MarketFailingMockHyperliquid, MockHyperliquid, ingestion_store,
        instant, job_context, test_services, test_services_with_hyperliquid,
    };
    use crate::ingestion::orchestration::{create_run, latest_status, recover_abandoned_runs};
    use crate::ingestion::run::{IngestionRunCommand, IngestionRunStatus, running_runs};
    use crate::ingestion::run_id::IngestionRunId;
    use crate::ingestion::work::IngestionWork;
    use crate::logs_contain_at;
    use crate::timeframe::Timeframe;

    #[test]
    fn ingestion_job_label_includes_run_id() {
        let run_id: IngestionRunId = "ingestion-123-00000000000000000000000000000001"
            .parse()
            .unwrap();
        let label =
            IngestionJob::new(run_id.clone(), IngestionWork::candles(Timeframe::OneHour)).label();

        assert_eq!(label.to_string(), format!("ingestion:1h:{run_id}"));
    }

    #[traced_test]
    #[tokio::test]
    async fn scoped_candle_job_ingests_only_one_timeframe() {
        let fetch_candles_calls = Arc::new(AtomicU32::new(0));
        let (store, projection, pool) = ingestion_store().await;
        let services = test_services_with_hyperliquid(Arc::new(
            MockHyperliquid::with_candle_call_counter(Arc::clone(&fetch_candles_calls)),
        ))
        .await;
        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        let job = IngestionJob::new(run_id, IngestionWork::candles(Timeframe::OneHour));
        let context = job_context(&store, &projection, services);

        job.perform(&context).await.unwrap();

        assert_eq!(fetch_candles_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Completed)
        );
        assert!(logs_contain_at(Level::INFO, &["ingestion complete", "1h"]));
    }

    #[traced_test]
    #[tokio::test]
    async fn latest_status_shows_running_after_failed_run() {
        let (store, projection, pool) = ingestion_store().await;
        let work = IngestionWork::candles(Timeframe::OneHour);
        let failed_run_id = create_run(&store, &projection, work).await.unwrap();
        let failing_context = job_context(
            &store,
            &projection,
            test_services_with_hyperliquid(Arc::new(FailingMockHyperliquid)).await,
        );
        IngestionJob::new(failed_run_id, work)
            .perform(&failing_context)
            .await
            .unwrap();
        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Failed)
        );

        create_run(&store, &projection, work).await.unwrap();

        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Running),
            "a new run must replace the failed status in the aggregate view"
        );
        assert!(logs_contain_at(Level::ERROR, &["ingestion failed", "1h"]));
    }

    #[traced_test]
    #[tokio::test]
    async fn job_records_failure_when_ingestion_errors() {
        let (store, projection, pool) = ingestion_store().await;
        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        let services = test_services_with_hyperliquid(Arc::new(FailingMockHyperliquid)).await;
        let context = job_context(&store, &projection, services);
        let job = IngestionJob::new(run_id.clone(), IngestionWork::candles(Timeframe::OneHour));

        job.perform(&context).await.unwrap();

        let status = latest_status(&pool).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Failed));
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::ERROR,
            &["ingestion failed", run_id.as_str()]
        ));
    }

    /// When one market of the universe fails its fetch, the run's failure must
    /// name it: the market is the first thing an operator needs from the logs.
    #[traced_test]
    #[tokio::test]
    async fn failed_run_names_the_failing_market() {
        let (store, projection, pool) = ingestion_store().await;
        let work = IngestionWork::candles(Timeframe::OneHour);
        let run_id = create_run(&store, &projection, work).await.unwrap();
        let services = test_services_with_hyperliquid(Arc::new(MarketFailingMockHyperliquid {
            failing_market: "ETH",
        }))
        .await;
        let context = job_context(&store, &projection, services);

        IngestionJob::new(run_id, work)
            .perform(&context)
            .await
            .unwrap();

        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Failed)
        );
        assert!(
            logs_contain_at(Level::ERROR, &["ingestion failed", "candle fetch", "ETH"]),
            "the failure log must name the failing market"
        );
    }

    #[traced_test]
    #[tokio::test]
    async fn stale_job_for_recovered_run_does_not_execute() {
        let (store, projection, pool) = ingestion_store().await;
        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        recover_abandoned_runs(&store, &projection).await.unwrap();
        let job = IngestionJob::new(run_id.clone(), IngestionWork::candles(Timeframe::OneHour));
        let context = job_context(&store, &projection, test_services().await);

        job.perform(&context).await.unwrap();

        let status = latest_status(&pool).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Abandoned));
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::WARN,
            &["skipping ingestion for a finished run", run_id.as_str()]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn job_completes_a_running_run_and_logs() {
        let (store, projection, pool) = ingestion_store().await;
        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();
        let job = IngestionJob::new(run_id.clone(), IngestionWork::candles(Timeframe::OneHour));
        let context = job_context(&store, &projection, test_services().await);

        job.perform(&context).await.unwrap();

        let status = latest_status(&pool).await.unwrap();

        assert_eq!(status, Some(IngestionRunStatus::Completed));
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::INFO,
            &["ingestion complete", run_id.as_str()]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn race_loser_job_skips_ingestion_before_winner_runs() {
        let fetch_market_metadata_calls = Arc::new(AtomicU32::new(0));
        let (store, projection, _pool) = ingestion_store().await;
        let services = test_services_with_hyperliquid(Arc::new(
            MockHyperliquid::with_call_counter(Arc::clone(&fetch_market_metadata_calls)),
        ))
        .await;
        let context = job_context(&store, &projection, services);

        // Simulate the post-Start race window: both streams committed `Start`
        // (and enqueued jobs) but the partial unique index left only one winner
        // in the projection.
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
                &second_id,
                IngestionRunCommand::Start {
                    run_id: second_id.clone(),
                    started_at: shared_start,
                    work: IngestionWork::candles(Timeframe::OneHour),
                },
            )
            .await
            .unwrap();

        let running = running_runs(&projection).await.unwrap();
        assert_eq!(running.len(), 1, "projection must admit exactly one winner");
        let winner_id = running[0].0.clone();
        let loser_id = if winner_id == first_id {
            second_id
        } else {
            first_id
        };

        // Run the loser's job first -- the ordering that previously duplicated work.
        IngestionJob::new(loser_id.clone(), IngestionWork::candles(Timeframe::OneHour))
            .perform(&context)
            .await
            .unwrap();
        IngestionJob::new(
            winner_id.clone(),
            IngestionWork::candles(Timeframe::OneHour),
        )
        .perform(&context)
        .await
        .unwrap();

        assert_eq!(
            fetch_market_metadata_calls.load(Ordering::SeqCst),
            1,
            "only the projection winner may execute ingestion"
        );

        let loser = store.load(&loser_id).await.unwrap().unwrap();
        let winner = store.load(&winner_id).await.unwrap().unwrap();
        assert_eq!(loser.status, IngestionRunStatus::Abandoned);
        assert_eq!(winner.status, IngestionRunStatus::Completed);

        let loser_id = loser_id.to_string();
        assert!(logs_contain_at(
            Level::WARN,
            &[
                "skipping ingestion for a run that lost the one-running race",
                loser_id.as_str()
            ]
        ));
        let winner_id = winner_id.to_string();
        assert!(logs_contain_at(
            Level::INFO,
            &["ingestion complete", winner_id.as_str()]
        ));
    }
}
