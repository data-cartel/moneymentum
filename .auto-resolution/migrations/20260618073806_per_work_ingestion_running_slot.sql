-- One Running row per schedule key (1h, 15m, funding, ...) instead of one
-- globally, so coincident cron ticks for different work units can each enqueue.

DROP INDEX IF EXISTS one_running_ingestion_run;

-- VIRTUAL, not STORED: SQLite rejects ALTER TABLE ADD COLUMN of a STORED
-- generated column on a table that already has rows, so a STORED column here
-- applies on fresh databases but fails on any database with recorded runs
-- (which took prod down). The column only backs the partial unique index
-- below, and indexes on virtual generated columns are enforced identically.
ALTER TABLE ingestion_run_view ADD COLUMN schedule_key TEXT GENERATED ALWAYS AS (
    json_extract(payload, '$.Live.schedule_key')
) VIRTUAL;

CREATE UNIQUE INDEX IF NOT EXISTS one_running_ingestion_run_per_schedule_key
    ON ingestion_run_view(schedule_key)
    WHERE status = 'Running';
