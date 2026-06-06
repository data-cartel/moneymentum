//! OHLCV candle timeframes with lookback configuration.
//!
//! Each timeframe has a different historical lookback depth: shorter intervals
//! have shorter lookbacks (30 days for 15m) while longer intervals go further
//! back (3 years for weekly). This balances storage costs against analytical
//! utility - higher-frequency data is most relevant for recent periods.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Timeframe {
    FifteenMin,
    OneHour,
    OneDay,
    OneWeek,
}

impl Timeframe {
    pub(crate) fn from_interval_string(interval: &str) -> Option<Self> {
        match interval {
            "15m" => Some(Self::FifteenMin),
            "1h" => Some(Self::OneHour),
            "1d" => Some(Self::OneDay),
            "1w" => Some(Self::OneWeek),
            _ => None,
        }
    }

    pub(crate) fn interval_string(self) -> &'static str {
        match self {
            Self::FifteenMin => "15m",
            Self::OneHour => "1h",
            Self::OneDay => "1d",
            Self::OneWeek => "1w",
        }
    }

    /// Duration covered by a window of `max_entries` candles for this timeframe.
    ///
    /// Callers (e.g. exchange adapters) pass their API's maximum history size;
    /// this keeps the domain independent of any specific data source.
    pub(crate) fn window_duration(self, max_entries: i64) -> chrono::Duration {
        match self {
            Self::FifteenMin => chrono::Duration::minutes(15 * max_entries),
            Self::OneHour => chrono::Duration::hours(max_entries),
            Self::OneDay => chrono::Duration::days(max_entries),
            Self::OneWeek => chrono::Duration::days(7 * max_entries),
        }
    }

    pub(crate) fn file_name(self) -> &'static str {
        match self {
            Self::FifteenMin => "ohlcv_15m.csv",
            Self::OneHour => "ohlcv_1h.csv",
            Self::OneDay => "ohlcv_1d.csv",
            Self::OneWeek => "ohlcv_1w.csv",
        }
    }

    /// Number of candles spanning roughly 24 hours, used to sum trailing 24h
    /// volume. Weekly candles are coarser than a day, so it is 1 (the latest
    /// weekly candle's volume).
    pub(crate) fn candles_per_day(self) -> usize {
        match self {
            Self::FifteenMin => 24 * 4,
            Self::OneHour => 24,
            Self::OneDay | Self::OneWeek => 1,
        }
    }

    /// Factor-engine parameters for this timeframe, ported from the legacy
    /// `util.py` `TIMEFRAME_CONFIGS`.
    pub(crate) fn config(self) -> TimeframeConfig {
        match self {
            Self::FifteenMin => TimeframeConfig {
                lookback_periods: 7 * 24 * 4,
                annualized_factor: 365.0 * 24.0 * 4.0,
                // The geometric 15m fraction of the hourly MAR.
                min_acceptable_return: 1.000_012_5_f64.sqrt().sqrt() - 1.0,
            },
            Self::OneHour => TimeframeConfig {
                lookback_periods: 7 * 24,
                annualized_factor: 365.0 * 24.0,
                min_acceptable_return: 0.000_012_5,
            },
            Self::OneDay => TimeframeConfig {
                lookback_periods: 90,
                annualized_factor: 365.0,
                min_acceptable_return: 0.000_3,
            },
            Self::OneWeek => TimeframeConfig {
                lookback_periods: 52,
                annualized_factor: 52.0,
                min_acceptable_return: 0.002_1,
            },
        }
    }
}

/// Per-timeframe parameters that drive the factor engine's windowed math.
pub(crate) struct TimeframeConfig {
    /// Number of trailing rows in the per-ticker lookback window for rolling
    /// factor math. Return-based factors window the last N log returns
    /// (spanning N+1 candles); price-based factors (SMA, price z-score) window
    /// the last N closes.
    pub(crate) lookback_periods: usize,
    /// Scaling factor to annualize per-period returns and volatility.
    pub(crate) annualized_factor: f64,
    /// Minimum acceptable per-period return below which a return counts as
    /// downside risk (the MAR in the Sortino ratio). Derived from Hyperliquid's
    /// neutral funding interest-rate component of 0.01% per 8 hours (0.00125%
    /// per hour), per
    /// <https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding>:
    /// 1h = 1.25e-5, 1d = 24x that, 1w = 7x daily, 15m = the geometric quarter
    /// of the hourly rate.
    pub(crate) min_acceptable_return: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_matches_legacy_timeframe_constants() {
        let fifteen = Timeframe::FifteenMin.config();
        assert_eq!(fifteen.lookback_periods, 672);
        assert!((fifteen.annualized_factor - 35040.0).abs() < f64::EPSILON);

        let hour = Timeframe::OneHour.config();
        assert_eq!(hour.lookback_periods, 168);
        assert!((hour.annualized_factor - 8760.0).abs() < f64::EPSILON);

        let day = Timeframe::OneDay.config();
        assert_eq!(day.lookback_periods, 90);
        assert!((day.annualized_factor - 365.0).abs() < f64::EPSILON);

        let week = Timeframe::OneWeek.config();
        assert_eq!(week.lookback_periods, 52);
        assert!((week.annualized_factor - 52.0).abs() < f64::EPSILON);
    }

