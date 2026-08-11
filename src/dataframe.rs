//! Generic async `DataFrame` persistence with Polars.
//!
//! Polars operations are synchronous and CPU-bound. This module wraps them in
//! `spawn_blocking` to avoid blocking the async runtime. All functions take
//! ownership of data to safely move it across thread boundaries.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use polars::prelude::{
    CsvReader, CsvWriter, DataFrame, IntoLazy, PlSmallStr, PolarsError, Selector, SerReader,
    SerWriter, SortMultipleOptions, UniqueKeepStrategy, col,
};
use thiserror::Error;
use tracing::{debug, instrument};

#[derive(Debug, Error)]
pub(crate) enum DataFrameError {
    #[error(transparent)]
    Polars(#[from] PolarsError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Join(#[from] tokio::task::JoinError),
}

#[instrument(skip_all, fields(path = %path.display()))]
pub(crate) async fn read_csv(path: PathBuf) -> Result<Option<DataFrame>, DataFrameError> {
    tokio::task::spawn_blocking(move || {
        if !path.exists() {
            debug!(path = %path.display(), "no existing data");
            return Ok(None);
        }

        let file = std::fs::File::open(&path)?;
        let dataframe = CsvReader::new(file).finish()?;
        debug!(rows = dataframe.height(), "loaded csv");
        Ok(Some(dataframe))
    })
    .await?
}

#[instrument(skip_all, fields(path = %path.display()))]
pub(crate) async fn write_csv(path: PathBuf, mut df: DataFrame) -> Result<(), DataFrameError> {
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Write to a unique sibling temp file and rename so readers racing this
        // write (request-time factor/beta computations) never observe a
        // truncated or half-written file, and overlapping writers to the same
        // target never share a temp file; same-directory rename is atomic on
        // POSIX.
        let tmp_path = unique_sibling_tmp_path(&path);
        let file = std::fs::File::create(&tmp_path)?;
        let written = CsvWriter::new(file)
            .finish(&mut df)
            .map_err(DataFrameError::from)
            .and_then(|()| std::fs::rename(&tmp_path, &path).map_err(DataFrameError::from));
        if let Err(write_error) = written {
            // Best-effort cleanup: failed writes must not leak uniquely named
            // temp files into the data directory forever.
            let _ = std::fs::remove_file(&tmp_path);
            return Err(write_error);
        }
        debug!(rows = df.height(), "wrote csv");
        Ok(())
    })
    .await?
}

/// Merges `DataFrames` and deduplicates by (timestamp, symbol).
///
/// Keeps the last occurrence when duplicates exist, then sorts by timestamp
/// and symbol ascending. This enables incremental ingestion: new data with
/// the same key overwrites old data.
pub(crate) async fn merge_and_deduplicate(
    existing: Option<DataFrame>,
    new: DataFrame,
) -> Result<DataFrame, DataFrameError> {
    tokio::task::spawn_blocking(move || {
        let existing_rows = existing.as_ref().map_or(0, DataFrame::height);
        let new_rows = new.height();
        debug!(existing_rows, new_rows, "combining dataframes");

        let combined = match existing {
            Some(existing) => existing.vstack(&new)?,
            None => new,
        };

        debug!(combined_rows = combined.height(), "deduplicating");

        let deduped = combined
            .lazy()
            .unique(
                Some(Selector::ByName {
                    names: [
                        PlSmallStr::from_static("timestamp"),
                        PlSmallStr::from_static("symbol"),
                    ]
                    .into(),
                    strict: true,
                }),
                UniqueKeepStrategy::Last,
            )
            .sort_by_exprs(
                [col("timestamp"), col("symbol")],
                SortMultipleOptions::default(),
            )
            .collect()?;

        debug!(final_rows = deduped.height(), "merge complete");

        Ok(deduped)
    })
    .await?
}

