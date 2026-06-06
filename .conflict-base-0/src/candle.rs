//! OHLCV candle types and conversion to `DataFrame`.
//!
//! This module defines the [`Candle`] domain type and converts it to a Polars
//! `DataFrame` for persistence. Generic `DataFrame` operations (read/write/merge)
//! live in [`crate::dataframe`].

use std::path::Path;

use chrono::{DateTime, Utc};
use polars::prelude::{DataFrame, JsonWriter, PolarsError, SerWriter, df};
use thiserror::Error;
use tracing::{debug, instrument};

use crate::dataframe::{self, DataFrameError};
use crate::finance::{Market, Symbol};
use crate::timeframe::Timeframe;

#[derive(Debug, Error)]
pub(crate) enum CandleError {
    #[error(transparent)]
    Polars(#[from] PolarsError),
    #[error(transparent)]
    DataFrame(#[from] DataFrameError),
    #[error(transparent)]
    Join(#[from] tokio::task::JoinError),
}

#[derive(Debug, Clone)]
pub(crate) struct Candle {
    pub(crate) timestamp: DateTime<Utc>,
    pub(crate) open: f64,
    pub(crate) high: f64,
    pub(crate) low: f64,
    pub(crate) close: f64,
    pub(crate) volume: f64,
    /// Full market identifier in CCXT format (e.g., "BTC/USDC:USDC")
    pub(crate) symbol: Market,
    /// Normalized base symbol (e.g., "BTC")
    pub(crate) ticker: Symbol,
}

#[instrument(skip_all, fields(count = candles.len()))]
pub(crate) async fn candles_to_dataframe(candles: Vec<Candle>) -> Result<DataFrame, CandleError> {
    tokio::task::spawn_blocking(move || {
        debug!("converting candles to dataframe");
        // ISO 8601 format to match Python pipeline output
        let timestamps: Vec<String> = candles
            .iter()
            .map(|candle| {
                candle
                    .timestamp
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string()
            })
            .collect();

        let opens: Vec<f64> = candles.iter().map(|candle| candle.open).collect();
        let highs: Vec<f64> = candles.iter().map(|candle| candle.high).collect();
        let lows: Vec<f64> = candles.iter().map(|candle| candle.low).collect();
        let closes: Vec<f64> = candles.iter().map(|candle| candle.close).collect();
        let volumes: Vec<f64> = candles.iter().map(|candle| candle.volume).collect();
        let symbols: Vec<&str> = candles
            .iter()
            .map(|candle| candle.symbol.as_str())
            .collect();
        let tickers: Vec<&str> = candles
            .iter()
            .map(|candle| candle.ticker.as_str())
            .collect();

        Ok(df! {
            "timestamp" => timestamps,
            "open" => opens,
            "high" => highs,
            "low" => lows,
            "close" => closes,
            "volume" => volumes,
            "symbol" => symbols,
            "ticker" => tickers,
        }?)
    })
    .await?
}

#[instrument(skip_all)]
pub(crate) async fn read_candles_json(
    data_dir: &Path,
    timeframe: Timeframe,
) -> Result<Option<Vec<u8>>, CandleError> {
    let path = data_dir.join(timeframe.file_name());
    let Some(mut dataframe) = dataframe::read_csv(path).await? else {
        return Ok(None);
    };

    let mut buffer = Vec::new();
    JsonWriter::new(&mut buffer).finish(&mut dataframe)?;
    Ok(Some(buffer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use proptest::prelude::*;
    use tracing::Level;
    use tracing_test::traced_test;

    use crate::logs_contain_at;

    fn sample_candles() -> Vec<Candle> {
        vec![
            Candle {
                timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
                open: 100.0,
                high: 110.0,
                low: 95.0,
                close: 105.0,
                volume: 1000.0,
                symbol: Market::new("BTC/USDC:USDC".to_string()),
                ticker: Symbol::from_raw("BTC"),
            },
            Candle {
                timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 1, 0, 0).unwrap(),
                open: 105.0,
                high: 115.0,
                low: 100.0,
                close: 110.0,
                volume: 1500.0,
                symbol: Market::new("BTC/USDC:USDC".to_string()),
                ticker: Symbol::from_raw("BTC"),
            },
        ]
    }

    proptest! {
        #[test]
        fn candles_to_dataframe_preserves_count(count in 1_usize..50) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let candles: Vec<Candle> = (0..count)
                    .map(|i| {
                        let offset = i64::try_from(i).unwrap() * 3_600_000;
                        Candle {
                            timestamp: DateTime::from_timestamp_millis(1_700_000_000_000 + offset).unwrap(),
                            open: 100.0,
                            high: 110.0,
                            low: 90.0,
                            close: 105.0,
                            volume: 1000.0,
                            symbol: Market::new("BTC/USDC:USDC".to_string()),
                            ticker: Symbol::from_raw("BTC"),
                        }
                    })
                    .collect();

                let df = candles_to_dataframe(candles).await.unwrap();
                prop_assert_eq!(df.height(), count);
                Ok(())
            })?;
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn candle_to_dataframe_produces_correct_output() {
        let candles = sample_candles();
        let df = candles_to_dataframe(candles).await.unwrap();

        let columns = df.get_column_names();
        assert!(columns.iter().any(|column| column.as_str() == "timestamp"));
        assert!(columns.iter().any(|column| column.as_str() == "open"));
        assert!(columns.iter().any(|column| column.as_str() == "high"));
        assert!(columns.iter().any(|column| column.as_str() == "low"));
        assert!(columns.iter().any(|column| column.as_str() == "close"));
        assert!(columns.iter().any(|column| column.as_str() == "volume"));
        assert!(columns.iter().any(|column| column.as_str() == "symbol"));
        assert!(columns.iter().any(|column| column.as_str() == "ticker"));
        assert_eq!(df.height(), 2);
        assert!(logs_contain_at(
            Level::DEBUG,
            &["converting candles to dataframe"]
        ));
    }
}
