use std::fs::File;
use std::path::Path;

use polars::prelude::{CsvReader, DataFrame, PolarsError, SerReader};
use thiserror::Error;
use tracing::Level;
use tracing_test::traced_test;

use super::beta::{compute_beta_from_log_returns, daily_candles_path};
use super::returns::compute_log_returns;
use super::scores::per_ticker_factors;
use crate::timeframe::TimeframeConfig;

#[derive(Debug, Error)]
enum FixtureTestError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Polars(#[from] PolarsError),
    #[error(transparent)]
    Returns(#[from] super::ReturnsError),
    #[error("fixture factors have no row for ticker {ticker}")]
    MissingTicker { ticker: &'static str },
    #[error("portfolio beta fixture produced no beta")]
    NoPortfolioBeta,
}

/// Portfolio beta for a weighted mix: `Cov(portfolio, BTC) / Var(BTC)`.
///
/// `compute_beta_from_log_returns` builds a per-timestamp portfolio return as the
/// weighted sum of constituent log returns, then measures covariance against BTC.
/// This is what `POST /beta` uses for the active portfolio risk panel.
///
/// With `weights = [("AAVE", 1.0)]` the portfolio is 100% AAVE, so the number
/// should be close to the screener's per-asset `beta` column -- but the code path
/// is different: no `lookback_periods` tail here, all paired timestamps in the
/// fixture are used, and missing-weight handling follows the portfolio report.
#[traced_test]
#[test]
fn aave_fixture_portfolio_beta_to_btc_is_102() -> Result<(), FixtureTestError> {
    let candles = load_fixture_candles()?;
    let log_returns = compute_log_returns(&candles)?;
    let weights = vec![("AAVE".to_string(), 1.0)];

    let portfolio_beta = compute_beta_from_log_returns(&log_returns, &weights, "BTC")?
        .ok_or(FixtureTestError::NoPortfolioBeta)?;

    assert_approx(portfolio_beta, 1.02, 0.005, "AAVE portfolio beta to BTC");
    assert!(crate::logs_contain_at(
        Level::DEBUG,
        &["log returns computed", "rows=740"]
    ));
    assert!(crate::logs_contain_at(
        Level::INFO,
        &["portfolio beta calculated", "beta="]
    ));

    Ok(())
}

/// Per-ticker screener factors from `per_ticker_factors`, including asset beta.
///
/// The `beta` column here comes from `asset_beta_by_ticker`: for each ticker
/// alone, `Cov(asset, BTC) / Var(BTC)` over the trailing `lookback_periods`
/// window. It ranks individual perps in the screener; it is not portfolio beta
/// unless the portfolio happens to be a single 100% weight in that ticker.
#[traced_test]
#[test]
fn aave_fixture_score_factors_match_spreadsheet_values() -> Result<(), FixtureTestError> {
    let candles = load_fixture_candles()?;
    let config = TimeframeConfig {
        lookback_periods: 370,
        annualized_factor: 365.0,
        min_acceptable_return: 0.000_3,
    };

    let factors = per_ticker_factors(&candles, &config)?;
    let aave_row = ticker_row(&factors, "AAVE")?;

    assert_approx(
        factor_value(&factors, aave_row, "mean_return")? * 100.0,
        0.29,
        0.005,
        "AAVE mean log return percent",
    );
    assert_approx(
        factor_value(&factors, aave_row, "annualized_return")? * 100.0,
        191.28,
        0.005,
        "AAVE annualized return percent",
    );
    assert_approx(
        factor_value(&factors, aave_row, "annualized_volatility")? * 100.0,
        97.76,
        0.005,
        "AAVE annualized volatility percent",
    );
    assert_approx(
        factor_value(&factors, aave_row, "sharpe")?,
        1.91,
        0.05,
        "AAVE Sharpe",
    );
    assert_approx(
        factor_value(&factors, aave_row, "sortino")?,
        58.555_595_38,
        0.1,
        "AAVE Sortino",
    );
    assert_approx(
        factor_value(&factors, aave_row, "beta")?,
        1.02,
        0.005,
        "AAVE per-asset beta (screener factor)",
    );
    assert_approx(
        factor_value(&factors, aave_row, "cum_return")?,
        1.947_128_611,
        0.000_001,
        "AAVE cum_return",
    );
    assert_approx(
        factor_value(&factors, aave_row, "information_discreteness")?,
        -0.016_216_216_22,
        0.000_1,
        "AAVE information_discreteness",
    );
    assert_approx(
        factor_value(&factors, aave_row, "sma")?,
        135.411_340_5,
        0.000_1,
        "AAVE sma",
    );
    assert_approx(
        factor_value(&factors, aave_row, "price_zscore")?,
        3.088_959_457,
        0.005,
        "AAVE price_zscore",
    );
    assert!(crate::logs_contain_at(
        Level::DEBUG,
        &["log returns computed", "rows=740"]
    ));

    Ok(())
}

fn load_fixture_candles() -> Result<DataFrame, FixtureTestError> {
    let path = daily_candles_path(Path::new("data_test"));

    Ok(CsvReader::new(File::open(path)?).finish()?)
}

fn ticker_row(frame: &DataFrame, ticker: &'static str) -> Result<usize, FixtureTestError> {
    let tickers = frame.column("ticker")?.str()?;

    (0..frame.height())
        .find(|row_index| tickers.get(*row_index) == Some(ticker))
        .ok_or(FixtureTestError::MissingTicker { ticker })
}

fn factor_value(
    frame: &DataFrame,
    row_index: usize,
    factor_name: &str,
) -> Result<f64, FixtureTestError> {
    let factor_numeric_value = frame
        .column(factor_name)?
        .get(row_index)?
        .try_extract::<f64>()?;

    Ok(factor_numeric_value)
}

fn assert_approx(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() < tolerance,
        "{label} should be {expected}, got {actual}"
    );
}
