//! Per-ticker factor scores for the screener, computed over a timeframe's
//! lookback window and served by the `/factors` endpoint.

use std::path::Path;

use polars::prelude::{
    ChunkApply, DataFrame, DataFrameJoinOps, DataType, IntoLazy, IntoSeries, JoinArgs, JoinType,
    JsonFormat, JsonWriter, NULL, PolarsError, SerWriter, SortMultipleOptions, col, cols, lit,
    when,
};
use tracing::{debug, instrument};

use super::ReturnsError;
use super::asset_beta::asset_beta_by_ticker;
use super::autocorrelation::autocorrelation_by_ticker;
use super::carry::with_carry;
use super::returns::{chronological, compute_log_returns};
use super::volume::with_volume_24h;
use crate::timeframe::{Timeframe, TimeframeConfig};

const PRICE_STDDEV_EPS: f64 = 1e-8;

/// Benchmark asset for the per-ticker beta factor. Bitcoin beta is the SPEC's
/// core risk metric, so the factor table's `beta` column is always beta to BTC.
const BENCHMARK_TICKER: &str = "BTC";

/// Per-ticker factor scores serialized as a JSON array, for the `/factors`
/// endpoint. Exposes `annualized_volatility`, `cum_return`, `sma`,
/// `mean_return`, `price_zscore`, `annualized_return`, `sharpe`, `sortino`,
/// `autocorrelation`, `information_discreteness`, `carry`, `beta`, and
/// `volume_24h`; further factors are added as columns as they land.
pub(crate) async fn compute_factors_json(
    data_dir: &Path,
    timeframe: Timeframe,
) -> Result<Vec<u8>, ReturnsError> {
    let mut factors = compute_factors(data_dir, timeframe).await?;
    let mut buf = Vec::new();
    JsonWriter::new(&mut buf)
        .with_json_format(JsonFormat::Json)
        .finish(&mut factors)?;
    Ok(buf)
}

/// Per-ticker factor scores from a timeframe's candles.
///
/// For each ticker, over the last `lookback_periods` candles:
/// - `annualized_volatility` = sample stddev (ddof=1) of log returns * sqrt(annualized_factor)
/// - `cum_return` = exp(sum of log returns) - 1 (cumulative / momentum return)
/// - `sma` = simple moving average of close prices
/// - `mean_return` = mean log return
/// - `price_zscore` = (latest close - `sma`) / population stddev of close prices
/// - `annualized_return` = exp(`mean_return` * annualized_factor) - 1
/// - `sharpe` = `annualized_return` / `annualized_volatility` (risk-free 0);
///   null when there is no volatility
/// - `sortino` = `annualized_return` / downside deviation below the MAR; null
///   when there is no downside
/// - `autocorrelation` = lag-1 autocorrelation of returns over the last
///   `lookback_periods` / 4 pairs; null when returns have no variation
/// - `information_discreteness` = sign(`cum_return`) * (bear candle fraction
///   - bull candle fraction) over the lookback, where bear = `close < open` and
///   bull = `close > open`
/// - `carry` = latest signed funding rate from `funding_rate1h.csv`; null when
///   no funding data is available
/// - `beta` = per-asset beta to the benchmark (BTC) over the lookback; null when
///   the benchmark has no return variance
/// - `volume_24h` = quote notional (`volume * close`) summed over the
///   dataset's trailing day of candles; null for a ticker with no candles in
///   that window. On 1w this is the latest weekly candle -- a week's notional
///
/// Returns a `DataFrame` keyed by `ticker`. New factors are added as columns.
#[instrument(skip_all, fields(data_dir = %data_dir.display()))]
pub(crate) async fn compute_factors(
    data_dir: &Path,
    timeframe: Timeframe,
) -> Result<DataFrame, ReturnsError> {
    let path = data_dir.join(timeframe.file_name());
    let df = crate::dataframe::read_csv(path.clone()).await?;
    let Some(df) = df else {
        return Err(ReturnsError::NoData { path });
    };
    let funding = crate::dataframe::read_csv(data_dir.join(crate::funding::file_name())).await?;
    let config = timeframe.config();
    let candles_per_day = timeframe.candles_per_day();
    let out = tokio::task::spawn_blocking(move || {
        let factors = per_ticker_factors(&df, &config)?;
        let factors = with_volume_24h(&factors, &df, candles_per_day)?;
        with_carry(factors, funding.as_ref())
    })
    .await??;
    debug!(tickers = out.height(), "factors computed");
    Ok(out)
}