/// A temp path unique to this write, next to the target so the final rename
/// stays within one filesystem (a cross-device rename is not atomic).
///
/// Uniqueness comes from the process id plus a process-wide counter, so
/// overlapping writers to the same target never truncate each other's temp
/// file.
fn unique_sibling_tmp_path(path: &std::path::Path) -> PathBuf {
    static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

    let write_id = WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let process_id = std::process::id();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.{process_id}.{write_id}.tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use proptest::prelude::*;
    use tempfile::TempDir;
    use tracing::Level;
    use tracing_test::traced_test;

    use crate::logs_contain_at;

    fn create_test_df(timestamps: &[i64], symbols: &[&str], closes: &[f64]) -> DataFrame {
        df! {
            "timestamp" => timestamps,
            "symbol" => symbols,
            "close" => closes,
        }
        .unwrap()
    }

    #[traced_test]
    #[tokio::test]
    async fn read_csv_nonexistent_returns_none_and_logs_path() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("nonexistent.csv");

        let loaded = read_csv(path).await.unwrap();

        assert!(loaded.is_none());
        // Log must include the filename so operators know what's missing
        assert!(logs_contain_at(
            Level::DEBUG,
            &["no existing data", "nonexistent.csv"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn csv_roundtrip_preserves_data() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.csv");

        let original = create_test_df(
            &[1_704_067_200_000_i64, 1_704_070_800_000],
            &["BTC", "ETH"],
            &[100.0, 2000.0],
        );

        let original_height = original.height();
        let original_width = original.width();

        write_csv(path.clone(), original).await.unwrap();
        let loaded = read_csv(path.clone()).await.unwrap().unwrap();

        assert_eq!(loaded.height(), original_height);
        assert_eq!(loaded.width(), original_width);
        assert!(logs_contain_at(Level::DEBUG, &["wrote csv"]));
        assert!(logs_contain_at(Level::DEBUG, &["loaded csv"]));

        // The atomic write publishes via temp-file-plus-rename: after a
        // successful write only the target may remain, or a dropped rename
        // would silently serve stale data to racing readers.
        let leftover_files: Vec<String> = std::fs::read_dir(temp_dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name != "test.csv")
            .collect();
        assert!(
            leftover_files.is_empty(),
            "write must clean up its temp file, found {leftover_files:?}"
        );

        // Overwriting an existing file goes through the same rename and must
        // replace the contents, not append or leave the old data.
        let replacement = create_test_df(&[1_704_074_400_000_i64], &["SOL"], &[150.0]);
        write_csv(path.clone(), replacement).await.unwrap();
        let reloaded = read_csv(path).await.unwrap().unwrap();
        assert_eq!(reloaded.height(), 1, "overwrite must replace the contents");
    }

    #[tokio::test]
    async fn merge_keeps_latest_for_duplicate_timestamp_symbol() {
        let existing = create_test_df(
            &[1_704_067_200_000, 1_704_070_800_000],
            &["BTC", "BTC"],
            &[100.0, 105.0],
        );

        let new = create_test_df(
            &[1_704_070_800_000, 1_704_074_400_000],
            &["BTC", "BTC"],
            &[106.0, 110.0],
        );

        let merged = merge_and_deduplicate(Some(existing), new).await.unwrap();

        assert_eq!(merged.height(), 3);
    }

    #[tokio::test]
    async fn merge_handles_none_existing() {
        let new = create_test_df(&[1_704_067_200_000], &["BTC"], &[100.0]);

        let merged = merge_and_deduplicate(None, new).await.unwrap();

        assert_eq!(merged.height(), 1);
    }

    #[tokio::test]
    async fn merge_with_multiple_symbols_deduplicates_per_symbol() {
        let existing = df! {
            "timestamp" => &[1_722_553_200_000_i64, 1_722_553_200_000, 1_722_556_800_000],
            "symbol" => &["BTC", "FRIEND", "BTC"],
            "close" => &[65215.0, 8.7362, 65402.0],
        }
        .unwrap();

        let new = df! {
            "timestamp" => &[1_722_553_200_000_i64, 1_722_553_200_000],
            "symbol" => &["BTC", "FRIEND"],
            "close" => &[65220.0, 8.8],
        }
        .unwrap();

        let merged = merge_and_deduplicate(Some(existing), new).await.unwrap();

        assert_eq!(merged.height(), 3);

        let timestamps: Vec<i64> = merged
            .column("timestamp")
            .unwrap()
            .i64()
            .unwrap()
            .into_no_null_iter()
            .collect();

        assert_eq!(
            timestamps,
            vec![1_722_553_200_000, 1_722_553_200_000, 1_722_556_800_000]
        );
    }

    #[tokio::test]
    async fn merge_sorts_by_timestamp_then_symbol() {
        let existing = df! {
            "timestamp" => &[1_704_074_400_000_i64, 1_704_067_200_000],
            "symbol" => &["ETH", "BTC"],
            "close" => &[2000.0, 42000.0],
        }
        .unwrap();

        let new = df! {
            "timestamp" => &[1_704_070_800_000_i64],
            "symbol" => &["BTC"],
            "close" => &[42500.0],
        }
        .unwrap();

        let merged = merge_and_deduplicate(Some(existing), new).await.unwrap();

        let timestamps: Vec<i64> = merged
            .column("timestamp")
            .unwrap()
            .i64()
            .unwrap()
            .into_no_null_iter()
            .collect();

        assert_eq!(
            timestamps,
            vec![1_704_067_200_000, 1_704_070_800_000, 1_704_074_400_000]
        );
    }

    proptest! {
        #[test]
        fn deduplication_is_idempotent(
            ts1 in 1_600_000_000_000_i64..1_800_000_000_000,
            ts2 in 1_600_000_000_000_i64..1_800_000_000_000,
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let df = df! {
                    "timestamp" => &[ts1, ts2, ts1],
                    "symbol" => &["BTC", "BTC", "BTC"],
                    "close" => &[100.0, 200.0, 150.0],
                }.unwrap();

                let once = merge_and_deduplicate(None, df).await.unwrap();
                let twice = merge_and_deduplicate(None, once.clone()).await.unwrap();

                prop_assert_eq!(once.height(), twice.height());
                Ok(())
            })?;
        }

        #[test]
        fn deduplication_never_increases_rows(
            ts1 in 1_600_000_000_000_i64..1_800_000_000_000,
            ts2 in 1_600_000_000_000_i64..1_800_000_000_000,
            ts3 in 1_600_000_000_000_i64..1_800_000_000_000,
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let existing = df! {
                    "timestamp" => &[ts1, ts2],
                    "symbol" => &["BTC", "ETH"],
                    "close" => &[100.0, 200.0],
                }.unwrap();

                let new = df! {
                    "timestamp" => &[ts2, ts3],
                    "symbol" => &["ETH", "BTC"],
                    "close" => &[250.0, 300.0],
                }.unwrap();

                let merged = merge_and_deduplicate(Some(existing.clone()), new.clone()).await.unwrap();

                prop_assert!(merged.height() <= existing.height() + new.height());
                Ok(())
            })?;
        }
    }
}
