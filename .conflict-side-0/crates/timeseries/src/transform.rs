use std::future::{Ready, ready};
use std::num::NonZeroUsize;
use std::task::{Context, Poll};

use polars::prelude::{IntoLazy, PolarsError, RollingOptionsFixedWindow, col, lit};
use thiserror::Error;
use tower::Service;
use tracing::debug;

use crate::marker::{Drawdown, Log, Normalized, Price, Return, Simple, Vol};
use crate::series::{Observation, SeriesError, TimeSeries};

#[derive(Debug, Error)]
pub enum TransformError {
    #[error(transparent)]
    Series(#[from] SeriesError),

    #[error(transparent)]
    Polars(#[from] PolarsError),

    #[error("insufficient observations: need at least {needed}, got {actual}")]
    InsufficientData { needed: usize, actual: usize },

    #[error("zero window size")]
    ZeroWindow,

    #[error("rolling window must cover at least 2 observations, got {window}")]
    WindowTooSmall { window: usize },

    #[error("non-positive price: minimum value {min} must be strictly positive")]
    NonPositivePrice { min: f64 },

    #[error("zero variance: cannot standardize a constant series")]
    ZeroVariance,

    #[error(transparent)]
    TryFromInt(#[from] std::num::TryFromIntError),
}

/// Rejects price series whose minimum value is not strictly positive.
///
/// Returns and drawdown are undefined for zero or negative prices (division
/// by zero, `ln` of a non-positive number), so the price-consuming transforms
/// reject such input rather than silently emit `NaN`/`Inf`. `TimeSeries::new`
/// already guarantees finite values, so the minimum is always a real number.
///
/// Precondition: the series is non-empty. On an empty series the fold returns
/// `f64::INFINITY` and the check passes vacuously; every caller rejects
/// empty/short input before reaching this guard.
fn ensure_positive_prices(input: &TimeSeries<Price>) -> Result<(), TransformError> {
    let min = input
        .as_dataframe()
        .column("value")?
        .as_materialized_series()
        .f64()?
        .into_no_null_iter()
        .fold(f64::INFINITY, f64::min);

    if min > 0.0 {
        Ok(())
    } else {
        Err(TransformError::NonPositivePrice { min })
    }
}

/// Computes arithmetic (simple) returns from a price series.
///
/// r_t = (P_t - P_{t-1}) / P_{t-1}
///
/// The first observation is dropped (no prior price to diff against).
#[derive(Clone)]
pub struct SimpleReturns;

impl Service<TimeSeries<Price>> for SimpleReturns {
    type Response = TimeSeries<Return<Simple>>;
    type Error = TransformError;
    type Future = Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, input: TimeSeries<Price>) -> Self::Future {
        ready(compute_simple_returns(input))
    }
}

fn compute_simple_returns(
    input: TimeSeries<Price>,
) -> Result<TimeSeries<Return<Simple>>, TransformError> {
    let row_count = input.len();
    if row_count < 2 {
        return Err(TransformError::InsufficientData {
            needed: 2,
            actual: row_count,
        });
    }

    ensure_positive_prices(&input)?;

    let df = input.into_dataframe();

    let result = df
        .lazy()
        .with_column(
            ((col("value") - col("value").shift(lit(1))) / col("value").shift(lit(1)))
                .alias("value"),
        )
        .collect()?
        .slice(1, row_count - 1);

    debug!(
        observations = result.height(),
        "computed simple returns from prices"
    );

    Ok(TimeSeries::new(result)?)
}

/// Computes logarithmic returns from a price series.
///
/// r_t = ln(P_t / P_{t-1})
///
/// The first observation is dropped (no prior price to diff against).
#[derive(Clone)]
pub struct LogReturns;

impl Service<TimeSeries<Price>> for LogReturns {
    type Response = TimeSeries<Return<Log>>;
    type Error = TransformError;
    type Future = Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, input: TimeSeries<Price>) -> Self::Future {
        ready(compute_log_returns(input))
    }
}

fn compute_log_returns(
    input: TimeSeries<Price>,
) -> Result<TimeSeries<Return<Log>>, TransformError> {
    let row_count = input.len();
    if row_count < 2 {
        return Err(TransformError::InsufficientData {
            needed: 2,
            actual: row_count,
        });
    }

    ensure_positive_prices(&input)?;

    let df = input.into_dataframe();

    let result = df
        .lazy()
        .with_column(
            (col("value") / col("value").shift(lit(1)))
                .log(lit(std::f64::consts::E))
                .alias("value"),
        )
        .collect()?
        .slice(1, row_count - 1);

    debug!(
        observations = result.height(),
        "computed log returns from prices"
    );

    Ok(TimeSeries::new(result)?)
}

/// Computes realized volatility as the rolling standard deviation
/// over a fixed lookback window.
///
/// Generic over the source observation -- the output type composes:
/// `TimeSeries<Return<Simple>>` -> `TimeSeries<Vol<Return<Simple>>>`
/// `TimeSeries<Return<Log>>`    -> `TimeSeries<Vol<Return<Log>>>`
#[derive(Clone)]
pub struct RollingVolatility {
    window: NonZeroUsize,
}

impl RollingVolatility {
    /// Creates a new `RollingVolatility` with the given lookback window.
    ///
    /// Rejects windows below 2: a single observation has no dispersion, and
    /// sample standard deviation (Bessel's correction, ddof=1) over one point
    /// is `0 / 0 = NaN`, which would silently poison every output row.
    pub fn new(window: usize) -> Result<Self, TransformError> {
        let window = NonZeroUsize::new(window).ok_or(TransformError::ZeroWindow)?;
        if window.get() < 2 {
            return Err(TransformError::WindowTooSmall {
                window: window.get(),
            });
        }
        Ok(Self { window })
    }
}

impl<M: Observation> Service<TimeSeries<M>> for RollingVolatility {
    type Response = TimeSeries<Vol<M>>;
    type Error = TransformError;
    type Future = Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, input: TimeSeries<M>) -> Self::Future {
        ready(compute_rolling_vol(input, self.window.get()))
    }
}