/// Synchronous core: log returns per ticker, then per-ticker factor scores over
/// the last `lookback_periods` candles. Stddev uses ddof=1 to match the legacy
/// Spark `stddev`; the cumulative return is `exp(sum) - 1`.
pub(super) fn per_ticker_factors(
    candles: &DataFrame,
    config: &TimeframeConfig,
) -> Result<DataFrame, PolarsError> {
    let with_returns = compute_log_returns(candles)?;
    let lookback = config.lookback_periods;
    let annualization_multiplier = config.annualized_factor.sqrt();

    // Lag-1 autocorrelation and per-asset beta each need their own pass (a
    // shorter complete-pairs window, and a benchmark join), computed separately
    // and joined back in by ticker below.
    //
    // The pair window is a quarter of the factor lookback (e.g. 22 pairs on
    // the 90-period daily window): a shorter window makes the score track the
    // recent regime instead of averaging lag-1 persistence over the whole
    // lookback.
    const AUTOCORRELATION_WINDOW_DIVISOR: usize = 4;
    let autocorrelation =
        autocorrelation_by_ticker(&with_returns, lookback / AUTOCORRELATION_WINDOW_DIVISOR)?;
    let asset_beta = asset_beta_by_ticker(&with_returns, BENCHMARK_TICKER, lookback)?;

    // Every factor must window the same trailing rows: single-source the two
    // window expressions so one factor cannot silently diverge from the rest.
    let trailing_returns = || chronological("log_return").tail(Some(lookback));
    let trailing_closes = || chronological("close").tail(Some(lookback));
    let trailing_opens = || chronological("open").tail(Some(lookback));

    // Downside deviation inputs for Sortino: sum of squared shortfalls below the
    // minimum acceptable return, and the observation count to average over.
    let above_mar = trailing_returns() - lit(config.min_acceptable_return);
    let downside_sq_sum = when(above_mar.clone().lt(lit(0.0)))
        .then(above_mar.pow(lit(2)))
        .otherwise(lit(0.0))
        .sum()
        .alias("downside_sq_sum");

    let factors = with_returns
        .lazy()
        .group_by([col("ticker")])
        .agg([
            (trailing_returns().std(1) * lit(annualization_multiplier))
                .alias("annualized_volatility"),
            trailing_returns().sum().alias("cum_log_return"),
            trailing_closes().mean().alias("sma"),
            trailing_returns().mean().alias("mean_return"),
            trailing_closes().std(0).alias("price_stddev"),
            chronological("close").last().alias("last_close"),
            downside_sq_sum,
            trailing_returns().count().alias("obs_count"),
            (trailing_closes().gt(trailing_opens()))
                .sum()
                .alias("bull_candle_count"),
            (trailing_closes().lt(trailing_opens()))
                .sum()
                .alias("bear_candle_count"),
        ])
        // price z-score = (latest close - SMA) / price stddev; undefined (null)
        // when there is no price dispersion (constant prices over the window)
        // or no measurable dispersion at all (a NaN stddev must never pass the
        // guard, mirroring the annualized_return finiteness guard).
        .with_column(
            when(
                col("price_stddev")
                    .is_finite()
                    .and(col("price_stddev").gt(lit(PRICE_STDDEV_EPS))),
            )
            .then((col("last_close") - col("sma")) / col("price_stddev"))
            .otherwise(lit(NULL))
            .alias("price_zscore"),
        )
        .drop(cols(["price_stddev", "last_close"]))
        .sort(["ticker"], SortMultipleOptions::default())
        .collect()?;

    let factors = add_return_and_risk_factors(factors, config.annualized_factor, lookback)?;

    let factors = factors.join(
        &autocorrelation,
        ["ticker"],
        ["ticker"],
        JoinArgs::new(JoinType::Left),
        None,
    )?;

    let factors = factors.join(
        &asset_beta,
        ["ticker"],
        ["ticker"],
        JoinArgs::new(JoinType::Left),
        None,
    )?;

    Ok(factors)
}

