-- Materialized view for the IngestionRun aggregate. `status` is a STORED generated
-- column over `$.Live.status` (the Lifecycle::Live wrapper), holding the serialized
-- IngestionRunStatus ("Running" / "Completed" / "Failed" / "Abandoned").
--
-- The partial unique index is the backstop for the one-running invariant: at
-- most one view row may be `Running`. The /ingest handler checks this projection
-- before starting (the primary guard); the index catches any view-level race.
-- The legacy `ingestion_runs` ledger is kept until a backfill path exists.

CREATE TABLE IF NOT EXISTS ingestion_run_view (
    view_id TEXT PRIMARY KEY,
    version BIGINT NOT NULL,
    payload JSON NOT NULL,
    status TEXT GENERATED ALWAYS AS (json_extract(payload, '$.Live.status')) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS one_running_ingestion_run
    ON ingestion_run_view(status)
    WHERE status = 'Running';