fn compute_rolling_vol<M: Observation>(
    input: TimeSeries<M>,
    window: usize,
) -> Result<TimeSeries<Vol<M>>, TransformError> {
    let row_count = input.len();
    if row_count < window {
        return Err(TransformError::InsufficientData {
            needed: window,
            actual: row_count,
        });
    }

    let df = input.into_dataframe();

    let with_rolling = df
        .lazy()
        .with_column(col("value").rolling_std(RollingOptionsFixedWindow {
            window_size: window,
            min_periods: window,
            ..RollingOptionsFixedWindow::default()
        }))
        .collect()?;

    // Drop rows where the rolling window has not yet filled (leading nulls).
    // window is guaranteed non-zero by the smart constructor, so window - 1 is safe.
    let leading_nulls = window - 1;
    let offset = i64::try_from(leading_nulls)?;
    let result = with_rolling.slice(offset, row_count - leading_nulls);

    debug!(
        window,
        observations = result.height(),
        "computed rolling volatility"
    );

    Ok(TimeSeries::new(result)?)
}

/// Computes drawdown from peak for a price series.
///
/// dd_t = (P_t - max(P_0..P_t)) / max(P_0..P_t)
///
/// Values are non-positive: 0 at peaks, negative during drawdowns.
#[derive(Clone)]
pub struct PeakDrawdown;

impl Service<TimeSeries<Price>> for PeakDrawdown {
    type Response = TimeSeries<Drawdown<Price>>;
    type Error = TransformError;
    type Future = Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, input: TimeSeries<Price>) -> Self::Future {
        ready(compute_drawdown(input))
    }
}

fn compute_drawdown(
    input: TimeSeries<Price>,
) -> Result<TimeSeries<Drawdown<Price>>, TransformError> {
    if input.is_empty() {
        return Err(TransformError::InsufficientData {
            needed: 1,
            actual: 0,
        });
    }

    ensure_positive_prices(&input)?;

    let df = input.into_dataframe();

    let result = df
        .lazy()
        .with_column(
            ((col("value") - col("value").cum_max(false)) / col("value").cum_max(false))
                .alias("value"),
        )
        .collect()?;

    debug!(observations = result.height(), "computed peak drawdown");

    Ok(TimeSeries::new(result)?)
}

