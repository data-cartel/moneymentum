use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, Method, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response, sse::Event, sse::Sse};
use axum::routing::{get, post};
use chrono::{DateTime, TimeZone, Utc};
use futures::{SinkExt, Stream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use tokio::sync::{RwLock, broadcast, mpsc};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};
use url::Url;

const ATM_TOLERANCE: f64 = 0.005;
const BTC_ASSET: &str = "BTC";
const TICKER_SLIM_INTERVAL_MS: &str = "100";
const SUBSCRIBE_CHANNELS_PER_MESSAGE: usize = 25;

type DeriveWsWriter = futures::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

#[derive(Debug, Error)]
pub enum DeriveError {
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
    #[error("invalid expiry timestamp: {timestamp}")]
    InvalidExpiry { timestamp: i64 },
    #[error("api error: {message}")]
    Api { message: String },
    #[error(transparent)]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: T,
}

#[derive(Debug, Deserialize)]
struct OptionDetailsDto {
    option_type: String,
    strike: String,
    expiry: u64,
}

#[derive(Debug, Deserialize)]
struct InstrumentDto {
    instrument_name: String,
    is_active: bool,
    option_details: Option<OptionDetailsDto>,
}

#[derive(Debug, Deserialize, Clone)]
struct WsNotification {
    channel: Option<String>,
    data: Option<WsData>,
    params: Option<WsParams>,
}

#[derive(Debug, Deserialize, Clone)]
struct WsParams {
    channel: Option<String>,
    data: Option<WsData>,
}

#[derive(Debug, Deserialize, Clone)]
struct WsData {
    #[serde(rename = "instrument_ticker")]
    instrument_ticker: TickerSlimDto,
}

#[derive(Debug, Deserialize, Clone)]
struct TickerSlimDto {
    #[serde(rename = "A")]
    best_ask_size: String,
    #[serde(rename = "B")]
    best_bid_size: String,
    #[serde(rename = "a")]
    best_ask_price: String,
    #[serde(rename = "b")]
    best_bid_price: String,
    #[serde(rename = "I")]
    index_price: String,
    #[serde(rename = "M")]
    mark_price: String,
    option_pricing: Option<OptionPricingSlimDto>,
}

#[derive(Debug, Deserialize, Clone)]
struct OptionPricingSlimDto {
    #[serde(rename = "ai")]
    ask_iv: String,
    #[serde(rename = "bi")]
    bid_iv: String,
    #[serde(rename = "d")]
    delta: String,
    #[serde(rename = "g")]
    gamma: String,
    #[serde(rename = "v")]
    vega: String,
    #[serde(rename = "t")]
    theta: String,
    #[serde(rename = "i")]
    iv: String,
    #[serde(rename = "r")]
    rho: String,
    #[serde(rename = "f")]
    forward: String,
    #[serde(rename = "m")]
    model_mark: String,
    #[serde(rename = "df")]
    discount_factor: String,
}

