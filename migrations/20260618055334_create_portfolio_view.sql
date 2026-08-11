-- Materialized view for the Portfolio aggregate.
--
-- event-sorcery serializes the entity wrapped in its Lifecycle::Live variant, so
-- a live portfolio's fields live under `$.Live`. `name` and `status` are pulled
-- into STORED generated columns so the projection can look up and status-filter
-- without scanning every payload; `status` holds the serialized PortfolioStatus
-- ("Active" / "Archived").

CREATE TABLE IF NOT EXISTS portfolio_view (
    view_id TEXT PRIMARY KEY,
    version BIGINT NOT NULL,
    payload JSON NOT NULL,
    name TEXT GENERATED ALWAYS AS (json_extract(payload, '$.Live.name')) STORED,
    status TEXT GENERATED ALWAYS AS (json_extract(payload, '$.Live.status')) STORED
);

CREATE INDEX IF NOT EXISTS idx_portfolio_view_status
    ON portfolio_view(status)
    WHERE status IS NOT NULL;

