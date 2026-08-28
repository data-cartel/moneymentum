//! On-disk market universe snapshots under `data_dir`.
//!
//! The live tradable set is event-sourced ([`crate::market_catalog`]); these
//! CSVs are a durable inspection cache rewritten whenever
//! `GET /hyperliquid/markets` or `GET /derive/markets` successfully fetches
//! from the exchange. They replace the old single `markets.csv` /
//! `testnet_markets.csv` pair.

use std::path::{Path, PathBuf};

use derive::{DeriveNetwork, OptionKind};
use polars::prelude::{DataFrame, NamedFrom, Series};
use tracing::{debug, warn};

use crate::dataframe::{self, DataFrameError};
use crate::derive_markets::{DeriveInstrument, DeriveInstrumentType, Strike};
use crate::hyperliquid::HyperliquidNetwork;
use crate::market_metadata::MarketMetadata;

const HYPERLIQUID_MAINNET_FILE: &str = "market_hyperliquid.csv";
const HYPERLIQUID_TESTNET_FILE: &str = "market_hyperliquid_testnet.csv";
const DERIVE_MAINNET_FILE: &str = "market_derive.csv";
const DERIVE_TESTNET_FILE: &str = "market_derive_testnet.csv";

pub(crate) fn hyperliquid_markets_path(data_dir: &Path, network: HyperliquidNetwork) -> PathBuf {
    let file_name = match network {
        HyperliquidNetwork::Mainnet => HYPERLIQUID_MAINNET_FILE,
        HyperliquidNetwork::Testnet => HYPERLIQUID_TESTNET_FILE,
    };
    data_dir.join(file_name)
}

pub(crate) fn derive_markets_path(data_dir: &Path, network: DeriveNetwork) -> PathBuf {
    let file_name = match network {
        DeriveNetwork::Mainnet => DERIVE_MAINNET_FILE,
        DeriveNetwork::Testnet => DERIVE_TESTNET_FILE,
    };
    data_dir.join(file_name)
}

/// Writes Hyperliquid meta rows: `symbol,max_leverage,asset_index,only_isolated`.
pub(crate) async fn write_hyperliquid_markets(
    path: PathBuf,
    metadata: &[MarketMetadata],
) -> Result<(), DataFrameError> {
    let symbols: Vec<String> = metadata
        .iter()
        .map(|market| market.symbol.as_str().to_string())
        .collect();
    let max_leverages: Vec<u32> = metadata.iter().map(|market| market.max_leverage).collect();
    let asset_indexes: Vec<u32> = metadata.iter().map(|market| market.asset_index).collect();
    let only_isolated: Vec<bool> = metadata.iter().map(|market| market.only_isolated).collect();

    let dataframe = DataFrame::new(vec![
        Series::new("symbol".into(), symbols).into(),
        Series::new("max_leverage".into(), max_leverages).into(),
        Series::new("asset_index".into(), asset_indexes).into(),
        Series::new("only_isolated".into(), only_isolated).into(),
    ])?;

    dataframe::write_csv(path.clone(), dataframe).await?;
    debug!(path = %path.display(), "hyperliquid markets csv written");
    Ok(())
}

/// Writes Derive instrument rows (no max_leverage -- not applicable).
pub(crate) async fn write_derive_markets(
    path: PathBuf,
    instruments: &[DeriveInstrument],
) -> Result<(), DataFrameError> {
    let names: Vec<String> = instruments
        .iter()
        .map(|instrument| instrument.instrument_name.clone())
        .collect();
    let types: Vec<String> = instruments
        .iter()
        .map(|instrument| instrument.instrument_type.as_str().to_string())
        .collect();
    let bases: Vec<String> = instruments
        .iter()
        .map(|instrument| instrument.base_currency.clone())
        .collect();
    let quotes: Vec<String> = instruments
        .iter()
        .map(|instrument| instrument.quote_currency.clone())
        .collect();
    let active: Vec<bool> = instruments
        .iter()
        .map(|instrument| instrument.is_active)
        .collect();
    let option_types: Vec<Option<String>> = instruments
        .iter()
        .map(|instrument| {
            instrument.option_type.map(|kind| match kind {
                OptionKind::Call => "C".to_string(),
                OptionKind::Put => "P".to_string(),
            })
        })
        .collect();
    let strikes: Vec<Option<f64>> = instruments
        .iter()
        .map(|instrument| instrument.strike.map(Strike::get))
        .collect();
    let expiries: Vec<Option<i64>> = instruments
        .iter()
        .map(|instrument| instrument.expiry_unix)
        .collect();

    let dataframe = DataFrame::new(vec![
        Series::new("instrument_name".into(), names).into(),
        Series::new("instrument_type".into(), types).into(),
        Series::new("base_currency".into(), bases).into(),
        Series::new("quote_currency".into(), quotes).into(),
        Series::new("is_active".into(), active).into(),
        Series::new("option_type".into(), option_types).into(),
        Series::new("strike".into(), strikes).into(),
        Series::new("expiry_unix".into(), expiries).into(),
    ])?;

    dataframe::write_csv(path.clone(), dataframe).await?;
    debug!(path = %path.display(), "derive markets csv written");
    Ok(())
}

