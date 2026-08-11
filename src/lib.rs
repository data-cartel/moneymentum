mod candle;
mod dataframe;
mod factors;
mod finance;
mod funding;
mod hyperliquid;
mod ingestion;
mod market_catalog;
mod market_enablement;
mod market_metadata;
mod portfolio;
mod readonly_portfolio;
mod screener;
mod timeframe;
mod venue;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::AtomicU32;

use apalis::prelude::{Monitor, WorkerBuilder};
use axum::Json;
use axum::Router;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use event_sorcery::{
    AggregateError, CircuitBreakerConfig, FAIL_STOP_RECOVERY_TIMEOUT, JobBackend, LifecycleError,
    Monitor as EventSorceryMonitor, Projection, SendError, Store, StoreBuilder,
    build_supervised_worker,
};
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use serde::Deserialize;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use thiserror::Error;
use tracing::{debug, error};
use tracing_subscriber::EnvFilter;

use crate::hyperliquid::{Hyperliquid, HyperliquidClients, HyperliquidNetwork};
use finance::Symbol;
use ingestion::{
    IngestionJob, IngestionJobContext, IngestionRun, IngestionRunStatus, IngestionServices,
    IngestionWork, default_ingestion_schedules, trigger_scheduled_ingestion,
};
use market_catalog::MarketCatalog;
use market_enablement::{
    MarketEnablement, MarketEnablementCommand, MarketEnablementError, MarketId,
};
use portfolio::{
    BaseCurrency, Portfolio, PortfolioCommand, PortfolioError, PortfolioId, PortfolioName,
    PortfolioStatus, PortfolioView, STATUS, TargetRevision,
};
use timeframe::Timeframe;
use venue::VenueRef;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Config {
    port: u16,
    data_dir: PathBuf,
    database_url: String,
    hyperliquid_base_url: Option<url::Url>,
    hyperliquid_testnet_base_url: Option<url::Url>,
    log_level: LogLevel,
    max_concurrent_requests: usize,
    max_retries: usize,
    pub derive: Option<derive::DeriveConfig>,
}

impl Config {
    /// Load configuration from a TOML file on disk.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Io`] if the file cannot be read or
    /// [`ConfigError::Toml`] if the contents are not valid TOML.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let content = std::fs::read_to_string(path.as_ref())?;
        Ok(toml::from_str(&content)?)
    }

    /// The TCP port the HTTP server should bind to.
    pub fn port(&self) -> u16 {
        self.port
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Toml(#[from] toml::de::Error),
    #[error("the [derive] config section is required to run the derive server")]
    MissingDeriveConfig,
}

pub(crate) struct AppState {
    config: Config,
    database_pool: SqlitePool,
    hyperliquid_clients: HyperliquidClients,
    portfolio_store: Arc<Store<Portfolio>>,
    portfolio_projection: Arc<Projection<Portfolio>>,
    market_enablement: Arc<Store<MarketEnablement>>,
    market_enablement_projection: Arc<Projection<MarketEnablement>>,
    market_catalog_projection: Arc<Projection<MarketCatalog>>,
}

/// Renders pre-serialized JSON bytes with the `application/json` content type.
fn raw_json(bytes: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], bytes).into_response()
}

#[derive(Debug, serde::Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

async fn health() -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(HealthResponse {
            status: "ok",
            version: env!("CARGO_PKG_VERSION"),
        }),
    )
}

