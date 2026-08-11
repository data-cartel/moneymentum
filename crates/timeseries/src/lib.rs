mod marker;
mod pipeline;
mod series;
mod transform;

pub use marker::{Drawdown, Log, Normalized, Price, Return, Simple, Vol};
pub use pipeline::Pipeline;
pub use series::{Observation, SeriesError, TimeSeries};
pub use transform::{
    LogReturns, Normalize, PeakDrawdown, RollingVolatility, SimpleReturns, TransformError,
};

/// Asserts that a single log line at `level` contains all `snippets`.
///
/// Mirrors `moneymentum::logs_contain_at`; this crate-local copy exists because
/// that helper is `pub(crate)` in the main crate and unreachable from here. Use
/// with `tracing_test::traced_test` to verify observability at a specific level
/// (the bare `logs_contain` macro asserts neither the level nor that snippets
/// share one line).
#[cfg(test)]
pub(crate) fn logs_contain_at(level: tracing::Level, snippets: &[&str]) -> bool {
    let logs = {
        let buffer = tracing_test::internal::global_buf().lock().unwrap();
        String::from_utf8_lossy(&buffer).into_owned()
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