    #[test]
    fn mar_constants_derive_from_the_hyperliquid_neutral_funding_rate() {
        // Asserting the relationships to the documented venue rate (0.01% per
        // 8 hours, paid hourly) rather than re-typing the source literals, so
        // a mistyped constant cannot agree with its own copy in the test.
        let documented_hourly_rate = 0.01 / 100.0 / 8.0;

        let hour = Timeframe::OneHour.config();
        assert!(
            (hour.min_acceptable_return - documented_hourly_rate).abs() < 1e-12,
            "hourly MAR must equal Hyperliquid's 0.00125% hourly neutral rate"
        );

        let day = Timeframe::OneDay.config();
        assert!(
            24.0f64
                .mul_add(-hour.min_acceptable_return, day.min_acceptable_return)
                .abs()
                < 1e-12,
            "daily MAR must be 24x the hourly rate"
        );

        let week = Timeframe::OneWeek.config();
        assert!(
            7.0f64
                .mul_add(-day.min_acceptable_return, week.min_acceptable_return)
                .abs()
                < 1e-12,
            "weekly MAR must be 7x the daily rate"
        );

        let fifteen = Timeframe::FifteenMin.config();
        let compounded_back_to_hourly = (1.0 + fifteen.min_acceptable_return).powi(4) - 1.0;
        assert!(
            (compounded_back_to_hourly - hour.min_acceptable_return).abs() < 1e-12,
            "four compounded 15m MARs must reproduce the hourly MAR"
        );
    }

    #[test]
    fn candles_per_day_spans_roughly_one_day() {
        // Assert the property (window covers one day of intra-day candles)
        // rather than re-typing the lookup table's literals.
        const MINUTES_PER_DAY: usize = 24 * 60;
        assert_eq!(
            Timeframe::FifteenMin.candles_per_day() * 15,
            MINUTES_PER_DAY,
            "15m candles must cover one full day"
        );
        assert_eq!(
            Timeframe::OneHour.candles_per_day() * 60,
            MINUTES_PER_DAY,
            "1h candles must cover one full day"
        );
        assert_eq!(
            Timeframe::OneDay.candles_per_day() * MINUTES_PER_DAY,
            MINUTES_PER_DAY,
            "a daily candle covers exactly one day"
        );
        assert_eq!(
            Timeframe::OneWeek.candles_per_day(),
            1,
            "weekly candles are coarser than a day, so the window is the latest candle"
        );
    }

    #[test]
    fn interval_strings_are_valid() {
        assert_eq!(Timeframe::FifteenMin.interval_string(), "15m");
        assert_eq!(Timeframe::OneHour.interval_string(), "1h");
        assert_eq!(Timeframe::OneDay.interval_string(), "1d");
        assert_eq!(Timeframe::OneWeek.interval_string(), "1w");
    }

    #[test]
    fn interval_string_roundtrips() {
        for timeframe in [
            Timeframe::FifteenMin,
            Timeframe::OneHour,
            Timeframe::OneDay,
            Timeframe::OneWeek,
        ] {
            assert_eq!(
                Timeframe::from_interval_string(timeframe.interval_string()),
                Some(timeframe)
            );
        }
    }

    #[test]
    fn window_duration_increases_with_granularity() {
        let max_entries = 5000_i64;
        assert!(
            Timeframe::FifteenMin.window_duration(max_entries)
                < Timeframe::OneHour.window_duration(max_entries)
        );
        assert!(
            Timeframe::OneHour.window_duration(max_entries)
                < Timeframe::OneDay.window_duration(max_entries)
        );
        assert!(
            Timeframe::OneDay.window_duration(max_entries)
                < Timeframe::OneWeek.window_duration(max_entries)
        );
    }
}
