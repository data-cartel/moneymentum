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

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::Response;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error};

use crate::dataframe::DataFrameError;
use crate::readonly_portfolio::{
    BetaInclusion, BtcAddress, ExposurePosition, ExposureSource, HyperliquidPositionInput,
    PortfolioExposureRequest, ReadonlyBtcBalancesRequest, ReadonlyBtcBalancesResponse,
    ReadonlyBtcEntryRequest, ReadonlyPortfolioError, Side, build_portfolio_exposure,
    default_blockchain_info_base_url, default_btc_base_url, fetch_ubtc_price_usd,
    load_readonly_btc_balances,
};
use crate::timeframe::Timeframe;
use crate::{ApiError, AppState, api_error, raw_json};

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
#[serde(untagged)]
pub(crate) enum BetaRequest {
    Portfolio(PortfolioBetaRequest),
    Weights(WeightedBetaRequest),
}

#[derive(Debug, Deserialize)]
pub(crate) struct WeightedBetaRequest {
    weights: HashMap<String, f64>,
    benchmark: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortfolioBetaRequest {
    positions: Vec<BetaPositionRequest>,
    read_only_btc: Vec<BetaReadonlyBtcRequest>,
    benchmark: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BetaPositionRequest {
    symbol: String,
    side: Side,
    notional_usd: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BetaReadonlyBtcRequest {
    address: BtcAddress,
    include_in_beta: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum PortfolioBetaRequestError {
    #[error("portfolio beta requires at least one included positive notional")]
    EmptyExposure,
    #[error("invalid portfolio beta notional for {symbol}")]
    InvalidNotional { symbol: String },
    #[error("portfolio beta request contains a duplicate readonly btc address")]
    DuplicateReadonlyBtcAddress,
    #[error("portfolio beta position symbol must not be blank")]
    InvalidSymbol,
    #[error("portfolio beta notional overflow")]
    NotionalOverflow,
    #[error("portfolio beta weight is not representable for {symbol}")]
    UnrepresentableWeight { symbol: String },
}

#[derive(Debug, Clone, Copy)]
enum PortfolioBetaRejectionReason {
    DuplicateAddress,
    EmptyExposure,
    InvalidNotional,
    InvalidSymbol,
    NotionalOverflow,
    UnrepresentableWeight,
}

#[derive(Debug, Clone, Copy)]
enum BetaDataFailureStage {
    Balance,
    Price,
}

fn validate_portfolio_beta_request(
    request: &PortfolioBetaRequest,
) -> Result<(), PortfolioBetaRequestError> {
    let unique_addresses = request
        .read_only_btc
        .iter()
        .map(|entry| &entry.address)
        .collect::<HashSet<_>>();
    if unique_addresses.len() != request.read_only_btc.len() {
        log_beta_request_rejection(PortfolioBetaRejectionReason::DuplicateAddress);
        return Err(PortfolioBetaRequestError::DuplicateReadonlyBtcAddress);
    }

    if let Some(position) = request
        .positions
        .iter()
        .find(|position| position.notional_usd < Decimal::ZERO)
    {
        log_beta_request_rejection(PortfolioBetaRejectionReason::InvalidNotional);
        return Err(PortfolioBetaRequestError::InvalidNotional {
            symbol: position.symbol.clone(),
        });
    }

    if request
        .positions
        .iter()
        .try_fold(Decimal::ZERO, |total_notional, position| {
            total_notional.checked_add(position.notional_usd)
        })
        .is_none()
    {
        log_beta_request_rejection(PortfolioBetaRejectionReason::NotionalOverflow);
        return Err(PortfolioBetaRequestError::NotionalOverflow);
    }

    if request.positions.iter().any(|position| {
        position
            .symbol
            .split_once('/')
            .map_or(position.symbol.as_str(), |(base_ticker, _)| base_ticker)
            .trim()
            .is_empty()
    }) {
        log_beta_request_rejection(PortfolioBetaRejectionReason::InvalidSymbol);
        return Err(PortfolioBetaRequestError::InvalidSymbol);
    }

    Ok(())
}

struct BetaWeightAccumulator {
    total_notional: Decimal,
    signed_notionals: BTreeMap<String, Decimal>,
    exchange_positions: usize,
    readonly_positions: usize,
}

impl BetaWeightAccumulator {
    fn new() -> Self {
        Self {
            total_notional: Decimal::ZERO,
            signed_notionals: BTreeMap::new(),
            exchange_positions: 0,
            readonly_positions: 0,
        }
    }

    fn include(mut self, position: &ExposurePosition) -> Result<Self, PortfolioBetaRequestError> {
        if position.notional_usd < Decimal::ZERO {
            log_beta_rejection(PortfolioBetaRejectionReason::InvalidNotional);
            return Err(PortfolioBetaRequestError::InvalidNotional {
                symbol: position.symbol.clone(),
            });
        }
        if position.notional_usd == Decimal::ZERO {
            return Ok(self);
        }

        let ticker = position
            .symbol
            .split_once('/')
            .map_or(position.symbol.as_str(), |(base_ticker, _)| base_ticker)
            .trim();
        if ticker.is_empty() {
            log_beta_rejection(PortfolioBetaRejectionReason::InvalidNotional);
            return Err(PortfolioBetaRequestError::InvalidNotional {
                symbol: position.symbol.clone(),
            });
        }

        self.total_notional = self
            .total_notional
            .checked_add(position.notional_usd)
            .ok_or_else(notional_overflow)?;
        let signed_notional = match position.side {
            Side::Buy => position.notional_usd,
            Side::Sell => -position.notional_usd,
        };
        let next_signed_notional = match self.signed_notionals.get(ticker) {
            Some(current_notional) => current_notional
                .checked_add(signed_notional)
                .ok_or_else(notional_overflow)?,
            None => signed_notional,
        };
        self.signed_notionals
            .insert(ticker.to_string(), next_signed_notional);

        match position.source {
            ExposureSource::Hyperliquid => self.exchange_positions += 1,
            ExposureSource::BtcAddress => self.readonly_positions += 1,
        }

        Ok(self)
    }

    fn into_weights(self) -> Result<Vec<(String, f64)>, PortfolioBetaRequestError> {
        if self.total_notional == Decimal::ZERO {
            log_beta_rejection(PortfolioBetaRejectionReason::EmptyExposure);
            return Err(PortfolioBetaRequestError::EmptyExposure);
        }

        let weights = self
            .signed_notionals
            .into_iter()
            .map(|(symbol, signed_notional)| {
                signed_notional
                    .checked_div(self.total_notional)
                    .and_then(|weight| weight.to_f64())
                    .filter(|weight| weight.is_finite())
                    .map(|weight| (symbol.clone(), weight))
                    .ok_or_else(|| {
                        log_beta_rejection(PortfolioBetaRejectionReason::UnrepresentableWeight);
                        PortfolioBetaRequestError::UnrepresentableWeight { symbol }
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;

        debug!(
            exchange_positions = self.exchange_positions,
            readonly_positions = self.readonly_positions,
            symbols = weights.len(),
            "portfolio beta weights derived"
        );

        Ok(weights)
    }
}

fn beta_weights_from_exposure(
    positions: &[ExposurePosition],
) -> Result<Vec<(String, f64)>, PortfolioBetaRequestError> {
    positions
        .iter()
        .filter(|position| position.include_in_beta == BetaInclusion::Included)
        .try_fold(BetaWeightAccumulator::new(), BetaWeightAccumulator::include)?
        .into_weights()
}

fn notional_overflow() -> PortfolioBetaRequestError {
    log_beta_rejection(PortfolioBetaRejectionReason::NotionalOverflow);
    PortfolioBetaRequestError::NotionalOverflow
}

fn log_beta_rejection(reason: PortfolioBetaRejectionReason) {
    debug!(reason = ?reason, "portfolio beta exposure rejected");
}

fn log_beta_request_rejection(reason: PortfolioBetaRejectionReason) {
    debug!(reason = ?reason, "portfolio beta request rejected");
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
) -> Result<Json<BetaResponse>, ApiError> {
    let (weights, benchmark) = match body {
        BetaRequest::Weights(request) => {
            let weights = validate_weighted_beta_request(&request)?;
            (weights, request.benchmark)
        }
        BetaRequest::Portfolio(request) => {
            validate_portfolio_beta_request(&request)
                .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))?;
            let benchmark = request.benchmark.trim().to_string();
            if benchmark.is_empty() {
                return Err(api_error(
                    StatusCode::BAD_REQUEST,
                    "beta benchmark must not be blank",
                ));
            }

            let exposure_request = PortfolioExposureRequest {
                hyperliquid_positions: request
                    .positions
                    .into_iter()
                    .map(|position| HyperliquidPositionInput {
                        symbol: position.symbol,
                        side: position.side,
                        notional_usd: position.notional_usd,
                    })
                    .collect(),
                readonly_btc_entries: request
                    .read_only_btc
                    .into_iter()
                    .filter(|entry| entry.include_in_beta)
                    .map(|entry| ReadonlyBtcEntryRequest {
                        address: entry.address,
                        include_in_beta: BetaInclusion::Included,
                    })
                    .collect(),
            };
            let exposure = load_beta_exposure(&state, &exposure_request).await?;
            let weights = beta_weights_from_exposure(&exposure.positions)
                .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))?;
            (weights, benchmark)
        }
    };

    match compute_portfolio_beta_report(&state.config.data_dir, &weights, &benchmark).await {
        Ok(report) => Ok(Json(BetaResponse {
            beta: report.beta,
            excluded_symbols: report.excluded_tickers,
            effective_weights: report.effective_weights,
            data_age_hours: report.data_age_hours,
        })),
        Err(err) => {
            error!(error = %err, "beta calculation failed");
            Err(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "beta calculation failed",
            ))
        }
    }
}

fn validate_weighted_beta_request(
    request: &WeightedBetaRequest,
) -> Result<Vec<(String, f64)>, ApiError> {
    if request.benchmark.trim().is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "beta benchmark must not be blank",
        ));
    }
    if request.weights.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "beta weights must not be empty",
        ));
    }
    if request.weights.values().any(|weight| !weight.is_finite()) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "beta weights must be finite",
        ));
    }

    Ok(request
        .weights
        .iter()
        .map(|(ticker, weight)| (ticker.clone(), *weight))
        .collect::<BTreeMap<String, f64>>()
        .into_iter()
        .collect())
}

