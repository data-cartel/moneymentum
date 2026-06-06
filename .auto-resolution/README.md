# Moneymentum

[![His name is Yang](https://img.youtube.com/vi/FoYC_8cutb0/0.jpg)](https://www.youtube.com/watch?v=FoYC_8cutb0)

Moneymentum is an institutional-grade quant toolkit for crypto portfolio
management. Define portfolios as proportions, not positions. Stage and simulate
before executing. Manage factor exposures, not symbols. Most crypto holders
cannot answer basic questions about their portfolio's factor exposure;
Moneymentum makes those exposures legible and adjustable.

## Status

- **Frontend rebalancer** (working, used daily): weight-based positions,
  cross-account leverage, staged trade preview, execution against Hyperliquid
  perps.
- **Frontend prototype** at `/prototype`: design reference for the target UI.
- **Backend** (active development): Rust + Axum API, Polars analytics,
  SQLite-backed ingestion runs and job queue. Ingests Hyperliquid
  open-high-low-close-volume (OHLCV) and funding rates; computes rolling beta to
  BTC and serves per-asset factor scores via `GET /factors/<timeframe>`.
- **Vault program** (planned): Anchor program on Solana for non-custodial
  managed deposits with two-phase withdrawal.

See [ROADMAP.md](./ROADMAP.md) for what's next.

## Documentation

| Doc                                  | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| [SPEC.md](./SPEC.md)                 | Product vision and target architecture             |
| [ROADMAP.md](./ROADMAP.md)           | Themed stories ordered by priority                 |
| [stories/](./stories/README.md)      | User and dev stories with acceptance tests         |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Extreme Programming (XP) workflow for contributors |
| [AGENTS.md](./AGENTS.md)             | Per-repo rules for AI coding agents                |

## Quick start

### Prerequisites

- Nix with flakes enabled
- Direnv (recommended)

### Setup

```bash
git clone https://github.com/dataclique/moneymentum.git
cd moneymentum
direnv allow  # or: nix develop
```

### Frontend

Run from `frontend/`:

```bash
bun run typecheck   # type check
bun run lint        # eslint
bun run test        # vitest
bun run dev         # dev server on :5173
bun run build       # production bundle
```

### Backend

Run from repo root:

```bash
cargo check         # fast compilation verification
cargo test -q       # tests
cargo clippy        # lints (pedantic + nursery, panic-free)
cargo fmt           # format

cargo run -- --help # see CLI options
```

Configuration is loaded from a TOML file modeled on
[example.toml](./example.toml).

### Pre-commit

```bash
pre-commit run -a
```

All dependencies are managed through Nix. Do not use `bun install` or similar
directly.

### Running AI coding agents

Launch agents via `nix develop --impure` rather than relying on direnv to avoid
shell-init quirks:

```bash
nix develop --impure -c claude
```

Agents must follow [AGENTS.md](./AGENTS.md).

## Infrastructure

Terraform provisions the server, then NixOS is bootstrapped onto it.

```bash
nix run .#tfCreateVars   # create + encrypt terraform vars
nix run .#tfInit
nix run .#tfPlan
nix run .#tfApply
nix run .#bootstrap      # bootstrap NixOS

nix run .#remote         # SSH
nix run .#tfEditVars
```

Infrastructure commands use age-encrypted state. The `-i` flag selects a custom
SSH identity (defaults to `~/.ssh/id_ed25519`).

`master` deploys automatically through the `Deploy` GitHub Actions workflow. The
workflow pins the SSH host key from `keys.nix`, resolves the host IP from
encrypted Terraform state, builds the frontend with Bun and cached dependencies,
runs `nix run .#deployServer` for NixOS and backend services, then runs
`nix run .#deployFrontend` to publish the static frontend files. The
`post-deploy-smoke-test` job verifies the public frontend and `/api/health`.

Manual deployment uses the same split flow:

```bash
nix develop --impure .#frontend --command bash -c 'cd frontend && bun install --frozen-lockfile && bun run build'
nix run .#deployServer
nix run .#deployFrontend
```

Set `DEPLOY_FRONTEND_URL` and `DEPLOY_HEALTH_URL` repository variables when the
public checks should use a domain or HTTPS instead of the raw droplet IP. Set
`DEPLOY_SMOKE_HOST` when the post-deploy smoke test needs an explicit `Host`
header, such as targeting a domain behind a load balancer; set
`DEPLOY_SMOKE_INSECURE` to `true` only when those frontend and `/api/health`
checks must skip TLS verification for self-signed certificates.

There is no standalone destroy command. To remove or reprovision resources, edit
`infra/main.tf`, inspect `nix run .#tfPlan`, then apply the reviewed plan.
