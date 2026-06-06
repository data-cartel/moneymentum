use std::fmt::{self, Display};
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) const INGESTION_RUN_ID_PREFIX: &str = "ingestion-";

/// Identity of a single ingestion attempt, permanent for the life of its event
/// stream. It is the two values that determine it -- the microsecond the run
/// started (so ids sort by start time) and a random nonce (so two runs started
/// in the same microsecond cannot collide onto one stream, which would surface a
/// legitimate concurrent ingestion enqueue as a spurious 500 rather than a 409). The
/// wire form `ingestion-{micros}-{nonce}` is *derived* from those fields by
/// [`Display`] and parsed back by [`FromStr`]; the fields, not the string, are
/// the source of truth. The start time is held at microsecond precision -- the
/// resolution the wire form preserves -- so an id always equals the value parsed
/// back from its own [`Display`] output.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct IngestionRunId {
    started_at_micros: i64,
    nonce: Uuid,
}

impl IngestionRunId {
    pub(crate) fn new(started_at: DateTime<Utc>) -> Self {
        Self {
            started_at_micros: started_at.timestamp_micros(),
            nonce: Uuid::new_v4(),
        }
    }
}

impl Display for IngestionRunId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{INGESTION_RUN_ID_PREFIX}{}-{}",
            self.started_at_micros,
            self.nonce.simple()
        )
    }
}

impl FromStr for IngestionRunId {
    type Err = IngestionRunIdParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let body = value
            .strip_prefix(INGESTION_RUN_ID_PREFIX)
            .ok_or(IngestionRunIdParseError::MissingPrefix)?;
        let (micros, nonce) = body
            .rsplit_once('-')
            .ok_or(IngestionRunIdParseError::MissingNonce)?;
        let started_at_micros = micros.parse::<i64>()?;
        let nonce = Uuid::parse_str(nonce)?;
        Ok(Self {
            started_at_micros,
            nonce,
        })
    }
}

/// Why a string is not a valid [`IngestionRunId`].
#[derive(Debug, thiserror::Error)]
pub(crate) enum IngestionRunIdParseError {
    #[error("ingestion run id must start with `{INGESTION_RUN_ID_PREFIX}`")]
    MissingPrefix,
    #[error("ingestion run id is missing its nonce segment")]
    MissingNonce,
    #[error("ingestion run id has a non-numeric start timestamp")]
    ParseInt(#[from] std::num::ParseIntError),
    #[error("ingestion run id has a malformed nonce")]
    Uuid(#[from] uuid::Error),
}

impl Serialize for IngestionRunId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for IngestionRunId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        raw.parse().map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::IngestionRunId;

    #[test]
    fn ingestion_run_id_round_trips_through_its_string_form() {
        let started_at = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        let run_id = IngestionRunId::new(started_at);

        let rendered = run_id.to_string();
        let parsed: IngestionRunId = rendered.parse().unwrap();

        assert!(rendered.starts_with("ingestion-"));
        assert_eq!(parsed, run_id);
    }

    #[test]
    fn ingestion_run_id_round_trips_pre_epoch_micros() {
        let rendered = "ingestion--1230000000000000000-00000000000000000000000000000001";
        let parsed: IngestionRunId = rendered.parse().unwrap();

        assert_eq!(parsed.to_string(), rendered);
    }

    #[test]
    fn ingestion_run_id_rejects_malformed_strings() {
        assert!("missing-prefix".parse::<IngestionRunId>().is_err());
        assert!("ingestion-123".parse::<IngestionRunId>().is_err());
        assert!(
            "ingestion-notanumber-7a8b"
                .parse::<IngestionRunId>()
                .is_err()
        );
        assert!(
            "ingestion-123-not-a-uuid"
                .parse::<IngestionRunId>()
                .is_err()
        );
    }

    #[test]
    fn ingestion_run_id_serializes_as_its_display_form() {
        let started_at = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        let run_id = IngestionRunId::new(started_at);

        let json = serde_json::to_string(&run_id).unwrap();

        assert_eq!(json, format!("\"{run_id}\""));
        assert_eq!(
            serde_json::from_str::<IngestionRunId>(&json).unwrap(),
            run_id
        );
    }
}
