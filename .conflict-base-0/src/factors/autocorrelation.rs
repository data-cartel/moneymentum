//! Lag-1 autocorrelation of log returns: the Pearson correlation between each
//! return and the previous one, over the last `corr_lookback` complete pairs.

use polars::prelude::{
    DataFrame, IntoLazy, NULL, PolarsError, SortMultipleOptions, col, lit, when,
};

use super::returns::chronological;

/// Per-ticker lag-1 autocorrelation of `log_return` over the last
/// `corr_lookback` complete `(return, previous return)` pairs.
///
/// Returns a `DataFrame` with columns `ticker` and `autocorrelation`. The score
/// is null when a ticker has no return variation in the window (correlation
/// undefined) or too few pairs to measure. Uses a consistent-normalization
/// Pearson correlation, so it always lies in `[-1, 1]`.
pub(super) fn autocorrelation_by_ticker(
    with_returns: &DataFrame,
    corr_lookback: usize,
) -> Result<DataFrame, PolarsError> {
    // The lag pairing below relies on row order, so sort here instead of
    // assuming the caller's frame still carries compute_log_returns ordering.
    let lag_pairing = col("log_return")
        .shift(lit(1))
        .over([col("ticker")])
        .alias("lag_log_return");

    // Built once and cloned into each aggregation: the covariance and both
    // variances must share the same window and centering byte-for-byte, or the
    // output silently stops being a Pearson correlation in [-1, 1].
    let returns = chronological("log_return").tail(Some(corr_lookback));
    let lagged = chronological("lag_log_return").tail(Some(corr_lookback));
    let returns_dev = returns.clone() - returns.mean();
    let lagged_dev = lagged.clone() - lagged.mean();

    with_returns
        .clone()
        .lazy()
        .sort(["ticker", "timestamp"], SortMultipleOptions::default())
        .with_column(lag_pairing)
        // Keep only complete pairs so covariance and both variances are measured
        // over the same observations (a true Pearson correlation in [-1, 1]).
        .filter(
            col("log_return")
                .is_not_null()
                .and(col("lag_log_return").is_not_null()),
        )
        .group_by([col("ticker")])
        .agg([
            (returns_dev.clone() * lagged_dev.clone())
                .sum()
                .alias("autocorr_cov_sum"),
            (returns_dev.clone() * returns_dev)
                .sum()
                .alias("autocorr_var_returns"),
            (lagged_dev.clone() * lagged_dev)
                .sum()
                .alias("autocorr_var_lagged"),
        ])
        .with_column(
            when(
                col("autocorr_var_returns")
                    .gt(lit(0.0))
                    .and(col("autocorr_var_lagged").gt(lit(0.0))),
            )
            .then(
                col("autocorr_cov_sum")
                    / (col("autocorr_var_returns") * col("autocorr_var_lagged")).pow(lit(0.5)),
            )
            .otherwise(lit(NULL))
            .alias("autocorrelation"),
        )
        .select([col("ticker"), col("autocorrelation")])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use proptest::prelude::*;

    fn log_returns_frame(closes: &[f64]) -> DataFrame {
        let count = closes.len();
        let timestamps: Vec<String> = (0..count).map(|index| format!("{index:04}")).collect();
        let tickers = vec!["BTC"; count];
        let candles = df! {
            "timestamp" => timestamps,
            "ticker" => tickers,
            "close" => closes.to_vec(),
        }
        .unwrap();
        super::super::returns::compute_log_returns(&candles).unwrap()
    }

    #[test]
    fn autocorrelation_is_minus_one_for_alternating_returns() {
        // Alternating closes give log returns [+u, -u, +u, ...]; each return is
        // the negative of the previous one, so the lag-1 correlation is -1.
        let with_returns =
            log_returns_frame(&[100.0, 110.0, 100.0, 110.0, 100.0, 110.0, 100.0, 110.0]);

        let out = autocorrelation_by_ticker(&with_returns, 2).unwrap();
        let autocorrelation = out
            .column("autocorrelation")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            (autocorrelation - (-1.0)).abs() < 1e-12,
            "alternating returns must give autocorrelation -1, got {autocorrelation}"
        );
    }

    #[test]
    fn autocorrelation_keeps_tickers_independent() {
        // BTC alternates (every return is the negative of the previous one,
        // autocorrelation -1) while ETH's returns grow linearly (each return
        // is a linear function of the previous one, autocorrelation +1). If
        // the group_by leaked one ticker's value into the other, at least one
        // of the two opposite-sign assertions would fail.
        let btc_closes = [100.0, 110.0, 100.0, 110.0, 100.0, 110.0_f64];
        let eth_returns = [0.01, 0.02, 0.03, 0.04, 0.05_f64];
        let eth_closes: Vec<f64> = std::iter::once(100.0)
            .chain(eth_returns.iter().scan(100.0, |close, log_return| {
                *close *= log_return.exp();
                Some(*close)
            }))
            .collect();

        let timestamps: Vec<String> = (0..btc_closes.len())
            .chain(0..eth_closes.len())
            .map(|index| format!("{index:04}"))
            .collect();
        let tickers: Vec<&str> = std::iter::repeat_n("BTC", btc_closes.len())
            .chain(std::iter::repeat_n("ETH", eth_closes.len()))
            .collect();
        let closes: Vec<f64> = btc_closes
            .iter()
            .chain(eth_closes.iter())
            .copied()
            .collect();
        let candles = df! {
            "timestamp" => timestamps,
            "ticker" => tickers,
            "close" => closes,
        }
        .unwrap();
        let with_returns = super::super::returns::compute_log_returns(&candles).unwrap();

        let out = autocorrelation_by_ticker(&with_returns, 10).unwrap();
        let by_ticker = |ticker: &str| -> f64 {
            let index = out
                .column("ticker")
                .unwrap()
                .str()
                .unwrap()
                .iter()
                .position(|value| value == Some(ticker))
                .expect("ticker present");
            out.column("autocorrelation")
                .unwrap()
                .f64()
                .unwrap()
                .get(index)
                .expect("autocorrelation present")
        };

        let btc = by_ticker("BTC");
        let eth = by_ticker("ETH");
        assert!(
            (btc - (-1.0)).abs() < 1e-9,
            "BTC alternating returns must give -1, got {btc}"
        );
        assert!(
            (eth - 1.0).abs() < 1e-9,
            "ETH linearly growing returns must give +1, got {eth}"
        );
    }

    #[test]
    fn autocorrelation_windows_only_the_trailing_pairs() {
        // The early closes alternate (lag-1 autocorrelation -1); only the
        // last stretch grows linearly (+1). With a pair window covering just
        // the trailing stretch, the alternating prefix must not leak in --
        // a full-window computation would land far below +1.
        let closes = [
            100.0, 110.0, 100.0, 110.0, 100.0, // alternating prefix
            101.0, 103.0, 106.0, 110.0, 115.0, 121.0_f64, // linear-return tail
        ];
        let with_returns = log_returns_frame(&closes);

        let out = autocorrelation_by_ticker(&with_returns, 4).unwrap();
        let autocorrelation = out
            .column("autocorrelation")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            autocorrelation > 0.9,
            "the trailing window holds only the trend, so the alternating \
             prefix must not drag the score down, got {autocorrelation}"
        );
    }

    #[test]
    fn autocorrelation_is_null_for_constant_prices() {
        let with_returns = log_returns_frame(&[100.0, 100.0, 100.0, 100.0, 100.0]);

        let out = autocorrelation_by_ticker(&with_returns, 10).unwrap();
        let autocorrelation = out.column("autocorrelation").unwrap().f64().unwrap().get(0);
        assert!(
            autocorrelation.is_none(),
            "constant prices have no return variation, so autocorrelation must be null, got {autocorrelation:?}"
        );
    }

    proptest! {
        /// A correlation coefficient always lies in [-1, 1] whenever it is defined.
        #[test]
        fn autocorrelation_is_within_unit_interval(
            closes in prop::collection::vec(1.0_f64..1_000_000.0, 5..60),
        ) {
            let with_returns = log_returns_frame(&closes);
            let out = autocorrelation_by_ticker(&with_returns, 10).unwrap();
            if let Some(autocorrelation) = out.column("autocorrelation").unwrap().f64().unwrap().get(0) {
                prop_assert!(
                    (-1.0 - 1e-9..=1.0 + 1e-9).contains(&autocorrelation),
                    "autocorrelation {autocorrelation} outside [-1, 1]"
                );
            }
        }
    }
}
