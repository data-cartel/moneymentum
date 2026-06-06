//! Portfolio beta: `Cov(portfolio, benchmark) / Var(benchmark)` over the
//! benchmark-relative log returns of a weighted portfolio.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use chrono::{DateTime, Utc};
use polars::datatypes::AnyValue;
use polars::prelude::{
    DataFrame, DataFrameJoinOps, IntoLazy, JoinArgs, JoinType, NamedFrom, Series, SortOptions, col,
    lit,
};
use tracing::{info, instrument};

use super::ReturnsError;
use super::returns::{LOG_RETURNS_LOOKBACK_CANDLES, compute_log_returns};
use crate::finance::Symbol;
use crate::timeframe::Timeframe;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PortfolioBetaReport {
    pub(crate) beta: Option<f64>,
    pub(crate) excluded_tickers: Vec<Symbol>,
    pub(crate) effective_weights: BTreeMap<Symbol, f64>,
    pub(crate) data_age_hours: i64,
}

#[instrument(skip_all, fields(data_dir = %data_dir.display()))]
pub(crate) async fn compute_portfolio_beta_report(
    data_dir: &Path,
    weights: &[(Symbol, f64)],
    benchmark_ticker: &Symbol,
) -> Result<PortfolioBetaReport, ReturnsError> {
    // Symbol is the domain boundary; the Polars machinery below keys on the raw
    // ticker string, so convert to strings once here at the edge.
    let weights: Vec<(String, f64)> = weights
        .iter()
        .map(|(symbol, weight)| (symbol.as_str().to_owned(), *weight))
        .collect();
    let benchmark_ticker = benchmark_ticker.as_str();
    let path = daily_candles_path(data_dir);
    let df = crate::dataframe::read_csv(path.clone()).await?;
    let Some(df) = df else {
        return Err(ReturnsError::NoData { path });
    };
    let data_age_hours = data_age_hours_at(&df, Utc::now())?;
    let weights_clone = weights.clone();
    let benchmark_ticker_clone = benchmark_ticker.to_string();
    let lookback = LOG_RETURNS_LOOKBACK_CANDLES;
    let log_returns_df = tokio::task::spawn_blocking(move || {
        load_log_returns_last_n_candles(&df, &weights_clone, &benchmark_ticker_clone, lookback)
    })
    .await??;
    compute_beta_report_from_log_returns(
        &log_returns_df,
        &weights,
        benchmark_ticker,
        data_age_hours,
    )
}

/// Portfolio beta from precomputed log returns `DataFrame` (e.g. from `load_log_returns_last_n_candles`).
///
/// Takes long-format log returns (`timestamp`, `ticker`, `log_return`) and weights,
/// and returns beta = Cov(portfolio, benchmark) / Var(benchmark).
pub(super) fn compute_beta_from_log_returns(
    log_returns_df: &DataFrame,
    weights: &[(String, f64)],
    benchmark_ticker: &str,
) -> Result<Option<f64>, ReturnsError> {
    let pair_df = build_portfolio_and_benchmark_df(log_returns_df, weights, benchmark_ticker)?;

    // Filter once to the common non-null set of observations so covariance
    // and variance use the exact same rows.
    let clean_pair_df = pair_df
        .lazy()
        .drop_nulls(None)
        .collect()
        .map_err(ReturnsError::from)?;

    let portfolio_log_returns = clean_pair_df
        .column("portfolio_log_return")?
        .as_materialized_series()
        .clone();
    let benchmark_series = clean_pair_df
        .column("benchmark_log_return")?
        .as_materialized_series()
        .clone();

    let cov = covariance(&portfolio_log_returns, &benchmark_series)?;
    let var_b = variance(&benchmark_series)?;
    let beta = cov / var_b;
    info!(beta = beta, "portfolio beta calculated");
    Ok(Some(beta))
}

/// Path of the daily candles file relative to the data directory.
pub(super) fn daily_candles_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(Timeframe::OneDay.file_name())
}

