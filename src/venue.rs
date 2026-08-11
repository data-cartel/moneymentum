//! Venues: the execution and data sources the system abstracts over.
//!
//! [`VenueRef`] is a cross-cutting value object -- it keys the `MarketCatalog`
//! aggregate, composes into a market's id, and tags every instrument and
//! position -- so it lives here rather than inside any one feature.

use std::fmt::{self, Display};
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// An execution/data venue. The data-source and execution halves of the SPEC's
/// dual abstraction both key on this value, so adding a venue is one variant.
///
/// `Display`/`FromStr` round-trip a lowercase slug, used both as the
/// `MarketCatalog` aggregate id and inside the composite market id encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) enum VenueRef {
    #[serde(rename = "hyperliquid")]
    Hyperliquid,
}

impl Display for VenueRef {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let slug = match self {
            Self::Hyperliquid => "hyperliquid",
        };
        formatter.write_str(slug)
    }
}

impl FromStr for VenueRef {
    type Err = UnknownVenue;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "hyperliquid" => Ok(Self::Hyperliquid),
            other => Err(UnknownVenue(other.to_string())),
        }
    }
}

/// A venue slug that does not name any known venue.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown venue: {0}")]
pub(crate) struct UnknownVenue(String);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyperliquid_slug_round_trips_through_display_fromstr_and_serde() {
        let venue = VenueRef::Hyperliquid;
        assert_eq!(venue.to_string(), "hyperliquid");
        assert_eq!("hyperliquid".parse::<VenueRef>().unwrap(), venue);

        let decoded: VenueRef = serde_json::from_str("\"hyperliquid\"").unwrap();
        assert_eq!(decoded, venue);
        assert_eq!(serde_json::to_string(&venue).unwrap(), "\"hyperliquid\"");
    }
}