/// Derives the return and risk-adjusted factors from the aggregated columns and
/// drops the intermediate sums/counts they were computed from.
///
/// Adds `cum_return`, `annualized_return`, `sharpe`, `sortino`, and
/// `information_discreteness`. `sharpe`/`sortino` are null when their risk
/// denominator is zero; `information_discreteness` is `sign(cum_return)` times
/// (bear candle count - bull candle count) / `lookback_periods`, counting
/// `close < open` as bear and `close > open` as bull over the trailing window.
fn add_return_and_risk_factors(
    mut factors: DataFrame,
    annualized_factor: f64,
    lookback_periods: usize,
) -> Result<DataFrame, PolarsError> {
    // cum_return = exp(sum of log returns) - 1, and annualized_return =
    // exp(mean_return * annualized_factor) - 1. exp is applied on the series
    // (like compute_log_returns does for ln) to avoid a polars math-expr feature.
    let cum_return = factors
        .column("cum_log_return")?
        .f64()?
        .apply_values(f64::exp_m1)
        .into_series()
        .with_name("cum_return".into());
    factors.with_column(cum_return)?;

    let annualized_return = factors
        .column("mean_return")?
        .f64()?
        .apply_values(|mean| (mean * annualized_factor).exp_m1())
        .into_series()
        .with_name("annualized_return".into());
    factors.with_column(annualized_return)?;

    // An extreme mean return overflows exp() to a non-finite value; null it so
    // the screener never ranks on inf. sharpe and sortino derive from
    // annualized_return and stay null too.
    let mut factors = factors
        .lazy()
        .with_column(
            when(col("annualized_return").is_finite())
                .then(col("annualized_return"))
                .otherwise(lit(NULL))
                .alias("annualized_return"),
        )
        .collect()?;

    factors.drop_in_place("cum_log_return")?;

    let downside_deviation = (col("downside_sq_sum") / col("obs_count")).pow(lit(0.5));

    // information discreteness = sign(cum_return) * (bear - bull) / lookback:
    // smooth uptrends have more bull candles than bear, so the score is negative.
    let return_sign = when(col("cum_return").gt(lit(0.0)))
        .then(lit(1.0))
        .otherwise(
            when(col("cum_return").lt(lit(0.0)))
                .then(lit(-1.0))
                .otherwise(lit(0.0)),
        );
    let pct_difference = (col("bear_candle_count").cast(DataType::Float64)
        - col("bull_candle_count").cast(DataType::Float64))
        / lit(f64::from(
            u32::try_from(lookback_periods).unwrap_or(u32::MAX),
        ));

    let factors = factors
        .lazy()
        .with_columns([
            // NaN != 0.0 is true in IEEE 754, so a NaN volatility (e.g. from a
            // corrupt zero close producing a -inf log return) must be rejected
            // explicitly -- mirroring the price_zscore stddev guard.
            when(
                col("annualized_volatility")
                    .is_finite()
                    .and(col("annualized_volatility").neq(lit(0.0))),
            )
            .then(col("annualized_return") / col("annualized_volatility"))
            .otherwise(lit(NULL))
            .alias("sharpe"),
            // Same NaN hazard as the sharpe guard: a single-candle ticker
            // yields sqrt(0/0) = NaN downside deviation, and NaN != 0.0 is
            // true, so the zero check alone would emit a NaN sortino.
            when(
                downside_deviation
                    .clone()
                    .is_finite()
                    .and(downside_deviation.clone().neq(lit(0.0))),
            )
            .then(col("annualized_return") / downside_deviation)
            .otherwise(lit(NULL))
            .alias("sortino"),
            // NaN > 0.0 and NaN < 0.0 are both false, so a NaN-poisoned
            // cum_return would slip through return_sign as a legitimate-looking
            // 0.0 ("perfectly choppy") without the explicit finiteness guard
            // its sibling factors all carry.
            when(
                col("obs_count")
                    .gt(lit(0))
                    .and(col("cum_return").is_finite()),
            )
            .then(return_sign * pct_difference)
            .otherwise(lit(NULL))
            .alias("information_discreteness"),
        ])
        .drop(cols([
            "downside_sq_sum",
            "obs_count",
            "bull_candle_count",
            "bear_candle_count",
        ]))
        .collect()?;

    Ok(factors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use proptest::prelude::*;
    use std::fs;
    use tempfile::TempDir;
    use tracing_test::traced_test;

    fn opens_for_bull_candles(closes: &[f64]) -> Vec<f64> {
        closes.iter().map(|close| close * 0.99).collect()
    }

    fn opens_for_bear_candles(closes: &[f64]) -> Vec<f64> {
        closes.iter().map(|close| close + 1.0).collect()
    }

    proptest! {
        /// Volatility is a scaled standard deviation, so it is always finite and
        /// non-negative for any positive close series; the SMA stays within the
        /// price range, mean return is finite, and a present z-score is finite.
        #[test]
        fn volatility_is_non_negative(
            closes in prop::collection::vec(1.0_f64..1_000_000.0, 3..50),
        ) {
            let n = closes.len();
            let min_close = closes.iter().copied().fold(f64::INFINITY, f64::min);
            let max_close = closes.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let timestamps: Vec<String> = (0..n).map(|i| format!("{i:04}")).collect();
            let tickers = vec!["BTC"; n];
            let opens = opens_for_bull_candles(&closes);
            let candles = df! {
                "timestamp" => timestamps,
                "ticker" => tickers,
                "open" => opens,
                "close" => closes,
            }
            .unwrap();
            let config = TimeframeConfig {
                lookback_periods: 100,
                annualized_factor: 365.0,
                min_acceptable_return: 0.0,
            };

            let out = per_ticker_factors(&candles, &config).unwrap();
            let vol = out
                .column("annualized_volatility")
                .unwrap()
                .f64()
                .unwrap()
                .get(0)
                .unwrap();
            prop_assert!(vol >= 0.0, "volatility must be non-negative, got {vol}");
            prop_assert!(vol.is_finite());

            let cum = out
                .column("cum_return")
                .unwrap()
                .f64()
                .unwrap()
                .get(0)
                .unwrap();
            prop_assert!(cum.is_finite(), "cum_return must be finite, got {cum}");

            let sma = out.column("sma").unwrap().f64().unwrap().get(0).unwrap();
            prop_assert!(sma.is_finite());
            prop_assert!(
                sma >= min_close - 1e-6 && sma <= max_close + 1e-6,
                "sma {sma} outside price range [{min_close}, {max_close}]"
            );

            let mean_return = out.column("mean_return").unwrap().f64().unwrap().get(0).unwrap();
            prop_assert!(mean_return.is_finite(), "mean_return must be finite, got {mean_return}");

            if let Some(zscore) = out.column("price_zscore").unwrap().f64().unwrap().get(0) {
                prop_assert!(
                    zscore.is_finite(),
                    "price_zscore must be finite when present, got {zscore}"
                );
            }

            if let Some(annualized_return) =
                out.column("annualized_return").unwrap().f64().unwrap().get(0)
            {
                prop_assert!(
                    annualized_return.is_finite(),
                    "annualized_return must be finite when present, got {annualized_return}"
                );
            }

            if let Some(sharpe) = out.column("sharpe").unwrap().f64().unwrap().get(0) {
                prop_assert!(sharpe.is_finite(), "sharpe must be finite when present, got {sharpe}");
            }

            if let Some(sortino) = out.column("sortino").unwrap().f64().unwrap().get(0) {
                prop_assert!(
                    sortino.is_finite(),
                    "sortino must be finite when present, got {sortino}"
                );
            }

            let information_discreteness = out
                .column("information_discreteness")
                .unwrap()
                .f64()
                .unwrap()
                .get(0)
                .unwrap();
            prop_assert!(
                (-1.0 - 1e-9..=1.0 + 1e-9).contains(&information_discreteness),
                "information_discreteness {information_discreteness} outside [-1, 1]"
            );

            if let Some(beta) = out.column("beta").unwrap().f64().unwrap().get(0) {
                prop_assert!(beta.is_finite(), "beta must be finite when present, got {beta}");
            }
        }

        /// For a strictly increasing close series the latest close is the maximum,
        /// so it sits above the moving average (positive z-score) and every log
        /// return is positive, so the annualized return and (when volatility is
        /// non-zero) the Sharpe ratio are positive too.
        #[test]
        fn increasing_closes_give_positive_momentum_factors(
            base in 1.0_f64..1000.0,
            increments in prop::collection::vec(0.01_f64..100.0, 3..40),
        ) {
            let closes: Vec<f64> = std::iter::once(base)
                .chain(increments.iter().scan(base, |price, increment| {
                    *price += increment;
                    Some(*price)
                }))
                .collect();
            let n = closes.len();
            let timestamps: Vec<String> = (0..n).map(|i| format!("{i:04}")).collect();
            let tickers = vec!["BTC"; n];
            let opens = opens_for_bull_candles(&closes);
            let candles = df! {
                "timestamp" => timestamps,
                "ticker" => tickers,
                "open" => opens,
                "close" => closes,
            }
            .unwrap();
            let config = TimeframeConfig {
                lookback_periods: 100,
                annualized_factor: 365.0,
                min_acceptable_return: 0.0,
            };

            let out = per_ticker_factors(&candles, &config).unwrap();
            let zscore = out.column("price_zscore").unwrap().f64().unwrap().get(0).unwrap();
            prop_assert!(zscore > 0.0, "increasing closes must give a positive z-score, got {zscore}");

            let annualized_return = out
                .column("annualized_return")
                .unwrap()
                .f64()
                .unwrap()
                .get(0)
                .unwrap();
            prop_assert!(
                annualized_return > 0.0,
                "increasing closes must give a positive annualized_return, got {annualized_return}"
            );

            if let Some(sharpe) = out.column("sharpe").unwrap().f64().unwrap().get(0) {
                prop_assert!(
                    sharpe > 0.0,
                    "positive return with volatility must give a positive sharpe, got {sharpe}"
                );
            }

            // Every return is above the MAR (0), so there is no downside and
            // sortino is undefined -> null.
            let sortino = out.column("sortino").unwrap().f64().unwrap().get(0);
            prop_assert!(
                sortino.is_none(),
                "increasing closes have no downside, so sortino must be null, got {sortino:?}"
            );

            // Every candle is bullish (close > open), so information discreteness
            // is sign(+) * (0 - n) / lookback.
            let information_discreteness = out
                .column("information_discreteness")
                .unwrap()
                .f64()
                .unwrap()
                .get(0)
                .unwrap();
            let candle_count = f64::from(u32::try_from(n).unwrap_or(u32::MAX));
            let lookback = f64::from(
                u32::try_from(config.lookback_periods).unwrap_or(u32::MAX),
            );
            let expected_discreteness = -candle_count / lookback;
            prop_assert!(
                (information_discreteness - expected_discreteness).abs() < 1e-9,
                "a smooth uptrend must give information_discreteness {expected_discreteness}, got {information_discreteness}"
            );
        }
    }

    #[test]
    fn factor_windows_select_the_chronologically_latest_returns() {
        // 8 candles per ticker with a lookback of 3: the first five closes are
        // flat (zero returns), the last three returns are ln(1.1), ln(1/1.1),
        // ln(1.1). A stale window of zeros gives cum_return 0 instead of 0.1,
        // and while one other window ([0, 0, ln(1.1)]) also sums to ln(1.1),
        // the sma assertion below discriminates it (its closes average lower
        // than the trailing window's).
        let closes = &[
            100.0, 100.0, 100.0, 100.0, 100.0, 110.0, 100.0, 110.0, 200.0, 200.0, 200.0, 200.0,
            200.0, 220.0, 200.0, 220.0_f64,
        ];
        let candles = df! {
            "timestamp" => &[
                "0", "1", "2", "3", "4", "5", "6", "7",
                "0", "1", "2", "3", "4", "5", "6", "7",
            ],
            "ticker" => &["BTC"; 8].iter().chain(&["ETH"; 8]).copied().collect::<Vec<_>>(),
            "open" => closes,
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 3,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();

        let ticker_column = out.column("ticker").unwrap().str().unwrap();
        for (ticker, expected_sma) in [
            ("BTC", (110.0 + 100.0 + 110.0) / 3.0),
            ("ETH", (220.0 + 200.0 + 220.0) / 3.0),
        ] {
            let row_index = (0..out.height())
                .find(|row| ticker_column.get(*row) == Some(ticker))
                .expect("ticker row present in the factor output");

            let cum_return = out
                .column("cum_return")
                .unwrap()
                .f64()
                .unwrap()
                .get(row_index)
                .unwrap();
            assert!(
                (cum_return - 0.1).abs() < 1e-12,
                "{ticker}: trailing-window cum_return must be 0.1, got {cum_return}"
            );

            let sma = out
                .column("sma")
                .unwrap()
                .f64()
                .unwrap()
                .get(row_index)
                .unwrap();
            assert!(
                (sma - expected_sma).abs() < 1e-9,
                "{ticker}: sma over the trailing window must be {expected_sma}, got {sma}"
            );
        }
    }

    #[test]
    fn per_ticker_factors_sharpe_is_null_when_a_zero_close_poisons_volatility() {
        // A zero close produces a -inf log return: std over the window goes
        // NaN while annualized_return collapses to a finite -1, so only the
        // is_finite() denominator guard stands between this input and a NaN
        // sharpe in the /factors JSON.
        let closes = &[100.0, 0.0, 101.0];
        let candles = df! {
            "timestamp" => &["0", "1", "2"],
            "ticker" => &["BTC", "BTC", "BTC"],
            "open" => closes,
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();

        let sharpe = out.column("sharpe").unwrap().f64().unwrap().get(0);
        assert!(
            sharpe.is_none_or(|value| !value.is_nan()),
            "a NaN volatility must never produce a NaN sharpe, got {sharpe:?}"
        );

        let information_discreteness = out
            .column("information_discreteness")
            .unwrap()
            .f64()
            .unwrap()
            .get(0);
        assert!(
            information_discreteness.is_none(),
            "a NaN cum_return is unmeasurable, not \"perfectly choppy\": \
             information_discreteness must be null, got {information_discreteness:?}"
        );
    }

    #[test]
    fn per_ticker_factors_sharpe_is_negative_for_a_downtrend() {
        // Every other sharpe test uses a non-negative return, so a sign error
        // in the formula (e.g. an accidental abs on the numerator) would pass
        // the whole suite while misranking every asset in a drawdown.
        let closes = &[100.0, 99.0, 97.5, 95.0];
        let candles = df! {
            "timestamp" => &["0", "1", "2", "3"],
            "ticker" => &["BTC", "BTC", "BTC", "BTC"],
            "open" => opens_for_bear_candles(closes),
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();

        let sharpe = out
            .column("sharpe")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .expect("a varying downtrend has non-zero volatility");
        assert!(
            sharpe < 0.0,
            "a losing asset must have a negative sharpe, got {sharpe}"
        );
    }

    #[test]
    fn per_ticker_factors_nulls_annualized_return_when_exp_overflows() {
        // exp(mean_return * annualized_factor) overflows f64 for an extreme
        // mean return; the guard must surface null, never inf, which would
        // corrupt screener rankings and is unrepresentable in JSON. Two
        // distinct returns keep the volatility finite and non-zero, so the
        // sharpe assertion below genuinely tests null propagation from
        // annualized_return rather than a null-volatility shortcut.
        let closes = &[1.0, 1e100, 1e150_f64];
        let candles = df! {
            "timestamp" => &["0", "1", "2"],
            "ticker" => &["BTC", "BTC", "BTC"],
            "open" => opens_for_bull_candles(closes),
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();

        let annualized_return = out
            .column("annualized_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0);
        assert!(
            annualized_return.is_none(),
            "an overflowing annualized return must be null, got {annualized_return:?}"
        );
        let sharpe = out.column("sharpe").unwrap().f64().unwrap().get(0);
        assert!(
            sharpe.is_none(),
            "sharpe derives from annualized_return and must be null too, got {sharpe:?}"
        );
    }

    #[test]
    fn per_ticker_factors_zscore_is_null_when_a_close_is_nan() {
        // A NaN close poisons the window's stddev to NaN, and NaN != 0.0 is
        // true in IEEE 754 - without the is_finite() guard the z-score would
        // serialize as NaN and silently dominate any z-score-ranked output.
        let closes = &[100.0, f64::NAN, 101.0];
        let candles = df! {
            "timestamp" => &["0", "1", "2"],
            "ticker" => &["BTC", "BTC", "BTC"],
            "open" => closes,
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();

        let zscore = out.column("price_zscore").unwrap().f64().unwrap().get(0);
        assert!(
            zscore.is_none(),
            "a NaN close gives no measurable dispersion, so price_zscore must be null, got {zscore:?}"
        );
    }

    #[test]
    fn per_ticker_factors_zscore_is_null_for_a_single_candle_ticker() {
        // A single observation yields a null (not NaN) stddev from std(ddof=1);
        // pin the documented null so the edge stays covered.
        let close = 100.0_f64;
        let candles = df! {
            "timestamp" => &["0"],
            "ticker" => &["BTC"],
            "open" => &[close],
            "close" => &[close],
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();

        let zscore = out.column("price_zscore").unwrap().f64().unwrap().get(0);
        assert!(
            zscore.is_none(),
            "a single candle has no price dispersion, so price_zscore must be null, got {zscore:?}"
        );
    }

    #[test]
    fn per_ticker_factors_match_manual_values() {
        let closes = &[100.0, 101.0, 100.0, 101.0, 100.0_f64];
        let candles = df! {
            "timestamp" => &["0", "1", "2", "3", "4"],
            "ticker" => &["BTC", "BTC", "BTC", "BTC", "BTC"],
            "open" => closes,
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();
        let vol = out
            .column("annualized_volatility")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();

        // log returns are [a, -a, a, -a] with a = ln(1.01), mean 0, so the
        // sample variance is 4a^2/3 and volatility = sqrt(4a^2/3) * sqrt(365).
        let a = (101.0_f64 / 100.0).ln();
        let expected = (4.0 * a * a / 3.0).sqrt() * 365.0_f64.sqrt();
        assert!(
            (vol - expected).abs() < 1e-10,
            "vol {vol} != expected {expected}"
        );

        // log returns sum to a - a + a - a = 0, so cum_return = exp(0) - 1 = 0.
        let cum = out
            .column("cum_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(cum.abs() < 1e-12, "cum_return should be ~0, got {cum}");

        // sma = mean([100, 101, 100, 101, 100]) = 502 / 5 = 100.4.
        let sma = out.column("sma").unwrap().f64().unwrap().get(0).unwrap();
        assert!((sma - 100.4).abs() < 1e-10, "sma {sma} != 100.4");

        // mean of the non-null log returns [a, -a, a, -a] is 0.
        let mean_return = out
            .column("mean_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            mean_return.abs() < 1e-12,
            "mean_return should be ~0, got {mean_return}"
        );

        // price stddev (ddof=0) of the closes is sqrt(1.2 / 5) = sqrt(0.24), so
        // the z-score of the latest close (100) is (100 - 100.4) / sqrt(0.24).
        let zscore = out
            .column("price_zscore")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        let expected_zscore = -0.4 / 0.24_f64.sqrt();
        assert!(
            (zscore - expected_zscore).abs() < 1e-10,
            "zscore {zscore} != {expected_zscore}"
        );

        // mean_return is 0, so annualized_return = exp(0) - 1 = 0 and, with a
        // positive volatility, sharpe = 0 / vol = 0.
        let annualized_return = out
            .column("annualized_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            annualized_return.abs() < 1e-12,
            "annualized_return should be ~0, got {annualized_return}"
        );

        let sharpe = out.column("sharpe").unwrap().f64().unwrap().get(0).unwrap();
        assert!(sharpe.abs() < 1e-12, "sharpe should be ~0, got {sharpe}");

        // There is downside (the -a returns), so sortino is defined; with a zero
        // annualized_return it is 0 / downside_deviation = 0.
        let sortino = out
            .column("sortino")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(sortino.abs() < 1e-12, "sortino should be ~0, got {sortino}");

        // cum_return is 0, so sign(cum_return) is 0 and information discreteness
        // is 0 regardless of the positive/negative return split.
        let information_discreteness = out
            .column("information_discreteness")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            information_discreteness.abs() < 1e-12,
            "information_discreteness should be ~0, got {information_discreteness}"
        );
    }

    #[test]
    fn per_ticker_factors_are_zero_for_constant_prices() {
        let close = 100.0_f64;
        let candles = df! {
            "timestamp" => &["0", "1", "2", "3"],
            "ticker" => &["BTC", "BTC", "BTC", "BTC"],
            "open" => &[close; 4],
            "close" => &[close; 4],
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();
        let vol = out
            .column("annualized_volatility")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            vol.abs() < 1e-12,
            "constant prices give zero volatility, got {vol}"
        );

        let cum = out
            .column("cum_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            cum.abs() < 1e-12,
            "constant prices give zero cum_return, got {cum}"
        );

        let sma = out.column("sma").unwrap().f64().unwrap().get(0).unwrap();
        assert!((sma - 100.0).abs() < 1e-12, "sma should be 100, got {sma}");

        let mean_return = out
            .column("mean_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            mean_return.abs() < 1e-12,
            "constant prices give zero mean_return, got {mean_return}"
        );

        // No price dispersion means the z-score is undefined -> null.
        let zscore = out.column("price_zscore").unwrap().f64().unwrap().get(0);
        assert!(
            zscore.is_none(),
            "constant prices give an undefined (null) z-score, got {zscore:?}"
        );

        let annualized_return = out
            .column("annualized_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            annualized_return.abs() < 1e-12,
            "constant prices give zero annualized_return, got {annualized_return}"
        );

        // Zero volatility means sharpe is undefined -> null.
        let sharpe = out.column("sharpe").unwrap().f64().unwrap().get(0);
        assert!(
            sharpe.is_none(),
            "constant prices give an undefined (null) sharpe, got {sharpe:?}"
        );

        // No returns fall below the MAR, so downside deviation is zero and
        // sortino is undefined -> null.
        let sortino = out.column("sortino").unwrap().f64().unwrap().get(0);
        assert!(
            sortino.is_none(),
            "constant prices give an undefined (null) sortino, got {sortino:?}"
        );

        // No return variation means autocorrelation is undefined -> null.
        let autocorrelation = out.column("autocorrelation").unwrap().f64().unwrap().get(0);
        assert!(
            autocorrelation.is_none(),
            "constant prices give an undefined (null) autocorrelation, got {autocorrelation:?}"
        );

        // cum_return is 0 (sign 0) with no positive or negative returns, so
        // information discreteness is exactly 0.
        let information_discreteness = out
            .column("information_discreteness")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            information_discreteness.abs() < 1e-12,
            "constant prices give zero information_discreteness, got {information_discreteness}"
        );

        // BTC is the benchmark, so constant prices mean zero benchmark
        // variance and the beta guard must fire through the full pipeline.
        let beta = out.column("beta").unwrap().f64().unwrap().get(0);
        assert!(
            beta.is_none(),
            "constant benchmark prices give undefined (null) beta, got {beta:?}"
        );
    }

    #[test]
    fn per_ticker_sortino_matches_manual_downside_deviation() {
        // closes [100, 99, 101] give log returns [-p, q] with p = ln(100/99)
        // (a down move below the MAR of 0) and q = ln(101/99) (an up move).
        let closes = &[100.0, 99.0, 101.0_f64];
        let candles = df! {
            "timestamp" => &["0", "1", "2"],
            "ticker" => &["BTC", "BTC", "BTC"],
            "open" => opens_for_bull_candles(closes),
            "close" => closes,
        }
        .unwrap();
        // annualized_factor 1 keeps annualized_return = exp(mean_return) - 1.
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 1.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();
        let sortino = out
            .column("sortino")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();

        let down_move = (100.0_f64 / 99.0).ln();
        let up_move = (101.0_f64 / 99.0).ln();
        let mean_return = f64::midpoint(-down_move, up_move);
        let annualized_return = mean_return.exp_m1();
        // Only the down move is below the MAR, so downside variance = p^2 / 2.
        let downside_deviation = (down_move * down_move / 2.0).sqrt();
        let expected_sortino = annualized_return / downside_deviation;
        assert!(
            (sortino - expected_sortino).abs() < 1e-12,
            "sortino {sortino} != expected {expected_sortino}"
        );
    }

    #[test]
    fn per_ticker_factors_treat_near_zero_price_stddev_as_undefined_zscore() {
        let tiny_move = PRICE_STDDEV_EPS / 100.0;
        let closes = &[100.0, 100.0 + tiny_move, 100.0, 100.0 + tiny_move];
        let candles = df! {
            "timestamp" => &["0", "1", "2", "3"],
            "ticker" => &["BTC", "BTC", "BTC", "BTC"],
            "open" => closes,
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();
        let zscore = out.column("price_zscore").unwrap().f64().unwrap().get(0);

        assert!(
            zscore.is_none(),
            "near-zero price dispersion gives an undefined (null) z-score, got {zscore:?}"
        );
    }

    #[test]
    fn information_discreteness_matches_manual_value_for_mixed_candle_signs() {
        // Two bear and three bull candles on a net-positive cum_return:
        // sign(+) * (2 - 3) / lookback = -0.1.
        let candles = df! {
            "timestamp" => &["0", "1", "2", "3", "4"],
            "ticker" => &["BTC", "BTC", "BTC", "BTC", "BTC"],
            "open" => &[100.0, 103.0, 100.0, 104.0, 104.0_f64],
            "close" => &[102.0, 101.0, 103.0, 103.0, 105.0_f64],
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();
        let information_discreteness = out
            .column("information_discreteness")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();

        assert!(
            (information_discreteness - (-0.1)).abs() < 1e-12,
            "2 bear and 3 bull candles on a net uptrend must give -0.1, got {information_discreteness}"
        );
    }

    #[test]
    fn information_discreteness_for_smooth_bearish_candle_downtrend() {
        // Every candle is bearish (close < open) on a downtrend, so information
        // discreteness is sign(-) * (4 - 0) / lookback = -0.4.
        let closes = &[100.0, 99.0, 98.0, 97.0_f64];
        let candles = df! {
            "timestamp" => &["0", "1", "2", "3"],
            "ticker" => &["BTC", "BTC", "BTC", "BTC"],
            "open" => opens_for_bear_candles(closes),
            "close" => closes,
        }
        .unwrap();
        let config = TimeframeConfig {
            lookback_periods: 10,
            annualized_factor: 365.0,
            min_acceptable_return: 0.0,
        };

        let out = per_ticker_factors(&candles, &config).unwrap();
        let information_discreteness = out
            .column("information_discreteness")
            .unwrap()
            .f64()
            .unwrap()
            .get(0)
            .unwrap();
        assert!(
            (information_discreteness - (-0.4)).abs() < 1e-12,
            "a smooth bearish-candle downtrend must give information_discreteness -0.4, got {information_discreteness}"
        );
    }

    #[traced_test]
    #[tokio::test]
    async fn compute_factors_reads_candles_and_logs() {
        let tmp_dir = TempDir::new().unwrap();
        let src = Path::new("fixtures/ohlcv_1d_beta.csv");
        let dst = tmp_dir.path().join("ohlcv_1d.csv");
        fs::copy(src, &dst).unwrap();

        let out = compute_factors(tmp_dir.path(), Timeframe::OneDay)
            .await
            .unwrap();

        assert!(out.height() > 0, "expected a factor row per ticker");

        // Pin real values for a known fixture ticker (the value lookups also
        // prove every column exists); schema presence alone would pass on
        // all-NaN output.
        let ticker_column = out.column("ticker").unwrap().str().unwrap();
        let btc_row = (0..out.height())
            .find(|row| ticker_column.get(*row) == Some("BTC"))
            .expect("BTC present in the fixture");
        let btc_volatility = out
            .column("annualized_volatility")
            .unwrap()
            .f64()
            .unwrap()
            .get(btc_row)
            .expect("BTC volatility computed");
        assert!(
            btc_volatility.is_finite() && btc_volatility > 0.0,
            "BTC volatility must be a positive finite number, got {btc_volatility}"
        );
        let btc_cum_return = out
            .column("cum_return")
            .unwrap()
            .f64()
            .unwrap()
            .get(btc_row)
            .expect("BTC cum_return computed");
        assert!(
            btc_cum_return.is_finite() && btc_cum_return > 0.0,
            "the fixture's BTC closes rise over the lookback window, so \
             cum_return must be positive, got {btc_cum_return}"
        );

        // The fixture's BTC series varies, so every series-derived factor must
        // be a real number for BTC, not null.
        for factor_column in [
            "sma",
            "mean_return",
            "price_zscore",
            "annualized_return",
            "sharpe",
            "sortino",
            "autocorrelation",
            "information_discreteness",
            "beta",
            "volume_24h",
        ] {
            let value = out
                .column(factor_column)
                .unwrap()
                .f64()
                .unwrap()
                .get(btc_row);
            assert!(
                value.is_some_and(f64::is_finite),
                "BTC {factor_column} must be a finite number, got {value:?}"
            );
        }

        // No funding file was written, so carry must be null - the documented
        // no-funding-data behavior (the carry join is covered with real data by
        // compute_factors_joins_latest_carry_from_funding_file).
        let btc_carry = out.column("carry").unwrap().f64().unwrap().get(btc_row);
        assert!(
            btc_carry.is_none(),
            "carry must be null without funding data, got {btc_carry:?}"
        );

        assert!(crate::logs_contain_at(
            tracing::Level::DEBUG,
            &["factors computed"]
        ));
    }

    #[traced_test]
    #[tokio::test]
    async fn compute_factors_joins_latest_carry_from_funding_file() {
        let tmp_dir = TempDir::new().unwrap();
        fs::copy(
            "fixtures/ohlcv_1d_beta.csv",
            tmp_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();
        fs::write(
            tmp_dir.path().join("funding_rate1h.csv"),
            "timestamp,funding_rate,symbol\n\
             2024-01-01T00:00:00Z,0.0001,BTC\n\
             2024-01-02T00:00:00Z,0.0005,BTC\n",
        )
        .unwrap();

        let out = compute_factors(tmp_dir.path(), Timeframe::OneDay)
            .await
            .unwrap();

        let tickers = out.column("ticker").unwrap().str().unwrap();
        let carry = out.column("carry").unwrap().f64().unwrap();
        let btc_index = (0..tickers.len())
            .find(|&index| tickers.get(index) == Some("BTC"))
            .expect("BTC present");
        assert!(
            (carry.get(btc_index).unwrap() - 0.0005).abs() < 1e-12,
            "BTC carry should be the latest funding rate 0.0005"
        );

        assert!(crate::logs_contain_at(
            tracing::Level::DEBUG,
            &["factors computed"]
        ));
    }
}