fn data_age_hours_at(df: &DataFrame, now: DateTime<Utc>) -> Result<i64, ReturnsError> {
    let timestamp_col = df.column("timestamp")?;
    let latest_timestamp = any_value_to_string(timestamp_col.max_reduce()?.as_any_value())
        .ok_or(ReturnsError::NoTimestamps)?;
    let latest_timestamp = DateTime::parse_from_rfc3339(&latest_timestamp)
        .map(|parsed_timestamp| parsed_timestamp.with_timezone(&Utc))
        .map_err(|_| ReturnsError::InvalidTimestamp {
            timestamp: latest_timestamp,
        })?;
    if latest_timestamp > now {
        return Err(ReturnsError::FutureTimestamp {
            timestamp: latest_timestamp.to_rfc3339(),
        });
    }

    Ok(now.signed_duration_since(latest_timestamp).num_hours())
}

fn any_value_to_string(value: AnyValue<'_>) -> Option<String> {
    match value {
        AnyValue::String(timestamp) => Some(timestamp.to_string()),
        AnyValue::StringOwned(timestamp) => Some(timestamp.to_string()),
        _ => None,
    }
}

/// Filters to tickers in `weights` and `benchmark_ticker`, keeps last `lookback` timestamps,
/// computes log returns. Returns `DataFrame` with columns: `timestamp`, `ticker`, `close`, `log_return`.
fn load_log_returns_last_n_candles(
    df: &DataFrame,
    weights: &[(String, f64)],
    benchmark_ticker: &str,
    lookback: usize,
) -> Result<DataFrame, ReturnsError> {
    let benchmark_ticker_df = DataFrame::new(vec![
        Series::new("ticker".into(), vec![benchmark_ticker.to_string()]).into(),
    ])?;
    let benchmark_rows = df.join(
        &benchmark_ticker_df,
        ["ticker"],
        ["ticker"],
        JoinArgs::new(JoinType::Inner),
        None,
    )?;
    let benchmark_timestamp_col = benchmark_rows.column("timestamp")?;
    let benchmark_unique_timestamps = benchmark_timestamp_col
        .unique()?
        .sort(SortOptions::default())?;
    let benchmark_timestamp_series = benchmark_unique_timestamps.as_materialized_series().clone();
    let timestamp_count = benchmark_timestamp_series.len();
    let start = i64::try_from(timestamp_count.saturating_sub(lookback)).unwrap_or(0);
    let last_benchmark_timestamps =
        benchmark_timestamp_series.slice(start, lookback.min(timestamp_count));
    let ts_window_df = DataFrame::new(vec![
        last_benchmark_timestamps
            .with_name("timestamp".into())
            .into(),
    ])?;

    let tickers: Vec<String> = weights
        .iter()
        .map(|(ticker, _)| ticker.clone())
        .chain(std::iter::once(benchmark_ticker.to_string()))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let ticker_df = DataFrame::new(vec![Series::new("ticker".into(), tickers).into()])?;

    let filtered = df.join(
        &ticker_df,
        ["ticker"],
        ["ticker"],
        JoinArgs::new(JoinType::Inner),
        None,
    )?;

    let windowed = filtered.join(
        &ts_window_df,
        ["timestamp"],
        ["timestamp"],
        JoinArgs::new(JoinType::Inner),
        None,
    )?;

    compute_log_returns(&windowed).map_err(ReturnsError::from)
}

/// Builds a `DataFrame` with columns `portfolio_log_return` and `benchmark_log_return`
/// from long-format log returns (timestamp, ticker, `log_return`) and weighted portfolio.
/// Rows are aligned by timestamp; null where any required ticker is missing.
fn build_portfolio_and_benchmark_df(
    log_returns_df: &DataFrame,
    weights: &[(String, f64)],
    benchmark_ticker: &str,
) -> Result<DataFrame, ReturnsError> {
    let ts_col = log_returns_df.column("timestamp")?;
    let ticker_col = log_returns_df.column("ticker")?;
    let log_return_col = log_returns_df.column("log_return")?;

    // Group log returns by timestamp once (O(rows)), instead of scanning the
    // full DataFrame for every timestamp (O(timestamps * rows)). A ticker with
    // no finite return at a timestamp is simply absent from that row's map.
    let mut returns_by_timestamp: BTreeMap<String, HashMap<String, f64>> = BTreeMap::new();

    for row_idx in 0..log_returns_df.height() {
        let Some(timestamp) = ts_col.get(row_idx).ok().and_then(any_value_to_string) else {
            continue;
        };

        let ticker = ticker_col.get(row_idx).ok().and_then(any_value_to_string);
        let Some(ticker) = ticker else {
            continue;
        };

        let log_return = log_return_col
            .get(row_idx)
            .ok()
            .and_then(|value| value.try_extract::<f64>().ok())
            .filter(|log_return| log_return.is_finite());
        let Some(log_return) = log_return else {
            continue;
        };

        let entry = returns_by_timestamp.entry(timestamp).or_default();
        entry.insert(ticker, log_return);
    }

    let mut portfolio = Vec::with_capacity(returns_by_timestamp.len());
    let mut benchmark = Vec::with_capacity(returns_by_timestamp.len());

    for (_timestamp, row_returns) in returns_by_timestamp {
        let mut sum = 0.0_f64;
        let mut any_null = false;

        for (ticker, weight) in weights {
            if let Some(log_return) = row_returns.get(ticker).copied() {
                sum += weight * log_return;
            } else {
                any_null = true;
                break;
            }
        }
        portfolio.push(if any_null { None } else { Some(sum) });

        let bench = row_returns.get(benchmark_ticker).copied();
        benchmark.push(bench);
    }

    let portfolio_series = Series::new("portfolio_log_return".into(), portfolio);
    let benchmark_series = Series::new("benchmark_log_return".into(), benchmark);
    DataFrame::new(vec![portfolio_series.into(), benchmark_series.into()])
        .map_err(ReturnsError::from)
}

