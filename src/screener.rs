//! Screener: rank the perp universe by a factor so users build factor-driven
//! portfolios instead of picking symbols by hand.
//!
//! Each factor has a documented default sort direction, ties break by 24h volume
//! (descending) then symbol (ascending), and rows missing the chosen factor are
//! always sorted last and tagged with a `missing` flag.

use std::path::Path;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::Response;
use polars::prelude::{
    DataFrame, IntoLazy, JsonFormat, JsonWriter, PolarsError, SerWriter, SortMultipleOptions, col,
};
use serde::Deserialize;
use thiserror::Error;
use tracing::{debug, error, instrument};

use crate::factors::{ReturnsError, compute_factors};
use crate::timeframe::Timeframe;
use crate::{AppState, raw_json};

/// A factor the screener can rank the perp universe by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RankFactor {
    Beta,
    Momentum,
    Carry,
    Volatility,
    Sharpe,
}

/// Sort order for a ranking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SortDirection {
    Ascending,
    Descending,
}

/// A request to rank the universe by a factor, with optional overrides.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenerRequest {
    factor: RankFactor,
    /// Overrides the factor's documented default direction when present. For
    /// carry, ascending expresses a short bias and descending a long bias.
    direction: Option<SortDirection>,
    /// Keeps only the top `limit` rows after ranking, when present.
    limit: Option<usize>,
}

