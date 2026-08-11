# Risk-engine methodology (story 0x01b) -- proposal for review

Status: **proposed, for review. Not implemented.** This resolves the risk
engine's open methodology decisions -- Value at Risk (VaR) and Conditional VaR
(CVaR), the return convention, the Effective Number of Bets (ENB), and Monte
Carlo (MC) -- and shows how each threads through the `MeasurementContract` in
`src/risk.rs`. The portfolio is crypto perpetual futures (perps) plus spot, held
as signed weights plus leverage, so every choice is constrained by crypto
stylized facts -- fat tails, unstable correlation, funding, liquidation, and
stablecoin depeg -- not equity defaults.

## Framing: correlation behavior is the load-bearing input

This engine's value lives in **correlation behavior** (SPEC: "effective number
of bets -- true diversification accounting for correlations"; "10 assets that
all move with BTC = 1 bet"). Crypto correlation is the least stable input in the
system: cross-asset correlations sit low in calm regimes and spike toward +1 in
a crash, so a "diversified" levered book collapses to a single concentrated bet
exactly when it matters
([COVID crash crypto correlation analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC8597403/);
[conditional correlations spike in crises](https://www.tandfonline.com/doi/full/10.2469/faj.v74.n3.3)).
The covariance estimate is therefore load-bearing for two of the three decisions
(ENB and MC) and must be regularized and stress-tested, not trusted raw. Two
structural consequences drive the whole methodology:

- **Diversification fails when needed.** A single unconditional covariance hides
  the crash regime. Every correlation-dependent metric is reported twice -- once
  unconditional, once under stress -- and the gap between them is the headline
  tail-concentration number.
- **The dependence is asymmetric.** Crypto crashes cluster more tightly than
  rallies (lower-tail dependence exceeds upper-tail dependence). Any model that
  forces symmetric tail dependence structurally understates the joint left tail.

## Shared foundation: the return series

Build one return series per portfolio leg from ingested per-asset
open-high-low-close-volume (OHLCV) bars (Polars) at the contract
`SamplingFrequency` (Daily or Weekly).

Two return conventions per asset `i` from close prices `P`:

- **Simple (arithmetic) return:** `R_i_t = P_i_t / P_i_(t-1) - 1`.
- **Log (continuously compounded) return:**
  `r_i_t = ln(P_i_t / P_i_(t-1)) = ln(1 + R_i_t)`.

Log returns aggregate cleanly over **time** (the h-period log return is the sum
of single-period log returns), which makes them the right input for the
time-series volatility models below. Simple returns aggregate cleanly across
**assets** (cross-section). These conventions are not interchangeable, and the
distinction is a correctness bug if mishandled (see the next subsection).

- **Funding folded into perp profit-and-loss (P&L), by side.** Funding is a
  carry cash-flow on full notional, regime-switching, and already ingested (the
  carry factor). It is modeled in the P&L the VaR is computed on -- a per-period
  cost/income term `-side * funding_t` (`side = +1` long, `-1` short) added to
  the leg's price return -- not folded into the price-return aggregation in a
  way that distorts the cross-asset identity below. Hyperliquid charges funding
  hourly (one-eighth of the 8-hour-scale rate), with a baseline interest term of
  ~0.00125%/hour (~11.6% annual percentage rate, APR) and a hard cap of 4%/hour
  ([Hyperliquid funding docs](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)).
- **Stablecoin legs as a jump/mixture, never constant 1.0.**
  `r_t = (1 - p) * N(0, sigma_peg^2) + p * Jump(-d)` -- mostly ~0 with a rare
  large negative jump -- or at minimum a configurable depeg stress. (USDC
  depegged to ~0.87 over the Silicon Valley Bank weekend in March 2023; TerraUSD
  lost over 50B USD of UST/LUNA market cap when it collapsed from ~1.00 to near
  zero ([USDC depeg contagion](https://arxiv.org/html/2606.07442);
  [stablecoin co-instability](https://www.sciencedirect.com/science/article/abs/pii/S1057521924005404)).)
  Delta-neutral synthetics add funding-regime risk, mirroring this fund's own
  structures.

### Portfolio aggregation -- the correctness bug, resolved

The continuously compounded portfolio return is **not** the weight-weighted
average of the individual log returns:

```
r_p_t = ln(1 + sum_i w_i * R_i_t)  !=  sum_i w_i * r_i_t
```

Naively computing the portfolio return as `sum_i w_i * r_i_t` (averaging log
returns) is the known bug. Its error is second-order in the returns -- it grows
with return magnitude and cross-asset dispersion -- so on calm days it is
invisible and on exactly the violent crypto days that drive the tail it is
largest. It systematically corrupts the VaR/CVaR tail
([compfinezbook portfolio returns](https://bookdown.org/compfinezbook/introcompfinr/portfolios-and-portfolio-returns.html);
[log vs simple returns](https://www.pfolio.io/academy/log-vs-simple-returns)).

The correct aggregation pipeline, per timestamp `t`:

1. Build each asset's simple return `R_i_t`.
2. Form the portfolio simple return in **simple-return space** using signed,
   leverage-scaled weights: `R_p_t = leverage * sum_i w_i * R_i_t`. The signed
   weights already encode gross/net exposure (negative for shorts; perps carry a
   sign and a leverage multiplier). The contract's `weights` are exactly these
   signed proportions (validated to sum to 1 in absolute value).
3. Only then, if a downstream model needs a log return, convert **once** at the
   portfolio level: `r_p_t = ln(1 + R_p_t)`.

Fit the volatility/EVT models on `r_p_t`, convert the resulting return-space
quantile back to a loss before reporting, and never mix conventions inside one
calculation. Loss convention throughout (losses positive): `L_t = -R_p_t`.

## Decision 1 -- Value at Risk (VaR) and Conditional VaR / Expected Shortfall (CVaR/ES)

### What each measures

**Value at Risk (VaR)** at confidence `alpha` over horizon `h` is the quantile
of the loss distribution -- the smallest loss threshold such that the
probability of a worse loss is at most `1 - alpha`:

```
VaR_alpha(L) = inf{ l : P(L > l) <= 1 - alpha } = F_L^{-1}(alpha)
```

where `F_L` is the loss cumulative distribution function (CDF). It answers "how
bad is the threshold I cross `(1 - alpha)` of the time" but is silent about how
bad things get once that threshold is breached.

**Conditional VaR (CVaR)** -- also called Expected Shortfall (ES), Average VaR,
or Expected Tail Loss -- is the average loss in the tail beyond VaR. The clean
definition (robust even when the loss distribution has atoms) is the average of
VaR over the tail:

```
ES_alpha(L) = (1 / (1 - alpha)) * integral_{alpha}^{1} VaR_gamma(L) dgamma
```

For a **continuous** loss distribution this equals the conditional expectation
`ES_alpha = E[L | L >= VaR_alpha]`, and `ES_alpha >= VaR_alpha` always. For the
**discrete/empirical** historical-simulation estimator (sampled losses have
atoms), use the average-VaR integral form, not the raw tail conditional mean --
the integral stays coherent under atoms where the conditional-expectation
shortcut does not
([Columbia QRM notes](http://www.columbia.edu/~mh2078/RiskMeasures.pdf)).

### Why CVaR/ES is the headline

**(a) Coherence.** Artzner, Delbaen, Eber, and Heath (1999) defined a _coherent_
risk measure as one satisfying monotonicity, translation invariance, positive
homogeneity, and subadditivity. Subadditivity, `rho(X + Y) <= rho(X) + rho(Y)`,
means merging two books never increases total risk -- diversification cannot be
penalized. VaR is not subadditive in general, and specifically fails
subadditivity when the individual loss distributions have heavy tails -- exactly
the crypto regime. ES is coherent (subadditive), so a portfolio-level ES never
exceeds the sum of standalone ES values and the engine can decompose ES
additively across positions
([Artzner et al. coherent risk measures](http://www.columbia.edu/~mh2078/RiskMeasures.pdf)).
For a diversification-centric engine over a book of perps where any single name
can gap, this is the difference between a risk number you can aggregate and one
you cannot.

**(b) Tail magnitude.** VaR ignores the severity of losses beyond the threshold;
ES averages the loss in the tail, capturing the magnitude of rare catastrophic
events. This is why the Basel Committee's Fundamental Review of the Trading Book
(FRTB) replaced the 99% VaR with a 97.5% ES for the internal-models market-risk
charge -- the 97.5% ES level was deliberately calibrated to be broadly
comparable to 99% VaR under normal conditions while remaining sensitive to tail
severity beyond the quantile, and coherent where VaR is not
([BIS FRTB note](https://www.bis.org/bcbs/publ/d457_note.pdf);
[why FRTB ES is designed this way](https://bpi.com/why-is-the-frtb-expected-shortfall-calculation-designed-as-it-is/)).
Under fat tails the 97.5% ES is materially larger than the 99% VaR, so the move
is not a loosening despite the lower confidence number.

**Recommendation.** Make **ES the headline** at the highest contract confidence
level; report VaR as a secondary diagnostic. The contract's `confidence_levels`
(a subset of {0.90, 0.95, 0.99}) drive both -- each level yields a `(VaR, ES)`
pair.

### Estimators

**Historical simulation (HS) -- primary for the body.** HS is non-parametric: it
reads VaR straight off the empirical distribution of past portfolio returns,
making no distributional assumption. Build the vector of historical portfolio
returns `{R_p_t}` (via the correct aggregation above) holding today's weights
and leverage fixed, convert to losses `L_t = -R_p_t`, sort ascending, and take
the empirical `alpha`-quantile as VaR. ES is the average of the losses at or
beyond that quantile (the discrete average-VaR estimator). HS automatically
inherits crypto's fat tails, skew, and the _realized_ (not assumed) joint tail
between assets -- it never imposes a Gaussian copula on assets whose joint tail
clusters
([historical simulation VaR](https://mpra.ub.uni-muenchen.de/113350/1/MPRA_paper_113350.pdf)).
Its weaknesses are exactly the small-sample tail problem below: HS is blind to
any loss bigger than the worst observation in the window, reacts to a regime
shift only with a lag, and a short window starves the tail of data.

**Student-t parametric -- secondary and a fat-tail diagnostic.** Crypto returns
are strongly leptokurtic (positive excess kurtosis; Bitcoin daily-return
kurtosis of 11.9 over Sep 2011 - Jun 2020, far above the Gaussian's 3
([Takaishi](https://pmc.ncbi.nlm.nih.gov/articles/PMC7850481/))), so the
Gaussian provably understates crypto tail risk and is included only as a labeled
reference baseline. The Student-t distribution with `nu` degrees of freedom has
polynomially heavy tails (heavier as `nu` falls), so a small `nu` reproduces
that leptokurtosis. With location `mu`, **scale** `sigma`, standardized-t
inverse CDF `T_nu^{-1}`, and standardized-t probability density function (pdf)
`tau_nu`:

```
VaR_alpha = mu + sigma * T_nu^{-1}(alpha)
ES_alpha  = mu + sigma * (tau_nu(T_nu^{-1}(alpha)) / (1 - alpha))
                * ((nu + (T_nu^{-1}(alpha))^2) / (nu - 1))
```

Note `sigma` here is the **scale** parameter of the standardized Student-t, not
the standard deviation: the fitted t variable has variance
`nu/(nu - 2) * sigma^2`. If you parametrize by the standard deviation `s`
instead, substitute `sigma = s * sqrt((nu - 2) / nu)` (valid only for `nu > 2`).
ES is finite for `nu > 1` (mean exists), but a finite-variance interpretation
additionally needs `nu > 2`; surface a fitted `nu <= 2` as an unstable /
infinite-variance tail warning. Fit `nu` by maximum likelihood on the portfolio
returns; a fitted `nu` in the single digits is a direct, reportable fat-tail
signal
([generalized Student-t ES](https://en.wikipedia.org/wiki/Expected_shortfall);
[Manchester chapter on t ES](https://minerva.it.manchester.ac.uk/~saralees/chap17.pdf)).

For the Gaussian reference baseline only, under the loss convention with `alpha`
near 1 (define `z_alpha := Phi^{-1}(alpha)`, the standard-normal quantile, which
is **positive** for `alpha > 0.5`; `phi` is the standard-normal pdf):

```
VaR_alpha = mu + sigma * Phi^{-1}(alpha)
ES_alpha  = mu + sigma * phi(Phi^{-1}(alpha)) / (1 - alpha)
```

([Gaussian ES, loss convention](https://en.wikipedia.org/wiki/Expected_shortfall)).

### Required fix -- the small-sample tail (EVT/POT plus conditional volatility)

Historical ES off a window capped at `MAX_WINDOW_DAYS = 365` at 99% is dominated
by which crash happens to fall in the window, and HS cannot produce a loss worse
than the worst observed day. A 99% one-day VaR needs ~100 observations just to
place one point in the tail; on a 90-day daily window or a ~13-observation
weekly window there is not enough tail data. The principled fix is **Extreme
Value Theory via Peaks-Over-Threshold (EVT/POT)**, and on short windows it
becomes the _headline_ at 99%, with HS demoted to the cross-check there -- the
reverse of the naive ordering.

POT models only the exceedances over a high threshold `u`. The
Pickands-Balkema-de Haan theorem says the conditional distribution of
exceedances `(L - u | L > u)` converges to a Generalized Pareto Distribution
(GPD) with shape `xi` and scale `beta` as `u` rises; POT uses every exceedance
(not one block maximum), so it is more data-efficient for short crypto samples
([POT/GPD and conditional EVT](https://arxiv.org/html/2405.06798v1)). With `N_u`
exceedances above `u` out of `n` observations and GPD parameters `(xi, beta)`
fitted by maximum likelihood (McNeil-Frey-Embrechts):

```
VaR_alpha = u + (beta / xi) * ( ((n / N_u) * (1 - alpha))^{-xi} - 1 )
ES_alpha  = VaR_alpha / (1 - xi) + (beta - xi * u) / (1 - xi)   (finite only if xi < 1)
```

The shape `xi` is the tail index: `xi > 0` is a heavy (polynomial) tail, and
crypto empirically yields `xi > 0`. ES requires `xi < 1`; a fit with `xi >= 1`
means an infinite-mean tail with no finite ES -- surface that as a loud risk
signal ("ES undefined / infinite-mean tail"), do not hide it. As `alpha -> 1`,
`ES_alpha / VaR_alpha -> 1 / (1 - xi)`, so the fitted `xi` directly quantifies
how much worse the average tail loss is than the VaR threshold -- a single
number summarizing crypto tail severity that no Gaussian model can produce.

**Conditional volatility makes the tail react to regime.** Crypto volatility
clusters, so a static unconditional quantile is stale the moment volatility
jumps and an unconditional 1-year quantile blends calm and violent sub-periods.
Standardize returns by a conditional volatility estimate, fit the tail (POT or
Student-t) on the standardized innovations, then re-inflate by current
volatility -- the McNeil-Frey conditional-EVT recipe:

```
VaR_t = sigma_t * q_GPD(alpha)
ES_t  = sigma_t * ( q_GPD(alpha) / (1 - xi) + (beta - xi * u) / (1 - xi) )
```

Two volatility filters:

- **Exponentially Weighted Moving Average (EWMA, RiskMetrics):**
  `sigma^2_t = lambda * sigma^2_(t-1) + (1 - lambda) * r^2_(t-1)`, with
  `lambda = 0.94` for daily data (half-life `ln(0.5)/ln(0.94)` ~ 11.2 days). No
  estimation, reacts fast, a one-line Polars recursion -- a good default
  ([EWMA / RiskMetrics](https://analystprep.com/study-notes/frm/part-1/valuation-and-risk-management/quantifying-volatility-in-var-models/)).
- **GARCH(1,1)** (Generalized Autoregressive Conditional Heteroskedasticity,
  Bollerslev): `sigma^2_t = omega + alpha * r^2_(t-1) + beta * sigma^2_(t-1)`,
  with `omega, alpha, beta >= 0` and persistence `alpha + beta < 1` for
  stationarity (unconditional variance `omega / (1 - alpha - beta)`). GARCH
  captures the volatility mean reversion EWMA cannot, and is the right filter
  for forecasting volatility multiple steps ahead in horizon handling
  ([GARCH(1,1)](https://bookdown.org/compfinezbook/introcompfinr/bollerslevs-garch-model.html)).

### Required fix -- horizon handling (no sqrt(t))

The square-root-of-time rule (SRTR), `VaR_h = sqrt(h) * VaR_1`, is exact only
under independent, identically distributed (i.i.d.) normal returns -- neither
assumption holds in crypto. It is **unreliable, and the sign of its error
depends on the mechanism**: under a jump-diffusion the rule systematically
_understates_ multi-day tail risk (Danielsson-Zigrand 2006, worsening with
horizon, jump intensity, and confidence
([Danielsson-Zigrand](https://eprints.lse.ac.uk/24827/1/dp439.pdf))), while
under i.i.d. heavy tails it tends to _overstate_ the time-aggregated quantile.
Do not assert a uniform bias and do not apply sqrt(t) to tail metrics.

Correct horizon handling, in preference order:

1. **Direct estimation at the target horizon `h`** -- build h-period portfolio
   returns by summing log returns over time (which _is_ valid across time), then
   converting, and run HS / POT / Student-t directly on them. No scaling rule.
2. **Simulate forward** with the conditional-volatility model (Monte Carlo /
   filtered historical simulation, Decision 3) to generate h-step paths and read
   VaR/ES off the simulated distribution.
3. **Last resort:** a tail-index-aware scaling exponent. For a regularly varying
   tail `P(L > l) ~ l^{-alpha_tail}` the time-aggregation scaling is
   `h^{1/alpha_tail}`, not `h^{1/2}`. Note `alpha_tail = 1/xi` (the
   regular-variation index is the reciprocal of the GPD shape), so do not
   confuse the tail index `alpha_tail` with the shape `xi`. Document it as an
   approximation.

### Putting Decision 1 together

Estimate the headline ES two complementary ways and reconcile: HS on correctly
aggregated portfolio returns for the empirical body, and conditional EVT (EWMA
or GARCH filter, then POT-GPD on standardized innovations) for the extrapolated
tail and for the 99% level where HS runs out of data. Keep Student-t parametric
VaR/ES as a fast secondary and a fat-tail diagnostic (report fitted `nu` and POT
`xi`; surface `xi >= 1` and `nu <= 2` as instability flags). Specify the ES
estimator precisely (Acerbi-Tasche average-VaR with a defined interpolation
rule) and unit-test it against a closed-form case. Crypto-specific jumps
(stablecoin depeg, funding/liquidation cascades) live in the empirical and EVT
tails by construction -- do not blur them away by averaging log returns or
sqrt-scaling a calm-period number.

**The 99% window problem (owner sign-off).** `MAX_WINDOW_DAYS = 365` is
statistically insufficient for 99% tails (regulatory practice uses 3-5 years),
yet `ALLOWED_CONFIDENCE_LEVELS` includes `0.99`. Resolve deliberately: (a) widen
`MAX_WINDOW_DAYS` to ~1100, (b) add a `SamplingFrequency::Hourly` variant to
populate the tail, or (c) attach an explicit reliability flag / make EVT the
headline at 99% on short windows (per above). Do not silently report a 99% CVaR
off 90 daily candles as precise.

## Decision 2 -- Effective Number of Bets (ENB)

### What ENB measures

Counting positions overstates diversification: 10 crypto perps that all move
together are, in risk terms, close to a single bet. The **Effective Number of
Bets (ENB)**, introduced by Meucci, measures _how many genuinely independent
risk sources_ a portfolio is exposed to, by decomposing portfolio variance onto
a set of _uncorrelated_ risk factors and summarizing how evenly variance is
spread across them. Concentration in one factor gives ENB near 1; an even spread
across `n` factors gives ENB near `n`. This is the only choice that accounts for
correlation as the SPEC requires.

The construction has three separable layers:

1. **De-correlate** the assets into `n` uncorrelated factors via a torsion
   matrix `t`.
2. **Attribute** portfolio variance to each factor, giving a probability-like
   _diversification distribution_ `p` that sums to 1.
3. **Summarize** `p` with exponential Shannon entropy to get ENB.

### The diversification distribution and ENB

Let `w` be the vector of portfolio exposures (signed weights times leverage --
exactly the contract's representation), `Sigma` the `n`-by-`n` asset covariance,
and `t` the torsion matrix such that the transformed factors are uncorrelated
(`t * Sigma * t^T` is diagonal). The diversification distribution is

```
p = ( (t^{-T} w)  .*  (t Sigma w) ) / (w^T Sigma w)
```

where `.*` is the Hadamard (element-by-element) product and `t^{-T}` is the
inverse-transpose. The denominator `w^T Sigma w` is total portfolio variance;
component `p_i` is the percent contribution of uncorrelated factor `i` to total
variance, and `sum_i p_i = 1`. (Intuition: `t^{-T} w` is the portfolio's
_exposure_ to factor `i`, `t Sigma w` is factor `i`'s _marginal contribution to
risk_, their product is factor `i`'s _absolute risk contribution_, normalized by
total variance.) Then

```
ENB(w) = exp( - sum_{i=1}^{n} p_i * ln(p_i) )    with 0 * ln(0) = 0
```

ENB = 1 iff one factor carries 100% of variance (full concentration); ENB = `n`
iff every factor contributes equally (`p_i = 1/n`, full diversification). This
is the precise sense in which **correlation, not count, drives
diversification**: the torsion step collapses correlated assets into shared
factors, so two perfectly correlated longs land on one factor and ENB stays ~1
regardless of how notional is split between them
([Meucci ENB / Portfolio Optimizer](https://portfoliooptimizer.io/blog/the-effective-number-of-bets-measuring-portfolio-diversification/)).

### Choosing the torsion -- minimum-torsion over PCA

The factors must be uncorrelated, but the de-correlating transform is not
unique.

**Principal-components (PCA) torsion** eigendecomposes
`Sigma = E * Lambda * E^T` (with `E` the orthonormal eigenvectors and `Lambda`
the diagonal of _eigenvalues_ -- equal to the square of Meucci's singular-value
matrix; factor variances = `Lambda` = eigenvalues) and takes `t = E^T` sorted by
descending eigenvalue. It is cheap and exact, but its factors "usually bear no
relationship with the original assets": for three nearly-uncorrelated assets,
equal weighting can yield ENB ~ 1 under PCA torsion instead of the intuitive ~3,
because the components mix the assets arbitrarily and are not rotation-stable.
PCA-ENB can badly _understate_ diversification, and raw PCA eigenvectors rotate
between windows (false precision in any single point estimate).

**Minimum linear torsion (MLT)** finds the uncorrelated factors _as close as
possible to the original assets_ (minimizing a normalized tracking error), so it
keeps a one-to-one factor/asset correspondence and fixes the PCA pathology
([Meucci minimum-torsion](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2276632)).
The exact algorithm (Meucci's `torsion.m`): with `sigma = sqrt(diag(Sigma))`,
correlation `C = diag(1/sigma) Sigma diag(1/sigma)`, and `c = sqrtm(C)`, iterate
from `d = ones(1, n)`:

```
U  = diag(d) * c * c * diag(d)
u  = sqrtm(U)
q  = u \ (diag(d) * c)
d  = diag(q * c)
pi = diag(d) * q
```

stopping (for iteration `i > 1`) when `abs(f_i - f_{i-1}) / f_i / n <= 1e-8`,
where `f_i = ||c - pi||_F` (Frobenius norm) at iteration `i`; then `x = pi / c`
and `t = diag(sigma) * x * diag(1/sigma)`
([torsion.m](https://mathworks.com/matlabcentral/mlc-downloads/downloads/submissions/59794/versions/1/previews/torsion.m/index.html)).

**Recommendation: minimum-torsion is the default; PCA torsion is a cheap
diagnostic only.** Report a bootstrap stability band on ENB rather than a single
point estimate.

### Required fix -- positive-definiteness when n_obs < n_assets (the #1 crash risk)

ENB is only as good as `Sigma`, and the sample covariance `S` breaks in two ways
in a crypto risk engine:

**Estimation error.** `S` has its largest errors in its extreme eigenvalues --
exactly the ones the torsion leans on most. The sample eigenvalues are
over-dispersed (largest too large, smallest too small).

**Positive-definiteness failure.** The sample covariance from `T` de-meaned
return observations on `N` assets has rank at most `min(T - 1, N)` (the `-1`
from subtracting the sample mean). When `T < N` -- e.g. a 15-asset book on a
90-day _weekly_ window is ~13 observations against 15 assets, or a 60-asset book
on a 30-day window -- `S` is **singular**: it has zero eigenvalues, is not
positive definite (PD), and is not invertible. This is fatal for ENB because the
inverse-transpose `t^{-T}` needs an invertible transform, the matrix square root
`sqrtm(C)` needs a numerically PD correlation matrix, and negative eigenvalues
make `p_i < 0` -> entropy undefined -> NaN or silent garbage. Even when `T` is
slightly above `N`, `S` is near-singular and ill-conditioned
([T < N rank deficiency](https://www.oru.se/globalassets/oru-sv/institutioner/hh/workingpapers/workingpapers2021/wp-12-2021.pdf)).

**Ledoit-Wolf shrinkage** fixes both at once. It returns a convex combination of
`S` with a structured, PD target `F`:

```
Sigma_hat = delta * F + (1 - delta) * S,    0 <= delta <= 1
```

Because `F` is PD and full-rank, any `delta > 0` lifts the zero eigenvalues of a
singular `S` strictly above zero, so `Sigma_hat` is PD and invertible _even when
T < N_; simultaneously it pulls the over-dispersed eigenvalues toward the
center, reducing estimation error where it hurts ENB most. Pin the
**constant-correlation target** (keep sample variances, set every pairwise
correlation to the average sample correlation `r_bar`):

```
F_ii = s_ii ,    F_ij = r_bar * sqrt(s_ii * s_jj)
```

with the closed-form optimal intensity (no cross-validation):

```
delta_hat = max( 0, min( kappa_hat / T, 1 ) ),    kappa_hat = (pi_hat - rho_hat) / gamma_hat
```

where `pi_hat` is the summed asymptotic variances of `S`'s entries, `rho_hat`
the summed asymptotic covariances between target and `S` entries, and
`gamma_hat = ||F - S||_F^2` the target misspecification: large estimation noise
shrinks more, a badly misspecified target shrinks less
([Ledoit-Wolf notes](https://reasonabledeviations.com/notes/papers/ledoit_wolf_covariance/);
[PyPortfolioOpt risk models](https://pyportfolioopt.readthedocs.io/en/stable/RiskModels.html)).
This is **mandatory, not optional**: the torsion's `sqrtm` and inverse-transpose
silently produce garbage on a singular `S`. Implement it in-house on `nalgebra`,
pin the variant, write the closed form out, and property-test it (PD output;
intensity in [0, 1]; reduces to sample covariance as `T -> inf`; matches a
reference fixture). Hard-assert PD before eigendecomposition _and_ before the
Monte Carlo Cholesky, and reject or degrade when `n_obs < k * n_assets`.

> When `T << N`, `delta` is large and `Sigma_hat` is heavily biased toward the
> target, so ENB then reflects the target's structure as much as the data --
> disclose this when `n_obs` is far below `n_assets`.

### Required fix -- stressed-correlation ENB (asymmetric, co-crash aware)

The above measures _unconditional_ diversification. In crypto, diversification
fails exactly when needed: in stress, cross-asset correlations spike toward +1,
funding and liquidation cascades couple positions, and a depeg drags
"uncorrelated" stable-pegged legs into the same factor. A single unconditional
`Sigma` hides this, so always report a **stressed ENB** alongside the
unconditional one, recomputing the entire torsion + entropy pipeline on a
stressed covariance `Sigma_stress`. Two constructions, preference order:

1. **Regime-conditional covariance (preferred).** Estimate `Sigma` from
   observations restricted to a crisis sub-sample (high-volatility or drawdown
   regime), then run the exact same pipeline. Regime sampling respects crypto's
   real joint tails and its _asymmetric_ lower-tail dependence (crashes cluster
   more tightly than rallies), so it captures co-crash concentration a symmetric
   overlay cannot.
2. **Correlation stress overlay (engineering convention).** Decompose
   `Sigma = D R D` (`D` = diag of vols, `R` = correlation), push `R`
   off-diagonals toward a crisis level (e.g. ~0.85), optionally raise `D`,
   recompose, re-run ENB.

The diagnostic that matters is the **gap** `ENB_unconditional - ENB_stressed`: a
book that looks like 6 effective bets normally but collapses to ~1.5 under
stressed correlation is carrying hidden tail concentration that fat-tailed
crypto returns will realize.

ENB is not a tail metric, so the contract's `confidence_levels` do not apply --
it is reported once per contract (unconditional plus stressed), driven by the
contract `weights`, `window`, and `sampling_frequency`. Keep `1/HHI`
(inverse-Herfindahl) only as a correlation-blind cross-check, never the
headline. Guard the entropy sum with the `0 * ln 0 = 0` convention and clamp
tiny-negative `p_i` from numerical noise -- a clean shrunk `Sigma_hat` keeps `p`
in `[0, 1]`.

## Decision 3 -- Monte Carlo (MC)

The path matters because leveraged positions can be liquidated _intra-period_: a
position that breaches the liquidation barrier mid-horizon is force-closed and
never recovers, even if the price ends the period back above the barrier. So MC
must simulate multi-step price/return paths (sampled at an hourly-or-finer grid
over a 1-30 day projection horizon) and read risk off the whole trajectory, not
just the endpoint. Four pillars: the data-generating process (DGP), asymmetric
co-crash dependence, intra-period liquidation, and deterministic seeding.

### The data-generating process

**Reject parametric-Gaussian** -- it is the worst choice for crypto tails
(included only as a labeled baseline). A Gaussian copula has zero tail
dependence for `|rho| < 1` (`lambda_lower = lambda_upper = 0`); it literally
cannot produce a co-crash no matter how high the correlation, and is the single
biggest reason a Gaussian engine under-counts joint crash risk.

Run two complementary DGPs and reconcile them.

**Primary: filtered semiparametric copula.** Filter the marginals, model the
tails with EVT, and bind assets with an asymmetric copula
([MATLAB EVT + copula](https://www.mathworks.com/help/econ/using-extreme-value-theory-and-copulas-to-evaluate-market-risk.html);
[GARCH-filtered copula](https://www.sciencedirect.com/science/article/abs/pii/S0304407620302025)):

1. **Filter each asset** with AR(1)-GARCH -- asymmetric GARCH (e.g. GJR) to
   capture the leverage effect -- to remove autocorrelation and volatility
   clustering, producing approximately i.i.d. standardized residuals
   `z_t = epsilon_t / sigma_t`.
2. **Semiparametric marginal CDF:** Gaussian-kernel-smoothed interior for the
   middle ~80%, a GPD fitted by maximum likelihood to each ~10% tail (EVT in the
   tails is what lets you extrapolate beyond the worst observed shock).
3. **Probability integral transform:** `U_i = F_i(z_i)` maps each residual
   through its marginal CDF to a uniform on `[0, 1]`.
4. **Fit an asymmetric copula** so `lambda_lower > lambda_upper` (see below).
5. **Simulate:** draw correlated uniforms, invert each through its marginal CDF,
   then re-introduce autocorrelation and volatility via the fitted GARCH filter
   to produce return paths.

This is strictly more expressive than either pure block bootstrap or pure
multivariate-t: GARCH gives clustering, GPD gives extrapolatable tails, and the
copula carries cross-asset dependence with the freedom to make it asymmetric.

**Cross-check: stationary block bootstrap.** Resample _contiguous blocks_ of the
historical multi-asset standardized-residual (or return) matrix, keeping whole
blocks so serial autocorrelation, volatility clustering, the empirical fat
tails, and the contemporaneous cross-asset co-movement (including real
depeg/crash co-movement) are preserved with **zero distributional assumptions**.
Resample the _whole cross-section as an aligned unit_ (same time index for all
assets), never per-asset independently -- that alignment is what preserves
co-crashes. Use the **stationary bootstrap** (Politis-Romano 1994): each block
length is drawn from a Geometric(`p`) distribution (expected length `1/p`), so
the resampled series is strictly stationary with no block-boundary artifacts --
continue the current block with probability `(1 - p)`, jump to a new
uniform-random start with probability `p`
([Politis-Romano 1994](https://www.tandfonline.com/doi/abs/10.1080/01621459.1994.10476870)).
Pick the block length from the data via the Politis-White (2004) automatic
selector with the Patton-Politis-White (2009) correction
(`b_opt proportional to n^(1/3)`); for a multi-asset panel use a single shared
block length (per-asset selections summarized by average or max) so the
cross-section stays aligned
([Politis-White 2004](https://public.econ.duke.edu/~ap172/Politis_White_2004.pdf);
[arch optimal block length](https://arch.readthedocs.io/en/latest/bootstrap/generated/arch.bootstrap.optimal_block_length.html)).
Block bootstrap cannot produce any event more extreme than the worst block in
history (the SPEC's "stress testing against historical scenarios" -- add
explicit replays of March 2020 / LUNA / FTX / USDC-depeg paths through current
weights and leverage); the filtered copula carries the extrapolated tail.

A **multivariate Student-t** (Cholesky of the shrunk covariance, fat marginals)
is offered only as a labeled alternative, _not_ as a sole DGP. Simulate it as a
scale mixture of normals: draw `Y ~ N(0, Sigma)`, an independent
`W ~ ChiSquare(nu)`, set `X = mu + Y * sqrt(nu / W)`. The shared scalar
`sqrt(nu / W)` inflates all assets together, producing heavy tails and tail
dependence. But finite `nu` yields _symmetric_, non-zero tail dependence
(`lambda_lower = lambda_upper`; only the `nu -> inf` Gaussian limit is
tail-independent), so a single-`nu` multivariate-t structurally under-counts
co-crashes versus co-rallies. Funding spikes that coincide with crashes are
preserved by block-bootstrapping the `(return, funding)` vector jointly -- a
point in favor of the bootstrap path.

### Required fix -- asymmetric / co-crash tail modeling

The _tail dependence coefficient_ is the probability that one asset is extreme
given another is extreme, in the limit:

```
lambda_lower = lim_{u->0+} C(u, u) / u
lambda_upper = lim_{u->1-} (1 - 2u + C(u, u)) / (1 - u)
```

`lambda_lower > 0` means crashes genuinely cluster -- diversification fails
exactly when you need it. Tail dependence by copula family
([VineCopula tail dependence](https://tnagler.github.io/VineCopula/reference/BiCopPar2TailDep.html)):

- **Gaussian:** `lambda_lower = lambda_upper = 0` for `|rho| < 1` (tail-
  independent unless correlation is exactly unit). Cannot produce co-crashes.
- **Student-t:**
  `lambda_lower = lambda_upper = 2 * t_{nu+1}( -sqrt((nu+1)(1 - rho)/(1 + rho)) )`
  -- positive (good) but symmetric (bad; calibrating one `nu` to the average
  pulls the crash tail too thin).
- **Clayton:** `lambda_lower = 2^(-1/theta)`, `lambda_upper = 0` -- concentrates
  dependence in the _lower_ tail, the canonical "everything crashes together but
  rallies are uncorrelated," matching crypto's observed asymmetry.
- **Gumbel:** `lambda_upper = 2 - 2^(1/theta)`, `lambda_lower = 0` -- the mirror
  image.

To model the asymmetry (increasing fidelity): a **rotated/mixture copula**
(Clayton lower-tail component plus the bulk); the **symmetrized Joe-Clayton
(SJC)** copula, which directly parameterizes separate, time-varying
`lambda_lower` and `lambda_upper`; or, for many assets, a **vine (pair-copula)
construction** decomposing the joint dependence into bivariate copulas, each a
different family (Clayton on co-crashing pairs, Gaussian on the rest) -- the
scalable way to get heterogeneous asymmetric tail dependence across a whole
crypto book
([crypto SJC/copula fits](https://www.sciencedirect.com/science/article/abs/pii/S1544612319306087);
[vine copula crypto VaR](https://pmc.ncbi.nlm.nih.gov/articles/PMC7757910/)). A
symmetric-tail or zero-tail model treats depegs and liquidation cascades as
near-impossible; an asymmetric lower-tail copula (or a fat empirical block)
treats them as the fat left tail they are. This is also why the block bootstrap
is a sanity check -- it carries real depeg/crash co-movement with no parametric
assumption at all.

### Required fix -- intra-period liquidation

A leveraged perp is liquidated when the mark price touches its
maintenance-margin / liquidation threshold _at any instant_, not only at the
period close, and on Hyperliquid a backstop liquidation past the insurance fund
can wipe the remaining margin and even auto-deleverage (ADL) a winning position
([path-dependence](https://www.mdpi.com/1099-4300/25/2/202)). Liquidation is a
**barrier (first-passage) event**, so checking the condition only at simulation
grid points misses every crossing that happens between grid points and reverts
before the next -- a systematic, provable _understatement_ of liquidation
probability (the dangerous direction), exactly the discrete-monitoring bias from
barrier-option pricing, material even at daily monitoring
([Broadie-Glasserman-Kou 1997](http://www.columbia.edu/~sk75/mfBGK.pdf)).

Two correct procedures:

1. **Fine-grid simulation** -- simulate hourly or finer and test the barrier at
   every step. Simple, but mitigates rather than eliminates sub-step crossings.
2. **Brownian-bridge barrier correction (preferred)** -- keep a coarse grid but,
   between consecutive simulated log-prices `x = ln(S_t)` and `y = ln(S_(t+1))`,
   compute the analytical probability the path touched a lower barrier `b` in
   between via the Brownian-bridge extremum law:

   ```
   P(min stays above b) = 1 - exp( -2 * (x - b) * (y - b) / (sigma^2 * h) )
   P(hit / liquidation) = exp( -2 * (x - b) * (y - b) / (sigma^2 * h) )
   ```

   with `sigma` the per-step volatility and `h` the step length
   ([Glasserman, Monte Carlo Methods in Financial Engineering, pp. 368-370](https://www.bauer.uh.edu/spirrong/Monte_Carlo_Methods_In_Financial_Enginee.pdf);
   [multi-asset barrier bias](https://arxiv.org/pdf/0904.1157)). The barrier is
   on _account equity / margin ratio_ -- a signed-weight, leverage combination
   of asset prices -- so apply the bridge to the **account-equity path**, not a
   single asset. The bridge assumes a diffusion between points, which a jumpy
   depeg violates, so treat bridge-corrected numbers as a _floor_ on liquidation
   probability and fall back to fine-grid where jumps dominate.

Source per-asset maintenance margin from Hyperliquid's actual **tiered
schedule**, not a single hardcoded `(1/max_leverage)/2`. The documented rules
([Hyperliquid margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining);
[liquidations](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations);
[margin tiers](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers)):

- Initial margin fraction `IMF = 1 / leverage`; max leverage runs 3x (illiquid)
  to 40x (majors).
- Maintenance margin fraction is **half the initial margin rate at max
  leverage** -- the _fraction_ is halved, not the leverage number:
  `MMF = 1 / (2 * max_leverage)` (1.25% at 40x, 2.5% at 20x, 16.7% at 3x), with
  max leverage stepping down by position-size **tier** (BTC: 40x up to 150M USDC
  notional, 20x above).
- Dollar maintenance margin is continuous across tiers:
  `maintenance_margin = notional * MMF - maintenance_deduction(tier)`.
- Liquidation price (verbatim):
  `liq_price = price - side * margin_available / position_size / (1 - l * side)`,
  with `l = MMF`, `side = +1` long / `-1` short, and
  `margin_available = account_value - maintenance_margin_required` (cross) or
  `isolated_margin - maintenance_margin_required` (isolated).
- A cross account is liquidatable when
  `account_value (incl. unrealized PnL) < maintenance_margin_required`
  (`= notional * MMF(tier) - maintenance_deduction(tier)`);
  `MMF * total_notional` is the tier-0 special case only. Pull live tier tables
  from the API `meta` info; do not hardcode beyond the documented BTC split.

State the margin mode: in **cross** margin a liquidation must deleverage the
whole book, not zero one leg; in **isolated** margin the liquidation price
depends on the chosen leverage. Drive the distance-to-liquidation off the
fat-tailed return model (Student-t / EVT), not Gaussian, and evaluate
portfolio-level liquidation under a stressed correlation matrix, since the book
de-diversifies precisely in the tail.

### Required fix -- deterministic seeding for value-stable results

A risk number that changes run-to-run for the same inputs is not auditable; the
engine must be bit-reproducible (same inputs plus same seed give the same number
across machines, thread counts, and reruns). Use a **counter-based RNG (CBRNG --
Philox or Threefry)**, not a stateful stream RNG: a CBRNG computes the n-th
output directly from `(key, counter)` with no sequential state, so each path
gets its own independent sub-stream and the draws are identical regardless of
thread scheduling
([counter-based RNG reproducibility](https://arxiv.org/html/2605.05099v1)).

Concrete scheme: one logged master seed is the only entropy input; derive a
per-path key/counter offset deterministically from `(master_seed, path_index)`
so path `i` always consumes the same sub-stream regardless of run order or core
count; for the block bootstrap derive the block-start indices and geometric
block-length draws for path `i` from path `i`'s sub-stream. Never seed from
wall-clock time or OS entropy in the risk path. Value-stability is the
conjunction of a deterministic RNG _and_ a deterministic floating-point
reduction -- floating-point addition is not associative, so a parallel sum in
arbitrary order changes the last bits; aggregate path losses with a fixed-order
fold, fix a stable iteration order over assets, and pin library versions.

In Rust specifically, `StdRng` is _not_ value-stable across `rand` major
versions, so `cargo update` can silently change every number for the same seed.
Pin a counter-based generator (e.g. `rand`'s Philox via `rand_distr`, or a
ChaCha-family generator for the stream) and record the RNG name plus version
alongside the seed. Confirm the exact crate's jump-ahead/stream API gives
cross-platform bit-reproducibility before relying on it.

## The contract gap and the buildable-today slice

The `MeasurementContract` in `src/risk.rs` carries `window` (lookback or
explicit range), `sampling_frequency` (Daily/Weekly), and `confidence_levels`
(subset of {0.90, 0.95, 0.99}), with signed `weights` on the request. It does
**not** carry several inputs this methodology needs:

- **Portfolio leverage** -- required to scale the aggregated portfolio return
  (`R_p_t = leverage * sum_i w_i * R_i_t`) and to compute liquidation distance.
- **A projection horizon `H`** -- distinct from the estimation `window`; the
  MC/EVT horizon-handling target. Needs a default and bounds.
- **Per-leg margin / max-leverage tier** -- to source Hyperliquid maintenance
  margin per the tiered schedule rather than a hardcoded fraction.
- **A funding-series source** -- to fold funding into perp P&L by side and to
  joint-bootstrap `(return, funding)`.
- **A leg-type tag** (stablecoin vs perp vs spot) -- to route stablecoin legs to
  the jump/mixture model and perp legs to funding-inclusive P&L.

The SPEC risk section lists VaR/CVaR, correlation matrix, ENB, and historical
stress testing -- it does **not** mention Monte Carlo, liquidation, or
funding-in-returns, so those are a scope expansion beyond the SPEC text (in
scope per the build plan, but needing owner buy-in plus the contract changes
above).

- **Buildable today (no contract change):** the shrunk **correlation matrix**,
  **unlevered historical VaR/CVaR** (HS body plus EVT tail at high confidence,
  conditional-volatility filtered), **ENB** (unconditional plus stressed), and
  **historical max-drawdown** (peak-to-trough on the realized cumulative path:
  running max, drawdown series, max magnitude and duration -- its own
  definition, independent of MC). A clean shippable first slice. The reported
  correlation matrix is the **shrunk** one (consistent with ENB / MC), stated as
  such.
- **Needs contract changes plus buy-in:** leverage scaling, Monte Carlo,
  liquidation probability, and funding-in-returns.

## New crates

| Crate                  | For                                                               | Decision |
| ---------------------- | ----------------------------------------------------------------- | -------- |
| `nalgebra`             | symmetric eigendecomposition (ENB), Cholesky (MC), matrix algebra | 2, 3     |
| `rand` + counter-based | value-stable seeded RNG (Philox / ChaCha-family)                  | 3        |
| `rand_distr`           | Student-t / normal draws                                          | 3        |
| `statrs`               | Student-t distribution + `nu` estimation                          | 1, 3     |
| Polars (existing)      | return series, quantiles, covariance assembly                     | 1, 2, 3  |

Ledoit-Wolf shrinkage (constant-correlation target) is implemented in-house on
`nalgebra` (closed-form intensity), pinned and property-tested.

## Fix checklist (priority order)

1. **Small-sample tail.** Add EVT/POT (GPD) as the 99% headline at small `n` (HS
   becomes the cross-check there); filter with EWMA(0.94) or GARCH(1,1)
   conditional volatility before fitting the tail. Surface `xi >= 1` (infinite-
   mean tail, ES undefined) and `nu <= 2` (infinite-variance) as risk flags.
2. **Positive-definiteness / conditioning.** Mandatory Ledoit-Wolf shrinkage
   (constant-correlation target) so `Sigma_hat` is PD and invertible even when
   `n_obs < n_assets`; hard-assert PD before eigendecomposition and the MC
   Cholesky; reject/degrade when `n_obs < k * n_assets`; property-test the
   shrinkage estimator.
3. **Portfolio aggregation.** Aggregate in **simple-return space** at the
   portfolio level with signed, leverage-scaled weights, converting to log only
   once at the portfolio level -- never average per-asset log returns.
4. **Asymmetric / co-crash tail.** Use an asymmetric lower-tail copula (Clayton
   / SJC / vine) or a real historical-scenario replay (March 2020 / LUNA / FTX /
   USDC-depeg) for the joint left tail; a single-`nu` multivariate-t and any
   synthetic rho-bump are not substitutes.
5. **Intra-period liquidation.** Brownian-bridge barrier monitoring (fine-grid
   fallback) on the **account-equity** path; per-asset Hyperliquid maintenance
   margin from the live tiered schedule (`MMF = 1/(2*max_leverage)`, the
   fraction halved, with the `maintenance_deduction` continuity term); stated
   isolated-vs-cross margin mode (cross deleverages the whole book).
6. **Contract gap.** Add `leverage`, projection horizon `H`, per-leg
   margin/tier, funding-series source, and leg-type tag to the contract; ship
   the buildable-today slice (shrunk correlation, unlevered VaR/CVaR, ENB,
   max-drawdown) first.

Smaller but required: pin a counter-based / value-stable RNG (not `StdRng`) and
record name plus version alongside the seed; aggregate path losses with a
fixed-order reduction; a dedicated historical max-drawdown definition; report
the shrunk correlation matrix and say so; specify and unit-test the ES estimator
(Acerbi-Tasche with a defined interpolation rule).

Relevant files: `src/risk.rs` (the `MeasurementContract` this threads through),
`SPEC.md` (risk section).
