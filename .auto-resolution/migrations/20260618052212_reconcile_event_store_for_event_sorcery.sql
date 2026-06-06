-- Reconcile the event store with event-sorcery's canonical schema.
--
-- The `events`, `snapshots`, and `ingestion_view` tables were created by
-- earlier migrations for a cqrs-es Ingestion aggregate that issue #339 removed.
-- event-sorcery now owns the event store:
--
--   * `events` already matches event-sorcery's canonical layout -- left as is.
--   * `snapshots` is missing the `snapshot_version` column event-sorcery's
--     schema reconciler reads. We rebuild the table with the canonical columns
--     and copy every existing row forward (defaulting `snapshot_version` to 0)
--     rather than dropping it, so a database that still holds snapshot rows
--     keeps its event-store state instead of silently losing it.
--   * `ingestion_view` is dead: ingestion uses the `ingestion_runs` ledger, and
--     event-sorcery creates per-aggregate view tables itself, so the orphan is
--     dropped to avoid confusion with future projection tables.

DROP TABLE IF EXISTS ingestion_view;

ALTER TABLE snapshots RENAME TO snapshots_legacy;

CREATE TABLE snapshots (
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    last_sequence BIGINT NOT NULL,
    snapshot_version BIGINT NOT NULL DEFAULT 0,
    payload JSON NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (aggregate_type, aggregate_id)
);

INSERT INTO snapshots (
    aggregate_type,
    aggregate_id,
    last_sequence,
    payload,
    timestamp
)
SELECT
    aggregate_type,
    aggregate_id,
    last_sequence,
    payload,
    timestamp
FROM snapshots_legacy;

DROP TABLE snapshots_legacy;
