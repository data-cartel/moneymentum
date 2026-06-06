//! Per-asset beta to a benchmark: how strongly each asset's returns move with
//! the benchmark's. This is a per-ticker screener factor, distinct from the
//! portfolio beta in [`super::beta`].

use polars::prelude::{
    DataFrame, Expr, IntoLazy, JoinArgs, JoinType, NULL, PolarsError, SortMultipleOptions, col,
    lit, when,
};

use super::returns::chronological;

/// Per-ticker beta to `benchmark_ticker` over the last `lookback` paired returns:
/// `Cov(asset, benchmark) / Var(benchmark)` (population moments).
///
/// Returns a `DataFrame` with columns `ticker` and `beta`. Beta is null when the
/// benchmark has no return variance in the window. The benchmark's beta to
/// itself is 1.
pub(super) fn asset_beta_by_ticker(
    with_returns: &DataFrame,
    benchmark_ticker: &str,
    lookback: usize,
) -> Result<DataFrame, PolarsError> {
    let benchmark = with_returns
        .clone()
        .lazy()
        .filter(col("ticker").eq(lit(benchmark_ticker)))
        .select([
            col("timestamp"),
            col("log_return").alias("benchmark_return"),
        ]);

    with_returns
        .clone()
        .lazy()
        // Pair each asset return with the benchmark's return at the same time;
        // covariance and variance are then measured over the same observations.
        // Inner join by intent: an asset row without a benchmark row at that
        // timestamp cannot form a pair and must not survive.
        .join(
            benchmark,
            [col("timestamp")],
            [col("timestamp")],
            JoinArgs::new(JoinType::Inner),
        )
        // Drop incomplete pairs where either side's return is null (e.g. each
        // ticker's first candle has no previous close).
        .filter(
            col("log_return")
                .is_not_null()
                .and(col("benchmark_return").is_not_null()),
        )
        .group_by([col("ticker")])
        .agg([
            {
                let asset = chronological("log_return").tail(Some(lookback));
                let asset_dev = asset.clone() - asset.mean();
                (asset_dev * benchmark_deviation(lookback))
                    .sum()
                    .alias("beta_cov_sum")
            },
            (benchmark_deviation(lookback) * benchmark_deviation(lookback))
                .sum()
                .alias("beta_var_sum"),
        ])
        .with_column(
            when(col("beta_var_sum").gt(lit(0.0)))
                .then(col("beta_cov_sum") / col("beta_var_sum"))
                .otherwise(lit(NULL))
                .alias("beta"),
        )
        .select([col("ticker"), col("beta")])
        .sort(["ticker"], SortMultipleOptions::default())
        .collect()
}

/// Deviation of the benchmark's trailing returns from their window mean, the
/// term shared by the covariance and variance aggregations above.
fn benchmark_deviation(lookback: usize) -> Expr {
    let benchmark_returns = chronological("benchmark_return").tail(Some(lookback));
    benchmark_returns.clone() - benchmark_returns.mean()
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use proptest::prelude::*;

    fn returns_frame(btc: &[f64], eth: &[f64]) -> DataFrame {
        let count = btc.len();
        let timestamps: Vec<String> = (0..count)
            .chain(0..count)
            .map(|index| format!("{index:04}"))
            .collect();

        let tickers: Vec<&str> = std::iter::repeat_n("BTC", count)
            .chain(std::iter::repeat_n("ETH", count))
            .collect();

        let log_returns: Vec<f64> = btc.iter().chain(eth.iter()).copied().collect();
        df! {
            "timestamp" => timestamps,
            "ticker" => tickers,
            "log_return" => log_returns,
        }
        .unwrap()
    }

    #[test]
    fn beta_to_self_is_one_and_doubled_returns_give_two() {
        let btc = [0.01, -0.02, 0.03, -0.01, 0.02];
        let eth: Vec<f64> = btc.iter().map(|value| value * 2.0).collect();
        let with_returns = returns_frame(&btc, &eth);

        let out = asset_beta_by_ticker(&with_returns, "BTC", 100).unwrap();
        let tickers = out.column("ticker").unwrap().str().unwrap();
        let beta = out.column("beta").unwrap().f64().unwrap();

        assert_eq!(tickers.get(0), Some("BTC"));
        assert!(
            (beta.get(0).unwrap() - 1.0).abs() < 1e-12,
            "the benchmark's beta to itself must be 1"
        );

        assert_eq!(tickers.get(1), Some("ETH"));
        assert!(
            (beta.get(1).unwrap() - 2.0).abs() < 1e-12,
            "doubled returns must give beta 2"
        );
    }

    #[test]
    fn beta_is_null_when_benchmark_has_no_variance() {
        let btc = [0.0, 0.0, 0.0, 0.0];
        let eth = [0.01, -0.02, 0.03, -0.01];
        let with_returns = returns_frame(&btc, &eth);

        let out = asset_beta_by_ticker(&with_returns, "BTC", 100).unwrap();
        let beta = out.column("beta").unwrap().f64().unwrap();

        assert!(
            beta.iter().all(|beta_value| beta_value.is_none()),
            "a benchmark with no variance gives undefined (null) beta"
        );
    }

    proptest! {
        /// When an asset's returns are an exact multiple of the benchmark's, beta
        /// recovers that multiple.
        #[test]
        fn beta_recovers_a_linear_coefficient(
            btc in prop::collection::vec(-0.2_f64..0.2, 4..30),
            coefficient in -3.0_f64..3.0,
        ) {
            prop_assume!(btc.windows(2).any(|pair| (pair[0] - pair[1]).abs() > 1e-6));
            let eth: Vec<f64> = btc.iter().map(|value| value * coefficient).collect();
            let with_returns = returns_frame(&btc, &eth);

            let out = asset_beta_by_ticker(&with_returns, "BTC", 100).unwrap();
            let tickers = out.column("ticker").unwrap().str().unwrap();
            let beta = out.column("beta").unwrap().f64().unwrap();
            let eth_index = tickers.iter().position(|ticker| ticker == Some("ETH")).unwrap();

            prop_assert!(
                (beta.get(eth_index).unwrap() - coefficient).abs() < 1e-9,
                "beta should recover the coefficient {coefficient}"
            );
        }
    }
}
