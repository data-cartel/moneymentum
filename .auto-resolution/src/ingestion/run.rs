use chrono::{DateTime, Utc};
use event_sorcery::{
    Column, DomainEvent, EventSourced, JobQueue, ProjectionError, SendError, Store, Table,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::debug;

use super::job::IngestionJob;
use super::run_id::IngestionRunId;
use super::work::IngestionWork;

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
    pub(super) status: IngestionRunStatus,
    pub(super) started_at: DateTime<Utc>,
    pub(super) schedule_key: String,
}

/// The immutable facts of an ingestion run's lifecycle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum IngestionRunEvent {
    Started {
        started_at: DateTime<Utc>,
        schedule_key: String,
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
        run_id: IngestionRunId,
        started_at: DateTime<Utc>,
        work: IngestionWork,
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Error)]
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
    type Jobs = event_sorcery::jobs![IngestionJob];
    type Materialized = Table;

    const AGGREGATE_TYPE: &'static str = "IngestionRun";
    const PROJECTION: Table = Table("ingestion_run_view");
    const SCHEMA_VERSION: u64 = 2;

    fn originate(event: &IngestionRunEvent) -> Option<Self> {
        match event {
            IngestionRunEvent::Started {
                started_at,
                schedule_key,
            } => Some(Self {
                status: IngestionRunStatus::Running,
                started_at: *started_at,
                schedule_key: schedule_key.clone(),
            }),
            IngestionRunEvent::Completed { .. }
            | IngestionRunEvent::Failed { .. }
            | IngestionRunEvent::Abandoned { .. } => None,
        }
    }

    fn evolve(entity: &Self, event: &IngestionRunEvent) -> Result<Option<Self>, IngestionRunError> {
        if entity.status != IngestionRunStatus::Running {
            return Err(IngestionRunError::AlreadyTerminal);
        }

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
        jobs: &mut JobQueue<Self::Jobs>,
    ) -> Result<Vec<IngestionRunEvent>, IngestionRunError> {
        match command {
            IngestionRunCommand::Start {
                run_id,
                started_at,
                work,
            } => {
                // Enqueue the ingestion job on the same handle the framework
                // flushes inside the event-commit transaction, so the job is
                // queued iff the `Started` event commits -- there is no window
                // where a run is Running with no job behind it (issue #404).
                jobs.push(IngestionJob::new(run_id, work));
                Ok(vec![IngestionRunEvent::Started {
                    started_at,
                    schedule_key: work.schedule_key().to_string(),
                }])
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
                if self.status != IngestionRunStatus::Running =>
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

pub(super) async fn complete_run(
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

pub(crate) async fn running_runs(
    projection: &event_sorcery::Projection<IngestionRun>,
) -> Result<Vec<(IngestionRunId, IngestionRun)>, ProjectionError<IngestionRun>> {
    projection
        .filter(RUN_STATUS, &IngestionRunStatus::Running)
        .await
}

pub(crate) async fn running_runs_for_work(
    projection: &event_sorcery::Projection<IngestionRun>,
    work: IngestionWork,
) -> Result<Vec<(IngestionRunId, IngestionRun)>, ProjectionError<IngestionRun>> {
    let schedule_key = work.schedule_key();
    running_runs(projection).await.map(|runs| {
        runs.into_iter()
            .filter(|(_, run)| run.schedule_key == schedule_key)
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use event_sorcery::{LifecycleError, TestHarness, replay};
    use tracing::Level;
    use tracing_test::traced_test;

    use super::{
        IngestionRun, IngestionRunCommand, IngestionRunError, IngestionRunEvent,
        IngestionRunStatus, complete_run, fail_run, running_runs,
    };
    use crate::ingestion::fixtures::{ingestion_store, instant};
    use crate::ingestion::orchestration::{ABANDONED_RUN_REASON, create_run, latest_status};
    use crate::ingestion::run_id::IngestionRunId;
    use crate::ingestion::work::IngestionWork;
    use crate::logs_contain_at;
    use crate::timeframe::Timeframe;

    fn started_event(started_at: chrono::DateTime<chrono::Utc>) -> IngestionRunEvent {
        IngestionRunEvent::Started {
            started_at,
            schedule_key: IngestionWork::candles(Timeframe::OneHour)
                .schedule_key()
                .to_string(),
        }
    }

    #[test]
    fn replay_reconstructs_a_running_run() {
        let run = replay::<IngestionRun>(vec![IngestionRunEvent::Started {
            started_at: instant(),
            schedule_key: IngestionWork::candles(Timeframe::OneHour)
                .schedule_key()
                .to_string(),
        }])
        .unwrap()
        .unwrap();

        assert_eq!(run.status, IngestionRunStatus::Running);
    }

    #[test]
    fn replay_rejects_history_starting_with_a_terminal_event() {
        let result = replay::<IngestionRun>(vec![IngestionRunEvent::Completed {
            last_record_at: instant(),
            completed_at: instant(),
        }]);

        assert!(
            result.is_err(),
            "a history starting with a terminal event must not originate a run"
        );
    }

    #[test]
    fn replay_reconstructs_a_completed_run() {
        let run = replay::<IngestionRun>(vec![
            IngestionRunEvent::Started {
                started_at: instant(),
                schedule_key: IngestionWork::candles(Timeframe::OneHour)
                    .schedule_key()
                    .to_string(),
            },
            IngestionRunEvent::Completed {
                last_record_at: instant(),
                completed_at: instant(),
            },
        ])
        .unwrap()
        .unwrap();

        assert_eq!(run.status, IngestionRunStatus::Completed);
    }

    #[tokio::test]
    async fn starting_a_fresh_run_emits_started() {
        let started_at = instant();
        let run_id = IngestionRunId::new(started_at);

        TestHarness::<IngestionRun>::with()
            .given(vec![])
            .when(IngestionRunCommand::Start {
                run_id,
                started_at,
                work: IngestionWork::candles(Timeframe::OneHour),
            })
            .await
            .then_expect_events(&[started_event(started_at)]);
    }

    #[tokio::test]
    async fn starting_an_existing_run_returns_already_started() {
        let started_at = instant();
        let run_id = IngestionRunId::new(started_at);
        let error = TestHarness::<IngestionRun>::with()
            .given(vec![started_event(started_at)])
            .when(IngestionRunCommand::Start {
                run_id,
                started_at,
                work: IngestionWork::candles(Timeframe::OneHour),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(IngestionRunError::AlreadyStarted)
        ));
    }

    #[tokio::test]
    async fn complete_before_start_returns_not_started() {
        let error = TestHarness::<IngestionRun>::with()
            .given(vec![])
            .when(IngestionRunCommand::Complete {
                last_record_at: instant(),
                completed_at: instant(),
            })
            .await
            .then_expect_error();

        assert!(matches!(
            error,
            LifecycleError::Apply(IngestionRunError::NotStarted)
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn complete_run_transitions_a_running_run_via_store() {
        let (store, projection, pool) = ingestion_store().await;
        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();

        complete_run(&store, &run_id, instant()).await.unwrap();

        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Completed)
        );
        assert!(running_runs(&projection).await.unwrap().is_empty());
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion run completed", run_id.as_str()]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn fail_run_transitions_a_running_run_via_store() {
        let (store, projection, pool) = ingestion_store().await;
        let run_id = create_run(
            &store,
            &projection,
            IngestionWork::candles(Timeframe::OneHour),
        )
        .await
        .unwrap();

        fail_run(&store, &run_id, "boom").await.unwrap();

        assert_eq!(
            latest_status(&pool).await.unwrap(),
            Some(IngestionRunStatus::Failed)
        );
        assert!(running_runs(&projection).await.unwrap().is_empty());
        let run_id = run_id.to_string();
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion run failed", run_id.as_str()]
        ));
    }

    #[tokio::test]
    async fn completing_a_running_run_emits_completed() {
        TestHarness::<IngestionRun>::with()
            .given(vec![started_event(instant())])
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
                started_event(instant()),
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

    #[tokio::test]
    async fn failing_a_running_run_emits_failed() {
        TestHarness::<IngestionRun>::with()
            .given(vec![started_event(instant())])
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
            .given(vec![started_event(instant())])
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
                schedule_key: IngestionWork::candles(Timeframe::OneHour)
                    .schedule_key()
                    .to_string(),
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
                schedule_key: IngestionWork::candles(Timeframe::OneHour)
                    .schedule_key()
                    .to_string(),
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
}