fn compute_beta_report_from_log_returns(
    log_returns_df: &DataFrame,
    weights: &[(String, f64)],
    benchmark_ticker: &str,
    data_age_hours: i64,
) -> Result<PortfolioBetaReport, ReturnsError> {
    let return_timestamps = finite_return_timestamps_by_ticker(log_returns_df)?;
    let benchmark_return_timestamps = return_timestamps
        .get(benchmark_ticker)
        .ok_or(ReturnsError::BetaUndefined)?;
    if benchmark_return_timestamps.is_empty() {
        return Err(ReturnsError::BetaUndefined);
    }

    let (included_weights, excluded_tickers): (Vec<_>, Vec<_>) =
        weights.iter().cloned().partition(|(ticker, _weight)| {
            return_timestamps
                .get(ticker)
                .is_some_and(|ticker_return_timestamps| {
                    ticker_return_timestamps == benchmark_return_timestamps
                })
        });

    let effective_weights = match renormalize_abs_weights(&included_weights) {
        Ok(effective_weights) => effective_weights,
        Err(ReturnsError::BetaUndefined) => {
            return Ok(PortfolioBetaReport {
                beta: None,
                excluded_tickers: excluded_tickers
                    .into_iter()
                    .map(|(ticker, _weight)| Symbol::from_raw(&ticker))
                    .collect(),
                effective_weights: BTreeMap::new(),
                data_age_hours,
            });
        }
        Err(err) => return Err(err),
    };
    let beta_weights = effective_weights
        .iter()
        .map(|(ticker, weight)| (ticker.clone(), *weight))
        .collect::<Vec<_>>();
    let beta = compute_beta_from_log_returns(log_returns_df, &beta_weights, benchmark_ticker)?;

    Ok(PortfolioBetaReport {
        beta,
        excluded_tickers: excluded_tickers
            .into_iter()
            .map(|(ticker, _weight)| Symbol::from_raw(&ticker))
            .collect(),
        effective_weights: effective_weights
            .into_iter()
            .map(|(ticker, weight)| (Symbol::from_raw(&ticker), weight))
            .collect(),
        data_age_hours,
    })
}

fn finite_return_timestamps_by_ticker(
    log_returns_df: &DataFrame,
) -> Result<HashMap<String, BTreeSet<String>>, ReturnsError> {
    let timestamp_col = log_returns_df.column("timestamp")?;
    let ticker_col = log_returns_df.column("ticker")?;
    let log_return_col = log_returns_df.column("log_return")?;
    let mut return_timestamps = HashMap::new();

    for row_index in 0..log_returns_df.height() {
        let timestamp = timestamp_col
            .get(row_index)
            .ok()
            .and_then(any_value_to_string);
        let Some(timestamp) = timestamp else {
            continue;
        };

        let ticker = ticker_col.get(row_index).ok().and_then(any_value_to_string);
        let Some(ticker) = ticker else {
            continue;
        };
        let has_return = log_return_col
            .get(row_index)
            .ok()
            .and_then(|value| value.try_extract::<f64>().ok())
            .is_some_and(f64::is_finite);
        if has_return {
            return_timestamps
                .entry(ticker)
                .or_insert_with(BTreeSet::new)
                .insert(timestamp);
        }
    }

    Ok(return_timestamps)
}

