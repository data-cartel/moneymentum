# Moneymentum Architecture Specification

## Terminology Standard

Use proper financial terminology throughout--docs, code, UI. It's precise,
expected by institutional traders, and avoids ambiguity. Define terms in context
when first introduced. The system should educate, not gate-keep or oversimplify.

## The Problem

A portfolio of 10 crypto assets looks diversified, but if they all move in
lockstep with BTC, you effectively have one bet. Professional traders think in
**factor exposures**--systematic drivers of returns like beta (correlation to a
benchmark), momentum (tendency of winners to keep winning), and carry (yield
from holding a position)--rather than individual positions. This lets them:

- **Reason about risk**: "What's my actual BTC exposure across spot and perps
  (perpetual futures) combined?"
- **Construct portfolios intentionally**: "I want momentum exposure without
  adding market beta"
- **Define targets as proportions**: "60% BTC beta, 20% high-momentum, 20%
  carry" rather than "2.5 BTC, 10 ETH, 50 SOL"

This tool provides factor-based screening, portfolio construction, risk
analytics, and simulation of changes before execution.

**Portfolios as proportions, not positions.** Professional portfolio managers
define targets as weights (40% asset A, 30% asset B, 30% asset C) and a leverage
multiplier (total exposure as a multiple of capital)--not as fixed position
sizes. This matters because:

- **Rebalancing has meaning**: When prices move, weights drift. Rebalancing
  means returning to target proportions, which is a deliberate risk management
  action.
- **Scaling is trivial**: Double your capital? Same weights, same risk profile.
  No need to recalculate position sizes.
- **Leverage is explicit**: Total exposure = NAV (net asset value) × leverage. A
  2x leveraged portfolio at 40/30/30 weights is immediately understandable.

The alternative--thinking in position sizes ("2.5 BTC, 10 ETH")--obscures risk.
Your weights change silently as prices move. "Rebalancing" becomes ambiguous.
This tool enforces proportion-based thinking.

## Core Workflow

**Monitor → Screen → Stage → Simulate → Execute → Repeat**

1. **Monitor**: Check how your portfolio is doing--performance, factor
   exposures, risk metrics
2. **Screen**: Search for positions based on what you want to change:
   - Direct exposure to specific assets
   - Beta to assets (BTC, ETH, SPY)
   - Funding rates (periodic payments between long and short holders in
     perps--positive = longs pay shorts)
   - Sharpe ratio (risk-adjusted return), volatility
3. **Stage**: Add/remove positions, adjust weights and leverage. Portfolio is
   defined as **proportions + leverage**, not dollar amounts
4. **Simulate**: Instantly see how staged portfolio compares to
   current--historical performance, factor decomposition, risk metrics, and the
   specific trades needed to rebalance
5. **Execute**: Hit rebalance when satisfied
6. **Repeat**: Market moves change your realized weights. Hit rebalance to
   return to target proportions, or adjust the target and rebalance to that

[ROADMAP](./ROADMAP.md) groups in-flight workflow improvements into themes;
[stories/](./stories/README.md) breaks each into deliverable units with
acceptance criteria.

## Core Architectural Principle

**Dual abstraction**: The system abstracts away both **data sources** and
**execution venues**.

| Layer         | Trader Thinks            | System Handles                         |
| ------------- | ------------------------ | -------------------------------------- |
| **Data**      | "What's my BTC beta?"    | Aggregating data from multiple sources |
| **Execution** | "Rebalance to my target" | Routing orders to the correct venue    |

- Adding a new data source = one adapter, no analytics changes
- Adding a new execution venue = one adapter, no portfolio logic changes

```mermaid
flowchart LR
    T[/"Trader: Rebalance<br/>to 60/20/20"/]

    subgraph Backend["Backend (Rust)"]
        direction TB
        DATA[(Market Data)]
        ANAL[Analytics Engine]
        PLAN[Execution<br/>Plan Generator]
        ROUTE[Venue Router]
        DATA --> ANAL --> PLAN --> ROUTE
    end

    subgraph Turnkey["Turnkey (Policy Enforcement)"]
        direction TB
        POL[Policy Engine]
        WALLET[Server Wallets]
        POL --> WALLET
    end

    V[Venues]

    T --> PLAN
    ROUTE -->|signing requests| POL
    WALLET -->|transactions| V
```

## Security Model

**Policy-enforced custody via Turnkey server wallets.** The backend orchestrates
execution but never holds raw private keys.

- **Policy engine**: Contract allowlists, calldata restrictions, deny rules.
  Even if the backend is compromised, it cannot execute transactions outside
  policy bounds.
- **Credential separation**: Trading credentials are scoped to trade-only
  operations. Withdrawal credentials are held at a higher privilege tier.

