//! Compare a target portfolio against the current one: per-position weight
//! deltas, with positions below the minimum tradable change marked so the UI
//! and the staged trades agree on what counts as tradable.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::debug;

/// A request to compare target vs current portfolio weights.
///
/// Weights are signed proportions (negative for shorts); a symbol absent from a
/// side has weight 0 there. `min_tradable_change` is the minimum absolute weight
/// delta for a position to count as tradable, sourced from the caller's single
/// `portfolio.minTradableChange` config so the preview and the rebalance agree.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortfolioComparisonRequest {
    target: HashMap<String, f64>,
    current: HashMap<String, f64>,
    min_tradable_change: f64,
}

/// One position's target vs current comparison.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PositionComparison {
    symbol: String,
    target_weight: f64,
    current_weight: f64,
    delta: f64,
    tradable: bool,
}

/// Why a comparison request is rejected before any delta is computed.
///
/// JSON parses out-of-range floats (`1e309`) to infinity and serializes
/// non-finite floats back as `null`, so an unvalidated request silently yields a
/// corrupt response; a negative threshold marks every position tradable. Both are
/// caller errors the endpoint must refuse rather than answer.
#[derive(Debug, Error, PartialEq)]
pub(crate) enum ComparisonError {
    #[error("portfolio weights must be finite")]
    NonFiniteWeight,

    #[error("minimum tradable change must be finite and non-negative")]
    InvalidThreshold,
}

/// Compares target vs current weights, one row per symbol present in either side
/// (sorted by symbol). A position is tradable when `|delta| >= min_tradable_change`.
///
/// Rejects non-finite weights and a non-finite or negative threshold so the
/// response never carries `null` deltas or a degenerate all-tradable result.
pub(crate) fn compare_portfolios(
    request: &PortfolioComparisonRequest,
) -> Result<Vec<PositionComparison>, ComparisonError> {
    let all_finite = request
        .target
        .values()
        .chain(request.current.values())
        .all(|weight| weight.is_finite());
    if !all_finite {
        return Err(ComparisonError::NonFiniteWeight);
    }

    if !request.min_tradable_change.is_finite() || request.min_tradable_change < 0.0 {
        return Err(ComparisonError::InvalidThreshold);
    }

    let mut symbols: Vec<&String> = request
        .target
        .keys()
        .chain(request.current.keys())
        .collect();
    symbols.sort_unstable();
    symbols.dedup();

    let comparisons: Vec<PositionComparison> = symbols
        .into_iter()
        .map(|symbol| {
            // A symbol absent from a side has zero weight there (no position).
            let target_weight = request.target.get(symbol).copied().unwrap_or(0.0);
            let current_weight = request.current.get(symbol).copied().unwrap_or(0.0);
            let delta = target_weight - current_weight;
            PositionComparison {
                symbol: symbol.clone(),
                target_weight,
                current_weight,
                delta,
                tradable: delta.abs() >= request.min_tradable_change,
            }
        })
        .collect();

    let tradable = comparisons.iter().filter(|row| row.tradable).count();
    debug!(
        positions = comparisons.len(),
        tradable, "portfolio compared"
    );
    Ok(comparisons)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing::Level;
    use tracing_test::traced_test;

    use crate::logs_contain_at;

    fn request(
        target: &[(&str, f64)],
        current: &[(&str, f64)],
        min_tradable_change: f64,
    ) -> PortfolioComparisonRequest {
        PortfolioComparisonRequest {
            target: target
                .iter()
                .map(|(symbol, weight)| ((*symbol).to_string(), *weight))
                .collect(),
            current: current
                .iter()
                .map(|(symbol, weight)| ((*symbol).to_string(), *weight))
                .collect(),
            min_tradable_change,
        }
    }

    fn row<'a>(comparisons: &'a [PositionComparison], symbol: &str) -> &'a PositionComparison {
        comparisons
            .iter()
            .find(|row| row.symbol == symbol)
            .expect("symbol present")
    }

    #[traced_test]
    #[test]
    fn computes_delta_and_tradability_per_position() {
        let comparison = compare_portfolios(&request(
            &[("BTC", 0.6), ("ETH", 0.4)],
            &[("BTC", 0.5), ("ETH", 0.3)],
            0.05,
        ))
        .expect("finite weights and a valid threshold");

        let btc = row(&comparison, "BTC");
        assert!((btc.target_weight - 0.6).abs() < 1e-12);
        assert!((btc.current_weight - 0.5).abs() < 1e-12);
        assert!((btc.delta - 0.1).abs() < 1e-12);
        assert!(btc.tradable, "0.1 delta exceeds the 0.05 threshold");

        assert!(logs_contain_at(Level::DEBUG, &["portfolio compared"]));
    }

    #[test]
    fn marks_sub_threshold_positions_not_tradable() {
        let comparison = compare_portfolios(&request(&[("BTC", 0.55)], &[("BTC", 0.5)], 0.1))
            .expect("finite weights and a valid threshold");
        assert!(
            !row(&comparison, "BTC").tradable,
            "a 0.05 delta is below the 0.1 threshold"
        );
    }

    #[test]
    fn includes_symbols_present_on_only_one_side() {
        // SOL is a current position with no target (a full exit); NEW is a target
        // with no current position (a fresh entry).
        let comparison = compare_portfolios(&request(&[("NEW", 0.3)], &[("SOL", 0.2)], 0.05))
            .expect("finite weights and a valid threshold");

        let sol = row(&comparison, "SOL");
        assert!((sol.target_weight - 0.0).abs() < 1e-12);
        assert!((sol.delta - (-0.2)).abs() < 1e-12);
        assert!(sol.tradable);

        let new = row(&comparison, "NEW");
        assert!((new.current_weight - 0.0).abs() < 1e-12);
        assert!((new.delta - 0.3).abs() < 1e-12);
        assert!(new.tradable);
    }

    #[test]
    fn rows_are_sorted_by_symbol() {
        let comparison = compare_portfolios(&request(
            &[("SOL", 0.3), ("BTC", 0.4), ("ETH", 0.3)],
            &[],
            0.0,
        ))
        .expect("finite weights and a valid threshold");
        let symbols: Vec<&str> = comparison.iter().map(|row| row.symbol.as_str()).collect();
        assert_eq!(symbols, ["BTC", "ETH", "SOL"]);
    }

    #[test]
    fn rejects_non_finite_weight() {
        let infinite = compare_portfolios(&request(&[("BTC", f64::INFINITY)], &[], 0.05));
        assert_eq!(infinite, Err(ComparisonError::NonFiniteWeight));

        let not_a_number = compare_portfolios(&request(&[], &[("ETH", f64::NAN)], 0.05));
        assert_eq!(not_a_number, Err(ComparisonError::NonFiniteWeight));
    }

    #[test]
    fn rejects_negative_threshold() {
        let comparison = compare_portfolios(&request(&[("BTC", 0.5)], &[("BTC", 0.5)], -0.05));
        assert_eq!(comparison, Err(ComparisonError::InvalidThreshold));
    }

    #[test]
    fn rejects_non_finite_threshold() {
        let comparison = compare_portfolios(&request(&[("BTC", 0.5)], &[("BTC", 0.4)], f64::NAN));
        assert_eq!(comparison, Err(ComparisonError::InvalidThreshold));
    }
}