/// Standardizes observations to z-scores: z = (x - mu) / sigma.
///
/// Generic over any observation type -- the output preserves provenance:
/// `TimeSeries<Price>`          -> `TimeSeries<Normalized<Price>>`
/// `TimeSeries<Return<Simple>>` -> `TimeSeries<Normalized<Return<Simple>>>`
///
/// Returns `TransformError::ZeroVariance` for constant series where
/// standard deviation is zero.
#[derive(Clone)]
pub struct Normalize;

impl<M: Observation> Service<TimeSeries<M>> for Normalize {
    type Response = TimeSeries<Normalized<M>>;
    type Error = TransformError;
    type Future = Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, input: TimeSeries<M>) -> Self::Future {
        ready(compute_zscore(input))
    }
}

fn compute_zscore<M: Observation>(
    input: TimeSeries<M>,
) -> Result<TimeSeries<Normalized<M>>, TransformError> {
    if input.len() < 2 {
        return Err(TransformError::InsufficientData {
            needed: 2,
            actual: input.len(),
        });
    }

    let df = input.into_dataframe();

    // Check for zero variance before dividing to avoid producing NaNs.
    let std_val = df.column("value")?.as_materialized_series().std(1);

    match std_val {
        Some(sigma) if sigma > f64::EPSILON => {}
        _ => return Err(TransformError::ZeroVariance),
    }

    let result = df
        .lazy()
        .with_column(((col("value") - col("value").mean()) / col("value").std(1)).alias("value"))
        .collect()?;

    debug!(observations = result.height(), "computed z-scores");

    Ok(TimeSeries::new(result)?)
}

#[cfg(test)]
mod tests {
    use polars::prelude::{Column, DataFrame, DataType, NamedFrom, Series, TimeUnit};
    use proptest::prelude::*;
    use tracing::Level;
    use tracing_test::traced_test;

    use super::*;
    use crate::logs_contain_at;

    const DAY_MS: i64 = 86_400_000;

    fn sample_price_series(prices: &[f64]) -> TimeSeries<Price> {
        let epoch_start: i64 = 1_704_067_200_000; // 2024-01-01T00:00:00Z
        let millis: Vec<i64> = (0..prices.len())
            .map(|idx| epoch_start + i64::try_from(idx).unwrap() * DAY_MS)
            .collect();
        let timestamps = Series::new("timestamp".into(), millis)
            .cast(&DataType::Datetime(TimeUnit::Milliseconds, None))
            .unwrap();

        let value_series = Series::new("value".into(), prices);
        let df =
            DataFrame::new(vec![Column::from(timestamps), Column::from(value_series)]).unwrap();

        TimeSeries::new(df).unwrap()
    }

    fn extract_values(ts: &TimeSeries<impl Observation>) -> Vec<f64> {
        ts.as_dataframe()
            .column("value")
            .unwrap()
            .as_materialized_series()
            .f64()
            .unwrap()
            .into_no_null_iter()
            .collect()
    }

