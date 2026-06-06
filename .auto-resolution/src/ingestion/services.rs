use std::path::PathBuf;
use std::sync::Arc;

use crate::hyperliquid::Hyperliquid;
use crate::market_catalog::MarketCatalog;
use crate::market_enablement::MarketEnablement;

pub(crate) struct IngestionServices {
    pub(crate) hyperliquid: Arc<dyn Hyperliquid>,
    pub(crate) data_dir: PathBuf,
    pub(crate) max_concurrent_requests: usize,
    pub(crate) market_catalog: Arc<event_sorcery::Store<MarketCatalog>>,
    pub(crate) market_catalog_projection: Arc<event_sorcery::Projection<MarketCatalog>>,
    pub(crate) market_enablement_projection: Arc<event_sorcery::Projection<MarketEnablement>>,
}