async fn load_beta_exposure(
    state: &AppState,
    request: &PortfolioExposureRequest,
) -> Result<crate::readonly_portfolio::PortfolioExposureResponse, ApiError> {
    if request.readonly_btc_entries.is_empty() {
        return build_portfolio_exposure(
            request,
            ReadonlyBtcBalancesResponse {
                holdings: Vec::new(),
                total_confirmed_btc: Decimal::ZERO,
            },
            Decimal::ZERO,
        )
        .map_err(|error| beta_exposure_validation_error(&error));
    }

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| {
            error!(error = %error, "beta http client creation failed");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "beta http client creation failed",
            )
        })?;
    let btc_base_url = default_btc_base_url().map_err(|error| beta_internal_url_error(&error))?;
    let blockchain_info_base_url =
        default_blockchain_info_base_url().map_err(|error| beta_internal_url_error(&error))?;
    let balance_request = ReadonlyBtcBalancesRequest {
        addresses: request
            .readonly_btc_entries
            .iter()
            .map(|entry| entry.address.clone())
            .collect(),
    };
    let readonly_balances = load_readonly_btc_balances(
        &http_client,
        &btc_base_url,
        &blockchain_info_base_url,
        &balance_request,
    )
    .await
    .map_err(|error| beta_balance_error(&error))?;
    let ubtc_price_usd =
        fetch_ubtc_price_usd(&http_client, state.config.hyperliquid_base_url.as_ref())
            .await
            .map_err(|_| beta_data_unavailable(BetaDataFailureStage::Price))?;

    build_portfolio_exposure(request, readonly_balances, ubtc_price_usd)
        .map_err(|error| beta_exposure_validation_error(&error))
}

