use serde::{Deserialize, Serialize};

use crate::timeframe::Timeframe;

/// What a single ingestion job executes. Each scheduled tick enqueues one scoped
/// unit of work -- a single candle timeframe or a funding refresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum IngestionWork {
    Funding,
    Candles { timeframe: Timeframe },
}

const FUNDING_INGESTION_CRON: &str = "20 0 * * * *";

/// Six-field cron used only under `test-support` so e2e tests observe scheduled
/// ticks without waiting for production cadences.
#[cfg(feature = "test-support")]
const TEST_INGESTION_CRON: &str = "*/2 * * * * *";

impl IngestionWork {
    pub(crate) fn scheduled_units() -> Vec<Self> {
        Timeframe::all()
            .into_iter()
            .map(Self::candles)
            .chain([Self::Funding])
            .collect()
    }

    /// Scoped work units started by schedulers in e2e tests: one candle interval
    /// plus funding, avoiding the OneWeek lookback overflow (issue #64).
    #[cfg(feature = "test-support")]
    pub(crate) fn test_e2e_scheduled_units() -> [Self; 2] {
        [Self::candles(Timeframe::OneHour), Self::Funding]
    }

    pub(crate) fn candles(timeframe: Timeframe) -> Self {
        Self::Candles { timeframe }
    }

    pub(crate) fn production_cron_expression(self) -> &'static str {
        match self {
            Self::Funding => FUNDING_INGESTION_CRON,
            Self::Candles { timeframe } => timeframe.ingestion_cron_expression(),
        }
    }

    pub(crate) fn default_cron_expression(self) -> &'static str {
        #[cfg(feature = "test-support")]
        {
            let _ = self.production_cron_expression();
            TEST_INGESTION_CRON
        }
        #[cfg(not(feature = "test-support"))]
        self.production_cron_expression()
    }

    pub(crate) fn schedule_key(self) -> &'static str {
        match self {
            Self::Funding => "funding",
            Self::Candles { timeframe } => timeframe.interval_string(),
        }
    }

    pub(crate) fn from_schedule_key(key: &str) -> Result<Self, IngestionWorkParseError> {
        match key {
            "funding" => Ok(Self::Funding),
            interval => Timeframe::from_interval_string(interval)
                .map(|timeframe| Self::Candles { timeframe })
                .ok_or_else(|| IngestionWorkParseError::UnknownScheduleKey {
                    key: key.to_string(),
                }),
        }
    }
}

/// Why a schedule key string is not a valid [`IngestionWork`].
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum IngestionWorkParseError {
    #[error(
        "unknown ingestion schedule key `{key}`; expected funding or a candle interval (15m, 1h, 1d, 1w)"
    )]
    UnknownScheduleKey { key: String },
}

#[cfg(test)]
mod tests {
    use crate::timeframe::Timeframe;

    use super::{IngestionWork, IngestionWorkParseError};

    #[test]
    fn schedule_key_round_trips_for_candle_intervals() {
        for (interval, work) in [
            ("15m", IngestionWork::candles(Timeframe::FifteenMin)),
            ("1h", IngestionWork::candles(Timeframe::OneHour)),
            ("1d", IngestionWork::candles(Timeframe::OneDay)),
            ("1w", IngestionWork::candles(Timeframe::OneWeek)),
        ] {
            assert_eq!(work.schedule_key(), interval);
            assert_eq!(IngestionWork::from_schedule_key(interval).unwrap(), work);
        }
    }

    #[test]
    fn schedule_key_round_trips_for_funding() {
        assert_eq!(IngestionWork::Funding.schedule_key(), "funding");
        assert_eq!(
            IngestionWork::from_schedule_key("funding").unwrap(),
            IngestionWork::Funding
        );
    }

    #[test]
    fn scheduled_units_cover_every_candle_timeframe_and_funding() {
        assert_eq!(
            IngestionWork::scheduled_units().len(),
            Timeframe::all().len() + 1
        );
        for timeframe in Timeframe::all() {
            assert!(IngestionWork::scheduled_units().contains(&IngestionWork::candles(timeframe)));
        }
        assert!(IngestionWork::scheduled_units().contains(&IngestionWork::Funding));
    }

    #[test]
    #[cfg(not(feature = "test-support"))]
    fn default_cron_expressions_match_timeframe_cadence() {
        assert_eq!(
            IngestionWork::candles(Timeframe::FifteenMin).default_cron_expression(),
            "0 */15 * * * *"
        );
        assert_eq!(
            IngestionWork::candles(Timeframe::OneHour).default_cron_expression(),
            "10 0 * * * *"
        );
        assert_eq!(
            IngestionWork::candles(Timeframe::OneDay).default_cron_expression(),
            "0 0 0 * * *"
        );
        assert_eq!(
            IngestionWork::candles(Timeframe::OneWeek).default_cron_expression(),
            "0 30 0 * * 1"
        );
        assert_eq!(
            IngestionWork::Funding.default_cron_expression(),
            "20 0 * * * *"
        );
    }

    #[test]
    fn ingestion_work_serializes_with_internally_tagged_candles_variant() {
        let work = IngestionWork::candles(Timeframe::OneHour);
        let json = serde_json::to_string(&work).unwrap();
        assert_eq!(json, r#"{"kind":"candles","timeframe":"1h"}"#);
        assert_eq!(serde_json::from_str::<IngestionWork>(&json).unwrap(), work);
    }

    #[test]
    fn unknown_schedule_keys_are_rejected() {
        assert_eq!(
            IngestionWork::from_schedule_key("banana"),
            Err(IngestionWorkParseError::UnknownScheduleKey {
                key: "banana".to_string()
            })
        );
    }
}
