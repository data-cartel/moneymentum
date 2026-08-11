//! Carry factor: the latest signed funding rate per asset, joined into the
//! per-ticker factor scores from `funding_rate1h.csv`.

use polars::prelude::{
    DataFrame, DataFrameJoinOps, DataType, IntoLazy, JoinArgs, JoinType, NULL, PolarsError,
    SortMultipleOptions, col, lit,
};

use super::returns::chronological;

/// Joins the carry factor (latest signed funding rate per ticker) into `factors`.
///
/// When funding data is absent, adds a null `carry` column so the factor table
/// keeps a stable schema.
pub(super) fn with_carry(
    factors: DataFrame,
    funding: Option<&DataFrame>,
) -> Result<DataFrame, PolarsError> {
    match funding {
        Some(funding) => {
            let carry = carry_by_ticker(funding)?;
            Ok(factors.join(
                &carry,
                ["ticker"],
                ["ticker"],
                JoinArgs::new(JoinType::Left),
                None,
            )?)
        }
        None => Ok(factors
            .lazy()
            .with_column(lit(NULL).cast(DataType::Float64).alias("carry"))
            .collect()?),
    }
}

/// Latest funding rate per symbol, as a `DataFrame` keyed by `ticker`.
///
/// Funding rates are signed: positive means longs pay shorts, so a positive
/// carry is a cost of being long and a yield for being short.
fn carry_by_ticker(funding: &DataFrame) -> Result<DataFrame, PolarsError> {
    funding
        .clone()
        .lazy()
        .group_by([col("symbol")])
        .agg([chronological("funding_rate").last().alias("carry")])
        .select([col("symbol").alias("ticker"), col("carry")])
        .sort(["ticker"], SortMultipleOptions::default())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use polars::prelude::df;

    fn sample_funding() -> DataFrame {
        // BTC's latest rate comes first so "latest" must win by timestamp,
        // not by row order surviving into the group.
        df! {
            "timestamp" => &[
                "2024-01-01T01:00:00Z",
                "2024-01-01T00:00:00Z",
                "2024-01-01T00:00:00Z",
            ],
            "funding_rate" => &[0.0003, 0.0001, -0.0002_f64],
            "symbol" => &["BTC", "BTC", "ETH"],
        }
        .unwrap()
    }

    #[test]
    fn carry_is_latest_funding_rate_per_symbol() {
        let out = carry_by_ticker(&sample_funding()).unwrap();
        let tickers = out.column("ticker").unwrap().str().unwrap();
        let carry = out.column("carry").unwrap().f64().unwrap();

        assert_eq!(tickers.get(0), Some("BTC"));
        assert!(
            (carry.get(0).unwrap() - 0.0003).abs() < 1e-12,
            "BTC carry should be the latest funding rate 0.0003"
        );

        assert_eq!(tickers.get(1), Some("ETH"));
        assert!(
            (carry.get(1).unwrap() - (-0.0002)).abs() < 1e-12,
            "ETH carry should be its only funding rate -0.0002"
        );
    }

    #[test]
    fn with_carry_joins_latest_funding_onto_factors() {
        // SOL has candles but no funding entry -- the most common real-world
        // case. The left join must keep it with a null carry; an accidental
        // inner join would silently drop every asset without a perp listing.
        let factors = df! {
            "ticker" => &["BTC", "ETH", "SOL"],
            "sma" => &[1.0, 2.0, 3.0_f64],
        }
        .unwrap();

        let out = with_carry(factors, Some(&sample_funding())).unwrap();
        let tickers = out.column("ticker").unwrap().str().unwrap();
        let carry = out.column("carry").unwrap().f64().unwrap();
        let carry_for = |ticker: &str| {
            let index = (0..tickers.len())
                .find(|&index| tickers.get(index) == Some(ticker))
                .expect("every factors ticker survives the join");

            carry.get(index)
        };

        assert!((carry_for("BTC").unwrap() - 0.0003).abs() < 1e-12);
        assert!((carry_for("ETH").unwrap() - (-0.0002)).abs() < 1e-12);
        assert!(
            carry_for("SOL").is_none(),
            "a ticker without funding data must keep a null carry, not vanish"
        );
    }

    #[test]
    fn with_carry_adds_null_column_when_funding_absent() {
        let factors = df! {
            "ticker" => &["BTC"],
            "sma" => &[1.0_f64],
        }
        .unwrap();

        let out = with_carry(factors, None).unwrap();
        assert!(
            out.column("carry").is_ok(),
            "carry column is always present"
        );
        assert!(
            out.column("carry").unwrap().f64().unwrap().get(0).is_none(),
            "carry is null when there is no funding data"
        );
    }
}