The backend pre-computes global market metrics (betas, correlations, etc.) and
returns user-specific analytics (portfolio beta, Value at Risk (VaR), execution
plans). The frontend is a monitoring and control dashboard.

## Custody & Execution

**Turnkey server wallets** provide the custody layer with policy enforcement at
the signing layer. The backend routes orders to venues but cannot withdraw funds
or interact with non-whitelisted contracts.

**Solana vault program** (Anchor) handles investor deposits/withdrawals, share
token accounting, and fee deductions. Capital flows from the vault to Turnkey
wallets for trading across venues.

**NAV oracle**: The backend aggregates positions across all venues, computes
total NAV, and posts signed attestations to the vault program.

```mermaid
---
title: "Flow of Funds: Deposits, Rebalancing & Withdrawals"
---
graph TB
    subgraph Solana["── Solana ──"]
        Investor["Investor"]
        Vault["Vault Program<br/>─────────────<br/>share tokens<br/>fee accounting<br/>NAV attestations"]
        SOLWallet["Turnkey SOL Wallet<br/>(vault custody)"]
        HumidiFi["HumidiFi<br/>spot trading"]
        PMFee["PM Fee Wallet"]

        Investor -- "1. deposit USDC" --> Vault
        Vault -- "2. mint shares,<br/>forward USDC" --> SOLWallet
        SOLWallet -- "spot swap" --> HumidiFi
        HumidiFi -- "return tokens" --> SOLWallet

        %% Withdrawal return
        SOLWallet -. "return USDC" .-> Vault
        Vault -. "3. burn shares,<br/>deduct fees,<br/>send net USDC" .-> Investor
        Vault -. "mgmt + perf fee" .-> PMFee
    end

    subgraph Bridge["── deBridge ──"]
        deBridge["Solana ↔ Hyperliquid<br/>direct USDC"]
    end

    subgraph Hyperliquid["── Hyperliquid L1 ──"]
        EVMWallet["Turnkey EVM Wallet<br/>(HyperEVM home)"]
        HyperCore["HyperCore<br/>perps + spot"]

        EVMWallet -- "deposit USDC" --> HyperCore
        HyperCore -- "withdraw USDC" --> EVMWallet
    end

    subgraph DeriveChain["── Derive Chain ──"]
        DeriveDeposit["Derive Native Deposit<br/>from HyperEVM"]
        DeriveProtocol["Derive Protocol<br/>options"]

        DeriveDeposit --> DeriveProtocol
    end

    %% Cross-chain: Solana to Hyperliquid
    SOLWallet -- "bridge USDC" --> deBridge
    deBridge -- "receive USDC" --> EVMWallet

    %% Cross-chain: Hyperliquid to Derive
    EVMWallet -- "deposit USDC" --> DeriveDeposit
    DeriveProtocol -- "withdraw USDC" --> EVMWallet

    %% Withdrawal: bridge back
    EVMWallet -. "bridge back" .-> deBridge
    deBridge -. "return USDC" .-> SOLWallet

    %% Styles
    style Solana fill:#0f1419,stroke:#10b981,color:#e2e8f0
    style Hyperliquid fill:#0f1419,stroke:#06b6d4,color:#e2e8f0
    style DeriveChain fill:#0f1419,stroke:#a855f7,color:#e2e8f0
    style Bridge fill:#1a1a2e,stroke:#ef4444,color:#e2e8f0
```

## Fee Structure

Fees are the commercialization mechanism. Personal use is free (0/0 fees).
Revenue comes from portfolio managers (PMs) managing other people's money.

- **Management fee**: Annual percentage of AUM (assets under management),
  deducted at withdrawal
- **Performance fee**: Percentage of profits above high-water mark
  (HWM)--ensures fees only on new profits
- **Platform fee**: Percentage of PM's collected fees (not investor capital),
  creating aligned incentives

## Technology Stack

| Layer         | Technology             | Rationale                                |
| ------------- | ---------------------- | ---------------------------------------- |
| Backend       | Rust                   | See below.                               |
| Frontend      | TypeScript + SolidJS   | Monitoring dashboard, PM controls.       |
| Vault Program | Anchor (Rust)          | Deposits, withdrawals, fees, NAV.        |
| Custody       | Turnkey server wallets | Policy-enforced signing.                 |
| Dependencies  | Nix                    | Reproducible builds. Non-negotiable.     |
| Storage       | SQLite > Postgres      | Start simple, migrate when needed.       |
| Analytics     | Parquet                | Historical prices for VaR, stress tests. |

**Why Rust?**

- Official SDKs for Hyperliquid, Derive, deBridge, Jupiter--no client-building
- Polars for analytics--Rust-native DataFrames, no JVM overhead
- Alloy for HyperEVM, solana-sdk for Solana--transaction building in one
  language
