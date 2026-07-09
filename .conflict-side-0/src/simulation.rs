//! Forward simulation: project portfolio metrics for a staged set of weights so
//! users can see a rebalance's impact before sending any trades.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tracing::{debug, instrument};

use crate::factors::{ReturnsError, compute_portfolio_beta_report};
use crate::finance::Symbol;

/// Benchmark for projected portfolio beta. Bitcoin beta is the SPEC's core risk
/// metric, so simulations always project beta to BTC.
const BENCHMARK_TICKER: &str = "BTC";

/// A request to project metrics for the current and staged portfolios.
///
/// Weights are signed proportions (negative for shorts).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SimulationRequest {
    current: HashMap<String, f64>,
    staged: HashMap<String, f64>,
}

/// Projected metrics for one portfolio. Extended as the risk engine lands.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectedMetrics {
    /// Portfolio beta to Bitcoin; null when there is insufficient return data.
    beta: Option<f64>,
}

/// Current and staged projections, side by side for direct comparison.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SimulationResponse {
    current: ProjectedMetrics,
    staged: ProjectedMetrics,
}

/// Projects metrics for the current and staged portfolios.
#[instrument(skip_all, fields(data_dir = %data_dir.display()))]
pub(crate) async fn simulate(
    data_dir: &Path,
    request: &SimulationRequest,
) -> Result<SimulationResponse, ReturnsError> {
    let current = project_metrics(data_dir, &request.current).await?;
    let staged = project_metrics(data_dir, &request.staged).await?;
    debug!(
        current_beta = ?current.beta,
        staged_beta = ?staged.beta,
        "portfolio simulated"
    );
    Ok(SimulationResponse { current, staged })
}

/// Projects metrics for a single set of weights.
async fn project_metrics(
    data_dir: &Path,
    weights: &HashMap<String, f64>,
) -> Result<ProjectedMetrics, ReturnsError> {
    let weights: Vec<(Symbol, f64)> = weights
        .iter()
        .map(|(symbol, weight)| (Symbol::from_raw(symbol), *weight))
        .collect();
    let beta =
        compute_portfolio_beta_report(data_dir, &weights, &Symbol::from_raw(BENCHMARK_TICKER))
            .await?
            .beta;

    Ok(ProjectedMetrics { beta })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use tracing::Level;
    use tracing_test::traced_test;

    use crate::logs_contain_at;

    fn weights(entries: &[(&str, f64)]) -> HashMap<String, f64> {
        entries
            .iter()
            .map(|(symbol, weight)| ((*symbol).to_string(), *weight))
            .collect()
    }

    #[traced_test]
    #[tokio::test]
    async fn projects_current_and_staged_beta_side_by_side() {
        let data_dir = TempDir::new().unwrap();
        fs::copy(
            "fixtures/ohlcv_1d_beta.csv",
            data_dir.path().join("ohlcv_1d.csv"),
        )
        .unwrap();

        let request = SimulationRequest {
            current: weights(&[("BTC", 1.0)]),
            staged: weights(&[("BTC", 0.6), ("ETH", -0.4)]),
        };

        let response = simulate(data_dir.path(), &request).await.unwrap();

        // A pure-BTC portfolio has beta 1 to BTC; the staged 60/-40 portfolio
        // matches the POST /beta regression value.
        assert!((response.current.beta.unwrap() - 1.0).abs() < 1e-10);
        assert!((response.staged.beta.unwrap() - 0.592_091_722_3).abs() < 1e-10);
        assert!(logs_contain_at(Level::DEBUG, &["portfolio simulated"]));
    }

    #[tokio::test]
    async fn errors_when_no_candle_data() {
        let data_dir = TempDir::new().unwrap();
        let request = SimulationRequest {
            current: weights(&[("BTC", 1.0)]),
            staged: weights(&[("BTC", 1.0)]),
        };

        let result = simulate(data_dir.path(), &request).await;
        assert!(matches!(result, Err(ReturnsError::NoData { .. })));
    }
}
