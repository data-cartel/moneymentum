//! Ingestion orchestration and the event-sourced [`IngestionRun`] lifecycle.
//!
//! Each ingestion attempt is its own [`IngestionRun`] stream -- a monotone
//! `Running -> {Completed, Failed, Abandoned}` state machine -- so crashed and
//! abandoned runs stay visible without a database reset. The one-running-run-per-
//! schedule-key invariant is enforced by the per-work projection check plus a
//! partial unique index; an unconditional startup reconciler abandons every
//! still-running stream before schedulers start, so a crash can never wedge a slot.
//!
//! Organized by concern:
//! - [`run_id`]: opaque run identity and wire parsing.
//! - [`run`]: the event-sourced aggregate and terminal transitions.
//! - [`job`]: the apalis worker that performs ingestion work.
//! - [`orchestration`]: run creation, recovery, scheduling, and status reads.
//! - [`services`]: shared dependencies injected into the worker.

mod job;
mod orchestration;
mod run;
mod run_id;
mod services;
mod work;

#[cfg(test)]
pub(crate) mod fixtures;

pub(crate) use job::{IngestionJob, IngestionJobContext};
pub(crate) use orchestration::{
    default_ingestion_schedules, latest_status, recover_abandoned_runs, trigger_scheduled_ingestion,
};
pub(crate) use run::{IngestionRun, IngestionRunStatus};
pub(crate) use services::IngestionServices;
pub(crate) use work::IngestionWork;