- Single binary deployment, instant startup, minimal runtime dependencies
- Type safety and memory safety without garbage collector pauses

**Key crates:**

| Purpose   | Crate                                            |
| --------- | ------------------------------------------------ |
| API       | rocket                                           |
| Analytics | polars, linfa                                    |
| State     | SQLite ingestion runs, Apalis job queue          |
| EVM       | alloy                                            |
| Solana    | solana-sdk, anchor-client                        |
| Venues    | hyperliquid-rs, cockpit, jupiter-swap-api-client |
| DB        | sqlx - SQLite DB access                          |
| Types     | ts-rs (TypeScript bindings)                      |

## Domain Architecture

**Bounded contexts:**

| Domain              | Responsibility                                          |
| ------------------- | ------------------------------------------------------- |
| **Portfolio**       | Target weights, current positions, NAV computation      |
| **Chain**           | Blockchain abstraction--tx formats, RPC, confirmations  |
| **Analytics**       | Factor exposures, risk metrics, correlations            |
| **Spot Trading**    | Buy/sell tokens on spot venues                          |
| **Perps Trading**   | Open/close perpetual futures positions                  |
| **Options Trading** | Options contracts, Greeks                               |
| **Bridging**        | Cross-chain asset transfers                             |
| **Wallet**          | Transaction signing, policy enforcement                 |
| **Vault**           | Investor deposits, share tokens, fee accounting         |
| **Rebalancing**     | Orchestrate trades across venues/chains to reach target |

**Crate mapping:**

| Crate      | Trait          | Implementations                  |
| ---------- | -------------- | -------------------------------- |
| portfolio  | --             | --                               |
| chain      | `Chain`        | `solana`, `evm`, `mock`          |
| analytics  | `Analytics`    | `polars`, `mock`                 |
| spot       | `SpotVenue`    | `hyperliquid`, `jupiter`, `mock` |
| perps      | `PerpsVenue`   | `hyperliquid`, `mock`            |
| options    | `OptionsVenue` | `derive`, `mock`                 |
| bridging   | `Bridge`       | `debridge`, `mock`               |
| wallet     | `Wallet`       | `turnkey`, `mock`                |
| vault      | `VaultClient`  | `anchor`, `mock`                 |
| rebalancer | --             | --                               |
| api        | --             | --                               |

Each crate exposes a trait and common types. Implementations are behind feature
flags (e.g., `spot/hyperliquid`, `spot/mock`) to enforce domain boundaries,
improve build times, and enable testing with mocks.

This is the target architecture. The current backend lives in a single root
crate at `src/`; the split into per-domain crates happens as domain boundaries
solidify.

## Analytics Capabilities

**Factor Engine**: Computes per-asset factor scores (beta, momentum, carry,
volatility, Sharpe) over the tradable universe. The backend computes rolling
beta to BTC and serves per-asset factor scores via `GET /factors/<timeframe>`;
factors land incrementally as columns (rolling windows over ingested
open-high-low-close-volume (OHLCV) and funding-rate data). Outputs feed the
screener (rank/filter assets by factor) and the rebalancer (target factor
exposures, not symbols).

The portfolio-weighted beta is exposed via `POST /beta`, which accepts a set of
position weights plus a benchmark symbol and returns a single beta value
(weighted sum of per-asset rolling betas to the benchmark). Per-asset betas are
computed from log returns over a rolling window of daily candles. The endpoint
is the canonical way for clients to compute portfolio Bitcoin beta;
endpoint-level request/response details are documented next to the handler in
the backend crate.

**Risk Engine**: Portfolio-level risk metrics

- VaR/CVaR (Value at Risk: maximum expected loss at a confidence level;
  Conditional VaR: expected loss when VaR is exceeded)
- Correlation matrix
- Effective number of bets (true diversification accounting for correlations)
- Stress testing against historical scenarios

## UI/UX Principles

**Keyboard-first, mouse-friendly.** Professional trading tools need speed. Power
users get vim-style and Bloomberg-style keyboard navigation--hjkl movement,
single-key actions, modal editing. But unlike vim, you shouldn't need to google
"how to quit" on day one. Everything is also clickable. Power comes from
learning the shortcuts, not from requiring them.

**Staged changes with instant feedback.** Never execute blind. Every portfolio
change is staged first, with immediate visualization of impact on factor
exposures, risk metrics, and the specific trades required. Commit when
satisfied.

## Future Directions

These are areas we know we want to explore but haven't designed in detail:

| Area                     | Notes                                 |
| ------------------------ | ------------------------------------- |
| **Tokenized Equities**   | SPY, TLT for factor hedging.          |
| **Fixed Income / Yield** | Yield-bearing positions, staking.     |
| **Multi-account**        | Isolated risk, shared infrastructure. |
