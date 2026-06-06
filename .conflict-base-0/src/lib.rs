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
mod portfolio_comparison;
mod readonly_portfolio;
mod screener;
mod timeframe;
mod venue;

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use apalis::prelude::{Data, Monitor, WorkerBuilder};
use apalis_sqlite::SqliteStorage;
use event_sorcery::{AggregateError, LifecycleError, Projection, SendError, Store, StoreBuilder};
use rocket::config::Config as RocketConfig;
use rocket::http::Status;
use rocket::request::FromParam;
use rocket::response::content::RawJson;
use rocket::response::status::Custom;
use rocket::response::{Responder, Response};
use rocket::serde::json::Json;
use rocket::{Rocket, State, get, post, routes};
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use serde::Deserialize;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use thiserror::Error;
use tracing::{debug, error, info};
use tracing_subscriber::EnvFilter;

use finance::Symbol;
use ingestion::{
    IngestionError, IngestionJob, IngestionRun, IngestionRunStatus, IngestionServices,
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

impl<'r> FromParam<'r> for Timeframe {
    type Error = &'r str;

    fn from_param(param: &'r str) -> Result<Self, Self::Error> {
        Self::from_interval_string(param).ok_or(param)
    }
}

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
    log_level: LogLevel,
    max_concurrent_requests: usize,
    max_retries: usize,
    ingestion_schedule: String,
}

impl Config {
    /// Load configuration from a TOML file on disk.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::Io`] if the file cannot be read, or
    /// [`ConfigError::Toml`] if the contents are not valid TOML for [`Config`].
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, ConfigError> {
        let content = std::fs::read_to_string(path.as_ref())?;
        Ok(toml::from_str(&content)?)
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Toml(#[from] toml::de::Error),
}

#[get("/health")]
fn health() -> HealthJson {
    HealthJson(Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    }))
}

#[derive(Debug, serde::Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

struct HealthJson(Json<HealthResponse>);

impl<'request> Responder<'request, 'static> for HealthJson {
    fn respond_to(
        self,
        request: &'request rocket::request::Request<'_>,
    ) -> rocket::response::Result<'static> {
        Response::build_from(self.0.respond_to(request)?)
            .raw_header("Cache-Control", "no-store")
            .ok()
    }
}

#[get("/candles/<timeframe>")]
async fn get_candles(
    config: &State<Config>,
    timeframe: Timeframe,
) -> Result<RawJson<Vec<u8>>, Status> {
    candle::read_candles_json(&config.data_dir, timeframe)
        .await
        .map_err(|err| {
            error!(error = %err, "failed to read candles");
            Status::InternalServerError
        })?
        .map(RawJson)
        .ok_or(Status::NotFound)
}

#[get("/factors/<timeframe>")]
async fn get_factors(
    config: &State<Config>,
    timeframe: Timeframe,
) -> Result<RawJson<Vec<u8>>, Status> {
    match factors::compute_factors_json(&config.data_dir, timeframe).await {
        Ok(json) => Ok(RawJson(json)),
        Err(factors::ReturnsError::NoData { .. }) => Err(Status::NotFound),
        Err(err) => {
            error!(error = %err, "failed to compute factors");
            Err(Status::InternalServerError)
        }
    }
}

#[post("/screener/<timeframe>", data = "<body>")]
async fn post_screener(
    config: &State<Config>,
    timeframe: Timeframe,
    body: Json<screener::ScreenerRequest>,
) -> Result<RawJson<Vec<u8>>, Status> {
    match screener::screen(&config.data_dir, timeframe, &body).await {
        Ok(json) => Ok(RawJson(json)),
        Err(screener::ScreenerError::Factors(factors::ReturnsError::NoData { .. })) => {
            Err(Status::NotFound)
        }
        Err(err) => {
            error!(error = %err, "failed to screen perps");
            Err(Status::InternalServerError)
        }
    }
}

#[post("/portfolio/compare", data = "<body>")]
fn post_portfolio_compare(
    body: Json<portfolio_comparison::PortfolioComparisonRequest>,
) -> Result<Json<Vec<portfolio_comparison::PositionComparison>>, Status> {
    portfolio_comparison::compare_portfolios(&body.into_inner())
        .map(Json)
        .map_err(|_| Status::BadRequest)
}

#[post("/ingest")]
async fn start_ingestion(
    ingestion_store: &State<Arc<Store<IngestionRun>>>,
    ingestion_projection: &State<Arc<Projection<IngestionRun>>>,
    apalis_pool: &State<apalis_sqlite::SqlitePool>,
) -> Status {
    match ingestion::enqueue_run(ingestion_store, ingestion_projection, apalis_pool).await {
        Ok(_) => Status::Accepted,
        Err(IngestionError::AlreadyRunning) => Status::Conflict,
        Err(err) => {
            error!(error = %err, "failed to start ingestion run");
            Status::InternalServerError
        }
    }
}

