use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use tower::Service;

/// Chains two services into a sequential pipeline.
///
/// The output of `first` feeds into `second`. Only compiles when
/// the response type of `A` matches the request type of `B`,
/// enforcing type-safe composition at compile time.
///
/// The second service is polled for readiness inside the future,
/// immediately before it is called, so readiness is never stale.
///
/// ```text
/// TimeSeries<Price> --[SimpleReturns]--> TimeSeries<Return<Simple>> --[RollingVolatility]--> TimeSeries<Vol<Return<Simple>>>
/// ```
#[derive(Clone)]
pub struct Pipeline<A, B> {
    first: A,
    second: B,
}

impl<A, B> Pipeline<A, B> {
    /// Creates a pipeline that feeds the output of `first` into `second`.
    ///
    /// Type-safe: the `Service` impl only compiles when `first`'s `Response`
    /// matches `second`'s request type.
    pub fn new(first: A, second: B) -> Self {
        Self { first, second }
    }
}

impl<A, B, Req> Service<Req> for Pipeline<A, B>
where
    A: Service<Req>,
    B: Service<A::Response, Error = A::Error> + Clone + Unpin,
    A::Future: Unpin,
    A::Response: Unpin,
    B::Future: Unpin,
{
    type Response = B::Response;
    type Error = A::Error;
    type Future = PipelineFuture<A, B, Req>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.first.poll_ready(cx)
    }

    fn call(&mut self, request: Req) -> Self::Future {
        let first_future = self.first.call(request);
        PipelineFuture::First {
            future: first_future,
            second: self.second.clone(),
        }
    }
}

/// Future for a two-stage pipeline execution.
///
/// The second service is polled for readiness immediately before calling it,
/// inside the future -- not in `Pipeline::poll_ready`. Once the first stage
/// completes, its output is held in `Buffered` while the second stage's
/// readiness is awaited, so a not-yet-ready second stage never causes the
/// already-completed first future to be polled again.
pub enum PipelineFuture<A, B, Req>
where
    A: Service<Req>,
    B: Service<A::Response>,
{
    First {
        future: A::Future,
        second: B,
    },
    Buffered {
        intermediate: Option<A::Response>,
        second: B,
    },
    Second {
        future: B::Future,
    },
}

