-- Reconcile the event store with event-sorcery's canonical schema.
--
-- The `events`, `snapshots`, and `ingestion_view` tables were created by
-- earlier migrations for a cqrs-es Ingestion aggregate that issue #339 removed,
-- so they are empty. event-sorcery now owns the event store:
--
--   * `events` already matches event-sorcery's canonical layout -- left as is.
--   * `snapshots` is missing the `snapshot_version` column event-sorcery's
--     schema reconciler reads, so we recreate it from empty with the canonical
--     columns rather than ALTER (the table holds no rows to preserve).
--   * `ingestion_view` is dead: ingestion uses the `ingestion_runs` ledger, and
--     event-sorcery creates per-aggregate view tables itself, so the orphan is
--     dropped to avoid confusion with future projection tables.

DROP TABLE IF EXISTS ingestion_view;

DROP TABLE IF EXISTS snapshots;

CREATE TABLE IF NOT EXISTS snapshots (
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    last_sequence BIGINT NOT NULL,
    snapshot_version BIGINT NOT NULL DEFAULT 0,
    payload JSON NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (aggregate_type, aggregate_id)
);