#[get("/ingestion/status")]
async fn get_ingestion_status(
    ingestion_projection: &State<Arc<Projection<IngestionRun>>>,
) -> Result<Json<Option<IngestionRunStatus>>, Status> {
    let status = ingestion::latest_status(ingestion_projection)
        .await
        .map_err(|err| {
            error!(error = %err, "failed to load ingestion status");
            Status::InternalServerError
        })?;

    Ok(Json(status))
}

#[derive(Debug, Deserialize)]
struct BetaRequest {
    weights: std::collections::HashMap<Symbol, f64>,
    benchmark: Symbol,
}

#[derive(Debug, serde::Serialize)]
struct BetaResponse {
    beta: Option<f64>,
    excluded_symbols: Vec<Symbol>,
    effective_weights: std::collections::BTreeMap<Symbol, f64>,
    data_age_hours: i64,
}

#[derive(Debug, serde::Serialize)]
struct ApiErrorResponse {
    error: String,
}

#[post("/portfolio/readonly/btc", data = "<body>")]
async fn post_portfolio_readonly_btc(
    body: Json<readonly_portfolio::ReadonlyBtcBalancesRequest>,
) -> Result<Json<readonly_portfolio::ReadonlyBtcBalancesResponse>, Custom<Json<ApiErrorResponse>>> {
    let http_client = reqwest::Client::new();
    let btc_base_url = readonly_portfolio::default_btc_base_url().map_err(|err| {
        error!(error = %err, "failed to resolve btc explorer base url");
        Custom(
            Status::InternalServerError,
            Json(ApiErrorResponse {
                error: "failed to resolve btc explorer base url".to_string(),
            }),
        )
    })?;
    let blockchain_info_base_url =
        readonly_portfolio::default_blockchain_info_base_url().map_err(|err| {
            error!(error = %err, "failed to resolve blockchain.info base url");
            Custom(
                Status::InternalServerError,
                Json(ApiErrorResponse {
                    error: "failed to resolve blockchain.info base url".to_string(),
                }),
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
            | readonly_portfolio::ReadonlyPortfolioError::EmptyAddressList => Status::BadRequest,
            _ => Status::InternalServerError,
        };
        Custom(
            status,
            Json(ApiErrorResponse {
                error: err.to_string(),
            }),
        )
    })
}

#[post("/portfolio/exposure", data = "<body>")]
async fn post_portfolio_exposure(
    config: &State<Config>,
    body: Json<readonly_portfolio::PortfolioExposureRequest>,
) -> Result<Json<readonly_portfolio::PortfolioExposureResponse>, Custom<Json<ApiErrorResponse>>> {
    let http_client = reqwest::Client::new();
    let btc_base_url = readonly_portfolio::default_btc_base_url().map_err(|err| {
        error!(error = %err, "failed to resolve btc explorer base url");
        Custom(
            Status::InternalServerError,
            Json(ApiErrorResponse {
                error: "failed to resolve btc explorer base url".to_string(),
            }),
        )
    })?;
    let blockchain_info_base_url =
        readonly_portfolio::default_blockchain_info_base_url().map_err(|err| {
            error!(error = %err, "failed to resolve blockchain.info base url");
            Custom(
                Status::InternalServerError,
                Json(ApiErrorResponse {
                    error: "failed to resolve blockchain.info base url".to_string(),
                }),
            )
        })?;

    readonly_portfolio::load_portfolio_exposure(
        &http_client,
        &btc_base_url,
        &blockchain_info_base_url,
        config.hyperliquid_base_url.as_ref(),
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
                Status::BadRequest
            }
            _ => Status::InternalServerError,
        };
        Custom(
            status,
            Json(ApiErrorResponse {
                error: err.to_string(),
            }),
        )
    })
}