#[derive(Debug, Deserialize)]
pub struct DeriveConfig {
    pub port: u16,
    pub rest_base_url: Url,
    pub ws_url: Url,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum OptionKind {
    #[serde(rename = "C")]
    Call,
    #[serde(rename = "P")]
    Put,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Moneyness {
    InTheMoney,
    AtTheMoney,
    OutOfTheMoney,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct OptionGreeks {
    pub bid_iv: Option<f64>,
    pub ask_iv: Option<f64>,
    pub delta: Option<f64>,
    pub gamma: Option<f64>,
    pub vega: Option<f64>,
    pub theta: Option<f64>,
    pub iv: Option<f64>,
    pub rho: Option<f64>,
    pub forward_price: Option<f64>,
    pub discount_factor: Option<f64>,
    pub option_model_mark: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OptionQuote {
    pub instrument_name: String,
    pub kind: OptionKind,
    pub strike: f64,
    pub expiry: DateTime<Utc>,
    pub expiry_unix: i64,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub bid_size: Option<f64>,
    pub ask_size: Option<f64>,
    pub mark: Option<f64>,
    pub spot_price: f64,
    pub moneyness: Moneyness,
    pub greeks: OptionGreeks,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PortfolioRiskSummary {
    pub aggregate_delta: f64,
    pub aggregate_gamma: f64,
    pub aggregate_vega: f64,
    pub aggregate_theta: f64,
    pub hedge_ratio_btc: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioPoint {
    pub pct_move: f64,
    pub estimated_pnl: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OptionsSnapshot {
    pub asset: String,
    pub updated_at: DateTime<Utc>,
    pub active_expiry_unix: i64,
    pub expiry_unixes: Vec<i64>,
    pub spot_price: f64,
    pub expiry_dates: Vec<DateTime<Utc>>,
    pub strikes: Vec<f64>,
    pub quotes: Vec<OptionQuote>,
    pub risk: PortfolioRiskSummary,
    pub scenarios: Vec<ScenarioPoint>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpiryTabPayload {
    pub expiry_unix: i64,
    pub instruments: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OptionsBootstrap {
    pub asset: String,
    pub default_expiry_unix: i64,
    pub tabs: Vec<ExpiryTabPayload>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ActiveExpiryBody {
    pub expiry_unix: i64,
}

#[derive(Debug, Clone)]
struct InstrumentMeta {
    instrument_name: String,
    kind: OptionKind,
    strike: f64,
    expiry: DateTime<Utc>,
    expiry_unix: i64,
}

#[derive(Debug, Clone)]
struct QuoteState {
    bid: Option<f64>,
    ask: Option<f64>,
    bid_size: Option<f64>,
    ask_size: Option<f64>,
    mark: Option<f64>,
    spot: f64,
    greeks: OptionGreeks,
}

impl Default for QuoteState {
    fn default() -> Self {
        Self {
            bid: None,
            ask: None,
            bid_size: None,
            ask_size: None,
            mark: None,
            spot: 0.0,
            greeks: OptionGreeks::default(),
        }
    }
}

struct OptionsCatalogue {
    instrument_by_name: HashMap<String, InstrumentMeta>,
    names_by_expiry_unix: HashMap<i64, Vec<String>>,
    expiry_unix_sorted_asc: Vec<i64>,
}

struct DeriveState {
    catalogue: Arc<OptionsCatalogue>,
    snapshot: Arc<RwLock<OptionsSnapshot>>,
    tx: broadcast::Sender<OptionsSnapshot>,
    tab_command_tx: mpsc::Sender<i64>,
}

fn apply_cors_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization"),
    );
}

async fn cors_middleware(request: Request<Body>, next: Next) -> Response {
    if request.method() == Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors_headers(&mut response);
        return response;
    }
    let mut response = next.run(request).await;
    apply_cors_headers(&mut response);
    response
}

async fn fetch_options_catalogue(
    http: &Client,
    rest_base_url: &Url,
    asset: &str,
) -> Result<OptionsCatalogue, DeriveError> {
    let rest_url = format!(
        "{}/public/get_instruments",
        rest_base_url.as_str().trim_end_matches('/')
    );
    let payload = json!({
        "currency": asset,
        "instrument_type": "option",
        "expired": false
    });

    let response: RpcResponse<Vec<InstrumentDto>> = http
        .post(&rest_url)
        .json(&payload)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut by_expiry: BTreeMap<i64, Vec<InstrumentMeta>> = BTreeMap::new();
    let mut instrument_by_name: HashMap<String, InstrumentMeta> = HashMap::new();

    for row in response.result {
        if !row.is_active {
            continue;
        }
        let Some(details) = row.option_details else {
            continue;
        };
        let timestamp = i64::try_from(details.expiry).map_err(|_| DeriveError::Api {
            message: "expiry value does not fit i64".to_string(),
        })?;
        let expiry = Utc
            .timestamp_opt(timestamp, 0)
            .single()
            .ok_or(DeriveError::InvalidExpiry { timestamp })?;
        let strike = parse_required_number(&details.strike, "strike")?;
        let kind = match details.option_type.as_str() {
            "C" => OptionKind::Call,
            "P" => OptionKind::Put,
            other => {
                return Err(DeriveError::Api {
                    message: format!("unsupported option_type: {other}"),
                });
            }
        };
        let meta = InstrumentMeta {
            instrument_name: row.instrument_name.clone(),
            kind,
            strike,
            expiry,
            expiry_unix: timestamp,
        };
        instrument_by_name.insert(row.instrument_name.clone(), meta.clone());
        by_expiry.entry(timestamp).or_default().push(meta);
    }

    let mut names_by_expiry_unix: HashMap<i64, Vec<String>> = HashMap::new();
    let mut expiry_unix_sorted_asc: Vec<i64> = Vec::new();
    for (expiry_unix, mut metas) in by_expiry {
        expiry_unix_sorted_asc.push(expiry_unix);
        metas.sort_by(|left, right| {
            left.strike
                .partial_cmp(&right.strike)
                .unwrap_or(Ordering::Equal)
                .then_with(|| match (left.kind, right.kind) {
                    (OptionKind::Call, OptionKind::Put) => Ordering::Less,
                    (OptionKind::Put, OptionKind::Call) => Ordering::Greater,
                    _ => Ordering::Equal,
                })
        });
        let names = metas
            .into_iter()
            .map(|meta| meta.instrument_name)
            .collect::<Vec<_>>();
        names_by_expiry_unix.insert(expiry_unix, names);
    }

    Ok(OptionsCatalogue {
        instrument_by_name,
        names_by_expiry_unix,
        expiry_unix_sorted_asc,
    })
}

fn channel_name_for_instrument(instrument_name: &str) -> String {
    format!("ticker_slim.{instrument_name}.{TICKER_SLIM_INTERVAL_MS}")
}

fn parse_instrument_from_channel(channel: &str) -> Option<String> {
    let parts: Vec<&str> = channel.split('.').collect();
    if parts.len() != 3 || parts.first() != Some(&"ticker_slim") {
        return None;
    }
    parts.get(1).map(|name| (*name).to_string())
}

async fn send_subscribe_batch(
    writer: &mut DeriveWsWriter,
    channels: &[String],
    message_id: &mut i64,
) -> Result<(), DeriveError> {
    for chunk in channels.chunks(SUBSCRIBE_CHANNELS_PER_MESSAGE) {
        let payload = json!({
            "method": "subscribe",
            "params": { "channels": chunk },
            "id": *message_id
        });
        *message_id += 1;
        writer
            .send(Message::Text(payload.to_string().into()))
            .await?;
    }
    Ok(())
}

async fn send_unsubscribe_batch(
    writer: &mut DeriveWsWriter,
    channels: &[String],
    message_id: &mut i64,
) -> Result<(), DeriveError> {
    for chunk in channels.chunks(SUBSCRIBE_CHANNELS_PER_MESSAGE) {
        let payload = json!({
            "method": "unsubscribe",
            "params": { "channels": chunk },
            "id": *message_id
        });
        *message_id += 1;
        writer
            .send(Message::Text(payload.to_string().into()))
            .await?;
    }
    Ok(())
}

fn extract_notification_parts(notification: &WsNotification) -> Option<(String, WsData)> {
    if let (Some(channel), Some(data)) = (notification.channel.clone(), notification.data.clone()) {
        return Some((channel, data));
    }
    notification
        .params
        .as_ref()
        .and_then(|params| params.channel.clone().zip(params.data.clone()))
}

fn parse_optional_number(input: &str) -> Option<f64> {
    let value = input.parse::<f64>().ok()?;
    if value == 0.0 { None } else { Some(value) }
}

fn parse_api_decimal(input: &str) -> Option<f64> {
    input.parse::<f64>().ok()
}

fn parse_required_number(input: &str, field: &str) -> Result<f64, DeriveError> {
    input.parse::<f64>().map_err(|_| DeriveError::Api {
        message: format!("failed to parse {field}: {input}"),
    })
}

fn compute_moneyness(kind: OptionKind, strike: f64, spot: f64) -> Moneyness {
    if spot <= 0.0 {
        return Moneyness::AtTheMoney;
    }
    let ratio = (strike - spot).abs() / spot;
    if ratio < ATM_TOLERANCE {
        return Moneyness::AtTheMoney;
    }
    match kind {
        OptionKind::Call if spot > strike => Moneyness::InTheMoney,
        OptionKind::Put if spot < strike => Moneyness::InTheMoney,
        _ => Moneyness::OutOfTheMoney,
    }
}

fn build_greeks(ticker: &TickerSlimDto) -> OptionGreeks {
    let Some(pricing) = ticker.option_pricing.as_ref() else {
        return OptionGreeks::default();
    };
    OptionGreeks {
        bid_iv: parse_api_decimal(&pricing.bid_iv),
        ask_iv: parse_api_decimal(&pricing.ask_iv),
        delta: parse_api_decimal(&pricing.delta),
        gamma: parse_api_decimal(&pricing.gamma),
        vega: parse_api_decimal(&pricing.vega),
        theta: parse_api_decimal(&pricing.theta),
        iv: parse_api_decimal(&pricing.iv),
        rho: parse_api_decimal(&pricing.rho),
        forward_price: parse_api_decimal(&pricing.forward),
        discount_factor: parse_api_decimal(&pricing.discount_factor),
        option_model_mark: parse_api_decimal(&pricing.model_mark),
    }
}

fn build_bootstrap(catalogue: &OptionsCatalogue, asset: &str) -> OptionsBootstrap {
    let tabs = catalogue
        .expiry_unix_sorted_asc
        .iter()
        .map(|expiry_unix| ExpiryTabPayload {
            expiry_unix: *expiry_unix,
            instruments: catalogue
                .names_by_expiry_unix
                .get(expiry_unix)
                .cloned()
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    let default_expiry_unix = catalogue
        .expiry_unix_sorted_asc
        .first()
        .copied()
        .unwrap_or(0);
    OptionsBootstrap {
        asset: asset.to_string(),
        default_expiry_unix,
        tabs,
    }
}

fn expiry_datetimes_from_catalogue(catalogue: &OptionsCatalogue) -> Vec<DateTime<Utc>> {
    catalogue
        .expiry_unix_sorted_asc
        .iter()
        .filter_map(|unix| Utc.timestamp_opt(*unix, 0).single())
        .collect()
}

fn build_tab_snapshot(
    asset: &str,
    catalogue: &OptionsCatalogue,
    active_expiry_unix: i64,
    quote_map: &HashMap<String, QuoteState>,
) -> OptionsSnapshot {
    let names = catalogue
        .names_by_expiry_unix
        .get(&active_expiry_unix)
        .cloned()
        .unwrap_or_default();

    let mut quotes: Vec<OptionQuote> = names
        .iter()
        .filter_map(|instrument_name| {
            let meta = catalogue.instrument_by_name.get(instrument_name)?;
            let state = quote_map.get(instrument_name).cloned().unwrap_or_default();
            Some(OptionQuote {
                instrument_name: instrument_name.clone(),
                kind: meta.kind,
                strike: meta.strike,
                expiry: meta.expiry,
                expiry_unix: meta.expiry_unix,
                bid: state.bid,
                ask: state.ask,
                bid_size: state.bid_size,
                ask_size: state.ask_size,
                mark: state.mark,
                spot_price: state.spot,
                moneyness: compute_moneyness(meta.kind, meta.strike, state.spot),
                greeks: state.greeks,
            })
        })
        .collect();

    quotes.sort_by(|left, right| {
        left.strike
            .partial_cmp(&right.strike)
            .unwrap_or(Ordering::Equal)
            .then_with(|| match (left.kind, right.kind) {
                (OptionKind::Call, OptionKind::Put) => Ordering::Less,
                (OptionKind::Put, OptionKind::Call) => Ordering::Greater,
                _ => Ordering::Equal,
            })
    });

    let mut strike_bits = quotes
        .iter()
        .map(|quote| quote.strike.to_bits())
        .collect::<Vec<_>>();
    strike_bits.sort_unstable();
    strike_bits.dedup();
    let strikes = strike_bits
        .into_iter()
        .map(f64::from_bits)
        .collect::<Vec<_>>();

    let spot_price = quotes
        .iter()
        .find_map(|quote| (quote.spot_price > 0.0).then_some(quote.spot_price))
        .unwrap_or(0.0);

    let risk = aggregate_risk(&quotes);
    let scenarios = [-0.10, -0.05, 0.05, 0.10]
        .iter()
        .map(|pct_move| ScenarioPoint {
            pct_move: *pct_move,
            estimated_pnl: scenario_pnl(&risk, spot_price, *pct_move),
        })
        .collect::<Vec<_>>();

    OptionsSnapshot {
        asset: asset.to_string(),
        updated_at: Utc::now(),
        active_expiry_unix,
        expiry_unixes: catalogue.expiry_unix_sorted_asc.clone(),
        spot_price,
        expiry_dates: expiry_datetimes_from_catalogue(catalogue),
        strikes,
        quotes,
        risk,
        scenarios,
    }
}

fn aggregate_risk(quotes: &[OptionQuote]) -> PortfolioRiskSummary {
    let totals = quotes
        .iter()
        .fold(PortfolioRiskSummary::default(), |mut totals, quote| {
            totals.aggregate_delta += quote.greeks.delta.unwrap_or(0.0);
            totals.aggregate_gamma += quote.greeks.gamma.unwrap_or(0.0);
            totals.aggregate_vega += quote.greeks.vega.unwrap_or(0.0);
            totals.aggregate_theta += quote.greeks.theta.unwrap_or(0.0);
            totals
        });

    PortfolioRiskSummary {
        hedge_ratio_btc: -totals.aggregate_delta,
        ..totals
    }
}

fn scenario_pnl(risk: &PortfolioRiskSummary, spot: f64, pct_move: f64) -> f64 {
    let spot_move = spot * pct_move;
    (0.5 * risk.aggregate_gamma * spot_move).mul_add(spot_move, risk.aggregate_delta * spot_move)
}

async fn apply_tab_switch(
    writer: &mut DeriveWsWriter,
    message_id: &mut i64,
    subscribed_channels: &mut Vec<String>,
    quote_map: &mut HashMap<String, QuoteState>,
    catalogue: &OptionsCatalogue,
    new_expiry_unix: i64,
) -> Result<(), DeriveError> {
    if !subscribed_channels.is_empty() {
        send_unsubscribe_batch(writer, subscribed_channels, message_id).await?;
        subscribed_channels.clear();
    }
    quote_map.clear();

    let names = catalogue
        .names_by_expiry_unix
        .get(&new_expiry_unix)
        .cloned()
        .unwrap_or_default();
    let channels = names
        .iter()
        .map(|name| channel_name_for_instrument(name))
        .collect::<Vec<_>>();
    if !channels.is_empty() {
        send_subscribe_batch(writer, &channels, message_id).await?;
    }
    *subscribed_channels = channels;
    Ok(())
}

async fn publish_snapshot(
    asset: &str,
    catalogue: &OptionsCatalogue,
    active_expiry_unix: i64,
    quote_map: &HashMap<String, QuoteState>,
    snapshot: &RwLock<OptionsSnapshot>,
    broadcast_tx: &broadcast::Sender<OptionsSnapshot>,
) {
    let next_snapshot = build_tab_snapshot(asset, catalogue, active_expiry_unix, quote_map);
    *snapshot.write().await = next_snapshot.clone();
    let _ = broadcast_tx.send(next_snapshot);
}

async fn process_message(
    message: Message,
    catalogue: &OptionsCatalogue,
    asset: &str,
    active_expiry_unix: i64,
    quote_map: &mut HashMap<String, QuoteState>,
    snapshot: &RwLock<OptionsSnapshot>,
    broadcast_tx: &broadcast::Sender<OptionsSnapshot>,
) -> Result<(), DeriveError> {
    if !message.is_text() {
        return Ok(());
    }
    let text = message.to_text()?;
    let Ok(notification) = serde_json::from_str::<WsNotification>(text) else {
        return Ok(());
    };
    let Some((channel, data)) = extract_notification_parts(&notification) else {
        return Ok(());
    };
    if !channel.starts_with("ticker_slim.") {
        return Ok(());
    }
    let Some(instrument_name) = parse_instrument_from_channel(&channel) else {
        return Ok(());
    };
    let Some(meta) = catalogue.instrument_by_name.get(&instrument_name) else {
        return Ok(());
    };
    if meta.expiry_unix != active_expiry_unix {
        return Ok(());
    }
    let state = QuoteState {
        bid: parse_optional_number(&data.instrument_ticker.best_bid_price),
        ask: parse_optional_number(&data.instrument_ticker.best_ask_price),
        bid_size: parse_optional_number(&data.instrument_ticker.best_bid_size),
        ask_size: parse_optional_number(&data.instrument_ticker.best_ask_size),
        mark: parse_optional_number(&data.instrument_ticker.mark_price),
        spot: parse_required_number(&data.instrument_ticker.index_price, "spot").unwrap_or(0.0),
        greeks: build_greeks(&data.instrument_ticker),
    };
    quote_map.insert(instrument_name, state);
    publish_snapshot(
        asset,
        catalogue,
        active_expiry_unix,
        quote_map,
        snapshot,
        broadcast_tx,
    )
    .await;
    Ok(())
}

async fn run_websocket_hub(
    ws_url: Url,
    catalogue: Arc<OptionsCatalogue>,
    asset: String,
    snapshot: Arc<RwLock<OptionsSnapshot>>,
    broadcast_tx: broadcast::Sender<OptionsSnapshot>,
    mut tab_command_rx: mpsc::Receiver<i64>,
    initial_expiry_unix: i64,
) -> Result<(), DeriveError> {
    let mut quote_map: HashMap<String, QuoteState> = HashMap::new();
    let mut active_expiry_unix = initial_expiry_unix;

    'reconnect: loop {
        let (stream, _) = match connect_async(ws_url.as_str()).await {
            Ok(pair) => pair,
            Err(error) => {
                error!(error = %error, url = %ws_url, "derive websocket connect failed");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue 'reconnect;
            }
        };
        info!(url = %ws_url, "derive websocket connected");
        let (mut writer, mut reader) = stream.split();

        let mut message_id: i64 = 1;
        let mut subscribed_channels: Vec<String> = Vec::new();

        if let Err(error) = apply_tab_switch(
            &mut writer,
            &mut message_id,
            &mut subscribed_channels,
            &mut quote_map,
            catalogue.as_ref(),
            active_expiry_unix,
        )
        .await
        {
            error!(error = %error, "derive initial tab subscriptions failed");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue 'reconnect;
        }

        publish_snapshot(
            asset.as_str(),
            catalogue.as_ref(),
            active_expiry_unix,
            &quote_map,
            snapshot.as_ref(),
            &broadcast_tx,
        )
        .await;

        'session: loop {
            tokio::select! {
                maybe_command = tab_command_rx.recv() => {
                    let Some(next_expiry_unix) = maybe_command else {
                        return Ok(());
                    };
                    if !catalogue.expiry_unix_sorted_asc.contains(&next_expiry_unix) {
                        warn!(expiry_unix = next_expiry_unix, "ignored unknown expiry tab switch");
                        continue;
                    }
                    active_expiry_unix = next_expiry_unix;
                    if let Err(error) = apply_tab_switch(
                        &mut writer,
                        &mut message_id,
                        &mut subscribed_channels,
                        &mut quote_map,
                        catalogue.as_ref(),
                        active_expiry_unix,
                    ).await {
                        error!(error = %error, "derive tab switch failed");
                        break 'session;
                    }
                    publish_snapshot(
                        asset.as_str(),
                        catalogue.as_ref(),
                        active_expiry_unix,
                        &quote_map,
                        snapshot.as_ref(),
                        &broadcast_tx,
                    )
                    .await;
                    debug!(expiry_unix = active_expiry_unix, "derive tab switched and subscriptions updated");
                }
                maybe_message = reader.next() => {
                    let Some(message_result) = maybe_message else {
                        break 'session;
                    };
                    let message = match message_result {
                        Ok(message) => message,
                        Err(error) => {
                            error!(error = %error, "derive websocket read failed");
                            break 'session;
                        }
                    };
                    process_message(
                        message,
                        catalogue.as_ref(),
                        asset.as_str(),
                        active_expiry_unix,
                        &mut quote_map,
                        snapshot.as_ref(),
                        &broadcast_tx,
                    )
                    .await?;
                }
            }
        }

        warn!(url = %ws_url, "derive websocket session ended, reconnecting");
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn get_bootstrap(State(state): State<Arc<DeriveState>>) -> Json<OptionsBootstrap> {
    Json(build_bootstrap(state.catalogue.as_ref(), BTC_ASSET))
}

async fn get_snapshot(State(state): State<Arc<DeriveState>>) -> Json<OptionsSnapshot> {
    Json(state.snapshot.read().await.clone())
}

async fn stream_options(
    State(state): State<Arc<DeriveState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.tx.subscribe();
    let stream = futures::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(next_snapshot) => {
                    let event = match Event::default().json_data(next_snapshot) {
                        Ok(event) => event,
                        Err(error) => {
                            warn!(error = %error, "derive options stream serialization failed");
                            continue;
                        }
                    };
                    return Some((Ok(event), receiver));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream)
}

/// Switch the active expiry that the server streams.
///
/// The derive server holds a single, process-global active expiry shared by
/// every SSE subscriber, so it is intended for single-client use: if two
/// clients select different expiries, the most recent request wins and both
/// clients see that expiry's data.
async fn post_active_expiry(
    State(state): State<Arc<DeriveState>>,
    Json(body): Json<ActiveExpiryBody>,
) -> Result<StatusCode, StatusCode> {
    if !state
        .catalogue
        .expiry_unix_sorted_asc
        .contains(&body.expiry_unix)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    state
        .tab_command_tx
        .send(body.expiry_unix)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn derive_app(config: DeriveConfig) -> Result<Router, DeriveError> {
    let http = Client::new();
    let catalogue =
        Arc::new(fetch_options_catalogue(&http, &config.rest_base_url, BTC_ASSET).await?);
    let Some(default_expiry_unix) = catalogue.expiry_unix_sorted_asc.first().copied() else {
        error!(
            asset = BTC_ASSET,
            "derive returned no active option expiries"
        );
        return Err(DeriveError::Api {
            message: "derive returned no active option expiries".to_string(),
        });
    };

    let empty_snapshot = build_tab_snapshot(
        BTC_ASSET,
        catalogue.as_ref(),
        default_expiry_unix,
        &HashMap::new(),
    );
    let snapshot = Arc::new(RwLock::new(empty_snapshot));
    let (broadcast_tx, _) = broadcast::channel(2048);
    let (tab_command_tx, tab_command_rx) = mpsc::channel::<i64>(32);

    let state = Arc::new(DeriveState {
        catalogue: Arc::clone(&catalogue),
        snapshot: Arc::clone(&snapshot),
        tx: broadcast_tx.clone(),
        tab_command_tx,
    });

    let ws_url = config.ws_url.clone();
    let snapshot_for_task = Arc::clone(&snapshot);
    let catalogue_for_task = Arc::clone(&catalogue);
    tokio::spawn(async move {
        if let Err(error) = run_websocket_hub(
            ws_url,
            catalogue_for_task,
            BTC_ASSET.to_string(),
            snapshot_for_task,
            broadcast_tx,
            tab_command_rx,
            default_expiry_unix,
        )
        .await
        {
            error!(error = %error, "derive websocket hub exited with error");
        }
    });

    info!(port = config.port, "derive options server ready");
    let router = Router::new()
        .route("/health", get(health))
        .route("/derive/options/bootstrap", get(get_bootstrap))
        .route("/derive/options/snapshot", get(get_snapshot))
        .route("/derive/options/stream", get(stream_options))
        .route("/derive/options/active_expiry", post(post_active_expiry))
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state);
    Ok(router)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_greeks_maps_option_pricing_including_zero_bid_iv() {
        let ticker: TickerSlimDto = serde_json::from_value(serde_json::json!({
            "A": "1",
            "B": "1",
            "a": "1",
            "b": "1",
            "I": "71760",
            "M": "13289",
            "option_pricing": {
                "d": "-0.9545",
                "t": "-15.89706",
                "g": "0.00001374",
                "v": "16.42465",
                "i": "0.40474",
                "r": "761.28903",
                "f": "71824",
                "m": "13289",
                "df": "0.999",
                "bi": "0",
                "ai": "0.54578"
            }
        }))
        .expect("fixture ticker");

        let greeks = build_greeks(&ticker);
        assert!((greeks.delta.expect("delta") + 0.9545).abs() < 1e-9);
        assert_eq!(greeks.bid_iv, Some(0.0));
        assert!((greeks.ask_iv.expect("ask_iv") - 0.54578).abs() < 1e-9);
        assert!((greeks.rho.expect("rho") - 761.28903).abs() < 1e-5);
        assert_eq!(greeks.forward_price, Some(71824.0));
        assert_eq!(greeks.option_model_mark, Some(13289.0));
        assert!((greeks.discount_factor.expect("df") - 0.999).abs() < 1e-9);
    }

    #[test]
    fn build_greeks_default_without_option_pricing() {
        let ticker: TickerSlimDto = serde_json::from_value(serde_json::json!({
            "A": "1",
            "B": "1",
            "a": "1",
            "b": "1",
            "I": "100",
            "M": "50",
            "option_pricing": null
        }))
        .expect("fixture ticker");

        let greeks = build_greeks(&ticker);
        assert_eq!(greeks.delta, None);
        assert_eq!(greeks.iv, None);
    }

    fn quote_with_greeks(
        instrument_name: &str,
        strike: f64,
        spot: f64,
        delta: Option<f64>,
        gamma: Option<f64>,
        vega: Option<f64>,
        theta: Option<f64>,
    ) -> OptionQuote {
        OptionQuote {
            instrument_name: instrument_name.to_string(),
            kind: OptionKind::Call,
            strike,
            expiry: Utc
                .timestamp_opt(1_700_000_000, 0)
                .single()
                .expect("valid timestamp"),
            expiry_unix: 1_700_000_000,
            bid: None,
            ask: None,
            bid_size: None,
            ask_size: None,
            mark: None,
            spot_price: spot,
            moneyness: Moneyness::AtTheMoney,
            greeks: OptionGreeks {
                delta,
                gamma,
                vega,
                theta,
                ..OptionGreeks::default()
            },
        }
    }

    #[test]
    fn compute_moneyness_classifies_calls_and_puts_outside_the_atm_band() {
        assert_eq!(
            compute_moneyness(OptionKind::Call, 60000.0, 70000.0),
            Moneyness::InTheMoney
        );
        assert_eq!(
            compute_moneyness(OptionKind::Call, 80000.0, 70000.0),
            Moneyness::OutOfTheMoney
        );
        assert_eq!(
            compute_moneyness(OptionKind::Put, 80000.0, 70000.0),
            Moneyness::InTheMoney
        );
        assert_eq!(
            compute_moneyness(OptionKind::Put, 60000.0, 70000.0),
            Moneyness::OutOfTheMoney
        );
    }

    #[test]
    fn compute_moneyness_returns_atm_inside_the_tolerance_band() {
        // |70100 - 70000| / 70000 = 0.0014, which is below ATM_TOLERANCE (0.005).
        assert_eq!(
            compute_moneyness(OptionKind::Call, 70100.0, 70000.0),
            Moneyness::AtTheMoney
        );
        assert_eq!(
            compute_moneyness(OptionKind::Put, 69900.0, 70000.0),
            Moneyness::AtTheMoney
        );
    }

    #[test]
    fn compute_moneyness_treats_nonpositive_spot_as_atm() {
        assert_eq!(
            compute_moneyness(OptionKind::Call, 70000.0, 0.0),
            Moneyness::AtTheMoney
        );
        assert_eq!(
            compute_moneyness(OptionKind::Put, 70000.0, -5.0),
            Moneyness::AtTheMoney
        );
    }

    #[test]
    fn aggregate_risk_sums_present_greeks_and_negates_delta_for_hedge() {
        let quotes = vec![
            quote_with_greeks(
                "BTC-A",
                70000.0,
                70000.0,
                Some(0.5),
                Some(0.01),
                Some(2.0),
                Some(-1.0),
            ),
            quote_with_greeks(
                "BTC-B",
                71000.0,
                70000.0,
                Some(-0.25),
                None,
                Some(3.0),
                Some(-0.5),
            ),
        ];

        let risk = aggregate_risk(&quotes);

        assert!((risk.aggregate_delta - 0.25).abs() < 1e-9);
        assert!((risk.aggregate_gamma - 0.01).abs() < 1e-9);
        assert!((risk.aggregate_vega - 5.0).abs() < 1e-9);
        assert!((risk.aggregate_theta - (-1.5)).abs() < 1e-9);
        assert!((risk.hedge_ratio_btc - (-0.25)).abs() < 1e-9);
    }

    #[test]
    fn aggregate_risk_is_zero_for_empty_holdings() {
        let risk = aggregate_risk(&[]);

        assert!(risk.aggregate_delta.abs() < 1e-9);
        assert!(risk.aggregate_gamma.abs() < 1e-9);
        assert!(risk.aggregate_vega.abs() < 1e-9);
        assert!(risk.aggregate_theta.abs() < 1e-9);
        assert!(risk.hedge_ratio_btc.abs() < 1e-9);
    }

    #[test]
    fn scenario_pnl_combines_delta_and_gamma_terms() {
        let risk = PortfolioRiskSummary {
            aggregate_delta: 2.0,
            aggregate_gamma: 0.5,
            aggregate_vega: 0.0,
            aggregate_theta: 0.0,
            hedge_ratio_btc: -2.0,
        };

        // spot 100, +10% move: spot_move = 10
        // pnl = 2 * 10 + 0.5 * 0.5 * 10 * 10 = 20 + 25 = 45
        assert!((scenario_pnl(&risk, 100.0, 0.10) - 45.0).abs() < 1e-9);

        // spot 100, -10% move: spot_move = -10
        // pnl = 2 * -10 + 0.5 * 0.5 * 100 = -20 + 25 = 5
        assert!((scenario_pnl(&risk, 100.0, -0.10) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn parse_optional_number_treats_zero_and_garbage_as_absent() {
        assert_eq!(parse_optional_number("0"), None);
        assert_eq!(parse_optional_number("0.0"), None);
        assert_eq!(parse_optional_number("not-a-number"), None);
        assert_eq!(parse_optional_number("12.5"), Some(12.5));
        assert_eq!(parse_optional_number("-3.25"), Some(-3.25));
    }

    #[test]
    fn parse_instrument_from_channel_requires_three_segment_ticker_slim() {
        assert_eq!(
            parse_instrument_from_channel("ticker_slim.BTC-20240101-70000-C.100"),
            Some("BTC-20240101-70000-C".to_string())
        );
        assert_eq!(parse_instrument_from_channel("orderbook.BTC.100"), None);
        assert_eq!(parse_instrument_from_channel("ticker_slim.BTC"), None);
    }

    #[test]
    fn build_tab_snapshot_dedups_strikes_and_selects_first_positive_spot() {
        let expiry = Utc
            .timestamp_opt(1_700_000_000, 0)
            .single()
            .expect("valid timestamp");
        let metas = vec![
            InstrumentMeta {
                instrument_name: "BTC-C-70000".to_string(),
                kind: OptionKind::Call,
                strike: 70000.0,
                expiry,
                expiry_unix: 1_700_000_000,
            },
            InstrumentMeta {
                instrument_name: "BTC-P-70000".to_string(),
                kind: OptionKind::Put,
                strike: 70000.0,
                expiry,
                expiry_unix: 1_700_000_000,
            },
            InstrumentMeta {
                instrument_name: "BTC-C-71000".to_string(),
                kind: OptionKind::Call,
                strike: 71000.0,
                expiry,
                expiry_unix: 1_700_000_000,
            },
        ];

        let mut instrument_by_name = HashMap::new();
        let mut names = Vec::new();
        for meta in &metas {
            instrument_by_name.insert(meta.instrument_name.clone(), meta.clone());
            names.push(meta.instrument_name.clone());
        }
        let mut names_by_expiry_unix = HashMap::new();
        names_by_expiry_unix.insert(1_700_000_000, names);
        let catalogue = OptionsCatalogue {
            instrument_by_name,
            names_by_expiry_unix,
            expiry_unix_sorted_asc: vec![1_700_000_000],
        };

        let mut quote_map: HashMap<String, QuoteState> = HashMap::new();
        quote_map.insert(
            "BTC-C-70000".to_string(),
            QuoteState {
                spot: 70500.0,
                greeks: OptionGreeks {
                    delta: Some(0.4),
                    ..OptionGreeks::default()
                },
                ..QuoteState::default()
            },
        );

        let snapshot = build_tab_snapshot("BTC", &catalogue, 1_700_000_000, &quote_map);

        assert_eq!(snapshot.strikes, vec![70000.0, 71000.0]);
        assert!((snapshot.spot_price - 70500.0).abs() < 1e-9);
        assert_eq!(snapshot.quotes.len(), 3);
        assert!((snapshot.risk.aggregate_delta - 0.4).abs() < 1e-9);
        assert_eq!(snapshot.scenarios.len(), 4);
    }
}