    #[traced_test]
    #[test]
    fn simple_returns_computes_arithmetic_returns() {
        let prices = sample_price_series(&[100.0, 110.0, 99.0, 115.0]);

        let mut service = SimpleReturns;
        let result = service.call(prices).into_inner().unwrap();

        assert_eq!(result.len(), 3);
        let values = extract_values(&result);

        let tolerance = 1e-10;
        assert!((values[0] - 0.1).abs() < tolerance); // (110-100)/100
        assert!((values[1] - (-0.1)).abs() < tolerance); // (99-110)/110
        assert!((values[2] - (16.0 / 99.0)).abs() < tolerance); // (115-99)/99

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed simple returns from prices"]
        ));
    }

    #[traced_test]
    #[test]
    fn simple_returns_rejects_single_observation() {
        let prices = sample_price_series(&[100.0]);
        let mut service = SimpleReturns;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 2,
                actual: 1
            })
        ));
    }

    #[traced_test]
    #[test]
    fn log_returns_computes_logarithmic_returns() {
        let prices = sample_price_series(&[100.0, 110.0, 99.0]);

        let mut service = LogReturns;
        let result = service.call(prices).into_inner().unwrap();

        assert_eq!(result.len(), 2);
        let values = extract_values(&result);

        let tolerance = 1e-10;
        assert!((values[0] - (110.0_f64 / 100.0).ln()).abs() < tolerance);
        assert!((values[1] - (99.0_f64 / 110.0).ln()).abs() < tolerance);

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed log returns from prices"]
        ));
    }

    #[traced_test]
    #[test]
    fn rolling_volatility_over_simple_returns() {
        // 6 prices -> 5 simple returns, window=3 -> 3 vol observations
        let prices = sample_price_series(&[100.0, 102.0, 101.0, 105.0, 103.0, 108.0]);

        let mut return_svc = SimpleReturns;
        let returns = return_svc.call(prices).into_inner().unwrap();
        assert_eq!(returns.len(), 5);
        let returns_values = extract_values(&returns);

        let mut vol_svc = RollingVolatility::new(3).unwrap();
        let vol = vol_svc.call(returns).into_inner().unwrap();

        assert_eq!(vol.len(), 3);
        let values = extract_values(&vol);

        // Independently recompute the first window's sample std (ddof=1) over the
        // returns, so a wrong ddof, an off-by-factor, or a window misalignment in
        // the composed Returns -> RollingVolatility path is caught numerically.
        let window = &returns_values[0..3];
        let window_mean = window.iter().sum::<f64>() / 3.0;
        let window_var = window
            .iter()
            .map(|rate| (rate - window_mean).powi(2))
            .sum::<f64>()
            / 2.0;
        let expected_first = window_var.sqrt();
        assert!(
            (values[0] - expected_first).abs() < 1e-10,
            "vol[0] = {}, expected {expected_first}",
            values[0]
        );

        // All volatility values should be positive
        for value in &values {
            assert!(*value > 0.0, "vol should be positive, got {value}");
        }

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed rolling volatility"]
        ));
    }

    #[traced_test]
    #[test]
    fn rolling_volatility_over_log_returns() {
        // Same test but with log returns -- no separate LogRollingVolatility needed
        let prices = sample_price_series(&[100.0, 102.0, 101.0, 105.0, 103.0, 108.0]);

        let mut return_svc = LogReturns;
        let returns = return_svc.call(prices).into_inner().unwrap();
        assert_eq!(returns.len(), 5);

        let mut vol_svc = RollingVolatility::new(3).unwrap();
        let vol: TimeSeries<Vol<Return<Log>>> = vol_svc.call(returns).into_inner().unwrap();

        assert_eq!(vol.len(), 3);
        let values = extract_values(&vol);

        for value in &values {
            assert!(*value > 0.0, "vol should be positive, got {value}");
        }

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed rolling volatility"]
        ));
    }

    #[traced_test]
    #[test]
    fn rolling_volatility_rejects_insufficient_data() {
        let prices = sample_price_series(&[100.0, 102.0, 101.0]);
        let mut return_svc = SimpleReturns;
        let returns = return_svc.call(prices).into_inner().unwrap();
        // 2 returns, window=5 -> insufficient
        let mut vol_svc = RollingVolatility::new(5).unwrap();
        let result = vol_svc.call(returns).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 5,
                actual: 2
            })
        ));
    }

    #[test]
    fn rolling_volatility_rejects_zero_window() {
        let result = RollingVolatility::new(0);
        assert!(matches!(result, Err(TransformError::ZeroWindow)));
    }

    #[traced_test]
    #[test]
    fn peak_drawdown_computation() {
        // Peak at 120, then drawdown to 90, then partial recovery
        let prices = sample_price_series(&[100.0, 120.0, 90.0, 110.0]);

        let mut service = PeakDrawdown;
        let result = service.call(prices).into_inner().unwrap();

        assert_eq!(result.len(), 4);
        let values = extract_values(&result);

        let tolerance = 1e-10;
        assert!((values[0] - 0.0).abs() < tolerance); // first price is the peak so far
        assert!((values[1] - 0.0).abs() < tolerance); // 120 is new peak
        assert!((values[2] - (-0.25)).abs() < tolerance); // (90-120)/120 = -0.25
        assert!((values[3] - (-1.0 / 12.0)).abs() < tolerance); // (110-120)/120

        assert!(logs_contain_at(Level::DEBUG, &["computed peak drawdown"]));
    }

    #[traced_test]
    #[test]
    fn normalize_produces_z_scores_with_provenance() {
        let prices = sample_price_series(&[100.0, 200.0, 300.0]);

        let mut service = Normalize;
        let result: TimeSeries<Normalized<Price>> = service.call(prices).into_inner().unwrap();

        assert_eq!(result.len(), 3);
        let values = extract_values(&result);

        // Mean = 200, sample std (ddof=1) = 100, so z-scores are exactly [-1, 0, 1].
        let tolerance = 1e-10;
        assert!((values[0] - (-1.0)).abs() < tolerance);
        assert!(values[1].abs() < tolerance);
        assert!((values[2] - 1.0).abs() < tolerance);

        assert!(logs_contain_at(Level::DEBUG, &["computed z-scores"]));
    }

    #[traced_test]
    #[test]
    fn normalize_output_has_zero_mean_and_unit_std() {
        // Asymmetric input: the z-scores are not hand-pretty, but by construction
        // every standardized series has sample mean 0 and sample std 1.
        let prices = sample_price_series(&[10.0, 20.0, 40.0, 35.0, 5.0]);

        let mut service = Normalize;
        let result: TimeSeries<Normalized<Price>> = service.call(prices).into_inner().unwrap();
        let values = extract_values(&result);

        assert_eq!(values.len(), 5);
        let count = 5.0;
        let mean = values.iter().sum::<f64>() / count;
        let variance = values
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f64>()
            / (count - 1.0);
        let std = variance.sqrt();

        let tolerance = 1e-10;
        assert!(
            mean.abs() < tolerance,
            "z-score mean should be 0, got {mean}"
        );
        assert!(
            (std - 1.0).abs() < tolerance,
            "z-score std should be 1, got {std}"
        );

        assert!(logs_contain_at(Level::DEBUG, &["computed z-scores"]));
    }

    #[test]
    fn normalize_rejects_constant_series() {
        let prices = sample_price_series(&[42.0, 42.0, 42.0]);
        let mut service = Normalize;
        let result = service.call(prices).into_inner();
        assert!(
            matches!(result, Err(TransformError::ZeroVariance)),
            "expected ZeroVariance for constant series, got {result:?}"
        );
    }

    #[test]
    fn composable_labels_reflect_nesting() {
        assert_eq!(Price::label().as_ref(), "price");
        assert_eq!(<Return<Simple>>::label().as_ref(), "simple return");
        assert_eq!(<Return<Log>>::label().as_ref(), "log return");
        assert_eq!(<Vol<Return<Simple>>>::label().as_ref(), "simple return vol");
        assert_eq!(<Vol<Return<Log>>>::label().as_ref(), "log return vol");
        assert_eq!(<Normalized<Price>>::label().as_ref(), "normalized price");
        assert_eq!(
            <Normalized<Return<Simple>>>::label().as_ref(),
            "normalized simple return"
        );
        assert_eq!(<Drawdown<Price>>::label().as_ref(), "price drawdown");
    }

    #[traced_test]
    #[test]
    fn peak_drawdown_single_price_is_zero() {
        let prices = sample_price_series(&[100.0]);

        let mut service = PeakDrawdown;
        let result = service.call(prices).into_inner().unwrap();

        assert_eq!(result.len(), 1);
        let values = extract_values(&result);
        assert!(values[0].abs() < 1e-10); // a lone price is its own peak

        assert!(logs_contain_at(Level::DEBUG, &["computed peak drawdown"]));
    }

    #[test]
    fn peak_drawdown_rejects_empty_series() {
        let prices = sample_price_series(&[]);
        let mut service = PeakDrawdown;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 1,
                actual: 0
            })
        ));
    }

    #[test]
    fn log_returns_rejects_single_observation() {
        let prices = sample_price_series(&[100.0]);
        let mut service = LogReturns;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 2,
                actual: 1
            })
        ));
    }

    #[test]
    fn simple_returns_rejects_empty_series() {
        let prices = sample_price_series(&[]);
        let mut service = SimpleReturns;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 2,
                actual: 0
            })
        ));
    }

    #[test]
    fn log_returns_rejects_empty_series() {
        let prices = sample_price_series(&[]);
        let mut service = LogReturns;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 2,
                actual: 0
            })
        ));
    }

    #[test]
    fn normalize_rejects_empty_series() {
        let prices = sample_price_series(&[]);
        let mut service = Normalize;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::InsufficientData {
                needed: 2,
                actual: 0
            })
        ));
    }

    #[test]
    fn simple_returns_rejects_zero_price() {
        let prices = sample_price_series(&[100.0, 0.0, 50.0]);
        let mut service = SimpleReturns;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::NonPositivePrice { min }) if min <= 0.0
        ));
    }

    #[test]
    fn log_returns_rejects_negative_price() {
        let prices = sample_price_series(&[100.0, -5.0, 50.0]);
        let mut service = LogReturns;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::NonPositivePrice { min }) if min < 0.0
        ));
    }

    #[test]
    fn drawdown_rejects_zero_price() {
        let prices = sample_price_series(&[100.0, 0.0, 50.0]);
        let mut service = PeakDrawdown;
        let result = service.call(prices).into_inner();
        assert!(matches!(
            result,
            Err(TransformError::NonPositivePrice { .. })
        ));
    }

    #[test]
    fn rolling_volatility_rejects_window_below_two() {
        let result = RollingVolatility::new(1);
        assert!(matches!(
            result,
            Err(TransformError::WindowTooSmall { window: 1 })
        ));
    }

    #[traced_test]
    #[test]
    fn rolling_volatility_matches_sample_std() {
        // Evenly spaced values have constant sample std: each window [n, n+1, n+2]
        // has sample std (ddof=1) sqrt((1 + 0 + 1) / 2) = 1.0 exactly.
        let prices = sample_price_series(&[10.0, 11.0, 12.0, 13.0, 14.0]);

        let mut service = RollingVolatility::new(3).unwrap();
        let vol = service.call(prices).into_inner().unwrap();

        assert_eq!(vol.len(), 3);
        let values = extract_values(&vol);

        let tolerance = 1e-10;
        for value in &values {
            assert!(
                (value - 1.0).abs() < tolerance,
                "expected sample std 1.0, got {value}"
            );
        }

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed rolling volatility"]
        ));
    }

    proptest! {
        #[test]
        fn simple_returns_stay_above_negative_one(
            prices in proptest::collection::vec(0.01f64..1_000_000.0, 2..64)
        ) {
            let series = sample_price_series(&prices);
            let mut service = SimpleReturns;
            let returns = service.call(series).into_inner().unwrap();
            for value in extract_values(&returns) {
                prop_assert!(value.is_finite());
                prop_assert!(value > -1.0);
            }
        }

        #[test]
        fn drawdown_is_never_positive(
            prices in proptest::collection::vec(0.01f64..1_000_000.0, 1..64)
        ) {
            let series = sample_price_series(&prices);
            let mut service = PeakDrawdown;
            let result = service.call(series).into_inner().unwrap();
            for value in extract_values(&result) {
                prop_assert!(value.is_finite());
                prop_assert!(value <= 0.0);
            }
        }

        #[test]
        fn rolling_volatility_is_never_negative(
            prices in proptest::collection::vec(0.01f64..1_000_000.0, 4..64)
        ) {
            let series = sample_price_series(&prices);
            let mut returns_service = SimpleReturns;
            let returns = returns_service.call(series).into_inner().unwrap();
            let mut vol_service = RollingVolatility::new(3).unwrap();
            let vol = vol_service.call(returns).into_inner().unwrap();
            for value in extract_values(&vol) {
                prop_assert!(value.is_finite());
                prop_assert!(value >= 0.0);
            }
        }

        #[test]
        fn z_scores_have_zero_mean_and_unit_std(
            prices in proptest::collection::vec(0.01f64..1_000_000.0, 3..64)
        ) {
            let series = sample_price_series(&prices);
            let mut service = Normalize;
            let outcome = service.call(series).into_inner();
            // Constant series are rejected as ZeroVariance by design; skip them.
            prop_assume!(outcome.is_ok());
            let result = outcome.unwrap();
            let values = extract_values(&result);

            let count = f64::from(u32::try_from(values.len()).unwrap());
            let mean = values.iter().sum::<f64>() / count;
            let variance =
                values.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / (count - 1.0);
            let std = variance.sqrt();

            prop_assert!(mean.abs() < 1e-6, "mean = {mean}");
            prop_assert!((std - 1.0).abs() < 1e-6, "std = {std}");
        }
    }
}
