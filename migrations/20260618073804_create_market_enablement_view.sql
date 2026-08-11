-- Materialized view for the MarketEnablement aggregate. `status` is a STORED
-- generated column over `$.Live.status` (the serialized MarketStatus, "Enabled"
-- / "Disabled"), so the tradable-set join can scan only the disabled rows.

CREATE TABLE IF NOT EXISTS market_enablement_view (
    view_id TEXT PRIMARY KEY,
    version BIGINT NOT NULL,
    payload JSON NOT NULL,
    status TEXT GENERATED ALWAYS AS (json_extract(payload, '$.Live.status')) STORED
);

CREATE INDEX IF NOT EXISTS idx_market_enablement_view_status
    ON market_enablement_view(status)
    WHERE status IS NOT NULL;