#[derive(Debug, Error)]
pub(crate) enum ScreenerError {
    #[error(transparent)]
    Factors(#[from] ReturnsError),
    #[error(transparent)]
    Polars(#[from] PolarsError),
}

/// Ranks the perp universe for `timeframe` by the requested factor and returns
/// the ranked rows as a JSON array.
#[instrument(skip_all, fields(data_dir = %data_dir.display()))]
pub(crate) async fn screen(
    data_dir: &Path,
    timeframe: Timeframe,
    request: &ScreenerRequest,
) -> Result<Vec<u8>, ScreenerError> {
    let factors = compute_factors(data_dir, timeframe).await?;
    let mut ranked = rank_perps_by_factor(factors, request)?;

    let mut buf = Vec::new();
    JsonWriter::new(&mut buf)
        .with_json_format(JsonFormat::Json)
        .finish(&mut ranked)?;
    Ok(buf)
}

/// Ranks the factor table by the requested factor.
///
/// Adds a `missing` flag (true where the chosen factor is null), sorts missing
/// rows last regardless of direction, then orders by the factor, breaking ties
/// by 24h volume (descending) then ticker (ascending). Honors a direction
/// override and an optional top-`limit` filter.
pub(crate) fn rank_perps_by_factor(
    factors: DataFrame,
    request: &ScreenerRequest,
) -> Result<DataFrame, PolarsError> {
    let column = request.factor.column();
    let direction = request
        .direction
        .unwrap_or_else(|| request.factor.default_direction());
    let descending = matches!(direction, SortDirection::Descending);

    let ranked = factors
        .lazy()
        .with_column(col(column).is_null().alias("missing"))
        // missing first (ascending: present rows, then missing), then the factor
        // in its direction, then the tie-breaks: 24h volume desc, ticker asc.
        .sort_by_exprs(
            [
                col("missing"),
                col(column),
                col("volume_24h"),
                col("ticker"),
            ],
            SortMultipleOptions::default()
                .with_order_descending_multi([false, descending, true, false])
                .with_nulls_last(true),
        )
        .collect()?;

    let ranked = match request.limit {
        Some(limit) => ranked.head(Some(limit)),
        None => ranked,
    };

    debug!(
        factor = column,
        limit = request.limit.unwrap_or(0),
        rows = ranked.height(),
        "perps ranked"
    );
    Ok(ranked)
}

impl RankFactor {
    /// The factor-table column this factor ranks on.
    fn column(self) -> &'static str {
        match self {
            Self::Beta => "beta",
            Self::Momentum => "cum_return",
            Self::Carry => "carry",
            Self::Volatility => "annualized_volatility",
            Self::Sharpe => "sharpe",
        }
    }

    /// The documented default sort direction. Carry defaults to descending (a
    /// long bias); a short bias is expressed by overriding to ascending.
    fn default_direction(self) -> SortDirection {
        match self {
            Self::Beta | Self::Momentum | Self::Carry | Self::Sharpe => SortDirection::Descending,
            Self::Volatility => SortDirection::Ascending,
        }
    }
}

/// `POST /screener/<timeframe>` -- ranks the perp universe by the requested factor.
pub(crate) async fn post_screener(
    State(state): State<Arc<AppState>>,
    AxumPath(timeframe): AxumPath<String>,
    Json(body): Json<ScreenerRequest>,
) -> Result<Response, StatusCode> {
    let timeframe =
        Timeframe::from_interval_string(&timeframe).ok_or(StatusCode::UNPROCESSABLE_ENTITY)?;
    match screen(&state.config.data_dir, timeframe, &body).await {
        Ok(json) => Ok(raw_json(json)),
        Err(ScreenerError::Factors(ReturnsError::NoData { .. })) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            error!(error = %err, "failed to screen perps");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;
    use std::fs;
    use tempfile::TempDir;
    use tracing::Level;
    use tracing_test::traced_test;

    use crate::logs_contain_at;

    fn request(
        factor: RankFactor,
        direction: Option<SortDirection>,
        limit: Option<usize>,
    ) -> ScreenerRequest {
        ScreenerRequest {
            factor,
            direction,
            limit,
        }
    }

    fn tickers_in_order(ranked: &DataFrame) -> Vec<String> {
        let column = ranked.column("ticker").unwrap().str().unwrap();
        (0..column.len())
            .map(|index| column.get(index).unwrap().to_string())
            .collect()
    }

    #[traced_test]
    #[test]
    fn ranks_by_sharpe_descending_by_default() {
        let factors = df! {
            "ticker" => &["AAA", "BBB", "CCC"],
            "sharpe" => &[1.0, 3.0, 2.0_f64],
            "volume_24h" => &[1.0, 1.0, 1.0_f64],
        }
        .unwrap();

        let ranked =
            rank_perps_by_factor(factors, &request(RankFactor::Sharpe, None, None)).unwrap();
        assert_eq!(tickers_in_order(&ranked), ["BBB", "CCC", "AAA"]);
        assert!(logs_contain_at(Level::DEBUG, &["perps ranked", "sharpe"]));
    }

    #[traced_test]
    #[test]
    fn ranks_by_volatility_ascending_by_default() {
        let factors = df! {
            "ticker" => &["AAA", "BBB", "CCC"],
            "annualized_volatility" => &[0.3, 0.1, 0.2_f64],
            "volume_24h" => &[1.0, 1.0, 1.0_f64],
        }
        .unwrap();

        let ranked =
            rank_perps_by_factor(factors, &request(RankFactor::Volatility, None, None)).unwrap();
        assert_eq!(tickers_in_order(&ranked), ["BBB", "CCC", "AAA"]);
        assert!(logs_contain_at(
            Level::DEBUG,
            &["perps ranked", "annualized_volatility"]
        ));
    }

    #[traced_test]
    #[test]
    fn carry_defaults_to_descending_and_short_bias_overrides_to_ascending() {
        let factors = df! {
            "ticker" => &["AAA", "BBB"],
            "carry" => &[0.0001, -0.0002_f64],
            "volume_24h" => &[1.0, 1.0_f64],
        }
        .unwrap();

        let long =
            rank_perps_by_factor(factors.clone(), &request(RankFactor::Carry, None, None)).unwrap();
        assert_eq!(
            tickers_in_order(&long),
            ["AAA", "BBB"],
            "long bias: highest carry first"
        );

        let short = rank_perps_by_factor(
            factors,
            &request(RankFactor::Carry, Some(SortDirection::Ascending), None),
        )
        .unwrap();
        assert_eq!(
            tickers_in_order(&short),
            ["BBB", "AAA"],
            "short bias: lowest carry first"
        );
        assert!(logs_contain_at(Level::DEBUG, &["perps ranked", "carry"]));
    }

    #[traced_test]
    #[test]
    fn missing_rows_sort_last_and_are_flagged_regardless_of_direction() {
        let factors = df! {
            "ticker" => &["AAA", "BBB", "CCC"],
            "sharpe" => &[Some(1.0), None, Some(2.0_f64)],
            "volume_24h" => &[1.0, 1.0, 1.0_f64],
        }
        .unwrap();

        for direction in [SortDirection::Ascending, SortDirection::Descending] {
            let ranked = rank_perps_by_factor(
                factors.clone(),
                &request(RankFactor::Sharpe, Some(direction), None),
            )
            .unwrap();
            let order = tickers_in_order(&ranked);
            assert_eq!(order.last().unwrap(), "BBB", "missing row is always last");

            let missing = ranked.column("missing").unwrap().bool().unwrap();
            let bbb_index = order.iter().position(|ticker| ticker == "BBB").unwrap();
            assert_eq!(missing.get(bbb_index), Some(true), "missing row is flagged");
        }
        assert!(logs_contain_at(Level::DEBUG, &["perps ranked", "sharpe"]));
    }

    #[traced_test]
    #[test]
    fn ties_break_by_volume_then_symbol() {
        let factors = df! {
            "ticker" => &["AAA", "BBB", "CCC"],
            "sharpe" => &[1.0, 1.0, 1.0_f64],
            "volume_24h" => &[100.0, 300.0, 300.0_f64],
        }
        .unwrap();

        // All sharpe equal: higher volume first (BBB, CCC at 300 before AAA at
        // 100); the BBB/CCC tie breaks by symbol ascending.
        let ranked =
            rank_perps_by_factor(factors, &request(RankFactor::Sharpe, None, None)).unwrap();
        assert_eq!(tickers_in_order(&ranked), ["BBB", "CCC", "AAA"]);
        assert!(logs_contain_at(Level::DEBUG, &["perps ranked", "sharpe"]));
    }

    #[traced_test]
    #[test]
    fn limit_keeps_only_the_top_rows() {
        let factors = df! {
            "ticker" => &["AAA", "BBB", "CCC"],
            "sharpe" => &[1.0, 3.0, 2.0_f64],
            "volume_24h" => &[1.0, 1.0, 1.0_f64],
        }
        .unwrap();

        let ranked =
            rank_perps_by_factor(factors, &request(RankFactor::Sharpe, None, Some(2))).unwrap();
        assert_eq!(tickers_in_order(&ranked), ["BBB", "CCC"]);
        assert!(logs_contain_at(Level::DEBUG, &["perps ranked", "limit=2"]));
    }

    #[traced_test]
    #[tokio::test]
    async fn screen_ranks_real_factors_and_logs() {
        let tmp_dir = TempDir::new().unwrap();
        fs::copy(
            "fixtures/ohlcv_1d_beta.csv",
            tmp_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();

        let body = screen(
            tmp_dir.path(),
            Timeframe::OneDay,
            &request(RankFactor::Sharpe, None, None),
        )
        .await
        .unwrap();

        let rows: Vec<serde_json::Value> =
            serde_json::from_str(&String::from_utf8(body).unwrap()).unwrap();
        assert!(!rows.is_empty(), "expected ranked rows");
        assert!(
            rows.iter().all(|row| row.get("missing").is_some()),
            "every row carries a missing flag"
        );
        assert!(logs_contain_at(Level::DEBUG, &["perps ranked"]));
    }
}