fn renormalize_abs_weights(
    weights: &[(String, f64)],
) -> Result<BTreeMap<String, f64>, ReturnsError> {
    let absolute_weight_sum = weights
        .iter()
        .map(|(_ticker, weight)| weight.abs())
        .sum::<f64>();
    if absolute_weight_sum <= 0.0 {
        return Err(ReturnsError::BetaUndefined);
    }

    Ok(weights
        .iter()
        .map(|(ticker, weight)| (ticker.clone(), weight / absolute_weight_sum))
        .collect())
}

/// Covariance of two return series. `Cov(P, B) = E[(P - mean_P)(B - mean_B)]`.
fn covariance(portfolio: &Series, benchmark: &Series) -> Result<f64, ReturnsError> {
    let df = DataFrame::new(vec![portfolio.clone().into(), benchmark.clone().into()])
        .map_err(ReturnsError::from)?;
    let out = df
        .lazy()
        .select([
            ((col("portfolio_log_return") - col("portfolio_log_return").mean())
                * (col("benchmark_log_return") - col("benchmark_log_return").mean()))
            .mean()
            .alias("_cov"),
        ])
        .collect()?;
    out.column("_cov")?
        .get(0)
        .ok()
        .and_then(|value| value.try_extract::<f64>().ok())
        .ok_or(ReturnsError::BetaUndefined)
}

