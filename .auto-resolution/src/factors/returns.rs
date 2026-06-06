//! Log-return primitive shared by the beta and per-ticker factor calculations.
//!
//! `log_return = ln(close_t / close_{t-1})`, computed per ticker.

use polars::prelude::{
    ChunkApply, DataFrame, Expr, IntoLazy, IntoSeries, NULL, PolarsError, SortMultipleOptions, col,
    lit, when,
};
use tracing::debug;

/// Daily candles needed for a 365-calendar-day log-return window.
pub(super) const LOG_RETURNS_LOOKBACK_CANDLES: usize = 366;

/// A column's values sorted by candle timestamp, for use inside `group_by`
/// aggregations.
///
/// Polars does not document the order of values gathered per group, so any
/// trailing-window selection (`tail`, `last`) must sort explicitly instead of
/// relying on the input frame's row order surviving the grouping.
pub(super) fn chronological(column: &str) -> Expr {
    col(column).sort_by([col("timestamp")], SortMultipleOptions::default())
}

/// Sort by ticker and timestamp, then add a per-ticker `log_return` column.
///
/// Returns the input frame with an added `log_return` column; the first row of
/// each ticker is null (no previous close).
pub(super) fn compute_log_returns(df: &DataFrame) -> Result<DataFrame, PolarsError> {
    let close_prev = col("close").shift(lit(1)).over([col("ticker")]);
    let ratio = col("close") / close_prev;
    let guarded_ratio = when(ratio.clone().gt(lit(0)).and(ratio.clone().is_finite()))
        .then(ratio)
        .otherwise(lit(NULL));

    let mut out = df
        .clone()
        .lazy()
        .sort(["ticker", "timestamp"], SortMultipleOptions::default())
        .with_columns([guarded_ratio.alias("_ratio")])
        .collect()?;

    let ratio_series = out.column("_ratio")?;
    let log_return_series = ratio_series
        .f64()?
        .apply_values(f64::ln)
        .into_series()
        .with_name("log_return".into());
    out.with_column(log_return_series)?;
    out.drop_in_place("_ratio")?;

    debug!(rows = out.height(), "log returns computed");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use proptest::prelude::*;
    use tracing::Level;
    use tracing_test::traced_test;

    proptest! {
        /// `log_return` equals `ln(close_t / close_{t-1})` for any positive close series.
        #[traced_test]
        #[test]
        fn log_returns_are_ln_of_close_ratio(
            closes in prop::collection::vec(1.0_f64..1_000_000.0, 2..30),
        ) {
            let n = closes.len();
            let timestamps: Vec<String> = (0..n).map(|i| format!("{i:04}")).collect();
            let tickers = vec!["BTC"; n];
            let frame = df! {
                "timestamp" => timestamps,
                "ticker" => tickers,
                "close" => closes.clone(),
            }
            .unwrap();

            let out = compute_log_returns(&frame).unwrap();
            let log_return = out.column("log_return").unwrap();

            prop_assert!(log_return.get(0).unwrap().is_null());
            for (idx, pair) in closes.windows(2).enumerate() {
                let expected = (pair[1] / pair[0]).ln();
                let actual = log_return.get(idx + 1).unwrap().try_extract::<f64>().unwrap();
                prop_assert!((actual - expected).abs() < 1e-9);
            }
            prop_assert!(crate::logs_contain_at(Level::DEBUG, &["log returns computed", "rows="]));
        }
    }

    #[traced_test]
    #[test]
    fn compute_log_returns_produces_ln_ratio() {
        let df = df! {
            "timestamp" => &["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z"],
            "ticker" => &["BTC", "BTC", "BTC"],
            "close" => &[100.0, 102.0, 99.0_f64],
        }
        .unwrap();

        let out = compute_log_returns(&df).unwrap();
        let log_return = out.column("log_return").unwrap();
        assert!(
            log_return.get(0).unwrap().is_null(),
            "first row has no previous close"
        );
        let r1 = log_return.get(1).unwrap().try_extract::<f64>().unwrap();
        let r2 = log_return.get(2).unwrap().try_extract::<f64>().unwrap();
        assert!((r1 - (102.0_f64 / 100.0).ln()).abs() < 1e-10);
        assert!((r2 - (99.0_f64 / 102.0).ln()).abs() < 1e-10);
        assert!(crate::logs_contain_at(
            Level::DEBUG,
            &["log returns computed", "rows=3"]
        ));
    }

    #[traced_test]
    #[test]
    fn compute_log_returns_nulls_invalid_ratios() {
        let df = df! {
            "timestamp" => &[
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
                "2024-01-03T00:00:00Z",
                "2024-01-04T00:00:00Z",
                "2024-01-05T00:00:00Z",
                "2024-01-06T00:00:00Z",
            ],
            "ticker" => &["BTC", "BTC", "BTC", "BTC", "BTC", "BTC"],
            "close" => &[100.0, 0.0, 50.0, -25.0, f64::INFINITY, 125.0],
        }
        .unwrap();

        let out = compute_log_returns(&df).unwrap();
        let log_return = out.column("log_return").unwrap();

        assert!(
            log_return.get(0).unwrap().is_null(),
            "first row has no previous close"
        );
        assert!(
            log_return.get(1).unwrap().is_null(),
            "zero ratio is invalid"
        );
        assert!(
            log_return.get(2).unwrap().is_null(),
            "ratio with zero previous close is invalid"
        );
        assert!(
            log_return.get(3).unwrap().is_null(),
            "negative ratio is invalid"
        );
        assert!(
            log_return.get(4).unwrap().is_null(),
            "non-finite ratio is invalid"
        );
        assert!(
            log_return.get(5).unwrap().is_null(),
            "ratio with non-finite previous close is invalid"
        );
        assert!(crate::logs_contain_at(
            Level::DEBUG,
            &["log returns computed", "rows=6"]
        ));
    }
}