fn beta_balance_error(error: &ReadonlyPortfolioError) -> ApiError {
    match error {
        ReadonlyPortfolioError::InvalidBtcAddress(_)
        | ReadonlyPortfolioError::EmptyAddressList
        | ReadonlyPortfolioError::AddressListTooLong
        | ReadonlyPortfolioError::DuplicateBtcAddress => beta_exposure_validation_error(error),
        _ => beta_data_unavailable(BetaDataFailureStage::Balance),
    }
}

fn beta_exposure_validation_error(error: &ReadonlyPortfolioError) -> ApiError {
    let status = match error {
        ReadonlyPortfolioError::InvalidBtcAddress(_)
        | ReadonlyPortfolioError::EmptyAddressList
        | ReadonlyPortfolioError::AddressListTooLong
        | ReadonlyPortfolioError::DuplicateBtcAddress
        | ReadonlyPortfolioError::InvalidNotional { .. } => StatusCode::BAD_REQUEST,
        ReadonlyPortfolioError::ExposureNotionalOverflow => {
            log_beta_rejection(PortfolioBetaRejectionReason::NotionalOverflow);
            StatusCode::BAD_REQUEST
        }
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    api_error(status, error.to_string())
}

fn beta_internal_url_error(error: &ReadonlyPortfolioError) -> ApiError {
    error!(error = %error, "beta upstream url resolution failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "beta upstream url resolution failed",
    )
}

fn beta_data_unavailable(stage: BetaDataFailureStage) -> ApiError {
    let error_code = match stage {
        BetaDataFailureStage::Balance => "missing_bitcoin_balance",
        BetaDataFailureStage::Price => "btc_price_unavailable",
    };
    tracing::warn!(
        failure_stage = ?stage,
        "portfolio beta data unavailable"
    );
    api_error(StatusCode::SERVICE_UNAVAILABLE, error_code)
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;
    use tracing::Level;
    use tracing_test::traced_test;

    use super::*;
    use crate::logs_contain_at;
    use crate::readonly_portfolio::{BetaInclusion, ExposureSource, Tradability};

    fn exposure_position(
        source: ExposureSource,
        symbol: &str,
        side: Side,
        notional_usd: Decimal,
        include_in_beta: BetaInclusion,
    ) -> ExposurePosition {
        ExposurePosition {
            source,
            source_id: None,
            symbol: symbol.to_string(),
            side,
            notional_usd,
            quantity_btc: None,
            tradability: match source {
                ExposureSource::Hyperliquid => Tradability::Tradable,
                ExposureSource::BtcAddress => Tradability::ReadOnly,
            },
            include_in_beta,
        }
    }

    #[test]
    fn portfolio_beta_request_deserializes_separate_sources_with_exact_notionals() {
        let request: PortfolioBetaRequest = serde_json::from_value(serde_json::json!({
            "positions": [{
                "symbol": "ETH/USDC:USDC",
                "side": "buy",
                "notionalUsd": "100.25"
            }],
            "readOnlyBtc": [{
                "address": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
                "includeInBeta": true
            }],
            "benchmark": "BTC"
        }))
        .unwrap();

        assert_eq!(request.positions.len(), 1);
        assert_eq!(request.positions[0].symbol, "ETH/USDC:USDC");
        assert_eq!(request.positions[0].side, Side::Buy);
        assert_eq!(request.positions[0].notional_usd, dec!(100.25));
        assert_eq!(request.read_only_btc.len(), 1);
        assert_eq!(request.benchmark, "BTC");
    }

    #[traced_test]
    #[test]
    fn portfolio_beta_request_rejects_duplicate_addresses_before_filtering() {
        let request: PortfolioBetaRequest = serde_json::from_value(serde_json::json!({
            "positions": [],
            "readOnlyBtc": [
                {
                    "address": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
                    "includeInBeta": true
                },
                {
                    "address": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
                    "includeInBeta": false
                }
            ],
            "benchmark": "BTC"
        }))
        .unwrap();

        let result = validate_portfolio_beta_request(&request);

        assert_eq!(
            result,
            Err(PortfolioBetaRequestError::DuplicateReadonlyBtcAddress)
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["portfolio beta request rejected", "reason=DuplicateAddress",]
        ));
    }

    #[traced_test]
    #[test]
    fn portfolio_beta_request_rejects_negative_notional_before_fetching_balances() {
        let request: PortfolioBetaRequest = serde_json::from_value(serde_json::json!({
            "positions": [{
                "symbol": "ETH",
                "side": "buy",
                "notionalUsd": "-1"
            }],
            "readOnlyBtc": [{
                "address": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
                "includeInBeta": true
            }],
            "benchmark": "BTC"
        }))
        .unwrap();

        let result = validate_portfolio_beta_request(&request);

        assert_eq!(
            result,
            Err(PortfolioBetaRequestError::InvalidNotional {
                symbol: "ETH".to_string(),
            })
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["portfolio beta request rejected", "reason=InvalidNotional",]
        ));
    }

    #[traced_test]
    #[test]
    fn portfolio_beta_request_rejects_aggregate_notional_overflow_before_fetching_balances() {
        let max_notional = Decimal::MAX.to_string();
        let request: PortfolioBetaRequest = serde_json::from_value(serde_json::json!({
            "positions": [
                {
                    "symbol": "BTC",
                    "side": "buy",
                    "notionalUsd": max_notional
                },
                {
                    "symbol": "ETH",
                    "side": "buy",
                    "notionalUsd": max_notional
                }
            ],
            "readOnlyBtc": [{
                "address": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
                "includeInBeta": true
            }],
            "benchmark": "BTC"
        }))
        .unwrap();

        let result = validate_portfolio_beta_request(&request);

        assert_eq!(result, Err(PortfolioBetaRequestError::NotionalOverflow));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["portfolio beta request rejected", "reason=NotionalOverflow",]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_weights_include_readonly_btc_and_preserve_long_short_signs() {
        let positions = vec![
            exposure_position(
                ExposureSource::Hyperliquid,
                "ETH/USDC:USDC",
                Side::Buy,
                dec!(100),
                BetaInclusion::Included,
            ),
            exposure_position(
                ExposureSource::Hyperliquid,
                "SOL/USDC:USDC",
                Side::Sell,
                dec!(50),
                BetaInclusion::Included,
            ),
            exposure_position(
                ExposureSource::BtcAddress,
                "BTC",
                Side::Buy,
                dec!(100),
                BetaInclusion::Included,
            ),
        ];

        let weights = beta_weights_from_exposure(&positions).unwrap();

        assert_eq!(
            weights,
            vec![
                ("BTC".to_string(), 0.4),
                ("ETH".to_string(), 0.4),
                ("SOL".to_string(), -0.2),
            ]
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &[
                "portfolio beta weights derived",
                "exchange_positions=2",
                "readonly_positions=1",
            ]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_weights_reject_negative_notionals_before_calculation() {
        let positions = vec![exposure_position(
            ExposureSource::Hyperliquid,
            "ETH",
            Side::Buy,
            dec!(-1),
            BetaInclusion::Included,
        )];

        let result = beta_weights_from_exposure(&positions);

        assert_eq!(
            result,
            Err(PortfolioBetaRequestError::InvalidNotional {
                symbol: "ETH".to_string(),
            })
        );
        assert!(logs_contain_at(
            Level::DEBUG,
            &["portfolio beta exposure rejected", "reason=InvalidNotional",]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_balance_failure_returns_a_distinct_degraded_code() {
        let error = beta_data_unavailable(BetaDataFailureStage::Balance);

        assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            serde_json::to_value(error.1.0).unwrap()["error"],
            "missing_bitcoin_balance"
        );
        assert!(logs_contain_at(
            Level::WARN,
            &["portfolio beta data unavailable", "failure_stage=Balance",]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_price_failure_returns_a_distinct_degraded_code() {
        let error = beta_data_unavailable(BetaDataFailureStage::Price);

        assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            serde_json::to_value(error.1.0).unwrap()["error"],
            "btc_price_unavailable"
        );
        assert!(logs_contain_at(
            Level::WARN,
            &["portfolio beta data unavailable", "failure_stage=Price",]
        ));
    }

    #[traced_test]
    #[test]
    fn beta_weights_exclude_opted_out_and_zero_readonly_holdings() {
        let positions = vec![
            exposure_position(
                ExposureSource::Hyperliquid,
                "ETH",
                Side::Buy,
                dec!(100),
                BetaInclusion::Included,
            ),
            exposure_position(
                ExposureSource::BtcAddress,
                "BTC",
                Side::Buy,
                Decimal::ZERO,
                BetaInclusion::Included,
            ),
            exposure_position(
                ExposureSource::BtcAddress,
                "BTC",
                Side::Buy,
                dec!(900),
                BetaInclusion::Excluded,
            ),
        ];

        let weights = beta_weights_from_exposure(&positions).unwrap();

        assert_eq!(weights, vec![("ETH".to_string(), 1.0)]);
        assert!(logs_contain_at(
            Level::DEBUG,
            &[
                "portfolio beta weights derived",
                "exchange_positions=1",
                "readonly_positions=0",
            ]
        ));
    }
}