async fn get_candles(
    State(state): State<Arc<AppState>>,
    AxumPath(timeframe): AxumPath<String>,
) -> Result<Response, StatusCode> {
    let timeframe =
        Timeframe::from_interval_string(&timeframe).ok_or(StatusCode::UNPROCESSABLE_ENTITY)?;
    candle::read_candles_json(&state.config.data_dir, timeframe)
        .await
        .map_err(|err| {
            error!(error = %err, "failed to read candles");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .map(raw_json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn get_factors(
    State(state): State<Arc<AppState>>,
    AxumPath(timeframe): AxumPath<String>,
) -> Result<Response, StatusCode> {
    let timeframe =
        Timeframe::from_interval_string(&timeframe).ok_or(StatusCode::UNPROCESSABLE_ENTITY)?;
    match factors::compute_factors_json(&state.config.data_dir, timeframe).await {
        Ok(json) => Ok(raw_json(json)),
        Err(factors::ReturnsError::NoData { .. }) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            error!(error = %err, "failed to compute factors");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn post_screener(
    State(state): State<Arc<AppState>>,
    AxumPath(timeframe): AxumPath<String>,
    Json(body): Json<screener::ScreenerRequest>,
) -> Result<Response, StatusCode> {
    let timeframe =
        Timeframe::from_interval_string(&timeframe).ok_or(StatusCode::UNPROCESSABLE_ENTITY)?;
    match screener::screen(&state.config.data_dir, timeframe, &body).await {
        Ok(json) => Ok(raw_json(json)),
        Err(screener::ScreenerError::Factors(factors::ReturnsError::NoData { .. })) => {
            Err(StatusCode::NOT_FOUND)
        }
        Err(err) => {
            error!(error = %err, "failed to screen perps");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_ingestion_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Option<IngestionRunStatus>>, StatusCode> {
    let status = ingestion::latest_status(&state.database_pool)
        .await
        .map_err(|err| {
            error!(error = %err, "failed to load ingestion status");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(status))
}

#[derive(Debug, Deserialize)]
struct BetaRequest {
    weights: std::collections::HashMap<String, f64>,
    benchmark: String,
}

#[derive(Debug, serde::Serialize)]
struct BetaResponse {
    beta: Option<f64>,
    excluded_symbols: Vec<String>,
    effective_weights: std::collections::BTreeMap<String, f64>,
    data_age_hours: i64,
}

#[derive(Debug, serde::Serialize)]
struct ApiErrorResponse {
    error: String,
}

type ApiError = (StatusCode, Json<ApiErrorResponse>);

fn api_error(status: StatusCode, message: impl Into<String>) -> ApiError {
    (
        status,
        Json(ApiErrorResponse {
            error: message.into(),
        }),
    )
}

async fn post_portfolio_readonly_btc(
    Json(body): Json<readonly_portfolio::ReadonlyBtcBalancesRequest>,
) -> Result<Json<readonly_portfolio::ReadonlyBtcBalancesResponse>, ApiError> {
    let http_client = reqwest::Client::new();
    let btc_base_url = readonly_portfolio::default_btc_base_url().map_err(|err| {
        error!(error = %err, "failed to resolve btc explorer base url");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to resolve btc explorer base url",
        )
    })?;
    let blockchain_info_base_url =
        readonly_portfolio::default_blockchain_info_base_url().map_err(|err| {
            error!(error = %err, "failed to resolve blockchain.info base url");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to resolve blockchain.info base url",
            )
        })?;

    readonly_portfolio::load_readonly_btc_balances(
        &http_client,
        &btc_base_url,
        &blockchain_info_base_url,
        &body,
    )
    .await
    .map(Json)
    .map_err(|err| {
        error!(error = %err, "failed to load readonly btc balances");
        let status = match err {
            readonly_portfolio::ReadonlyPortfolioError::InvalidBtcAddress(_)
            | readonly_portfolio::ReadonlyPortfolioError::EmptyAddressList => {
                StatusCode::BAD_REQUEST
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        api_error(status, err.to_string())
    })
}

async fn post_portfolio_exposure(
    State(state): State<Arc<AppState>>,
    Json(body): Json<readonly_portfolio::PortfolioExposureRequest>,
) -> Result<Json<readonly_portfolio::PortfolioExposureResponse>, ApiError> {
    let http_client = reqwest::Client::new();
    let btc_base_url = readonly_portfolio::default_btc_base_url().map_err(|err| {
        error!(error = %err, "failed to resolve btc explorer base url");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to resolve btc explorer base url",
        )
    })?;
    let blockchain_info_base_url =
        readonly_portfolio::default_blockchain_info_base_url().map_err(|err| {
            error!(error = %err, "failed to resolve blockchain.info base url");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to resolve blockchain.info base url",
            )
        })?;

    readonly_portfolio::load_portfolio_exposure(
        &http_client,
        &btc_base_url,
        &blockchain_info_base_url,
        state.config.hyperliquid_base_url.as_ref(),
        &body,
    )
    .await
    .map(Json)
    .map_err(|err| {
        error!(error = %err, "failed to load portfolio exposure");
        let status = match err {
            readonly_portfolio::ReadonlyPortfolioError::InvalidBtcAddress(_)
            | readonly_portfolio::ReadonlyPortfolioError::EmptyAddressList
            | readonly_portfolio::ReadonlyPortfolioError::InvalidNotional { .. } => {
                StatusCode::BAD_REQUEST
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        api_error(status, err.to_string())
    })
}

async fn post_beta(
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

    match factors::compute_portfolio_beta_report(&state.config.data_dir, &weights, &body.benchmark)
        .await
    {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePortfolioRequest {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamePortfolioRequest {
    name: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PortfolioCreatedResponse {
    id: PortfolioId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviseTargetRequest {
    weights: HashMap<String, f64>,
    leverage: f64,
}

/// Opens a new portfolio under a freshly minted id.
async fn post_portfolio_create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreatePortfolioRequest>,
) -> Result<(StatusCode, Json<PortfolioCreatedResponse>), ApiError> {
    let name = PortfolioName::new(&body.name).map_err(|err| bad_request(&err.to_string()))?;
    let id = PortfolioId::generate();

    state
        .portfolio_store
        .send(
            &id,
            PortfolioCommand::Open {
                name,
                base_currency: BaseCurrency::Usdc,
            },
        )
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to open portfolio"))?;

    debug!(portfolio_id = %id, "portfolio opened");
    Ok((StatusCode::CREATED, Json(PortfolioCreatedResponse { id })))
}

/// Replaces a portfolio's target with a new revision of perp weights + leverage.
async fn post_portfolio_target(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<ReviseTargetRequest>,
) -> Result<StatusCode, ApiError> {
    let portfolio_id =
        PortfolioId::from_str(&id).map_err(|_| bad_request("portfolio id is not a valid uuid"))?;

    let mut weights = Vec::with_capacity(body.weights.len());
    for (symbol, weight) in &body.weights {
        let weight =
            finite_decimal(*weight).ok_or_else(|| bad_request("weights must be finite"))?;
        weights.push((Symbol::from_raw(symbol), weight));
    }
    let leverage =
        finite_decimal(body.leverage).ok_or_else(|| bad_request("leverage must be finite"))?;

    let target = TargetRevision::from_hyperliquid_perp_weights(weights, leverage)
        .map_err(|err| bad_request(&err.to_string()))?;

    state
        .portfolio_store
        .send(&portfolio_id, PortfolioCommand::ReviseTarget { target })
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to revise portfolio target"))?;

    debug!(portfolio_id = %id, "portfolio target revised");
    Ok(StatusCode::ACCEPTED)
}

/// Returns a portfolio's current state, read from its projection.
async fn get_portfolio(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<PortfolioView>, StatusCode> {
    let portfolio_id = PortfolioId::from_str(&id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let portfolio = state
        .portfolio_projection
        .load(&portfolio_id)
        .await
        .map_err(|err| {
            error!(error = %err, "failed to load portfolio");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(portfolio.to_view(&portfolio_id)))
}

#[derive(Debug, Deserialize)]
struct ListPortfoliosQuery {
    status: Option<String>,
}

/// Lists portfolios, optionally restricted to a single status.
async fn list_portfolios(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListPortfoliosQuery>,
) -> Result<Json<Vec<PortfolioView>>, StatusCode> {
    let portfolios = match query.status.as_deref() {
        Some(raw) => {
            let status = PortfolioStatus::from_query(raw).ok_or(StatusCode::BAD_REQUEST)?;
            state
                .portfolio_projection
                .filter(STATUS, &status)
                .await
                .map_err(|err| {
                    error!(error = %err, "failed to list portfolios by status");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?
        }
        None => state.portfolio_projection.load_all().await.map_err(|err| {
            error!(error = %err, "failed to list portfolios");
            StatusCode::INTERNAL_SERVER_ERROR
        })?,
    };

    let views = portfolios
        .iter()
        .map(|(id, portfolio)| portfolio.to_view(id))
        .collect();
    Ok(Json(views))
}

/// Renames a portfolio.
async fn post_portfolio_rename(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<RenamePortfolioRequest>,
) -> Result<StatusCode, ApiError> {
    let portfolio_id =
        PortfolioId::from_str(&id).map_err(|_| bad_request("portfolio id is not a valid uuid"))?;
    let name = PortfolioName::new(&body.name).map_err(|err| bad_request(&err.to_string()))?;

    state
        .portfolio_store
        .send(&portfolio_id, PortfolioCommand::Rename { name })
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to rename portfolio"))?;

    debug!(portfolio_id = %id, "portfolio renamed");
    Ok(StatusCode::ACCEPTED)
}

/// Archives a portfolio, retiring it from active management.
async fn post_portfolio_archive(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let portfolio_id =
        PortfolioId::from_str(&id).map_err(|_| bad_request("portfolio id is not a valid uuid"))?;

    state
        .portfolio_store
        .send(&portfolio_id, PortfolioCommand::Archive)
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to archive portfolio"))?;

    debug!(portfolio_id = %id, "portfolio archived");
    Ok(StatusCode::ACCEPTED)
}

/// Maps a finite `f64` from the wire onto an exact `Decimal`; `None` for NaN,
/// infinities, or values outside `Decimal`'s range.
fn finite_decimal(value: f64) -> Option<Decimal> {
    if value.is_finite() {
        Decimal::from_f64(value)
    } else {
        None
    }
}

fn bad_request(message: &str) -> ApiError {
    api_error(StatusCode::BAD_REQUEST, message)
}

/// Translates a portfolio command failure into an HTTP response: domain refusals
/// map to client errors, everything else is an internal error and is logged.
fn classify_portfolio_send_error(error: &SendError<Portfolio>, operation: &str) -> ApiError {
    let (status, message) = match error {
        AggregateError::UserError(LifecycleError::Apply(PortfolioError::NotOpen)) => {
            (StatusCode::NOT_FOUND, "portfolio not found")
        }
        AggregateError::UserError(LifecycleError::Apply(PortfolioError::Archived)) => {
            (StatusCode::CONFLICT, "portfolio is archived")
        }
        AggregateError::UserError(LifecycleError::Apply(PortfolioError::AlreadyOpen)) => {
            (StatusCode::CONFLICT, "portfolio already exists")
        }
        other => {
            error!(error = %other, operation, "portfolio command failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "portfolio command failed",
            )
        }
    };

    api_error(status, message)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisableMarketRequest {
    reason: Option<String>,
}

/// Disables a market so ingestion and the tradable set exclude it.
async fn post_market_disable(
    State(state): State<Arc<AppState>>,
    AxumPath((venue, symbol)): AxumPath<(String, String)>,
    Json(body): Json<DisableMarketRequest>,
) -> Result<StatusCode, ApiError> {
    let market_id = parse_market_id(&venue, &symbol)?;
    state
        .market_enablement
        .send(
            &market_id,
            MarketEnablementCommand::Disable {
                reason: body.reason.clone(),
            },
        )
        .await
        .map_err(|err| classify_enablement_error(&err, "failed to disable market"))?;

    debug!(venue = %venue, symbol = %symbol, "market disabled");
    Ok(StatusCode::ACCEPTED)
}

/// Re-enables a previously disabled market.
async fn post_market_enable(
    State(state): State<Arc<AppState>>,
    AxumPath((venue, symbol)): AxumPath<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let market_id = parse_market_id(&venue, &symbol)?;
    state
        .market_enablement
        .send(&market_id, MarketEnablementCommand::Enable)
        .await
        .map_err(|err| classify_enablement_error(&err, "failed to enable market"))?;

    debug!(venue = %venue, symbol = %symbol, "market enabled");
    Ok(StatusCode::ACCEPTED)
}

/// Lists a venue's tradable markets: catalog listings minus operator disables.
async fn get_markets(
    State(state): State<Arc<AppState>>,
    AxumPath(venue): AxumPath<String>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let venue = VenueRef::from_str(&venue).map_err(|_| StatusCode::NOT_FOUND)?;
    let tradable = market_metadata::tradable_markets(
        venue,
        &state.market_catalog_projection,
        &state.market_enablement_projection,
    )
    .await
    .map_err(|err| {
        error!(error = %err, "failed to list tradable markets");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(
        tradable
            .iter()
            .map(|market| market.as_str().to_string())
            .collect(),
    ))
}

/// Serves a venue's per-market max-leverage limits from the cached catalog so
/// clients size leverage controls without each running a heavy all-market fetch.
async fn get_markets_leverage(
    State(state): State<Arc<AppState>>,
    AxumPath(venue): AxumPath<String>,
) -> Result<Json<market_metadata::LeverageLimits>, StatusCode> {
    let venue = VenueRef::from_str(&venue).map_err(|_| StatusCode::NOT_FOUND)?;
    match market_metadata::leverage_limits(venue, &state.market_catalog_projection).await {
        Ok(Some(limits)) => Ok(Json(limits)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            error!(error = %err, "failed to read leverage limits");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Debug, Deserialize)]
struct HyperliquidMarketsQuery {
    network: HyperliquidNetwork,
}

/// Serves the Hyperliquid perp universe in the ccxt-style shape the frontend
/// trading client consumes. Fetched live from the exchange on every request:
/// the asset indexes in the response route orders, so they must always match
/// the exchange's current universe rather than a cached observation.
async fn get_hyperliquid_markets(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HyperliquidMarketsQuery>,
) -> Result<Json<market_metadata::MarketsApiResponse>, StatusCode> {
    let network = query.network;
    let metadata = state
        .hyperliquid_clients
        .for_network(network)
        .fetch_market_metadata()
        .await
        .map_err(|err| {
            error!(error = %err, ?network, "failed to fetch hyperliquid markets");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    debug!(
        markets = metadata.len(),
        ?network,
        "hyperliquid markets served"
    );
    Ok(Json(market_metadata::markets_api_response(
        &metadata,
        chrono::Utc::now(),
    )))
}

fn parse_market_id(venue: &str, symbol: &str) -> Result<MarketId, ApiError> {
    let venue = VenueRef::from_str(venue).map_err(|_| bad_request("unknown venue"))?;
    Ok(MarketId::new(venue, Symbol::from_raw(symbol)))
}

/// Translates a market-enablement command failure into an HTTP response.
fn classify_enablement_error(error: &SendError<MarketEnablement>, operation: &str) -> ApiError {
    let (status, message) = match error {
        AggregateError::UserError(LifecycleError::Apply(
            MarketEnablementError::AlreadyDisabled,
        )) => (StatusCode::CONFLICT, "market is already disabled"),
        AggregateError::UserError(LifecycleError::Apply(MarketEnablementError::AlreadyEnabled)) => {
            (StatusCode::CONFLICT, "market is already enabled")
        }
        other => {
            error!(error = %other, operation, "market command failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "market command failed")
        }
    };

    api_error(status, message)
}

/// Spawns the supervised apalis worker that drains queued ingestion jobs.
///
/// The worker reads the `Jobs` table through its own sqlx-0.8 `apalis_pool`
/// (matched to the queue by [`JobBackend`], which polls the `IngestionJob::KIND`
/// queue the enqueue side writes) and drives each run's lifecycle through the
/// sqlx-0.9 event store bundled in the [`IngestionJobContext`]. It carries the
/// library's shared retry/backoff/circuit-breaker policy: retries are exhausted
/// before a terminal failure trips the breaker and stops the worker for a human
/// to inspect.
fn spawn_ingestion_worker(
    apalis_pool: apalis_sqlite::SqlitePool,
    context: Arc<IngestionJobContext>,
) {
    tokio::spawn(async move {
        let failure_notify = Arc::new(tokio::sync::Notify::new());
        let monitor = EventSorceryMonitor::new().register(move |worker_index| {
            let backend = JobBackend::<IngestionJob>::new(&apalis_pool);
            let fail_stop =
                CircuitBreakerConfig::default().with_recovery_timeout(FAIL_STOP_RECOVERY_TIMEOUT);

            // Under `test-support`, event-sorcery's `work` handler routes
            // through a `FailureInjector` pulled from worker data, so it must be
            // registered for jobs to run; production builds omit it entirely.
            #[cfg(not(feature = "test-support"))]
            let worker = build_supervised_worker!(
                ::<IngestionJob>,
                worker_index,
                backend,
                Arc::clone(&context),
                fail_stop,
                Arc::clone(&failure_notify),
            );
            #[cfg(feature = "test-support")]
            let worker = build_supervised_worker!(
                ::<IngestionJob>,
                worker_index,
                backend,
                Arc::clone(&context),
                fail_stop,
                Arc::clone(&failure_notify),
                event_sorcery::FailureInjector::new(),
            );

            worker
        });
        if let Err(err) = monitor.run().await {
            error!(error = %err, "ingestion monitor crashed");
        }
    });
}

/// Spawns supervised apalis-cron workers -- one per built-in schedule -- so each
/// candle timeframe and funding refresh tick on its own cadence.
fn spawn_ingestion_schedulers(
    schedules: Vec<(IngestionWork, cron::Schedule)>,
    ingestion_store: Arc<Store<IngestionRun>>,
    ingestion_projection: Arc<Projection<IngestionRun>>,
) {
    tokio::spawn(async move {
        let mut monitor = Monitor::new();
        for (work, schedule) in schedules {
            let ingestion_store = Arc::clone(&ingestion_store);
            let ingestion_projection = Arc::clone(&ingestion_projection);
            let consecutive_failures = Arc::new(AtomicU32::new(0));
            let worker_name = format!("ingestion-scheduler-{}", work.schedule_key());
            monitor = monitor.register(move |_worker_index| {
                WorkerBuilder::new(worker_name.clone())
                    .backend(apalis_cron::CronStream::new(schedule.clone()))
                    .data(Arc::clone(&ingestion_store))
                    .data(Arc::clone(&ingestion_projection))
                    .data(Arc::clone(&consecutive_failures))
                    .build(move |tick, store, projection, failures| {
                        trigger_scheduled_ingestion(work, tick, store, projection, failures)
                    })
            });
        }
        if let Err(err) = monitor.run().await {
            error!(error = %err, "ingestion scheduler monitor crashed");
        }
    });
}

/// Build the moneymentum HTTP router.
///
/// # Errors
///
/// Returns an error if the database connection, migrations, or the Hyperliquid
/// client fail to initialize.
pub async fn app(config: Config) -> Result<Router, Box<dyn std::error::Error + Send + Sync>> {
    let filter = EnvFilter::new(format!("moneymentum={}", config.log_level.as_str()));
    // Ignore error if subscriber already set (e.g., multiple tests running)
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    ensure_shared_database(&config.database_url)?;

    let ingestion_schedules = default_ingestion_schedules()?;

    let database_options = SqliteConnectOptions::from_str(&config.database_url)?
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = SqlitePool::connect_with(database_options).await?;
    debug!("database connected");

    // We own the apalis `Jobs`/`Workers` tables as consumer migrations rather
    // than calling apalis-sqlite's own migrator, which would compete with ours
    // over the shared `_sqlx_migrations` table. `ignore_missing` tolerates the
    // apalis-sql 0.7 migration records left in databases provisioned before the
    // upgrade, so those rows do not fail the migrator.
    let mut migrations = sqlx::migrate!("./migrations");
    migrations.set_ignore_missing(true).run(&pool).await?;
    debug!(count = migrations.iter().count(), "migrations applied");

    // One Store + Projection per event-sourced aggregate, built once here and
    // shared via router state. `build()` reconciles the schema registry (clearing
    // stale snapshots on a SCHEMA_VERSION bump) and auto-wires the projection.
    let (portfolio_store, portfolio_projection) =
        StoreBuilder::<Portfolio>::new(pool.clone()).build().await?;
    let (ingestion_store, ingestion_projection) = StoreBuilder::<IngestionRun>::new(pool.clone())
        .build()
        .await?;
    let (market_catalog, market_catalog_projection) =
        StoreBuilder::<MarketCatalog>::new(pool.clone())
            .build()
            .await?;
    let (market_enablement, market_enablement_projection) =
        StoreBuilder::<MarketEnablement>::new(pool.clone())
            .build()
            .await?;
    debug!("event-sourced stores ready");

    // Abandon any run left Running by a crash before schedulers enqueue work, so
    // the one-running slot can never stay wedged across a restart (issue #339).
    ingestion::recover_abandoned_runs(&ingestion_store, &ingestion_projection).await?;

    // apalis-sqlite is built against sqlx 0.8, so its storage needs its own
    // pool distinct from the sqlx 0.9 `pool` the event store and ledger use.
    // Both address the same SQLite file; WAL is already enabled on it by the
    // pool above, and `busy_timeout` lets the two writers wait out the single
    // writer lock instead of failing with "database is locked".
    let apalis_options = apalis_sqlite::SqliteConnectOptions::from_str(&config.database_url)?
        .busy_timeout(std::time::Duration::from_secs(5));
    let apalis_pool = apalis_sqlite::SqlitePool::connect_with(apalis_options).await?;
    debug!("apalis storage pool connected");

    let hyperliquid_clients = HyperliquidClients::from_config(
        config.hyperliquid_base_url.as_ref(),
        config.hyperliquid_testnet_base_url.as_ref(),
        config.max_retries,
    )
    .await?;
    let hyperliquid: Arc<dyn Hyperliquid> = Arc::clone(&hyperliquid_clients.mainnet);
    let services = IngestionServices {
        hyperliquid,
        data_dir: config.data_dir.clone(),
        max_concurrent_requests: config.max_concurrent_requests,
        market_catalog: Arc::clone(&market_catalog),
        market_catalog_projection: Arc::clone(&market_catalog_projection),
        market_enablement_projection: Arc::clone(&market_enablement_projection),
    };
    let ingestion_context = Arc::new(IngestionJobContext {
        run_store: Arc::clone(&ingestion_store),
        run_projection: Arc::clone(&ingestion_projection),
        services,
    });

    spawn_ingestion_worker(apalis_pool.clone(), ingestion_context);
    debug!("ingestion worker started");

    spawn_ingestion_schedulers(
        ingestion_schedules,
        Arc::clone(&ingestion_store),
        Arc::clone(&ingestion_projection),
    );
    debug!("ingestion schedulers started");

    let state = Arc::new(AppState {
        config,
        database_pool: pool,
        hyperliquid_clients,
        portfolio_store,
        portfolio_projection,
        market_enablement,
        market_enablement_projection,
        market_catalog_projection,
    });

    Ok(build_router(state))
}

/// Wires every moneymentum route to its handler and injects the shared state.
fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/candles/{timeframe}", get(get_candles))
        .route("/factors/{timeframe}", get(get_factors))
        .route("/screener/{timeframe}", post(post_screener))
        .route("/ingestion/status", get(get_ingestion_status))
        .route(
            "/portfolio",
            post(post_portfolio_create).get(list_portfolios),
        )
        .route("/portfolio/readonly/btc", post(post_portfolio_readonly_btc))
        .route("/portfolio/exposure", post(post_portfolio_exposure))
        .route("/portfolio/{id}", get(get_portfolio))
        .route("/portfolio/{id}/target", post(post_portfolio_target))
        .route("/portfolio/{id}/rename", post(post_portfolio_rename))
        .route("/portfolio/{id}/archive", post(post_portfolio_archive))
        .route("/hyperliquid/markets", get(get_hyperliquid_markets))
        .route("/markets/{venue}", get(get_markets))
        .route("/markets/{venue}/leverage", get(get_markets_leverage))
        .route(
            "/markets/{venue}/{symbol}/disable",
            post(post_market_disable),
        )
        .route("/markets/{venue}/{symbol}/enable", post(post_market_enable))
        .route("/beta", post(post_beta))
        .with_state(state)
}

/// The event store and the apalis worker each open their own pool against
/// `database_url` (sqlx 0.9 and sqlx 0.8 respectively, which cannot share a
/// pool). An in-memory SQLite URL gives each pool a *private* database, so the
/// worker never sees the migrated tables -- the queue silently breaks. Only a
/// file-backed database keeps the two pools pointed at the same data.
#[derive(Debug, thiserror::Error)]
#[error(
    "in-memory SQLite database_url is unsupported: the event store and the apalis worker open separate pools, and an in-memory URL gives each its own private database; use a file-backed database_url"
)]
struct InMemoryDatabaseUnsupported;

fn ensure_shared_database(database_url: &str) -> Result<(), InMemoryDatabaseUnsupported> {
    let normalized = database_url.to_ascii_lowercase();
    if normalized.contains(":memory:") || normalized.contains("mode=memory") {
        return Err(InMemoryDatabaseUnsupported);
    }
    Ok(())
}

/// Asserts that a log line at the given level contains all snippets.
///
/// Use with `tracing_test::traced_test` to verify observability.
#[cfg(test)]
pub(crate) fn logs_contain_at(level: tracing::Level, snippets: &[&str]) -> bool {
    let logs = {
        let buf = tracing_test::internal::global_buf().lock().unwrap();
        String::from_utf8_lossy(&buf).into_owned()
    };

    let level_str = match level {
        tracing::Level::TRACE => "TRACE",
        tracing::Level::DEBUG => "DEBUG",
        tracing::Level::INFO => "INFO",
        tracing::Level::WARN => "WARN",
        tracing::Level::ERROR => "ERROR",
    };

    logs.lines().any(|line| {
        line.contains(level_str) && snippets.iter().all(|snippet| line.contains(snippet))
    })
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use axum::body::Body;
    use axum::http::Request;
    use chrono::{TimeZone, Utc};
    use proptest::prelude::*;
    use tempfile::TempDir;
    use tower::ServiceExt;
    use tracing_test::traced_test;

    use crate::market_catalog::{CatalogMarket, MarketCatalogCommand};

    use super::*;

    struct TestHarness {
        router: Router,
        market_catalog: Arc<Store<MarketCatalog>>,
    }

    /// Builds the full production router backed by a temp-dir SQLite database, so
    /// tests exercise the real route wiring and shared state, not a hand-rolled
    /// subset.
    async fn test_harness(data_dir: &std::path::Path) -> TestHarness {
        let hyperliquid_clients = HyperliquidClients::from_config(None, None, 5)
            .await
            .unwrap();
        test_harness_with_markets(data_dir, hyperliquid_clients).await
    }

    /// Same harness with injected Hyperliquid clients, so markets-endpoint tests
    /// stub the exchange instead of reaching the real deployments.
    async fn test_harness_with_markets(
        data_dir: &std::path::Path,
        hyperliquid_clients: HyperliquidClients,
    ) -> TestHarness {
        let config = Config {
            port: 0,
            data_dir: data_dir.to_path_buf(),
            database_url: format!("sqlite://{}?mode=rwc", data_dir.join("test.db").display()),
            hyperliquid_base_url: None,
            hyperliquid_testnet_base_url: None,
            log_level: LogLevel::Info,
            max_concurrent_requests: 3,
            max_retries: 5,
            derive: None,
        };

        let database_options = SqliteConnectOptions::from_str(&config.database_url)
            .unwrap()
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePool::connect_with(database_options).await.unwrap();
        sqlx::migrate!("./migrations")
            .set_ignore_missing(true)
            .run(&pool)
            .await
            .unwrap();

        let (portfolio_store, portfolio_projection) = StoreBuilder::<Portfolio>::new(pool.clone())
            .build()
            .await
            .unwrap();
        let (_ingestion_store, _ingestion_projection) =
            StoreBuilder::<IngestionRun>::new(pool.clone())
                .build()
                .await
                .unwrap();
        let (market_catalog, market_catalog_projection) =
            StoreBuilder::<MarketCatalog>::new(pool.clone())
                .build()
                .await
                .unwrap();
        let (market_enablement, market_enablement_projection) =
            StoreBuilder::<MarketEnablement>::new(pool.clone())
                .build()
                .await
                .unwrap();

        let router = build_router(Arc::new(AppState {
            config,
            database_pool: pool,
            hyperliquid_clients,
            portfolio_store,
            portfolio_projection,
            market_enablement,
            market_enablement_projection,
            market_catalog_projection,
        }));

        TestHarness {
            router,
            market_catalog,
        }
    }

    async fn test_router(data_dir: &std::path::Path) -> Router {
        test_harness(data_dir).await.router
    }

    fn get_request(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    fn post_json(uri: &str, body: &serde_json::Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    fn post_empty(uri: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .body(Body::empty())
            .unwrap()
    }

    async fn body_text(response: axum::response::Response) -> String {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[traced_test]
    #[tokio::test]
    async fn markets_disable_enable_list_and_idempotency() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;

        // Disable a market -> 202.
        let disabled = router
            .clone()
            .oneshot(post_json(
                "/markets/hyperliquid/BTC/disable",
                &serde_json::json!({ "reason": "maintenance" }),
            ))
            .await
            .unwrap();
        assert_eq!(disabled.status(), StatusCode::ACCEPTED);
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["market disabled", "BTC"]
        ));

        // Disabling an already-disabled market -> 409.
        let again = router
            .clone()
            .oneshot(post_json(
                "/markets/hyperliquid/BTC/disable",
                &serde_json::json!({ "reason": null }),
            ))
            .await
            .unwrap();
        assert_eq!(again.status(), StatusCode::CONFLICT);

        // Re-enable the disabled market -> 202.
        let enabled = router
            .clone()
            .oneshot(post_empty("/markets/hyperliquid/BTC/enable"))
            .await
            .unwrap();
        assert_eq!(enabled.status(), StatusCode::ACCEPTED);

        // Enabling an already-enabled market -> 409.
        let enable_again = router
            .clone()
            .oneshot(post_empty("/markets/hyperliquid/BTC/enable"))
            .await
            .unwrap();
        assert_eq!(enable_again.status(), StatusCode::CONFLICT);

        // Enabling a market that was never disabled (no stream yet) -> 409,
        // not a spurious 202.
        let fresh_enable = router
            .clone()
            .oneshot(post_empty("/markets/hyperliquid/ETH/enable"))
            .await
            .unwrap();
        assert_eq!(fresh_enable.status(), StatusCode::CONFLICT);

        // Listing a known venue's tradable markets succeeds.
        let listed = router
            .clone()
            .oneshot(get_request("/markets/hyperliquid"))
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);

        // An unknown venue is a client error, never a 500.
        let bad_disable = router
            .clone()
            .oneshot(post_json(
                "/markets/bogus/BTC/disable",
                &serde_json::json!({ "reason": null }),
            ))
            .await
            .unwrap();
        assert_eq!(bad_disable.status(), StatusCode::BAD_REQUEST);
        let bad_list = router.oneshot(get_request("/markets/bogus")).await.unwrap();
        assert_eq!(bad_list.status(), StatusCode::NOT_FOUND);
    }

    #[traced_test]
    #[tokio::test]
    async fn markets_leverage_serves_catalog_limits_and_rejects_unknown_venue() {
        let data_dir = TempDir::new().unwrap();
        let TestHarness {
            router,
            market_catalog,
        } = test_harness(data_dir.path()).await;

        let unobserved = router
            .clone()
            .oneshot(get_request("/markets/hyperliquid/leverage"))
            .await
            .unwrap();
        assert_eq!(unobserved.status(), StatusCode::NOT_FOUND);

        let observed_at = Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap();

        market_catalog
            .send(
                &VenueRef::Hyperliquid,
                MarketCatalogCommand::RecordUniverse {
                    markets: vec![
                        CatalogMarket::new(Symbol::from_raw("BTC"), 50),
                        CatalogMarket::new(Symbol::from_raw("ETH"), 25),
                    ],
                    observed_at,
                },
            )
            .await
            .unwrap();

        let listed = router
            .clone()
            .oneshot(get_request("/markets/hyperliquid/leverage"))
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        let raw = body_text(listed).await;
        let body: market_metadata::LeverageLimits = serde_json::from_str(&raw).unwrap();
        assert_eq!(body.limits.len(), 2);
        assert_eq!(body.fetched_at, observed_at);

        let mut by_symbol: Vec<(&str, u32)> = body
            .limits
            .iter()
            .map(|limit| (limit.symbol.as_str(), limit.max_leverage))
            .collect();
        by_symbol.sort_unstable();
        assert_eq!(by_symbol, vec![("BTC", 50), ("ETH", 25)]);

        let wire: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let btc = wire["limits"]
            .as_array()
            .unwrap()
            .iter()
            .find(|limit| limit["symbol"] == "BTC")
            .unwrap();
        assert_eq!(btc["maxLeverage"], 50);
        assert_eq!(wire["fetchedAt"], "2026-03-15T12:00:00Z");

        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["leverage limits read", "markets=2"]
        ));

        let unknown = router
            .oneshot(get_request("/markets/bogus/leverage"))
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    }

    #[traced_test]
    #[tokio::test]
    async fn markets_leverage_includes_disabled_markets() {
        let data_dir = TempDir::new().unwrap();
        let TestHarness {
            router,
            market_catalog,
        } = test_harness(data_dir.path()).await;
        let observed_at = Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap();

        market_catalog
            .send(
                &VenueRef::Hyperliquid,
                MarketCatalogCommand::RecordUniverse {
                    markets: vec![
                        CatalogMarket::new(Symbol::from_raw("BTC"), 50),
                        CatalogMarket::new(Symbol::from_raw("ETH"), 25),
                    ],
                    observed_at,
                },
            )
            .await
            .unwrap();

        let disabled = router
            .clone()
            .oneshot(post_json(
                "/markets/hyperliquid/BTC/disable",
                &serde_json::json!({ "reason": "maintenance" }),
            ))
            .await
            .unwrap();
        assert_eq!(disabled.status(), StatusCode::ACCEPTED);

        let tradable = router
            .clone()
            .oneshot(get_request("/markets/hyperliquid"))
            .await
            .unwrap();
        assert_eq!(tradable.status(), StatusCode::OK);
        let tradable_symbols: Vec<String> =
            serde_json::from_str(&body_text(tradable).await).unwrap();
        assert_eq!(tradable_symbols, vec!["ETH".to_string()]);

        let leverage = router
            .clone()
            .oneshot(get_request("/markets/hyperliquid/leverage"))
            .await
            .unwrap();
        assert_eq!(leverage.status(), StatusCode::OK);
        let body: market_metadata::LeverageLimits =
            serde_json::from_str(&body_text(leverage).await).unwrap();

        let mut symbols: Vec<&str> = body
            .limits
            .iter()
            .map(|limit| limit.symbol.as_str())
            .collect();
        symbols.sort_unstable();
        assert_eq!(symbols, vec!["BTC", "ETH"]);
        assert_eq!(body.fetched_at, observed_at);
    }

    #[traced_test]
    #[tokio::test]
    async fn portfolio_create_set_target_and_read_back() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;

        let created = router
            .clone()
            .oneshot(post_json(
                "/portfolio",
                &serde_json::json!({ "name": "macro" }),
            ))
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let created_body: serde_json::Value =
            serde_json::from_str(&body_text(created).await).unwrap();
        let id = created_body["id"].as_str().unwrap().to_string();
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["portfolio opened", &id]
        ));

        let revised = router
            .clone()
            .oneshot(post_json(
                &format!("/portfolio/{id}/target"),
                &serde_json::json!({ "weights": { "BTC": 0.6, "ETH": -0.4 }, "leverage": 2.0 }),
            ))
            .await
            .unwrap();
        assert_eq!(revised.status(), StatusCode::ACCEPTED);
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["portfolio target revised", &id]
        ));

        let fetched = router
            .clone()
            .oneshot(get_request(&format!("/portfolio/{id}")))
            .await
            .unwrap();
        assert_eq!(fetched.status(), StatusCode::OK);
        let view: serde_json::Value = serde_json::from_str(&body_text(fetched).await).unwrap();
        assert_eq!(view["name"], "macro");
        assert_eq!(view["status"], "Active");
        let btc_weight: f64 = view["target"]["weights"]["BTC"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!(
            (btc_weight - 0.6).abs() < 1e-9,
            "BTC weight should round-trip, got {btc_weight}"
        );

        let listed = router
            .oneshot(get_request("/portfolio?status=active"))
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        let rows: Vec<serde_json::Value> = serde_json::from_str(&body_text(listed).await).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], id);
    }

    #[traced_test]
    #[tokio::test]
    async fn revising_a_missing_portfolio_is_not_found() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;
        let missing = uuid::Uuid::new_v4();

        let revised = router
            .oneshot(post_json(
                &format!("/portfolio/{missing}/target"),
                &serde_json::json!({ "weights": { "BTC": 1.0 }, "leverage": 1.0 }),
            ))
            .await
            .unwrap();

        assert_eq!(revised.status(), StatusCode::NOT_FOUND);
    }

    #[traced_test]
    #[tokio::test]
    async fn create_rejects_a_blank_name() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;

        let created = router
            .oneshot(post_json(
                "/portfolio",
                &serde_json::json!({ "name": "   " }),
            ))
            .await
            .unwrap();

        assert_eq!(created.status(), StatusCode::BAD_REQUEST);
    }

    proptest! {
        #[test]
        fn port_round_trips_through_toml(port in 1u16..=65535u16) {
            let toml = format!(r#"
                port = {port}
                data_dir = "data"
                database_url = "sqlite::memory:"
                log_level = "info"
                max_concurrent_requests = 3
                max_retries = 5
            "#);
            let config: Config = toml::from_str(&toml).unwrap();
            prop_assert_eq!(config.port, port);
        }
    }

    #[test]
    fn example_toml_is_valid() {
        let content = include_str!("../example.toml");
        let config: Config = toml::from_str(content).unwrap();

        assert_eq!(config.port, 8000);
        assert_eq!(config.data_dir, PathBuf::from("data"));
    }

    #[test]
    fn config_load_returns_error_for_missing_file() {
        let result = Config::load("/nonexistent/path.toml");
        assert!(matches!(result, Err(ConfigError::Io(_))));
    }

    #[tokio::test]
    async fn health_returns_json_contract() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;
        let response = router.oneshot(get_request("/health")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );

        let payload: serde_json::Value = serde_json::from_str(&body_text(response).await).unwrap();

        assert_eq!(
            payload.get("status").and_then(serde_json::Value::as_str),
            Some("ok")
        );
        assert_eq!(
            payload.get("version").and_then(serde_json::Value::as_str),
            Some(env!("CARGO_PKG_VERSION"))
        );
    }

    #[tokio::test]
    async fn get_candles_returns_404_when_no_data() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;
        let response = router.oneshot(get_request("/candles/1h")).await.unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn get_factors_returns_404_when_no_data() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;
        let response = router.oneshot(get_request("/factors/1d")).await.unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[traced_test]
    #[tokio::test]
    async fn get_factors_returns_per_ticker_factor_scores_json() {
        let data_dir = TempDir::new().unwrap();
        std::fs::copy(
            std::path::Path::new("fixtures/ohlcv_1d_beta.csv"),
            data_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();

        let router = test_router(data_dir.path()).await;
        let response = router.oneshot(get_request("/factors/1d")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = body_text(response).await;
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&body).expect("factors body is a JSON array");
        assert!(!rows.is_empty(), "expected a row per ticker");
        assert!(
            rows.iter()
                .all(|row| row.get("annualized_volatility").is_some()),
            "every row carries annualized_volatility"
        );
        assert!(
            rows.iter().all(|row| row.get("cum_return").is_some()),
            "every row carries cum_return"
        );
        assert!(
            rows.iter().all(|row| row
                .get("sma")
                .is_some_and(|value| value.is_null() || value.as_f64().is_some())),
            "every row carries sma as a number or null"
        );
        assert!(
            rows.iter().all(|row| row
                .get("mean_return")
                .is_some_and(|value| value.is_null() || value.as_f64().is_some())),
            "every row carries mean_return as a number or null"
        );
        assert!(
            rows.iter().all(|row| row
                .get("price_zscore")
                .is_some_and(|value| value.is_null() || value.as_f64().is_some())),
            "every row carries price_zscore as a number or null"
        );
        assert!(
            rows.iter().all(|row| row
                .get("annualized_return")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries annualized_return as a number (the fixture's closes are clean)"
        );
        assert!(
            rows.iter().all(|row| row
                .get("sharpe")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries sharpe as a number (the fixture's closes all vary)"
        );
        assert!(
            rows.iter().all(|row| row
                .get("sortino")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries sortino as a number (every fixture ticker has downside)"
        );
        assert!(
            rows.iter().all(|row| row
                .get("autocorrelation")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries autocorrelation as a number (the fixture's returns all vary)"
        );
        assert!(
            rows.iter().all(|row| row
                .get("information_discreteness")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries information_discreteness as a number (the fixture's returns all vary)"
        );
        // The fixture ships no funding data, so carry is legitimately null --
        // but the key itself must stay in the schema for every row.
        assert!(
            rows.iter()
                .all(|row| row.get("carry").is_some_and(serde_json::Value::is_null)),
            "carry key is present and null for every row without funding data"
        );

        assert!(
            rows.iter().all(|row| row
                .get("beta")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries beta as a number (prices vary and BTC is the benchmark)"
        );
        assert!(
            rows.iter().all(|row| row
                .get("volume_24h")
                .and_then(serde_json::Value::as_f64)
                .is_some()),
            "every row carries volume_24h as a number (every fixture ticker has current candles)"
        );
        assert_btc_factor_values_are_real(&rows);

        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["factors computed"]
        ));
    }

    /// Key presence alone would pass if every factor serialized as null; pin
    /// BTC's values so a serialization regression fails the factors route test.
    fn assert_btc_factor_values_are_real(rows: &[serde_json::Value]) {
        let btc_row = rows
            .iter()
            .find(|row| row.get("ticker").and_then(|ticker| ticker.as_str()) == Some("BTC"))
            .expect("BTC is present in the factor scores");

        let btc_volatility = btc_row["annualized_volatility"]
            .as_f64()
            .expect("BTC annualized_volatility is a number");
        assert!(
            btc_volatility > 0.0,
            "BTC annualized_volatility must be positive, got {btc_volatility}"
        );
        for factor_key in [
            "cum_return",
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
            let value = btc_row[factor_key].as_f64();
            assert!(
                value.is_some_and(f64::is_finite),
                "BTC {factor_key} must be a finite number, got {value:?}"
            );
        }

        // Pin the unit conversion: the fixture's latest BTC candle is 1400
        // base units against a ~$46.7k close, so notional must be tens of
        // millions -- a raw base-unit sum (~1400) fails this by four orders
        // of magnitude.
        let btc_volume = btc_row["volume_24h"]
            .as_f64()
            .expect("BTC volume_24h is a number");
        assert!(
            btc_volume > 1e6,
            "volume_24h must be quote notional, not base units, got {btc_volume}"
        );
        // No funding fixture is staged, so carry serializes as null - the
        // documented no-funding-data behavior.
        assert!(
            btc_row["carry"].is_null(),
            "carry must be null without funding data, got {:?}",
            btc_row["carry"]
        );
    }

    #[tokio::test]
    async fn post_screener_returns_404_when_no_data() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;
        let response = router
            .oneshot(post_json(
                "/screener/1d",
                &serde_json::json!({ "factor": "sharpe" }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn post_screener_returns_ranked_rows_with_missing_flags() {
        let data_dir = TempDir::new().unwrap();
        std::fs::copy(
            std::path::Path::new("fixtures/ohlcv_1d_beta.csv"),
            data_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();

        let router = test_router(data_dir.path()).await;
        let response = router
            .oneshot(post_json(
                "/screener/1d",
                &serde_json::json!({ "factor": "sharpe" }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = body_text(response).await;
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&body).expect("screener body is a JSON array");
        assert!(!rows.is_empty(), "expected ranked rows");
        assert!(
            rows.iter().all(|row| row.get("missing").is_some()),
            "every ranked row carries a missing flag"
        );
    }

    #[tokio::test]
    async fn get_candles_returns_422_for_invalid_timeframe() {
        let data_dir = TempDir::new().unwrap();
        let router = test_router(data_dir.path()).await;
        let response = router
            .oneshot(get_request("/candles/invalid"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn get_candles_returns_written_csv_as_json() {
        let data_dir = TempDir::new().unwrap();

        // Write a CSV file in the expected format
        let csv_content = "timestamp,open,high,low,close,volume,symbol\n\
                           1700000000000,42000.0,43000.0,41500.0,42500.0,1000.0,BTC\n\
                           1700000000000,2000.0,2100.0,1900.0,2050.0,500.0,ETH\n";
        std::fs::write(data_dir.path().join("ohlcv_1h.csv"), csv_content).unwrap();

        let router = test_router(data_dir.path()).await;
        let response = router.oneshot(get_request("/candles/1h")).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = body_text(response).await;
        let candles: Vec<serde_json::Value> = body
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_str(line).expect("each line should be valid JSON"))
            .collect();

        assert_eq!(candles.len(), 2);

        let btc_candle = candles
            .iter()
            .find(|c| c.get("symbol").and_then(|s| s.as_str()) == Some("BTC"))
            .expect("should have BTC candle");
        assert_eq!(
            btc_candle.get("open").and_then(serde_json::Value::as_f64),
            Some(42000.0)
        );

        let eth_candle = candles
            .iter()
            .find(|c| c.get("symbol").and_then(|s| s.as_str()) == Some("ETH"))
            .expect("should have ETH candle");
        assert_eq!(
            eth_candle.get("open").and_then(serde_json::Value::as_f64),
            Some(2000.0)
        );
    }

    #[test]
    fn ensure_shared_database_rejects_in_memory_urls() {
        for url in [
            "sqlite::memory:",
            "sqlite://:memory:",
            ":memory:",
            "sqlite:file:store.db?mode=memory&cache=shared",
        ] {
            assert!(
                ensure_shared_database(url).is_err(),
                "expected {url} to be rejected as in-memory"
            );
        }
    }

    #[test]
    fn ensure_shared_database_accepts_file_backed_urls() {
        assert!(ensure_shared_database("sqlite:./moneymentum.db?mode=rwc").is_ok());
        assert!(ensure_shared_database("sqlite://data/moneymentum.db").is_ok());
    }

    #[tokio::test]
    async fn reconcile_migration_preserves_existing_snapshots() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        // Stand up the pre-reconcile event store (snapshots without the
        // `snapshot_version` column) and seed a snapshot from the cqrs-es era.
        sqlx::raw_sql(include_str!(
            "../migrations/20260208011202_cqrs_event_store.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r"
            INSERT INTO snapshots
                (aggregate_type, aggregate_id, last_sequence, payload, timestamp)
            VALUES ('Portfolio', 'portfolio-1', 7, '{}', '2026-01-01T00:00:00Z')
            ",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!(
            "../migrations/20260618052212_reconcile_event_store_for_event_sorcery.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        let (last_sequence, snapshot_version): (i64, i64) = sqlx::query_as(
            r"
            SELECT last_sequence, snapshot_version
            FROM snapshots
            WHERE aggregate_id = 'portfolio-1'
            ",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(last_sequence, 7);
        assert_eq!(snapshot_version, 0);
    }

    /// Version of `migrations/20260618073806_per_work_ingestion_running_slot.sql`.
    const RUNNING_SLOT_MIGRATION_VERSION: i64 = 20_260_618_073_806;

    async fn insert_ingestion_run_row(
        pool: &SqlitePool,
        view_id: &str,
        status: &str,
        schedule_key: &str,
    ) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
        let payload = serde_json::json!({
            "Live": {
                "status": status,
                "started_at": "2026-07-01T00:00:00Z",
                "schedule_key": schedule_key,
            }
        })
        .to_string();
        sqlx::query("INSERT INTO ingestion_run_view (view_id, version, payload) VALUES (?1, 1, ?2)")
            .bind(view_id.to_string())
            .bind(payload)
            .execute(pool)
            .await
    }

    /// Prod regression: SQLite refuses `ALTER TABLE ... ADD COLUMN ... STORED`
    /// on a table that already has rows, so a migration adding a stored
    /// generated column passes on every fresh database (CI, dev) and crashes
    /// the binary on any database with recorded ingestion runs. Reproduces the
    /// prod path: migrate to the pre-existing state, record a run, then apply
    /// the remaining migrations.
    #[tokio::test]
    async fn running_slot_migration_applies_to_a_populated_database() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();

        let mut up_to_previous = sqlx::migrate!("./migrations");
        up_to_previous.migrations = up_to_previous
            .migrations
            .iter()
            .filter(|migration| migration.version < RUNNING_SLOT_MIGRATION_VERSION)
            .cloned()
            .collect::<Vec<_>>()
            .into();
        up_to_previous.run(&pool).await.unwrap();

        insert_ingestion_run_row(&pool, "ingestion-1", "Completed", "1h")
            .await
            .unwrap();

        let migrated = sqlx::migrate!("./migrations").run(&pool).await;
        assert!(
            migrated.is_ok(),
            "migrations must apply to a database with recorded runs: {migrated:?}"
        );

        // The rescoped index must still admit one Running row per schedule key.
        insert_ingestion_run_row(&pool, "ingestion-2", "Running", "15m")
            .await
            .unwrap();
        insert_ingestion_run_row(&pool, "ingestion-3", "Running", "1h")
            .await
            .unwrap();

        let second_running_for_key =
            insert_ingestion_run_row(&pool, "ingestion-4", "Running", "15m").await;
        assert!(
            second_running_for_key.is_err(),
            "a second Running row for the same schedule key must violate the unique index"
        );
    }

    /// Serves a fixed universe, standing in for one Hyperliquid deployment.
    struct StubHyperliquid {
        universe: Vec<market_metadata::MarketMetadata>,
    }

    #[async_trait::async_trait]
    impl Hyperliquid for StubHyperliquid {
        async fn fetch_market_metadata(
            &self,
        ) -> Result<Vec<market_metadata::MarketMetadata>, hyperliquid::HyperliquidError> {
            Ok(self.universe.clone())
        }

        async fn fetch_candles(
            &self,
            _market: &finance::Market,
            _timeframe: Timeframe,
            _start: chrono::DateTime<Utc>,
        ) -> Result<Vec<candle::Candle>, hyperliquid::HyperliquidError> {
            Ok(vec![])
        }

        async fn fetch_funding_rates(
            &self,
            _market: &finance::Market,
            _start: chrono::DateTime<Utc>,
        ) -> Result<Vec<funding::FundingRate>, hyperliquid::HyperliquidError> {
            Ok(vec![])
        }
    }

    /// Fails every fetch, standing in for an unreachable exchange.
    struct UnreachableHyperliquid;

    #[async_trait::async_trait]
    impl Hyperliquid for UnreachableHyperliquid {
        async fn fetch_market_metadata(
            &self,
        ) -> Result<Vec<market_metadata::MarketMetadata>, hyperliquid::HyperliquidError> {
            Err(hyperliquid::HyperliquidError::Url(
                url::ParseError::EmptyHost,
            ))
        }

        async fn fetch_candles(
            &self,
            _market: &finance::Market,
            _timeframe: Timeframe,
            _start: chrono::DateTime<Utc>,
        ) -> Result<Vec<candle::Candle>, hyperliquid::HyperliquidError> {
            Err(hyperliquid::HyperliquidError::Url(
                url::ParseError::EmptyHost,
            ))
        }

        async fn fetch_funding_rates(
            &self,
            _market: &finance::Market,
            _start: chrono::DateTime<Utc>,
        ) -> Result<Vec<funding::FundingRate>, hyperliquid::HyperliquidError> {
            Err(hyperliquid::HyperliquidError::Url(
                url::ParseError::EmptyHost,
            ))
        }
    }

    fn stub_market(
        symbol: &str,
        max_leverage: u32,
        asset_index: u32,
    ) -> market_metadata::MarketMetadata {
        market_metadata::MarketMetadata {
            symbol: finance::Market::new(symbol.to_string()),
            max_leverage,
            asset_index,
            only_isolated: false,
        }
    }

    fn stub_hyperliquid_clients() -> HyperliquidClients {
        HyperliquidClients {
            mainnet: Arc::new(StubHyperliquid {
                universe: vec![stub_market("BTC", 50, 0)],
            }),
            testnet: Arc::new(StubHyperliquid {
                universe: vec![stub_market("SOL", 20, 0)],
            }),
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn hyperliquid_markets_serves_the_mainnet_universe_and_logs() {
        let data_dir = TempDir::new().unwrap();
        let router = test_harness_with_markets(data_dir.path(), stub_hyperliquid_clients())
            .await
            .router;

        let response = router
            .oneshot(get_request("/hyperliquid/markets?network=mainnet"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value = serde_json::from_str(&body_text(response).await).unwrap();
        assert_eq!(body["tickers"], serde_json::json!(["BTC/USDC:USDC"]));
        assert_eq!(body["leverageLimits"][0]["maxLeverage"], 50);
        assert_eq!(body["leverageLimits"][0]["assetIndex"], 0);
        assert!(
            logs_contain_at(
                tracing::Level::DEBUG,
                &["hyperliquid markets served", "Mainnet"]
            ),
            "serving the universe must log the market count and network"
        );
    }

    #[tokio::test]
    async fn hyperliquid_markets_routes_testnet_queries_to_the_testnet_client() {
        let data_dir = TempDir::new().unwrap();
        let router = test_harness_with_markets(data_dir.path(), stub_hyperliquid_clients())
            .await
            .router;

        let response = router
            .oneshot(get_request("/hyperliquid/markets?network=testnet"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value = serde_json::from_str(&body_text(response).await).unwrap();
        assert_eq!(body["tickers"], serde_json::json!(["SOL/USDC:USDC"]));
    }

    #[traced_test]
    #[tokio::test]
    async fn hyperliquid_markets_maps_an_unreachable_exchange_to_500_and_logs() {
        let data_dir = TempDir::new().unwrap();
        let clients = HyperliquidClients {
            mainnet: Arc::new(UnreachableHyperliquid),
            testnet: Arc::new(UnreachableHyperliquid),
        };
        let router = test_harness_with_markets(data_dir.path(), clients)
            .await
            .router;

        let response = router
            .oneshot(get_request("/hyperliquid/markets?network=mainnet"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(
            logs_contain_at(
                tracing::Level::ERROR,
                &["failed to fetch hyperliquid markets"]
            ),
            "an upstream failure must be logged at ERROR"
        );
    }

    #[tokio::test]
    async fn hyperliquid_markets_rejects_missing_or_unknown_networks() {
        let data_dir = TempDir::new().unwrap();
        let harness = test_harness_with_markets(data_dir.path(), stub_hyperliquid_clients()).await;

        let missing = harness
            .router
            .clone()
            .oneshot(get_request("/hyperliquid/markets"))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::BAD_REQUEST);

        let unknown = harness
            .router
            .oneshot(get_request("/hyperliquid/markets?network=banana"))
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    }
}
