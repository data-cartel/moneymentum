-- Materialized view for the MarketCatalog aggregate. Read by primary key (the
-- venue), so no generated columns: the listed universe is a nested array loaded
-- and decoded in Rust.

CREATE TABLE IF NOT EXISTS market_catalog_view (
    view_id TEXT PRIMARY KEY,
    version BIGINT NOT NULL,
    payload JSON NOT NULL
);

