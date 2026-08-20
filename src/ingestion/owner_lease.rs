//! Exclusive owner lease for the ingestion worker.
//!
//! The HTTP server and the `moneymentum-ingest` CLI both write through the same
//! schedule slots. Recovering every `Running` stream on startup is only safe
//! when the previous owner is dead; otherwise a live worker keeps fetching
//! after its slot is released and a second writer starts. This sidecar SQLite
//! lock is held for the process lifetime and released by the OS on crash, so a
//! successful acquire proves the previous owner is stale.

use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use thiserror::Error;
use tracing::debug;

/// Held exclusive ownership of the ingestion writer for this database.
///
/// Dropping the lease (or the process dying) releases the sidecar lock so a
/// later owner can recover abandoned runs.
pub(crate) struct IngestionOwnerLease {
    connection: SqliteConnection,
}

/// Why acquiring the ingestion owner lease fails.
#[derive(Debug, Error)]
pub enum OwnerLeaseError {
    #[error("another moneymentum process holds the ingestion owner lease")]
    HeldByLiveOwner,
    #[error("ingestion owner lease requires a sqlite database_url")]
    UnsupportedDatabaseUrl,
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl IngestionOwnerLease {
    /// Acquires exclusive ingestion ownership for `database_url`.
    ///
    /// Returns [`OwnerLeaseError::HeldByLiveOwner`] when another process still
    /// holds the lock, so the caller must not abandon that owner's runs.
    pub(crate) async fn try_acquire(database_url: &str) -> Result<Self, OwnerLeaseError> {
        let lock_url = sidecar_lock_url(database_url)?;
        let options = SqliteConnectOptions::from_str(&lock_url)?
            .create_if_missing(true)
            .busy_timeout(Duration::ZERO);
        let mut connection = SqliteConnection::connect_with(&options).await?;
        sqlx::query("PRAGMA locking_mode = EXCLUSIVE")
            .execute(&mut connection)
            .await?;

        match sqlx::query("BEGIN EXCLUSIVE")
            .execute(&mut connection)
            .await
        {
            Ok(_) => {
                debug!("ingestion owner lease acquired");
                Ok(Self { connection })
            }
            Err(error) if is_lock_held(&error) => Err(OwnerLeaseError::HeldByLiveOwner),
            Err(error) => Err(OwnerLeaseError::Sqlx(error)),
        }
    }

    /// Ends the exclusive transaction and closes the sidecar connection.
    ///
    /// Prefer this over relying on [`Drop`]: sqlx closes SQLite on a worker
    /// thread, so a bare drop can leave the lock held briefly and race a
    /// following [`Self::try_acquire`].
    pub(crate) async fn release(self) -> Result<(), OwnerLeaseError> {
        let mut connection = self.connection;
        // Best-effort end of BEGIN EXCLUSIVE before close.
        let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
        connection.close().await?;
        debug!("ingestion owner lease released");
        Ok(())
    }
}

fn sidecar_lock_url(database_url: &str) -> Result<String, OwnerLeaseError> {
    let without_scheme = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))
        .ok_or(OwnerLeaseError::UnsupportedDatabaseUrl)?;
    let (path, query) = match without_scheme.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (without_scheme, None),
    };
    if path.is_empty() || path.eq_ignore_ascii_case(":memory:") {
        return Err(OwnerLeaseError::UnsupportedDatabaseUrl);
    }
    let lock_path = format!("{path}.ingestion-owner");
    Ok(query.map_or_else(
        || format!("sqlite://{lock_path}"),
        |query| format!("sqlite://{lock_path}?{query}"),
    ))
}

fn is_lock_held(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .is_some_and(|code| code == "5" || code == "6")
}

#[cfg(test)]
mod tests {
    use tracing::Level;
    use tracing_test::traced_test;

    use super::{IngestionOwnerLease, OwnerLeaseError, sidecar_lock_url};
    use crate::logs_contain_at;

    #[test]
    fn sidecar_lock_url_appends_owner_suffix_and_keeps_query() {
        let url = sidecar_lock_url("sqlite:///tmp/moneymentum.db?mode=rwc").unwrap();

        assert_eq!(url, "sqlite:///tmp/moneymentum.db.ingestion-owner?mode=rwc");
    }

    #[test]
    fn sidecar_lock_url_rejects_in_memory_databases() {
        let error = sidecar_lock_url("sqlite::memory:").unwrap_err();

        assert!(matches!(error, OwnerLeaseError::UnsupportedDatabaseUrl));
    }

    #[traced_test]
    #[tokio::test]
    async fn second_acquire_fails_while_the_owner_is_live() {
        let data_dir = tempfile::TempDir::new().unwrap();
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("moneymentum.db").display()
        );

        let lease = IngestionOwnerLease::try_acquire(&database_url)
            .await
            .unwrap();
        let contended = IngestionOwnerLease::try_acquire(&database_url).await;

        assert!(matches!(contended, Err(OwnerLeaseError::HeldByLiveOwner)));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion owner lease acquired"]
        ));
        lease.release().await.unwrap();
    }

    #[traced_test]
    #[tokio::test]
    async fn dropping_the_lease_allows_a_later_owner_to_acquire() {
        let data_dir = tempfile::TempDir::new().unwrap();
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("moneymentum.db").display()
        );

        let lease = IngestionOwnerLease::try_acquire(&database_url)
            .await
            .unwrap();
        lease.release().await.unwrap();

        IngestionOwnerLease::try_acquire(&database_url)
            .await
            .unwrap();
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion owner lease released"]
        ));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["ingestion owner lease acquired"]
        ));
    }
}