impl<A, B, Req> Future for PipelineFuture<A, B, Req>
where
    A: Service<Req>,
    B: Service<A::Response, Error = A::Error> + Clone + Unpin,
    A::Future: Unpin,
    A::Response: Unpin,
    B::Future: Unpin,
{
    type Output = Result<B::Response, A::Error>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();

        loop {
            match this {
                Self::First { future, second } => {
                    let intermediate = match Pin::new(future).poll(cx) {
                        Poll::Ready(Ok(value)) => value,
                        Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                        Poll::Pending => return Poll::Pending,
                    };

                    // The first stage is done. Hold its output in `Buffered` so
                    // that a not-yet-ready second stage cannot make us re-poll the
                    // already-completed first future on the next wake.
                    *this = Self::Buffered {
                        intermediate: Some(intermediate),
                        second: second.clone(),
                    };
                }
                Self::Buffered {
                    intermediate,
                    second,
                } => {
                    // Poll second for readiness right before calling it, not
                    // relying on a stale poll from Pipeline::poll_ready.
                    match second.poll_ready(cx) {
                        Poll::Ready(Ok(())) => {}
                        Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                        Poll::Pending => return Poll::Pending,
                    }

                    // `Buffered` is always constructed with `Some` and is replaced
                    // by `Second` immediately after this take, so `None` is
                    // unreachable. `unreachable!()` is forbidden in production code,
                    // so the impossible branch falls back to `Poll::Pending`: a
                    // future invariant violation would stall this task rather than
                    // panic. The state machine guarantees the branch is never taken.
                    let Some(value) = intermediate.take() else {
                        return Poll::Pending;
                    };

                    let second_future = second.call(value);
                    *this = Self::Second {
                        future: second_future,
                    };
                }
                Self::Second { future } => {
                    return Pin::new(future).poll(cx);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::task::{Context, Poll};

    use polars::prelude::{Column, DataFrame, DataType, NamedFrom, Series, TimeUnit};
    use tower::Service;
    use tracing::Level;
    use tracing_test::traced_test;

    use super::*;
    use crate::logs_contain_at;
    use crate::marker::Price;
    use crate::series::{Observation, TimeSeries};
    use crate::transform::{RollingVolatility, SimpleReturns};

    const DAY_MS: i64 = 86_400_000;

    fn sample_price_series(prices: &[f64]) -> TimeSeries<Price> {
        let epoch_start: i64 = 1_704_067_200_000; // 2024-01-01T00:00:00Z
        let millis: Vec<i64> = (0..prices.len())
            .map(|idx| epoch_start + i64::try_from(idx).unwrap() * DAY_MS)
            .collect();
        let timestamps = Series::new("timestamp".into(), millis)
            .cast(&DataType::Datetime(TimeUnit::Milliseconds, None))
            .unwrap();

        let value_series = Series::new("value".into(), prices);
        let df =
            DataFrame::new(vec![Column::from(timestamps), Column::from(value_series)]).unwrap();

        TimeSeries::new(df).unwrap()
    }

    fn extract_values(series: &TimeSeries<impl Observation>) -> Vec<f64> {
        series
            .as_dataframe()
            .column("value")
            .unwrap()
            .as_materialized_series()
            .f64()
            .unwrap()
            .into_no_null_iter()
            .collect()
    }

    #[traced_test]
    #[tokio::test]
    async fn pipeline_chains_price_to_volatility() {
        // 10 prices -> 9 returns, window=3 -> 7 vol observations
        let prices = [
            100.0, 102.0, 101.0, 105.0, 103.0, 108.0, 107.0, 110.0, 109.0, 112.0,
        ];

        let mut pipeline = Pipeline::new(SimpleReturns, RollingVolatility::new(3).unwrap());
        let result = pipeline.call(sample_price_series(&prices)).await.unwrap();

        assert_eq!(result.len(), 7);

        let values = extract_values(&result);

        // The pipeline must equal applying the two stages by hand, in order --
        // a stronger guard than checking only count and sign.
        let mut returns_service = SimpleReturns;
        let returns = returns_service
            .call(sample_price_series(&prices))
            .into_inner()
            .unwrap();
        let mut vol_service = RollingVolatility::new(3).unwrap();
        let expected = vol_service.call(returns).into_inner().unwrap();
        assert_eq!(values, extract_values(&expected));

        for value in &values {
            assert!(*value > 0.0, "vol should be positive, got {value}");
        }

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed simple returns from prices"]
        ));
        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed rolling volatility"]
        ));
    }

    /// A `Service` adapter that returns `Poll::Pending` from `poll_ready` a fixed
    /// number of times (waking the task each time) before delegating to `inner`.
    /// It forces the pipeline's `Buffered` state to hold the intermediate across
    /// real backpressure -- the exact scenario that state exists to handle.
    #[derive(Clone)]
    struct PendingThenReady<S> {
        inner: S,
        remaining_pending: Cell<u32>,
    }

    impl<S, Req> Service<Req> for PendingThenReady<S>
    where
        S: Service<Req>,
    {
        type Response = S::Response;
        type Error = S::Error;
        type Future = S::Future;

        fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            let remaining = self.remaining_pending.get();
            if remaining > 0 {
                self.remaining_pending.set(remaining - 1);
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
            self.inner.poll_ready(cx)
        }

        fn call(&mut self, request: Req) -> Self::Future {
            self.inner.call(request)
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn pipeline_preserves_intermediate_under_backpressure() {
        let prices = [
            100.0, 102.0, 101.0, 105.0, 103.0, 108.0, 107.0, 110.0, 109.0, 112.0,
        ];

        // The second stage yields Pending twice before becoming ready. The
        // original bug re-polled the completed first future here and panicked;
        // the Buffered state must instead hold the intermediate until ready.
        let backpressured_vol = PendingThenReady {
            inner: RollingVolatility::new(3).unwrap(),
            remaining_pending: Cell::new(2),
        };
        let mut pipeline = Pipeline::new(SimpleReturns, backpressured_vol);
        let result = pipeline.call(sample_price_series(&prices)).await.unwrap();

        // Output is identical to the no-backpressure pipeline -- nothing lost.
        let mut returns_service = SimpleReturns;
        let returns = returns_service
            .call(sample_price_series(&prices))
            .into_inner()
            .unwrap();
        let mut vol_service = RollingVolatility::new(3).unwrap();
        let expected = vol_service.call(returns).into_inner().unwrap();
        assert_eq!(extract_values(&result), extract_values(&expected));

        assert!(logs_contain_at(
            Level::DEBUG,
            &["computed rolling volatility"]
        ));
    }
}
