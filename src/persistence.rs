use sqlx::SqlitePool;
use thiserror::Error;
use tracing::warn;

const CQRS_EVENT_STORE_MIGRATION_VERSION: i64 = 20_260_208_011_202;
const EVENT_SORCERY_BRANCH_MIGRATION: &str =
    include_str!("../migration-fixtures/20260208011202_event_sorcery_branch_cqrs_event_store.sql");
const EXPECTED_EVENT_COLUMNS: &[ExpectedMigrationColumn] = &[
    ExpectedMigrationColumn::new("aggregate_type", "TEXT", true, None, 1),
    ExpectedMigrationColumn::new("aggregate_id", "TEXT", true, None, 2),
    ExpectedMigrationColumn::new("sequence", "BIGINT", true, None, 3),
    ExpectedMigrationColumn::new("event_type", "TEXT", true, None, 0),
    ExpectedMigrationColumn::new("event_version", "TEXT", true, None, 0),
    ExpectedMigrationColumn::new("payload", "JSON", true, None, 0),
    ExpectedMigrationColumn::new("metadata", "JSON", true, None, 0),
];
const EXPECTED_SNAPSHOT_COLUMNS: &[ExpectedMigrationColumn] = &[
    ExpectedMigrationColumn::new("aggregate_type", "TEXT", true, None, 1),
    ExpectedMigrationColumn::new("aggregate_id", "TEXT", true, None, 2),
    ExpectedMigrationColumn::new("last_sequence", "BIGINT", true, None, 0),
    ExpectedMigrationColumn::new("snapshot_version", "BIGINT", true, Some("0"), 0),
    ExpectedMigrationColumn::new("payload", "JSON", true, None, 0),
    ExpectedMigrationColumn::new("timestamp", "TEXT", true, None, 0),
];
const EXPECTED_EVENT_INDEXES: &[ExpectedMigrationIndex] = &[
    ExpectedMigrationIndex::new("idx_events_type", "aggregate_type"),
    ExpectedMigrationIndex::new("idx_events_aggregate", "aggregate_id"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MigrationHistoryOutcome {
    Unchanged,
    Reconciled,
}

#[derive(Debug, Error)]
pub(super) enum MigrationHistoryError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error("embedded migration 20260208011202 is missing")]
    EmbeddedMigrationMissing,
}

