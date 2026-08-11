//! Trailing 24h traded notional per asset, a liquidity measure the screener
//! uses as its tie-break.

use polars::prelude::{
    DataFrame, DataFrameJoinOps, IntoLazy, JoinArgs, JoinType, PolarsError, SortMultipleOptions,
    col, lit,
};

/// Joins per-ticker trailing-24h notional volume into `factors`.
///
/// Hyperliquid's candleSnapshot `v` field is denominated in the base asset
/// (the recorded fixtures show BTC hourly volumes of ~200 against $65k closes,
/// and the API docs' example value is 0.98639), so raw sums are not comparable
/// across assets. Each candle's volume is converted to quote notional
/// (`volume * close`) before summing, making `volume_24h` a real cross-asset
/// liquidity measure.
///
/// The window is the dataset's trailing `candles_per_day` distinct timestamps,
/// anchored to the most liquid market's clock rather than each ticker's own
/// last rows: a stale (halted/delisted) ticker has no candles at recent
/// timestamps and gets a null instead of re-counting its old tail, and a thin
/// market contributes only the intervals it actually traded. On timeframes
/// coarser than hourly the window holds a single candle -- on 1w that is the
/// latest weekly candle, a full week's notional, the finest approximation
/// weekly data can express.
pub(super) fn with_volume_24h(
    factors: &DataFrame,
    candles: &DataFrame,
    candles_per_day: usize,
) -> Result<DataFrame, PolarsError> {
    let volume = volume_24h_by_ticker(candles, candles_per_day)?;

    factors.join(
        &volume,
        ["ticker"],
        ["ticker"],
        JoinArgs::new(JoinType::Left),
        None,
    )
}

/// Per-ticker trailing-24h notional volume, as a `DataFrame` keyed by `ticker`.
fn volume_24h_by_ticker(
    candles: &DataFrame,
    candles_per_day: usize,
) -> Result<DataFrame, PolarsError> {
    let window_start = trailing_window_start(candles, candles_per_day)?;

    candles
        .clone()
        .lazy()
        .filter(col("timestamp").gt_eq(lit(window_start)))
        .group_by([col("ticker")])
        .agg([(col("volume") * col("close")).sum().alias("volume_24h")])
        .sort(["ticker"], SortMultipleOptions::default())
        .collect()
}

/// The earliest timestamp inside the trailing window: the dataset's
/// `candles_per_day`-th distinct timestamp from the end (or the very first
/// when the dataset is shorter than a day).
///
/// Anchoring on the dataset rather than each ticker keeps a ticker that
/// stopped trading from counting candles older than the window.
fn trailing_window_start(
    candles: &DataFrame,
    candles_per_day: usize,
) -> Result<String, PolarsError> {
    let mut timestamps: Vec<String> = candles
        .column("timestamp")?
        .str()?
        .iter()
        .flatten()
        .map(str::to_string)
        .collect();
    timestamps.sort_unstable();
    timestamps.dedup();

    let start_index = timestamps.len().saturating_sub(candles_per_day);

    // An empty dataset has no window to bound; the empty-string floor matches
    // every row of the (equally empty) frame.
    Ok(timestamps.into_iter().nth(start_index).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;

    fn candles() -> DataFrame {
        // Timestamps 0..2; ETH stopped trading after timestamp 1 and SOL only
        // traded the latest interval.
        df! {
            "timestamp" => &["0", "1", "2", "0", "1", "2"],
            "ticker" => &["BTC", "BTC", "BTC", "ETH", "ETH", "SOL"],
            "close" => &[100.0, 110.0, 120.0, 10.0, 11.0, 3.0_f64],
            "volume" => &[10.0, 20.0, 30.0, 5.0, 7.0, 1000.0_f64],
        }
        .unwrap()
    }

    #[test]
    fn volume_24h_sums_notional_over_the_trailing_window() {
        // Window = last two dataset timestamps ("1", "2"): BTC sums
        // 20*110 + 30*120 = 5800; base units alone would rank SOL's 1000
        // contracts above BTC's 50.
        let out = volume_24h_by_ticker(&candles(), 2).unwrap();
        let tickers = out.column("ticker").unwrap().str().unwrap();
        let volume = out.column("volume_24h").unwrap().f64().unwrap();
        let notional_for = |ticker: &str| {
            let index = tickers
                .iter()
                .position(|value| value == Some(ticker))
                .expect("ticker present");

            volume.get(index)
        };

        assert!((notional_for("BTC").unwrap() - 5800.0).abs() < 1e-12);
        assert!((notional_for("ETH").unwrap() - 77.0).abs() < 1e-12);
        assert!(
            (notional_for("SOL").unwrap() - 3000.0).abs() < 1e-12,
            "1000 contracts at $3 is $3000 of liquidity, far below BTC's $5800"
        );
    }

    #[test]
    fn volume_24h_excludes_a_stale_ticker_from_the_window() {
        // Window = the latest dataset timestamp only. ETH's last candle is at
        // timestamp 1, so it must not re-count its old tail: no rows survive
        // the window filter and the join below yields null, not stale volume.
        let out = volume_24h_by_ticker(&candles(), 1).unwrap();
        let tickers = out.column("ticker").unwrap().str().unwrap();

        assert!(
            tickers.iter().all(|ticker| ticker != Some("ETH")),
            "a ticker with no candles inside the window has no volume row"
        );
    }

    #[test]
    fn with_volume_24h_joins_onto_factors_and_keeps_unmatched_tickers() {
        let factors = df! {
            "ticker" => &["BTC", "ETH", "SOL"],
            "sma" => &[1.0, 2.0, 3.0_f64],
        }
        .unwrap();

        let out = with_volume_24h(&factors, &candles(), 1).unwrap();
        assert_eq!(out.height(), 3, "the left join keeps every factors row");

        let tickers = out.column("ticker").unwrap().str().unwrap();
        let volume = out.column("volume_24h").unwrap().f64().unwrap();
        let notional_for = |ticker: &str| {
            let index = tickers
                .iter()
                .position(|value| value == Some(ticker))
                .expect("ticker present");

            volume.get(index)
        };

        assert!((notional_for("BTC").unwrap() - 3600.0).abs() < 1e-12);
        assert!(
            notional_for("ETH").is_none(),
            "a stale ticker's volume is null, not its old tail"
        );
        assert!((notional_for("SOL").unwrap() - 3000.0).abs() < 1e-12);
    }

    #[test]
    fn volume_24h_uses_all_candles_when_the_dataset_is_shorter_than_a_day() {
        let out = volume_24h_by_ticker(&candles(), 100).unwrap();
        let tickers = out.column("ticker").unwrap().str().unwrap();
        let volume = out.column("volume_24h").unwrap().f64().unwrap();
        let btc_index = tickers
            .iter()
            .position(|value| value == Some("BTC"))
            .expect("ticker present");

        assert!(
            (volume.get(btc_index).unwrap() - (1000.0 + 2200.0 + 3600.0)).abs() < 1e-12,
            "a window wider than the dataset sums every candle's notional"
        );
    }
}