/// Best-effort CSV cache write; never fails the HTTP response.
pub(crate) async fn persist_hyperliquid_markets(
    data_dir: &Path,
    network: HyperliquidNetwork,
    metadata: &[MarketMetadata],
) {
    let path = hyperliquid_markets_path(data_dir, network);
    if let Err(error) = write_hyperliquid_markets(path, metadata).await {
        warn!(error = %error, ?network, "failed to write hyperliquid markets csv");
    }
}

/// Best-effort CSV cache write; never fails the HTTP response.
pub(crate) async fn persist_derive_markets(
    data_dir: &Path,
    network: DeriveNetwork,
    instruments: &[DeriveInstrument],
) {
    let path = derive_markets_path(data_dir, network);
    if let Err(error) = write_derive_markets(path, instruments).await {
        warn!(error = %error, ?network, "failed to write derive markets csv");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::Market;
    use crate::market_metadata::MarketMetadata;
    use tempfile::TempDir;

    #[tokio::test]
    async fn hyperliquid_path_uses_venue_prefixed_file_names() {
        let data_dir = Path::new("/tmp/data");
        assert_eq!(
            hyperliquid_markets_path(data_dir, HyperliquidNetwork::Mainnet),
            PathBuf::from("/tmp/data/market_hyperliquid.csv")
        );
        assert_eq!(
            hyperliquid_markets_path(data_dir, HyperliquidNetwork::Testnet),
            PathBuf::from("/tmp/data/market_hyperliquid_testnet.csv")
        );
    }

    #[tokio::test]
    async fn derive_path_uses_venue_prefixed_file_names() {
        let data_dir = Path::new("/tmp/data");
        assert_eq!(
            derive_markets_path(data_dir, DeriveNetwork::Mainnet),
            PathBuf::from("/tmp/data/market_derive.csv")
        );
        assert_eq!(
            derive_markets_path(data_dir, DeriveNetwork::Testnet),
            PathBuf::from("/tmp/data/market_derive_testnet.csv")
        );
    }

    #[tokio::test]
    async fn write_hyperliquid_markets_creates_csv() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join(HYPERLIQUID_MAINNET_FILE);
        write_hyperliquid_markets(
            path.clone(),
            &[MarketMetadata {
                symbol: Market::new("ETH".to_string()),
                max_leverage: 25,
                asset_index: 1,
                only_isolated: false,
            }],
        )
        .await
        .unwrap();

        let contents = std::fs::read_to_string(path).unwrap();
        assert!(contents.contains("symbol,max_leverage,asset_index,only_isolated"));
        assert!(contents.contains("ETH,25,1,false"));
    }

    #[tokio::test]
    async fn write_derive_markets_creates_csv_without_max_leverage() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join(DERIVE_MAINNET_FILE);
        write_derive_markets(
            path.clone(),
            &[DeriveInstrument {
                instrument_name: "ETH-20260829-2000-C".to_string(),
                instrument_type: DeriveInstrumentType::Option,
                base_currency: "ETH".to_string(),
                quote_currency: "USDC".to_string(),
                is_active: true,
                option_type: Some(derive::OptionKind::Call),
                strike: Some(Strike::parse("2000").unwrap()),
                expiry_unix: Some(1_788_000_000),
            }],
        )
        .await
        .unwrap();

        let contents = std::fs::read_to_string(path).unwrap();
        assert!(contents.contains(
            "instrument_name,instrument_type,base_currency,quote_currency,is_active,option_type,strike,expiry_unix"
        ));
        assert!(contents.contains("ETH-20260829-2000-C,option,ETH,USDC,true,C,2000,1788000000"));
        assert!(!contents.contains("max_leverage"));
    }
}