/// Variance of a return series. `Var(B) = E[(B - mean_B)^2]`.
fn variance(benchmark: &Series) -> Result<f64, ReturnsError> {
    let df = DataFrame::new(vec![benchmark.clone().into()]).map_err(ReturnsError::from)?;
    let out = df
        .lazy()
        .select([
            (col("benchmark_log_return") - col("benchmark_log_return").mean())
                .pow(lit(2))
                .mean()
                .alias("_var"),
        ])
        .collect()?;
    let variance = out
        .column("_var")?
        .get(0)
        .ok()
        .and_then(|value| value.try_extract::<f64>().ok())
        .ok_or(ReturnsError::BetaUndefined)?;
    if variance.abs() < 1e-20 {
        return Err(ReturnsError::BetaUndefined);
    }
    Ok(variance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use proptest::prelude::*;
    use std::fs;
    use tempfile::TempDir;
    use tracing_test::traced_test;

    proptest! {
        /// For a single-ticker portfolio measured against that same ticker,
        /// `beta = Cov(w*r, r) / Var(r) = w` whenever `Var(r) > 0`.
        #[traced_test]
        #[test]
        fn single_ticker_beta_equals_weight(
            returns in prop::collection::vec(-0.5_f64..0.5, 3..40),
            weight in -5.0_f64..5.0,
        ) {
            prop_assume!(returns.windows(2).any(|pair| (pair[0] - pair[1]).abs() > 1e-6));
            let n = returns.len();
            let timestamps: Vec<String> = (0..n).map(|i| format!("{i:04}")).collect();
            let tickers = vec!["BTC"; n];
            let frame = df! {
                "timestamp" => timestamps,
                "ticker" => tickers,
                "log_return" => returns,
            }
            .unwrap();

            let weights = [("BTC".to_string(), weight)];
            let beta = compute_beta_from_log_returns(&frame, &weights, "BTC")
                .unwrap()
                .unwrap();
            prop_assert!((beta - weight).abs() < 1e-9, "beta {beta} != weight {weight}");
            prop_assert!(crate::logs_contain_at(
                tracing::Level::INFO,
                &["portfolio beta calculated", "beta="]
            ));
        }
    }

    #[test]
    fn daily_candles_path_uses_ohlcv_1d() {
        let dir = TempDir::new().unwrap();
        let path = daily_candles_path(dir.path());
        assert!(path.ends_with("ohlcv_1d.csv"));
    }

    #[tokio::test]
    async fn compute_portfolio_beta_errors_when_daily_candles_file_missing() {
        let dir = TempDir::new().unwrap();
        let result = compute_portfolio_beta_report(dir.path(), &[], &Symbol::from_raw("BTC")).await;
        assert!(matches!(result, Err(ReturnsError::NoData { .. })));
    }

    #[test]
    fn data_age_hours_uses_most_recent_candle_timestamp() {
        let df = df! {
            "timestamp" => &["2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z"],
            "ticker" => &["BTC", "ETH"],
            "close" => &[100.0, 200.0],
        }
        .unwrap();
        let now = DateTime::parse_from_rfc3339("2024-01-03T12:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);

        let age_hours = data_age_hours_at(&df, now).unwrap();

        assert_eq!(age_hours, 36);
    }

    #[test]
    fn data_age_hours_rejects_future_candle_timestamp() {
        let df = df! {
            "timestamp" => &["2024-01-04T00:00:00.000Z"],
            "ticker" => &["BTC"],
            "close" => &[100.0],
        }
        .unwrap();
        let now = DateTime::parse_from_rfc3339("2024-01-03T12:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);

        let age_hours = data_age_hours_at(&df, now);

        assert!(matches!(
            age_hours,
            Err(ReturnsError::FutureTimestamp { .. })
        ));
    }

    #[traced_test]
    #[test]
    fn compute_beta_from_log_returns_portfolio_vs_self_benchmark_is_one() {
        let log_returns_df = df! {
            "timestamp" => &["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z"],
            "ticker" => &["BTC", "BTC", "BTC"],
            "log_return" => &[0.01_f64, -0.02, 0.015],
        }
        .unwrap();
        let weights = [("BTC".to_string(), 1.0)];
        let result = compute_beta_from_log_returns(&log_returns_df, &weights, "BTC").unwrap();
        let beta = result.expect("beta defined");
        assert!(
            (beta - 1.0).abs() < 1e-10,
            "beta of portfolio vs self should be 1, got {beta}"
        );
        assert!(crate::logs_contain_at(
            tracing::Level::INFO,
            &["portfolio beta calculated"]
        ));
    }

    #[test]
    fn compute_beta_from_log_returns_errors_when_benchmark_variance_zero() {
        let log_returns_df = df! {
            "timestamp" => &["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"],
            "ticker" => &["BTC", "BTC"],
            "log_return" => &[0.0_f64, 0.0],
        }
        .unwrap();
        let weights = [("BTC".to_string(), 1.0)];
        let result = compute_beta_from_log_returns(&log_returns_df, &weights, "BTC");
        assert!(matches!(result, Err(ReturnsError::BetaUndefined)));
    }

    #[traced_test]
    #[test]
    fn load_log_returns_window_uses_benchmark_timestamps() {
        let candles = df! {
            "timestamp" => &[
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-04T00:00:00Z", "2024-01-05T00:00:00Z",
            ],
            "ticker" => &["BTC", "BTC", "BTC", "ETH", "ETH", "ETH", "ETH", "ETH"],
            "close" => &[100.0_f64, 101.0, 102.0, 50.0, 51.0, 52.0, 53.0, 54.0],
        }
        .unwrap();
        let weights = [("ETH".to_string(), 1.0_f64)];

        let log_returns = load_log_returns_last_n_candles(&candles, &weights, "BTC", 3).unwrap();
        let timestamp_col = log_returns.column("timestamp").unwrap();
        let ticker_col = log_returns.column("ticker").unwrap();

        let expected_timestamps = vec![
            "2024-01-01T00:00:00Z".to_string(),
            "2024-01-02T00:00:00Z".to_string(),
            "2024-01-03T00:00:00Z".to_string(),
        ];
        let timestamps_for_ticker = |target_ticker: &str| {
            (0..log_returns.height())
                .filter_map(|row_index| {
                    let ticker = ticker_col
                        .get(row_index)
                        .ok()
                        .and_then(any_value_to_string)?;
                    if ticker != target_ticker {
                        return None;
                    }

                    timestamp_col
                        .get(row_index)
                        .ok()
                        .and_then(any_value_to_string)
                })
                .collect::<Vec<_>>()
        };
        let benchmark_timestamps = timestamps_for_ticker("BTC");
        let portfolio_timestamps = timestamps_for_ticker("ETH");

        assert_eq!(benchmark_timestamps, expected_timestamps);
        assert_eq!(portfolio_timestamps, expected_timestamps);
        assert!(crate::logs_contain_at(
            tracing::Level::DEBUG,
            &["log returns computed", "rows=6"]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_report_excludes_missing_assets_and_renormalizes_remaining_weights() {
        let log_returns_df = df! {
            "timestamp" => &[
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-02T00:00:00Z",
            ],
            "ticker" => &["BTC", "BTC", "BTC", "ETH", "ETH", "ETH", "DOGE"],
            "log_return" => &[0.01_f64, -0.02, 0.015, 0.01, -0.02, 0.015, 0.04],
        }
        .unwrap();
        let weights = [("ETH".to_string(), 0.4_f64), ("DOGE".to_string(), -0.6_f64)];

        let report = compute_beta_report_from_log_returns(&log_returns_df, &weights, "BTC", 12)
            .expect("beta report");

        assert_eq!(report.excluded_tickers, vec![Symbol::from_raw("DOGE")]);
        assert_eq!(
            report.effective_weights.get(&Symbol::from_raw("ETH")),
            Some(&1.0)
        );
        assert_eq!(report.data_age_hours, 12);
        assert!((report.beta.expect("beta") - 1.0).abs() < 1e-10);
        assert!(crate::logs_contain_at(
            tracing::Level::INFO,
            &["portfolio beta calculated"]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_report_returns_none_when_all_portfolio_assets_are_excluded() {
        let log_returns_df = df! {
            "timestamp" => &[
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-02T00:00:00Z",
            ],
            "ticker" => &["BTC", "BTC", "BTC", "DOGE"],
            "log_return" => &[0.01_f64, -0.02, 0.015, 0.04],
        }
        .unwrap();
        let weights = [("DOGE".to_string(), -1.0_f64)];

        let report = compute_beta_report_from_log_returns(&log_returns_df, &weights, "BTC", 2)
            .expect("beta report");

        assert_eq!(report.beta, None);
        assert_eq!(report.excluded_tickers, vec![Symbol::from_raw("DOGE")]);
        assert!(report.effective_weights.is_empty());
        assert_eq!(report.data_age_hours, 2);

        // The log buffer is process-global, so other tests legitimately logging
        // "portfolio beta calculated" would trip a bare negative assertion.
        // Scope it to this test's own span (traced_test prefixes every line
        // emitted here with the test name).
        assert!(!crate::logs_contain_at(
            tracing::Level::INFO,
            &[
                "beta_report_returns_none_when_all_portfolio_assets_are_excluded",
                "portfolio beta calculated",
            ]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_report_excludes_assets_with_same_return_count_but_different_timestamps() {
        let log_returns_df = df! {
            "timestamp" => &[
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z",
                "2024-01-02T00:00:00Z", "2024-01-03T00:00:00Z", "2024-01-04T00:00:00Z",
            ],
            "ticker" => &["BTC", "BTC", "BTC", "ETH", "ETH", "ETH", "DOGE", "DOGE", "DOGE"],
            "log_return" => &[0.01_f64, -0.02, 0.015, 0.01, -0.02, 0.015, 0.02, -0.01, 0.03],
        }
        .unwrap();
        let weights = [("ETH".to_string(), 0.4_f64), ("DOGE".to_string(), -0.6_f64)];

        let report = compute_beta_report_from_log_returns(&log_returns_df, &weights, "BTC", 12)
            .expect("beta report");

        assert_eq!(report.excluded_tickers, vec![Symbol::from_raw("DOGE")]);
        assert_eq!(
            report.effective_weights.get(&Symbol::from_raw("ETH")),
            Some(&1.0)
        );
        assert_eq!(report.data_age_hours, 12);
        assert!((report.beta.expect("beta") - 1.0).abs() < 1e-10);
        assert!(crate::logs_contain_at(
            tracing::Level::INFO,
            &["portfolio beta calculated"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn compute_portfolio_beta_matches_manual_beta_for_ohlcv_1d_data() {
        let tmp_dir = TempDir::new().unwrap();
        let src = Path::new("fixtures/ohlcv_1d_beta.csv");
        let dst = tmp_dir.path().join("ohlcv_1d.csv");
        fs::copy(src, &dst).unwrap();

        // 60% long BTC, 40% short ETH, benchmark BTC
        let weights = [
            (Symbol::from_raw("BTC"), 0.6_f64),
            (Symbol::from_raw("ETH"), -0.4_f64),
        ];

        let report =
            compute_portfolio_beta_report(tmp_dir.path(), &weights, &Symbol::from_raw("BTC"))
                .await
                .unwrap()
                .beta;
        let beta = report.expect("beta defined");

        assert!(
            (beta - 0.592_091_722_3_f64).abs() < 1e-10,
            "beta mismatch: got {beta}"
        );
        assert!(crate::logs_contain_at(
            tracing::Level::INFO,
            &["portfolio beta calculated"]
        ));
    }
}
