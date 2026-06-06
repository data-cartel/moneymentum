//! Factor engine: per-asset factor math over ingested OHLCV/funding data.
//!
//! All factor math is `f64`: these are statistical quantities (log returns,
//! volatility, correlation, Sharpe, beta) computed with `ln`/`exp`/`sqrt`, which
//! `rust_decimal` cannot express and which polars operates on as `f64`. Exact
//! decimal/integer types are reserved for monetary values (e.g. funding rates,
//! held as `rust_decimal`), never for statistics -- see `funding.rs` for the
//! exact-typed side.
//!
//! Organized by concern:
//! - [`returns`]: the per-ticker log-return primitive shared by the others.
//! - [`beta`]: portfolio beta (`Cov(portfolio, benchmark) / Var(benchmark)`),
//!   served by `POST /beta`.
//! - [`scores`]: per-ticker factor scores (volatility, cumulative return, SMA,
//!   mean return, price z-score), served by `GET /factors`.
//! - [`autocorrelation`]: lag-1 autocorrelation of returns, joined into the
//!   scores.
//! - [`carry`]: latest signed funding rate, joined into the scores.
//! - [`asset_beta`]: per-asset beta to the benchmark, joined into the scores.
//! - [`volume`]: trailing 24h volume, joined into the scores.

mod asset_beta;
mod autocorrelation;
mod beta;
mod carry;
mod returns;
mod scores;
mod volume;

#[cfg(test)]
mod fixture_tests;

pub(crate) use beta::compute_portfolio_beta_report;
pub(crate) use scores::{compute_factors, compute_factors_json};

use thiserror::Error;

use crate::dataframe::DataFrameError;

/// Errors from loading candles and computing returns-derived factors.
#[derive(Debug, Error)]
pub(crate) enum ReturnsError {
    #[error(transparent)]
    DataFrame(#[from] DataFrameError),
    #[error(transparent)]
    Polars(#[from] polars::prelude::PolarsError),
    #[error(transparent)]
    Join(#[from] tokio::task::JoinError),
    #[error("no candle data at {path}")]
    NoData { path: std::path::PathBuf },
    #[error("daily candle data has no timestamps")]
    NoTimestamps,
    #[error("invalid candle timestamp: {timestamp}")]
    InvalidTimestamp { timestamp: String },
    #[error("future candle timestamp: {timestamp}")]
    FutureTimestamp { timestamp: String },
    #[error("benchmark variance is zero or insufficient data for beta")]
    BetaUndefined,
}