#[post("/beta", data = "<body>")]
async fn post_beta(
    config: &State<Config>,
    body: Json<BetaRequest>,
) -> Result<Json<BetaResponse>, Status> {
    if body.benchmark.as_str().trim().is_empty() {
        return Err(Status::BadRequest);
    }
    if body.weights.is_empty() {
        return Err(Status::BadRequest);
    }
    if body.weights.values().any(|weight| !weight.is_finite()) {
        return Err(Status::BadRequest);
    }

    let weights: Vec<(Symbol, f64)> = {
        let mut sorted_weights: Vec<_> = body
            .weights
            .iter()
            .map(|(ticker, weight)| (ticker.clone(), *weight))
            .collect();
        sorted_weights
            .sort_unstable_by(|(left_ticker, _), (right_ticker, _)| left_ticker.cmp(right_ticker));
        sorted_weights
    };

    match factors::compute_portfolio_beta_report(&config.data_dir, &weights, &body.benchmark).await
    {
        Ok(report) => Ok(Json(BetaResponse {
            beta: report.beta,
            excluded_symbols: report.excluded_tickers,
            effective_weights: report.effective_weights,
            data_age_hours: report.data_age_hours,
        })),
        Err(err) => {
            error!(error = %err, "beta calculation failed");
            Err(Status::InternalServerError)
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
    weights: HashMap<Symbol, f64>,
    leverage: f64,
}

/// Opens a new portfolio under a freshly minted id.
#[post("/portfolio", data = "<body>")]
async fn post_portfolio_create(
    store: &State<Arc<Store<Portfolio>>>,
    body: Json<CreatePortfolioRequest>,
) -> Result<Custom<Json<PortfolioCreatedResponse>>, Custom<Json<ApiErrorResponse>>> {
    let name = PortfolioName::new(&body.name).map_err(|err| bad_request(&err.to_string()))?;
    let id = PortfolioId::generate();

    store
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
    Ok(Custom(
        Status::Created,
        Json(PortfolioCreatedResponse { id }),
    ))
}

/// Replaces a portfolio's target with a new revision of perp weights + leverage.
#[post("/portfolio/<id>/target", data = "<body>")]
async fn post_portfolio_target(
    store: &State<Arc<Store<Portfolio>>>,
    id: &str,
    body: Json<ReviseTargetRequest>,
) -> Result<Status, Custom<Json<ApiErrorResponse>>> {
    let portfolio_id =
        PortfolioId::from_str(id).map_err(|_| bad_request("portfolio id is not a valid uuid"))?;

    let mut weights = Vec::with_capacity(body.weights.len());
    for (symbol, weight) in &body.weights {
        let weight =
            finite_decimal(*weight).ok_or_else(|| bad_request("weights must be finite"))?;
        weights.push((symbol.clone(), weight));
    }
    let leverage =
        finite_decimal(body.leverage).ok_or_else(|| bad_request("leverage must be finite"))?;

    let target = TargetRevision::from_hyperliquid_perp_weights(weights, leverage)
        .map_err(|err| bad_request(&err.to_string()))?;

    store
        .send(&portfolio_id, PortfolioCommand::ReviseTarget { target })
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to revise portfolio target"))?;

    debug!(portfolio_id = id, "portfolio target revised");
    Ok(Status::Accepted)
}

/// Returns a portfolio's current state, read from its projection.
#[get("/portfolio/<id>")]
async fn get_portfolio(
    projection: &State<Arc<Projection<Portfolio>>>,
    id: &str,
) -> Result<Json<PortfolioView>, Status> {
    let portfolio_id = PortfolioId::from_str(id).map_err(|_| Status::BadRequest)?;
    let portfolio = projection
        .load(&portfolio_id)
        .await
        .map_err(|err| {
            error!(error = %err, "failed to load portfolio");
            Status::InternalServerError
        })?
        .ok_or(Status::NotFound)?;

    Ok(Json(portfolio.to_view(&portfolio_id)))
}

/// Lists portfolios, optionally restricted to a single status.
#[get("/portfolio?<status>")]
async fn list_portfolios(
    projection: &State<Arc<Projection<Portfolio>>>,
    status: Option<&str>,
) -> Result<Json<Vec<PortfolioView>>, Status> {
    let portfolios = match status {
        Some(raw) => {
            let status = PortfolioStatus::from_query(raw).ok_or(Status::BadRequest)?;
            projection.filter(STATUS, &status).await.map_err(|err| {
                error!(error = %err, "failed to list portfolios by status");
                Status::InternalServerError
            })?
        }
        None => projection.load_all().await.map_err(|err| {
            error!(error = %err, "failed to list portfolios");
            Status::InternalServerError
        })?,
    };

    let views = portfolios
        .iter()
        .map(|(id, portfolio)| portfolio.to_view(id))
        .collect();
    Ok(Json(views))
}

/// Renames a portfolio.
#[post("/portfolio/<id>/rename", data = "<body>")]
async fn post_portfolio_rename(
    store: &State<Arc<Store<Portfolio>>>,
    id: &str,
    body: Json<RenamePortfolioRequest>,
) -> Result<Status, Custom<Json<ApiErrorResponse>>> {
    let portfolio_id =
        PortfolioId::from_str(id).map_err(|_| bad_request("portfolio id is not a valid uuid"))?;
    let name = PortfolioName::new(&body.name).map_err(|err| bad_request(&err.to_string()))?;

    store
        .send(&portfolio_id, PortfolioCommand::Rename { name })
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to rename portfolio"))?;

    debug!(portfolio_id = id, "portfolio renamed");
    Ok(Status::Accepted)
}

/// Archives a portfolio, retiring it from active management.
#[post("/portfolio/<id>/archive")]
async fn post_portfolio_archive(
    store: &State<Arc<Store<Portfolio>>>,
    id: &str,
) -> Result<Status, Custom<Json<ApiErrorResponse>>> {
    let portfolio_id =
        PortfolioId::from_str(id).map_err(|_| bad_request("portfolio id is not a valid uuid"))?;

    store
        .send(&portfolio_id, PortfolioCommand::Archive)
        .await
        .map_err(|err| classify_portfolio_send_error(&err, "failed to archive portfolio"))?;

    debug!(portfolio_id = id, "portfolio archived");
    Ok(Status::Accepted)
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

fn bad_request(message: &str) -> Custom<Json<ApiErrorResponse>> {
    Custom(
        Status::BadRequest,
        Json(ApiErrorResponse {
            error: message.to_string(),
        }),
    )
}

/// Translates a portfolio command failure into an HTTP response: domain refusals
/// map to client errors, everything else is an internal error and is logged.
fn classify_portfolio_send_error(
    error: &SendError<Portfolio>,
    operation: &str,
) -> Custom<Json<ApiErrorResponse>> {
    let (status, message) = match error {
        AggregateError::UserError(LifecycleError::Apply(PortfolioError::NotOpen)) => {
            (Status::NotFound, "portfolio not found")
        }
        AggregateError::UserError(LifecycleError::Apply(PortfolioError::Archived)) => {
            (Status::Conflict, "portfolio is archived")
        }
        AggregateError::UserError(LifecycleError::Apply(PortfolioError::AlreadyOpen)) => {
            (Status::Conflict, "portfolio already exists")
        }
        other => {
            error!(error = %other, operation, "portfolio command failed");
            (Status::InternalServerError, "portfolio command failed")
        }
    };

    Custom(
        status,
        Json(ApiErrorResponse {
            error: message.to_string(),
        }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisableMarketRequest {
    reason: Option<String>,
}

/// Disables a market so ingestion and the tradable set exclude it.
#[post("/markets/<venue>/<symbol>/disable", data = "<body>")]
async fn post_market_disable(
    store: &State<Arc<Store<MarketEnablement>>>,
    venue: &str,
    symbol: &str,
    body: Json<DisableMarketRequest>,
) -> Result<Status, Custom<Json<ApiErrorResponse>>> {
    let market_id = parse_market_id(venue, symbol)?;
    store
        .send(
            &market_id,
            MarketEnablementCommand::Disable {
                reason: body.reason.clone(),
            },
        )
        .await
        .map_err(|err| classify_enablement_error(&err, "failed to disable market"))?;

    debug!(venue, symbol, "market disabled");
    Ok(Status::Accepted)
}

/// Re-enables a previously disabled market.
#[post("/markets/<venue>/<symbol>/enable")]
async fn post_market_enable(
    store: &State<Arc<Store<MarketEnablement>>>,
    venue: &str,
    symbol: &str,
) -> Result<Status, Custom<Json<ApiErrorResponse>>> {
    let market_id = parse_market_id(venue, symbol)?;
    store
        .send(&market_id, MarketEnablementCommand::Enable)
        .await
        .map_err(|err| classify_enablement_error(&err, "failed to enable market"))?;

    debug!(venue, symbol, "market enabled");
    Ok(Status::Accepted)
}

/// Lists a venue's tradable markets: catalog listings minus operator disables.
#[get("/markets/<venue>")]
async fn get_markets(
    catalog_projection: &State<Arc<Projection<MarketCatalog>>>,
    enablement_projection: &State<Arc<Projection<MarketEnablement>>>,
    venue: &str,
) -> Result<Json<Vec<String>>, Status> {
    let venue = VenueRef::from_str(venue).map_err(|_| Status::NotFound)?;
    let tradable =
        market_metadata::tradable_markets(venue, catalog_projection, enablement_projection)
            .await
            .map_err(|err| {
                error!(error = %err, "failed to list tradable markets");
                Status::InternalServerError
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
#[get("/markets/<venue>/leverage")]
async fn get_markets_leverage(
    catalog_projection: &State<Arc<Projection<MarketCatalog>>>,
    venue: &str,
) -> Result<Json<market_metadata::LeverageLimits>, Status> {
    let venue = VenueRef::from_str(venue).map_err(|_| Status::NotFound)?;
    match market_metadata::leverage_limits(venue, catalog_projection).await {
        Ok(Some(limits)) => Ok(Json(limits)),
        Ok(None) => Err(Status::NotFound),
        Err(err) => {
            error!(error = %err, "failed to read leverage limits");
            Err(Status::InternalServerError)
        }
    }
}

fn parse_market_id(venue: &str, symbol: &str) -> Result<MarketId, Custom<Json<ApiErrorResponse>>> {
    let venue = VenueRef::from_str(venue).map_err(|_| bad_request("unknown venue"))?;
    Ok(MarketId::new(venue, Symbol::from_raw(symbol)))
}

/// Translates a market-enablement command failure into an HTTP response.
fn classify_enablement_error(
    error: &SendError<MarketEnablement>,
    operation: &str,
) -> Custom<Json<ApiErrorResponse>> {
    let (status, message) = match error {
        AggregateError::UserError(LifecycleError::Apply(
            MarketEnablementError::AlreadyDisabled,
        )) => (Status::Conflict, "market is already disabled"),
        AggregateError::UserError(LifecycleError::Apply(MarketEnablementError::AlreadyEnabled)) => {
            (Status::Conflict, "market is already enabled")
        }
        other => {
            error!(error = %other, operation, "market command failed");
            (Status::InternalServerError, "market command failed")
        }
    };

    Custom(
        status,
        Json(ApiErrorResponse {
            error: message.to_string(),
        }),
    )
}

/// Spawns the supervised apalis worker that drains queued ingestion jobs.
///
/// The worker reads the `Jobs` table through its own sqlx-0.8 `apalis_pool` and
/// drives each run's lifecycle through the sqlx-0.9 `ingestion_store`.
fn spawn_ingestion_worker(
    apalis_pool: apalis_sqlite::SqlitePool,
    ingestion_store: Arc<Store<IngestionRun>>,
    services: Arc<IngestionServices>,
) {
    tokio::spawn(async move {
        let monitor = Monitor::new().register(move |_worker_index| {
            WorkerBuilder::new("ingestion")
                .backend(SqliteStorage::<IngestionJob, (), ()>::new(&apalis_pool))
                .data(Arc::clone(&ingestion_store))
                .data(services.clone())
                .build(IngestionJob::run)
        });
        if let Err(err) = monitor.run().await {
            error!(error = %err, "ingestion monitor crashed");
        }
    });
}

/// apalis-cron handler: enqueues an ingestion run on each schedule tick.
async fn run_scheduled_ingestion(
    _tick: apalis_cron::Tick<chrono::Utc>,
    ingestion_store: Data<Arc<Store<IngestionRun>>>,
    ingestion_projection: Data<Arc<Projection<IngestionRun>>>,
    apalis_pool: Data<apalis_sqlite::SqlitePool>,
    consecutive_failures: Data<Arc<std::sync::atomic::AtomicU32>>,
) -> Result<(), std::convert::Infallible> {
    ingestion::trigger_scheduled_ingestion(
        &ingestion_store,
        &ingestion_projection,
        &apalis_pool,
        &consecutive_failures,
    )
    .await;
    Ok(())
}

/// Spawns the supervised apalis-cron worker that enqueues an ingestion run on a
/// fixed schedule, so deployed data stays current without an operator poking
/// `/ingest`.
fn spawn_ingestion_scheduler(
    schedule: cron::Schedule,
    apalis_pool: apalis_sqlite::SqlitePool,
    ingestion_store: Arc<Store<IngestionRun>>,
    ingestion_projection: Arc<Projection<IngestionRun>>,
) {
    let consecutive_failures = Arc::new(std::sync::atomic::AtomicU32::new(0));
    tokio::spawn(async move {
        let monitor = Monitor::new().register(move |_worker_index| {
            WorkerBuilder::new("ingestion-scheduler")
                .backend(apalis_cron::CronStream::new(schedule.clone()))
                .data(apalis_pool.clone())
                .data(Arc::clone(&ingestion_store))
                .data(Arc::clone(&ingestion_projection))
                .data(Arc::clone(&consecutive_failures))
                .build(run_scheduled_ingestion)
        });
        if let Err(err) = monitor.run().await {
            error!(error = %err, "ingestion scheduler monitor crashed");
        }
    });
}

/// Build and configure the Rocket HTTP server for the moneymentum backend.
///
/// # Errors
///
/// Returns an error if the database connection, migrations, Hyperliquid client,
/// or Rocket initialization fail.
pub async fn rocket(
    config: Config,
) -> Result<Rocket<rocket::Build>, Box<dyn std::error::Error + Send + Sync>> {
    let filter = EnvFilter::new(format!("moneymentum={}", config.log_level.as_str()));
    // Ignore error if subscriber already set (e.g., multiple tests running)
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    let rocket_config = RocketConfig {
        port: config.port,
        address: Ipv4Addr::UNSPECIFIED.into(),
        ..RocketConfig::default()
    };

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
    // shared via Rocket state. `build()` reconciles the schema registry (clearing
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

    // Abandon any run left Running by a crash before we accept /ingest, so the
    // one-running slot can never stay wedged across a restart (issue #339).
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

    let hyperliquid_client = hyperliquid::HyperliquidClient::new(
        config.hyperliquid_base_url.as_ref(),
        config.max_retries,
    )
    .await?;
    let services = Arc::new(IngestionServices {
        hyperliquid: Arc::new(hyperliquid_client),
        data_dir: config.data_dir.clone(),
        max_concurrent_requests: config.max_concurrent_requests,
        market_catalog: Arc::clone(&market_catalog),
        market_catalog_projection: Arc::clone(&market_catalog_projection),
        market_enablement_projection: Arc::clone(&market_enablement_projection),
    });

    spawn_ingestion_worker(
        apalis_pool.clone(),
        Arc::clone(&ingestion_store),
        Arc::clone(&services),
    );
    debug!("ingestion worker started");

    let ingestion_schedule = cron::Schedule::from_str(&config.ingestion_schedule)?;
    spawn_ingestion_scheduler(
        ingestion_schedule,
        apalis_pool.clone(),
        Arc::clone(&ingestion_store),
        Arc::clone(&ingestion_projection),
    );
    debug!("ingestion scheduler started");

    info!(port = config.port, "moneymentum ready");
    Ok(rocket::custom(rocket_config)
        .manage(config)
        .manage(pool)
        .manage(apalis_pool)
        .manage(portfolio_store)
        .manage(portfolio_projection)
        .manage(ingestion_store)
        .manage(ingestion_projection)
        .manage(market_enablement)
        .manage(market_enablement_projection)
        .manage(market_catalog_projection)
        .mount(
            "/",
            routes![
                health,
                get_candles,
                get_factors,
                post_portfolio_create,
                post_portfolio_target,
                get_portfolio,
                list_portfolios,
                post_portfolio_rename,
                post_portfolio_archive,
                post_screener,
                post_portfolio_compare,
                start_ingestion,
                get_ingestion_status,
                post_market_disable,
                post_market_enable,
                get_markets,
                get_markets_leverage,
                post_beta,
                post_portfolio_readonly_btc,
                post_portfolio_exposure
            ],
        ))
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
    use super::*;
    use proptest::prelude::*;
    use rocket::local::blocking::Client;
    use tempfile::TempDir;
    use tracing_test::traced_test;

    fn test_rocket(data_dir: &std::path::Path) -> rocket::Rocket<rocket::Build> {
        let config = Config {
            port: 0,
            data_dir: data_dir.to_path_buf(),
            database_url: "sqlite::memory:".to_string(),
            hyperliquid_base_url: None,
            log_level: LogLevel::Info,
            max_concurrent_requests: 3,
            max_retries: 5,
            ingestion_schedule: "0 0 * * * *".to_string(),
        };
        rocket::build().manage(config).mount(
            "/",
            routes![
                health,
                get_candles,
                get_factors,
                post_screener,
                post_portfolio_compare
            ],
        )
    }

    async fn portfolio_client(data_dir: &TempDir) -> rocket::local::asynchronous::Client {
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("portfolio-test.db").display()
        );
        let pool = SqlitePool::connect(&database_url).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (store, projection) = StoreBuilder::<Portfolio>::new(pool).build().await.unwrap();
        let rocket = rocket::build().manage(store).manage(projection).mount(
            "/",
            routes![
                post_portfolio_create,
                post_portfolio_target,
                get_portfolio,
                list_portfolios,
                post_portfolio_rename,
                post_portfolio_archive
            ],
        );

        rocket::local::asynchronous::Client::tracked(rocket)
            .await
            .unwrap()
    }

    async fn markets_client(data_dir: &TempDir) -> rocket::local::asynchronous::Client {
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("markets-test.db").display()
        );
        let pool = SqlitePool::connect(&database_url).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (enablement_store, enablement_projection) =
            StoreBuilder::<MarketEnablement>::new(pool.clone())
                .build()
                .await
                .unwrap();
        let (_catalog_store, catalog_projection) = StoreBuilder::<MarketCatalog>::new(pool)
            .build()
            .await
            .unwrap();
        let rocket = rocket::build()
            .manage(enablement_store)
            .manage(catalog_projection)
            .manage(enablement_projection)
            .mount(
                "/",
                routes![
                    post_market_disable,
                    post_market_enable,
                    get_markets,
                    get_markets_leverage
                ],
            );

        rocket::local::asynchronous::Client::tracked(rocket)
            .await
            .unwrap()
    }

    #[traced_test]
    #[tokio::test]
    async fn markets_disable_enable_list_and_idempotency() {
        let data_dir = TempDir::new().unwrap();
        let client = markets_client(&data_dir).await;

        // Disable a market -> 202.
        let disabled = client
            .post("/markets/hyperliquid/BTC/disable")
            .json(&serde_json::json!({ "reason": "maintenance" }))
            .dispatch()
            .await;
        assert_eq!(disabled.status(), Status::Accepted);
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["market disabled", "BTC"]
        ));

        // Disabling an already-disabled market -> 409.
        let again = client
            .post("/markets/hyperliquid/BTC/disable")
            .json(&serde_json::json!({ "reason": null }))
            .dispatch()
            .await;
        assert_eq!(again.status(), Status::Conflict);

        // Re-enable the disabled market -> 202.
        let enabled = client
            .post("/markets/hyperliquid/BTC/enable")
            .dispatch()
            .await;
        assert_eq!(enabled.status(), Status::Accepted);

        // Enabling an already-enabled market -> 409.
        let enable_again = client
            .post("/markets/hyperliquid/BTC/enable")
            .dispatch()
            .await;
        assert_eq!(enable_again.status(), Status::Conflict);

        // Enabling a market that was never disabled (no stream yet) -> 409,
        // not a spurious 202.
        let fresh_enable = client
            .post("/markets/hyperliquid/ETH/enable")
            .dispatch()
            .await;
        assert_eq!(fresh_enable.status(), Status::Conflict);

        // Listing a known venue's tradable markets succeeds.
        let listed = client.get("/markets/hyperliquid").dispatch().await;
        assert_eq!(listed.status(), Status::Ok);

        // An unknown venue is a client error, never a 500.
        let bad_disable = client
            .post("/markets/bogus/BTC/disable")
            .json(&serde_json::json!({ "reason": null }))
            .dispatch()
            .await;
        assert_eq!(bad_disable.status(), Status::BadRequest);
        let bad_list = client.get("/markets/bogus").dispatch().await;
        assert_eq!(bad_list.status(), Status::NotFound);
    }

    #[traced_test]
    #[tokio::test]
    async fn markets_leverage_serves_catalog_limits_and_rejects_unknown_venue() {
        let data_dir = TempDir::new().unwrap();
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            data_dir.path().join("leverage-test.db").display()
        );
        let pool = SqlitePool::connect(&database_url).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let (catalog_store, catalog_projection) = StoreBuilder::<MarketCatalog>::new(pool)
            .build()
            .await
            .unwrap();

        catalog_store
            .send(
                &crate::venue::VenueRef::Hyperliquid,
                crate::market_catalog::MarketCatalogCommand::RecordUniverse {
                    markets: vec![
                        crate::market_catalog::CatalogMarket::new(
                            crate::finance::Symbol::from_raw("BTC"),
                            50,
                        ),
                        crate::market_catalog::CatalogMarket::new(
                            crate::finance::Symbol::from_raw("ETH"),
                            25,
                        ),
                    ],
                    observed_at: chrono::Utc::now(),
                },
            )
            .await
            .unwrap();

        let rocket = rocket::build()
            .manage(catalog_projection)
            .mount("/", routes![get_markets_leverage]);
        let client = rocket::local::asynchronous::Client::tracked(rocket)
            .await
            .unwrap();

        let response = client.get("/markets/hyperliquid/leverage").dispatch().await;
        assert_eq!(response.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        assert!(body["fetchedAt"].is_string());
        let by_symbol: std::collections::BTreeMap<String, u64> = body["limits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|limit| {
                (
                    limit["symbol"].as_str().unwrap().to_string(),
                    limit["maxLeverage"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(by_symbol.get("BTC"), Some(&50));
        assert_eq!(by_symbol.get("ETH"), Some(&25));
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["leverage limits read", "markets=2"]
        ));

        // An unknown venue is a client error, never a 500.
        let unknown = client.get("/markets/bogus/leverage").dispatch().await;
        assert_eq!(unknown.status(), Status::NotFound);
    }

    #[traced_test]
    #[tokio::test]
    async fn portfolio_create_set_target_and_read_back() {
        let data_dir = TempDir::new().unwrap();
        let client = portfolio_client(&data_dir).await;

        let created = client
            .post("/portfolio")
            .json(&serde_json::json!({ "name": "macro" }))
            .dispatch()
            .await;
        assert_eq!(created.status(), Status::Created);
        let created_body: serde_json::Value =
            serde_json::from_str(&created.into_string().await.unwrap()).unwrap();
        let id = created_body["id"].as_str().unwrap().to_string();
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["portfolio opened", &id]
        ));

        let revised = client
            .post(format!("/portfolio/{id}/target"))
            .json(&serde_json::json!({ "weights": { "BTC": 0.6, "ETH": -0.4 }, "leverage": 2.0 }))
            .dispatch()
            .await;
        assert_eq!(revised.status(), Status::Accepted);
        assert!(logs_contain_at(
            tracing::Level::DEBUG,
            &["portfolio target revised", &id]
        ));

        let fetched = client.get(format!("/portfolio/{id}")).dispatch().await;
        assert_eq!(fetched.status(), Status::Ok);
        let view: serde_json::Value =
            serde_json::from_str(&fetched.into_string().await.unwrap()).unwrap();
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

        let listed = client.get("/portfolio?status=active").dispatch().await;
        assert_eq!(listed.status(), Status::Ok);
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&listed.into_string().await.unwrap()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], id);
    }

    #[traced_test]
    #[tokio::test]
    async fn revising_a_missing_portfolio_is_not_found() {
        let data_dir = TempDir::new().unwrap();
        let client = portfolio_client(&data_dir).await;
        let missing = uuid::Uuid::new_v4();

        let revised = client
            .post(format!("/portfolio/{missing}/target"))
            .json(&serde_json::json!({ "weights": { "BTC": 1.0 }, "leverage": 1.0 }))
            .dispatch()
            .await;

        assert_eq!(revised.status(), Status::NotFound);
    }

    #[traced_test]
    #[tokio::test]
    async fn create_rejects_a_blank_name() {
        let data_dir = TempDir::new().unwrap();
        let client = portfolio_client(&data_dir).await;

        let created = client
            .post("/portfolio")
            .json(&serde_json::json!({ "name": "   " }))
            .dispatch()
            .await;

        assert_eq!(created.status(), Status::BadRequest);
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
                ingestion_schedule = "0 0 * * * *"
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

    #[test]
    fn health_returns_json_contract() {
        let rocket = rocket::build().mount("/", routes![health]);
        let client = Client::tracked(rocket).unwrap();
        let response = client.get("/health").dispatch();

        assert_eq!(response.status(), Status::Ok);
        assert_eq!(
            response.content_type(),
            Some(rocket::http::ContentType::JSON)
        );
        assert_eq!(
            response.headers().get_one("Cache-Control"),
            Some("no-store")
        );

        let body = response.into_string().unwrap();
        let payload: serde_json::Value = serde_json::from_str(&body).unwrap();

        assert_eq!(
            payload.get("status").and_then(serde_json::Value::as_str),
            Some("ok")
        );
        assert_eq!(
            payload.get("version").and_then(serde_json::Value::as_str),
            Some(env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn get_candles_returns_404_when_no_data() {
        let data_dir = TempDir::new().unwrap();
        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client.get("/candles/1h").dispatch();

        assert_eq!(response.status(), Status::NotFound);
    }

    #[test]
    fn get_factors_returns_404_when_no_data() {
        let data_dir = TempDir::new().unwrap();
        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client.get("/factors/1d").dispatch();

        assert_eq!(response.status(), Status::NotFound);
    }

    #[traced_test]
    #[test]
    fn get_factors_returns_per_ticker_factor_scores_json() {
        let data_dir = TempDir::new().unwrap();
        std::fs::copy(
            std::path::Path::new("fixtures/ohlcv_1d_beta.csv"),
            data_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();

        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client.get("/factors/1d").dispatch();

        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().unwrap();
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

    #[test]
    fn post_screener_returns_404_when_no_data() {
        let data_dir = TempDir::new().unwrap();
        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client
            .post("/screener/1d")
            .header(rocket::http::ContentType::JSON)
            .body(r#"{"factor":"sharpe"}"#)
            .dispatch();

        assert_eq!(response.status(), Status::NotFound);
    }

    #[test]
    fn post_screener_returns_ranked_rows_with_missing_flags() {
        let data_dir = TempDir::new().unwrap();
        std::fs::copy(
            std::path::Path::new("fixtures/ohlcv_1d_beta.csv"),
            data_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();

        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client
            .post("/screener/1d")
            .header(rocket::http::ContentType::JSON)
            .body(r#"{"factor":"sharpe"}"#)
            .dispatch();

        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().unwrap();
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&body).expect("screener body is a JSON array");
        assert!(!rows.is_empty(), "expected ranked rows");
        assert!(
            rows.iter().all(|row| row.get("missing").is_some()),
            "every ranked row carries a missing flag"
        );
    }

    #[test]
    fn post_portfolio_compare_returns_per_position_deltas() {
        let data_dir = TempDir::new().unwrap();
        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client
            .post("/portfolio/compare")
            .header(rocket::http::ContentType::JSON)
            .body(r#"{"target":{"BTC":0.6},"current":{"BTC":0.5},"minTradableChange":0.05}"#)
            .dispatch();

        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().unwrap();
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&body).expect("comparison body is a JSON array");
        let btc = rows
            .iter()
            .find(|row| row.get("symbol").and_then(|s| s.as_str()) == Some("BTC"))
            .expect("BTC row present");
        assert_eq!(
            btc.get("tradable").and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert!(
            (btc.get("delta")
                .and_then(serde_json::Value::as_f64)
                .unwrap()
                - 0.1)
                .abs()
                < 1e-9
        );
    }

    #[test]
    fn get_candles_returns_422_for_invalid_timeframe() {
        let data_dir = TempDir::new().unwrap();
        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client.get("/candles/invalid").dispatch();

        assert_eq!(response.status(), Status::UnprocessableEntity);
    }

    #[test]
    fn get_candles_returns_written_csv_as_json() {
        let data_dir = TempDir::new().unwrap();

        // Write a CSV file in the expected format
        let csv_content = "timestamp,open,high,low,close,volume,symbol\n\
                           1700000000000,42000.0,43000.0,41500.0,42500.0,1000.0,BTC\n\
                           1700000000000,2000.0,2100.0,1900.0,2050.0,500.0,ETH\n";
        std::fs::write(data_dir.path().join("ohlcv_1h.csv"), csv_content).unwrap();

        let client = Client::tracked(test_rocket(data_dir.path())).unwrap();
        let response = client.get("/candles/1h").dispatch();

        assert_eq!(response.status(), Status::Ok);

        let body = response.into_string().unwrap();
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
}
