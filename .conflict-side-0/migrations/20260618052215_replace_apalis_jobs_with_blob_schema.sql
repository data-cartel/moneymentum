-- Ship apalis-sqlite 1.0-rc's `Workers`/`Jobs` schema as consumer-owned DDL.
--
-- apalis-sqlite does not run its own migrator here: doing so competes with our
-- migrator over the shared `_sqlx_migrations` table. Instead we replay its
-- final schema (the state after all of apalis-sqlite 1.0.0-rc.8's own
-- migrations) so the version is pinned to our Cargo.lock and the crate's
-- offline `query!` caches resolve against a matching table.
--
-- The old apalis-sql 0.7 tables stored the job payload as `job TEXT`; the
-- 1.0-rc fetcher expects `job BLOB`. The two cannot coexist, so we drop the
-- 0.7 tables first. In-flight 0.7 jobs are not migrated: ingestion jobs are
-- short-lived and re-triggerable via POST /ingest, and startup recovery already
-- fails any orphaned run, so nothing durable is lost.

DROP TABLE IF EXISTS Jobs;

DROP TABLE IF EXISTS Workers;

CREATE TABLE IF NOT EXISTS Workers (
    id TEXT NOT NULL UNIQUE,
    worker_type TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    layers TEXT,
    last_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    started_at INTEGER
);

CREATE INDEX IF NOT EXISTS Idx ON Workers(id);

CREATE INDEX IF NOT EXISTS WTIdx ON Workers(worker_type);

CREATE INDEX IF NOT EXISTS LSIdx ON Workers(last_seen);

CREATE TABLE IF NOT EXISTS Jobs (
    job BLOB NOT NULL,
    id TEXT NOT NULL UNIQUE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 25,
    run_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_result TEXT,
    lock_at INTEGER,
    lock_by TEXT,
    done_at INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    idempotency_key TEXT,
    PRIMARY KEY(id),
    FOREIGN KEY(lock_by) REFERENCES Workers(id)
);

CREATE INDEX IF NOT EXISTS TIdx ON Jobs(id);

CREATE INDEX IF NOT EXISTS SIdx ON Jobs(status);

CREATE INDEX IF NOT EXISTS LIdx ON Jobs(lock_by);

CREATE INDEX IF NOT EXISTS JTIdx ON Jobs(job_type);

CREATE INDEX IF NOT EXISTS idx_jobs_job_type_status_run_at ON Jobs(job_type, status, run_at);

CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON Jobs(status, run_at);

CREATE INDEX IF NOT EXISTS idx_jobs_run_at_status ON Jobs(run_at, status);

CREATE INDEX IF NOT EXISTS idx_jobs_completed_done_at ON Jobs(status, done_at, run_at)
WHERE
    status IN ('Done', 'Failed', 'Killed')
    AND done_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_pending ON Jobs(run_at)
WHERE
    status = 'Pending';

CREATE INDEX IF NOT EXISTS idx_jobs_running ON Jobs(run_at)
WHERE
    status = 'Running';

CREATE INDEX IF NOT EXISTS idx_jobs_job_type_run_at ON Jobs(job_type, run_at);

CREATE INDEX IF NOT EXISTS idx_jobs_job_type_covering ON Jobs(job_type, status, run_at, done_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON Jobs(job_type, idempotency_key);
