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

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::error;

use crate::dataframe::DataFrameError;
use crate::timeframe::Timeframe;
use crate::{AppState, raw_json};

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

/// `GET /factors/<timeframe>` -- serves the per-asset factor scores.
pub(crate) async fn get_factors(
    State(state): State<Arc<AppState>>,
    AxumPath(timeframe): AxumPath<String>,
) -> Result<Response, StatusCode> {
    let timeframe =
        Timeframe::from_interval_string(&timeframe).ok_or(StatusCode::UNPROCESSABLE_ENTITY)?;
    match compute_factors_json(&state.config.data_dir, timeframe).await {
        Ok(json) => Ok(raw_json(json)),
        Err(ReturnsError::NoData { .. }) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            error!(error = %err, "failed to compute factors");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct BetaRequest {
    weights: HashMap<String, f64>,
    benchmark: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct BetaResponse {
    beta: Option<f64>,
    excluded_symbols: Vec<String>,
    effective_weights: BTreeMap<String, f64>,
    data_age_hours: i64,
}

/// `POST /beta` -- portfolio beta against a benchmark.
pub(crate) async fn post_beta(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BetaRequest>,
) -> Result<Json<BetaResponse>, StatusCode> {
    if body.benchmark.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if body.weights.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if body.weights.values().any(|weight| !weight.is_finite()) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let weights: Vec<(String, f64)> = {
        let mut sorted_weights: Vec<_> = body
            .weights
            .iter()
            .map(|(ticker, weight)| (ticker.clone(), *weight))
            .collect();
        sorted_weights
            .sort_unstable_by(|(left_ticker, _), (right_ticker, _)| left_ticker.cmp(right_ticker));
        sorted_weights
    };

    match compute_portfolio_beta_report(&state.config.data_dir, &weights, &body.benchmark).await {
        Ok(report) => Ok(Json(BetaResponse {
            beta: report.beta,
            excluded_symbols: report.excluded_tickers,
            effective_weights: report.effective_weights,
            data_age_hours: report.data_age_hours,
        })),
        Err(err) => {
            error!(error = %err, "beta calculation failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