#[derive(Debug, PartialEq, Eq, sqlx::FromRow)]
struct MigrationColumn {
    name: String,
    #[sqlx(rename = "type")]
    column_type: String,
    #[sqlx(rename = "notnull")]
    not_null: i64,
    default_value: Option<String>,
    primary_key_position: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExpectedMigrationColumn {
    name: &'static str,
    column_type: &'static str,
    not_null: bool,
    default_value: Option<&'static str>,
    primary_key_position: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExpectedMigrationIndex {
    name: &'static str,
    column: &'static str,
}

impl ExpectedMigrationColumn {
    const fn new(
        name: &'static str,
        column_type: &'static str,
        not_null: bool,
        default_value: Option<&'static str>,
        primary_key_position: i64,
    ) -> Self {
        Self {
            name,
            column_type,
            not_null,
            default_value,
            primary_key_position,
        }
    }
}

impl ExpectedMigrationIndex {
    const fn new(name: &'static str, column: &'static str) -> Self {
        Self { name, column }
    }
}

impl MigrationColumn {
    fn matches(&self, expected: &ExpectedMigrationColumn) -> bool {
        self.name == expected.name
            && self.column_type.eq_ignore_ascii_case(expected.column_type)
            && (self.not_null != 0) == expected.not_null
            && self.default_value.as_deref() == expected.default_value
            && self.primary_key_position == expected.primary_key_position
    }
}

pub(super) async fn reconcile_known_migration_history(
    pool: &SqlitePool,
) -> Result<MigrationHistoryOutcome, MigrationHistoryError> {
    let migration_table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    if !migration_table_exists {
        return Ok(MigrationHistoryOutcome::Unchanged);
    }

    let applied_checksum: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = ?1")
            .bind(CQRS_EVENT_STORE_MIGRATION_VERSION)
            .fetch_optional(pool)
            .await?;
    let event_sorcery_branch_checksum = event_sorcery_branch_checksum();
    if applied_checksum.as_deref() != Some(event_sorcery_branch_checksum.as_slice()) {
        return Ok(MigrationHistoryOutcome::Unchanged);
    }

    let events_are_compatible = table_matches(pool, "events", EXPECTED_EVENT_COLUMNS).await?;
    let snapshots_are_compatible =
        table_matches(pool, "snapshots", EXPECTED_SNAPSHOT_COLUMNS).await?;
    let event_indexes_are_compatible = indexes_match(pool, EXPECTED_EVENT_INDEXES).await?;
    if !events_are_compatible || !snapshots_are_compatible || !event_indexes_are_compatible {
        return Ok(MigrationHistoryOutcome::Unchanged);
    }

    let canonical_checksum = sqlx::migrate!("./migrations")
        .iter()
        .find(|migration| migration.version == CQRS_EVENT_STORE_MIGRATION_VERSION)
        .map(|migration| migration.checksum.as_ref().to_vec())
        .ok_or(MigrationHistoryError::EmbeddedMigrationMissing)?;
    let update = sqlx::query(
        "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2 AND checksum = ?3",
    )
    .bind(canonical_checksum)
    .bind(CQRS_EVENT_STORE_MIGRATION_VERSION)
    .bind(event_sorcery_branch_checksum)
    .execute(pool)
    .await?;
    if update.rows_affected() != 1 {
        return Ok(MigrationHistoryOutcome::Unchanged);
    }

    warn!(
        migration_version = CQRS_EVENT_STORE_MIGRATION_VERSION,
        "known migration history reconciled"
    );
    Ok(MigrationHistoryOutcome::Reconciled)
}

fn event_sorcery_branch_checksum() -> Vec<u8> {
    sqlx::migrate::Migration::new(
        CQRS_EVENT_STORE_MIGRATION_VERSION,
        "historical event-sorcery branch".into(),
        sqlx::migrate::MigrationType::Simple,
        sqlx::SqlStr::from_static(EVENT_SORCERY_BRANCH_MIGRATION),
        false,
    )
    .checksum
    .into_owned()
}

async fn indexes_match(
    pool: &SqlitePool,
    expected_indexes: &[ExpectedMigrationIndex],
) -> Result<bool, sqlx::Error> {
    for expected in expected_indexes {
        let index_columns: Vec<String> = sqlx::query_scalar(
            "SELECT index_info.name FROM pragma_index_list('events') AS index_list \
             JOIN pragma_index_info(index_list.name) AS index_info \
             WHERE index_list.name = ?1 AND index_list.\"unique\" = 0 ORDER BY index_info.seqno",
        )
        .bind(expected.name)
        .fetch_all(pool)
        .await?;
        if index_columns != [expected.column] {
            return Ok(false);
        }
    }

    Ok(true)
}

async fn table_matches(
    pool: &SqlitePool,
    table_name: &str,
    expected_columns: &[ExpectedMigrationColumn],
) -> Result<bool, sqlx::Error> {
    let columns = match table_name {
        "events" => sqlx::query_as::<_, MigrationColumn>(
            "SELECT name, type, \"notnull\", dflt_value AS default_value, pk AS primary_key_position FROM pragma_table_info('events') ORDER BY cid",
        )
        .fetch_all(pool)
        .await?,
        "snapshots" => sqlx::query_as::<_, MigrationColumn>(
            "SELECT name, type, \"notnull\", dflt_value AS default_value, pk AS primary_key_position FROM pragma_table_info('snapshots') ORDER BY cid",
        )
        .fetch_all(pool)
        .await?,
        _ => return Ok(false),
    };

    Ok(columns.len() == expected_columns.len()
        && columns
            .iter()
            .zip(expected_columns)
            .all(|(column, expected)| column.matches(expected)))
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;
    use tracing::Level;
    use tracing_test::traced_test;

    use super::*;
    use crate::logs_contain_at;

    async fn event_sorcery_branch_database() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();

        sqlx::raw_sql(EVENT_SORCERY_BRANCH_MIGRATION)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(
            r"CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO _sqlx_migrations \
             (version, description, success, checksum, execution_time) \
             VALUES (?1, 'cqrs event store', TRUE, ?2, 0)",
        )
        .bind(CQRS_EVENT_STORE_MIGRATION_VERSION)
        .bind(event_sorcery_branch_checksum())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO snapshots \
             (aggregate_type, aggregate_id, last_sequence, snapshot_version, payload, timestamp) \
             VALUES ('portfolio', 'staged-portfolio', 3, 1, \
                '{\"name\":\"staged allocation\"}', '2026-08-13T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO events \
             (aggregate_type, aggregate_id, sequence, event_type, event_version, payload, metadata) \
             VALUES ('portfolio', 'staged-portfolio', 1, 'Created', '1', \
                '{\"weight\":\"0.75\"}', '{\"source\":\"operator\"}')",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[traced_test]
    #[tokio::test]
    async fn reconciles_known_event_sorcery_branch_checksum_without_losing_staged_data() {
        let pool = event_sorcery_branch_database().await;

        let outcome = reconcile_known_migration_history(&pool).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        assert_eq!(outcome, MigrationHistoryOutcome::Reconciled);
        let preserved_snapshot: (String, String, i64, i64, String, String) = sqlx::query_as(
            "SELECT aggregate_type, aggregate_id, snapshot_version, last_sequence, payload, \
             timestamp FROM snapshots WHERE aggregate_id = ?1",
        )
        .bind("staged-portfolio")
        .fetch_one(&pool)
        .await
        .unwrap();
        let preserved_event: (String, String, i64, String, String, String, String) =
            sqlx::query_as(
                "SELECT aggregate_type, aggregate_id, sequence, event_type, event_version, \
                 payload, metadata FROM events WHERE aggregate_id = 'staged-portfolio'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            preserved_snapshot,
            (
                "portfolio".to_owned(),
                "staged-portfolio".to_owned(),
                0,
                3,
                "{\"name\":\"staged allocation\"}".to_owned(),
                "2026-08-13T00:00:00Z".to_owned(),
            )
        );
        assert_eq!(
            preserved_event,
            (
                "portfolio".to_owned(),
                "staged-portfolio".to_owned(),
                1,
                "Created".to_owned(),
                "1".to_owned(),
                "{\"weight\":\"0.75\"}".to_owned(),
                "{\"source\":\"operator\"}".to_owned(),
            )
        );
        assert!(logs_contain_at(
            Level::WARN,
            &["known migration history reconciled", "20260208011202"]
        ));
    }

    #[tokio::test]
    async fn leaves_incompatible_known_schema_untouched_for_sqlx_to_reject() {
        let pool = event_sorcery_branch_database().await;
        sqlx::query("ALTER TABLE snapshots ADD COLUMN unexpected TEXT")
            .execute(&pool)
            .await
            .unwrap();

        let outcome = reconcile_known_migration_history(&pool).await.unwrap();
        let migration_result = sqlx::migrate!("./migrations").run(&pool).await;

        assert_eq!(outcome, MigrationHistoryOutcome::Unchanged);
        assert!(matches!(
            migration_result,
            Err(sqlx::migrate::MigrateError::VersionMismatch(
                CQRS_EVENT_STORE_MIGRATION_VERSION
            ))
        ));
    }

    #[tokio::test]
    async fn leaves_known_schema_with_missing_index_untouched_for_sqlx_to_reject() {
        let pool = event_sorcery_branch_database().await;
        sqlx::query("DROP INDEX idx_events_type")
            .execute(&pool)
            .await
            .unwrap();

        let outcome = reconcile_known_migration_history(&pool).await.unwrap();
        let migration_result = sqlx::migrate!("./migrations").run(&pool).await;

        assert_eq!(outcome, MigrationHistoryOutcome::Unchanged);
        assert!(matches!(
            migration_result,
            Err(sqlx::migrate::MigrateError::VersionMismatch(
                CQRS_EVENT_STORE_MIGRATION_VERSION
            ))
        ));
    }

    #[tokio::test]
    async fn leaves_unknown_checksum_untouched_for_sqlx_to_reject() {
        let pool = event_sorcery_branch_database().await;
        sqlx::query("UPDATE _sqlx_migrations SET checksum = x'010203' WHERE version = ?1")
            .bind(CQRS_EVENT_STORE_MIGRATION_VERSION)
            .execute(&pool)
            .await
            .unwrap();

        let outcome = reconcile_known_migration_history(&pool).await.unwrap();
        let migration_result = sqlx::migrate!("./migrations").run(&pool).await;

        assert_eq!(outcome, MigrationHistoryOutcome::Unchanged);
        assert!(matches!(
            migration_result,
            Err(sqlx::migrate::MigrateError::VersionMismatch(
                CQRS_EVENT_STORE_MIGRATION_VERSION
            ))
        ));
    }
}
