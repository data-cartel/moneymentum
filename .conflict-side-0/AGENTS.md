# AGENTS.md

Rules and guidelines for AI agents working in this repository. Everything in
this document is a directive, not a suggestion.

---

## Project Direction

This project is an institutional-grade quant toolkit. See [SPEC.md](./SPEC.md)
for the vision and [ROADMAP.md](./ROADMAP.md) for the path.

### Agent expectations

AI coding agents working in this repo are expected to:

- Read [ROADMAP.md](./ROADMAP.md) and the relevant story under
  [stories/](./stories/README.md) before changing code. The story's acceptance
  criteria are the contract.
- Follow [CONTRIBUTING.md](./CONTRIBUTING.md): types-first, failing test,
  implementation, review.
- Honor the rules in this document for code style, testing, and quality gates.
- Edit code, tests, and configs in this repo. Humans own deploys, secrets, and
  external systems outside git.
- Never relax quality checks (clippy, eslint, tests) without explicit
  permission. Ask if a check seems wrong; don't suppress.
- Don't substitute approaches, libraries, or tools without checking in. Scope is
  whatever was asked, not whatever you'd prefer.

For status -- what works today vs. what's planned -- see
[README.md](./README.md) and [ROADMAP.md](./ROADMAP.md).

**Key architectural decisions:**

- **All Rust**: Official SDKs for Hyperliquid, Derive, deBridge, Jupiter. Polars
  for analytics. Single language from API to blockchain interactions.
- **Frontend holds credentials**: Backend generates execution plans, frontend
  executes. Credentials never leave the browser.
- **Portfolios as proportions**: Target portfolios are defined as weights +
  leverage, not dollar amounts. Rebalancing = return to target proportions.

---

## Development Commands

### Frontend (SolidJS + Vite)

Run from `frontend/` directory:

```bash
cd frontend
bun run typecheck  # Type check only
bun run lint       # Lint
bun run test       # Run tests (vitest)
bun run build      # Full build
bun run dev        # Dev server (port 5173) - only when explicitly asked
```

### Backend (Rust)

```bash
cargo check              # Fast compilation verification
cargo test -q            # Run tests
cargo clippy             # Linting
cargo fmt                # Format code
```

**Workflow (TTDD - Type-driven TDD)**:

TTDD sequence:

1. **Types first**: Define types, traits, and method signatures that model the
   domain
2. **Failing tests**: Write tests that compile but fail (build errors don't
   count as failing tests)
3. **Implementation**: Write the logic to make tests pass

While developing, continuously run `cargo check` and `cargo test` to verify
types and behavior. Only after implementation is complete, run `cargo clippy`
and fix all warnings. Finally, `cargo fmt` before committing.

**CRITICAL: Never use `cargo build` for verification.** Use `cargo check`
(faster) or `cargo test` (more useful). Only use `cargo build` when you need the
binary.

**Dependencies**: Always use `cargo add <crate>` - never manually edit
Cargo.toml versions.

**Migrations**: Never manually create migration files. Always use sqlx CLI:

```bash
sqlx migrate add <migration_name>  # Creates timestamped migration file
sqlx migrate run                   # Applies pending migrations
```

### Environment

- **Nix + Direnv**: `direnv allow` activates the dev environment
- All dependencies managed through Nix flake - do not use bun install, cargo
  install, or similar

### Version control

All write operations go through the GitButler CLI (`but`) -- never `git add`,
`git commit`, `git push`, `git checkout`, `git rebase`, or other git writes.
Read-only git inspection (`git status`, `git log`, `git diff`) is fine. See
[ai/skills/gitbutler/SKILL.md](./ai/skills/gitbutler/SKILL.md) for the full
command reference and workflow.

---

## Workflow & Policies

### When issues are pointed out

Fix immediately. The user never sends messages just for the sake of it.

### No self-promotion

Never add "Generated with [Tool Name]" to commits, PRs, or code.

### PR titles and descriptions

**Titles**: Lowercase, imperative, concise. Describe the outcome, not the
mechanism. No prefixes like `feat:` or `fix:`.

- Good: `migrate frontend from React to SolidJS`
- Good: `replace exceptions with typed Effect errors`
- Bad: `Add Effect library for functional HTTP error handling`
- Bad: `Refactor API hooks to use Effect-based error handling`

**Descriptions**: Two sections -- `## Why` and `## How`.

- **Why**: The problem or motivation. Why does this PR exist?
- **How**: High-level approach. Explain the solution, not the file changes --
  the diff tab handles that. No file paths, no bullet lists of changes.

```
## Why

<1-3 sentences explaining the problem or motivation>

## How

<1-3 sentences explaining the approach and key decisions>
```

### Every PR is tracked by an issue and the roadmap

Every PR `Closes` a problem-only GitHub issue, and that issue is a checklist
item in the relevant [ROADMAP.md](./ROADMAP.md) section linking the issue and
the PR. Keep the roadmap in lockstep: the entry and its tick land on the feature
PR itself, so the roadmap always matches what merged. The `pr-tracking` skill
makes a whole stack conform.

### Every stacked PR carries the GitButler stack footer

Every PR that belongs to a multi-branch stack must carry the GitButler
stack-navigation footer -- the
`This is part X of N in a stack made with
GitButler:` block (between the
`<!-- GitButler Footer Boundary -->` markers) listing the stack's PRs
top-to-bottom with the current one marked. It orients reviewers in the stack and
links the sibling PRs.

GitButler writes this footer when it opens or pushes a PR, but it **drifts**: a
no-op push does not rewrite it, so after a rebase, a branch add/remove, or a
merge it goes stale (lists merged PRs, wrong `N`, wrong position) or is missing
entirely on PRs that were not opened through GitButler. There is no `but`
command to refresh it. Keep every stacked PR's footer current by running
`nix run .#pr-stack-footer` (`scripts/pr-stack-footer.nu`), which rebuilds each
stack's footer from the live workspace and splices it into the PR bodies. Run it
after any operation that reshapes the stack.

### Documentation stays in lockstep with the code

Every PR must leave the documentation in a true state. Before handing off work
-- requesting review, marking a task done, declaring a story complete -- audit
the docs that touch what you changed and update anything that has gone stale.

Concrete audit checklist:

- [README.md](./README.md): does it still describe the system accurately (status
  of components, doc index)?
- [SPEC.md](./SPEC.md): does the vision or architecture description still match
  the code?
- [ROADMAP.md](./ROADMAP.md): are completed items marked completed, are new
  themes/stories listed, are stale ones removed?
- [stories/](./stories/README.md): is the story status frontmatter current, is
  the index entry present, are acceptance criteria reworded to match the shipped
  behavior?
- [CONTRIBUTING.md](./CONTRIBUTING.md) and `AGENTS.md`: did a rule change in
  practice? If so, the rule changes here first.
- Per-file CLAUDE.md / AGENTS.md (e.g. `frontend/CLAUDE.md`): same audit at the
  subtree level.
- Inline doc comments and module-level docstrings on any code you touched.

If a doc has fallen out of sync with reality and is not directly in your
change's path, either fix it in the same PR (preferred) or open a follow-up
issue immediately -- do not leave silent drift.

Stale documentation is a bug. Treat it like any other defect: do not ship work
that introduces it, and do not ignore it when you see it.

### Quality checks

**NEVER disable or relax any quality checks without explicit permission.** This
applies to:

- Clippy lints (`#[allow(clippy::*)]`)
- Compiler warnings (`#[allow(dead_code)]`, `#[allow(unused)]`)
- All linters in all languages (eslint, clippy, etc.)
- Test coverage - should not decrease without permission

Fix the underlying code, don't suppress warnings.

**When permission IS appropriate:** If fixing the underlying code is impossible
or would be worse than suppressing (e.g., a false positive, or a lint that
conflicts with project policy), STOP and ask for permission. Don't waste time on
convoluted workarounds - just ask. When granted, add a comment explaining why
the allow is necessary.

### Dependencies

- Frontend: use bun commands (`bun add`, `bun remove`). Never manually write
  version numbers - LLMs hallucinate them.
- Never bypass nix for dependency management.

### When stuck

If a fix doesn't work after three attempts, look up the official documentation.

### No hidden defaults

Never add default values (e.g., `#[serde(default)]`, `Option::unwrap_or`)
without being explicitly asked. Required configuration should fail loudly if
missing, not silently use a value the user didn't choose. Default values can be
grabbed from example.toml if needed. This makes it so that configuration
parameters are explicit by default while at the same time providing an easy
starting point for new setups.

### Testing

Write tests before changing logic. When writing tests for existing code, don't
assume current behavior is correct - it may have bugs.

**Tests must verify both behavior and observability.** Every test that exercises
business logic must also assert on expected log output (via `tracing-test`).
Observability is not optional - if code should log something, the test must
verify it does. Don't create separate test cases for logging; add log assertions
alongside behavioral assertions in the same test.

**Use `logs_contain_at` for log assertions.** The helper
`logs_contain_at(level,
&["snippet1", "snippet2"])` checks that a single log
line at the given level contains all specified snippets. This ensures you're
testing that the right information appears together in one log entry:

```rust
#[traced_test]
#[test]
fn ingestion_logs_progress() {
    // ... trigger ingestion ...
    assert!(logs_contain_at(Level::DEBUG, &["fetching", "BTC"]));
    assert!(logs_contain_at(Level::DEBUG, &["fetched", "1"]));
}
```

---

## Code Style

### Functional programming

Prefer declarative, expression-oriented code:

- `map`, `filter`, `fold`/`reduce`, `collect` over imperative loops
- Pure functions, immutable data
- Immutability by default: in TypeScript use `const`, in Rust use `let`; only
  use `let`/`let mut` respectively when mutation is necessary
- Method chaining over intermediate variables

**The smell to avoid**:
`let mut vec = Vec::new(); for x in xs { vec.push(...) }` when you could just
`.map(...).collect()`. But `mut` is fine in idiomatic contexts like `.scan()`,
`.try_fold()`, or builder patterns (`.with_x()` methods).

### No boolean blindness

Prefer discriminated unions or named functions over raw booleans:

```typescript
// Bad
setIsOpen(true);

// Good
type ModalState = "open" | "closed";
setModalState("open");

// Also good
const openModal = () => setIsOpen(true);
```

### ASCII for code, Unicode for users

The split is by **audience**, not by file type or language.

**ASCII** (the default): code, comments, identifiers, type names, log messages,
git commit subjects, PR titles, documentation prose, configuration files, and
developer-console output (`console.log`, `console.table`, `tracing` calls). Use
ASCII equivalents: `*` not `×`, `->` not `→`, `~` not `≈`, `--` not em-dash,
`beta` not `β`.

**Unicode** (whenever the audience is a user): UI text rendered in the app, CLI
messages presented to a user, error messages surfaced in the product,
tooltip/aria/accessibility strings, and -- importantly -- **the quoted UI
strings that appear inside documentation**. Story files routinely cite UI text
verbatim (e.g. `the tooltip reads "Read-only — cannot trade"`); inside those
quotes, write the exact character the user will see. The prose around the quote
stays ASCII.

The placeholder rendered when a number is missing is `—` (em-dash), not `--`,
because the user reads it. The same dash inside a code comment ("see note above
-- this is documented elsewhere") stays ASCII because no user ever sees it. When
in doubt, ask: who is the audience for this exact run of characters?

This is a strict, blast-radius-asymmetric rule. A bulk find/replace that
substitutes `—` with `--` across the repo is **not** a safe refactor -- it
mangles UI strings and the documentation that quotes them. Audit before running
such a sweep, and never apply it to `*.tsx`, `*.ts`, or to quoted strings inside
`stories/`.

### Self-documenting code

- Documentation comments (docstrings, API docs) are good
- Implementation comments are last resort - refactor to make code clear

### Descriptive names

- Avoid generic names like `result`, `data`, `value`, `item` - name what it IS
- No single-letter variable names anywhere - not in closures, locals,
  parameters, destructuring, or function bindings. `|r|` is unreadable; use
  `|rate|`. `const c = ...` is unreadable; use `const current = ...`. Single
  letters are only acceptable when the user has explicitly approved them for a
  specific case (e.g., conventional loop indices in tight numeric code where a
  longer name would obscure intent).
- No abbreviations unless universally understood (`id`, `url`, `http`, `msg`,
  `tx` are fine). This includes namespace import aliases: `import * as Hl` is
  wrong, use `import * as Hyperliquid`

### Colocate types

Keep types with the code that uses them, not in separate files.

### Logging

Use log levels semantically:

- **ERROR**: Something failed that requires attention (unrecoverable failures,
  unexpected exceptions)
- **WARN**: Something unexpected happened but the system recovered (retries
  exhausted, fallback used, deprecated feature accessed)
- **INFO**: High-level service lifecycle events only (service ready, graceful
  shutdown). One or two lines per service startup, not per component
- **DEBUG**: Operational details useful for troubleshooting (component
  initialized, request handled, configuration applied)
- **TRACE**: Fine-grained execution flow for deep debugging (variable values,
  loop iterations, function entry/exit)

**Message quality:**

- Log when something completes, not when it starts. "hyperliquid client ready"
  not "initializing hyperliquid client"
- Messages should be grep-friendly and unique. Avoid generic "error occurred" or
  "operation failed"
- Include relevant context as structured fields, not interpolated strings:
  `info!(port = config.port, "server ready")` not
  `info!("server ready on port
  {}", config.port)`
- Use past tense or state descriptions: "request processed", "connection
  established", "cache invalidated"

**Anti-patterns:**

- Logging both "starting X" and "X complete" at the same level - pick one
  (prefer completion)
- INFO-level logs for internal component setup (use DEBUG)
- Logging sensitive data (credentials, tokens, PII)
- Empty or near-empty messages: `debug!("here")`, `info!("")`
- Vague messages without subject: `info!("initialized")` - initialized what?
  Yes, tracing adds module prefixes, but logs should be clear at a glance
  without parsing `moneymentum::hyperliquid::client`. Say
  `debug!("hyperliquid client
  ready")` instead

### Data quality verification

When verifying ingested or processed data, follow these checks:

**Structural integrity:**

- Row counts match expectations (compare before/after for incremental loads)
- No duplicate records on primary key (e.g., timestamp + symbol)
- Schema matches expected columns and types
- No null/empty values in required fields

**Temporal validity:**

- Most recent records are current (within expected lag of real-time)
- No gaps in time series where data should be continuous
- Timestamps are in expected format and timezone

**Value reasonableness:**

- Cross-reference key values against external sources (e.g., check BTC price
  against exchange APIs, not against training data or assumptions)
- Numeric values are within plausible ranges for the domain
- No obvious outliers that suggest data corruption (e.g., prices of 0 or
  negative values where impossible)

**Referential integrity:**

- Foreign keys reference valid records
- Symbol/ticker names match expected universe

**Never assume values "look reasonable" without verification.** If you can't
verify against an external source, say "I cannot verify this value" rather than
guessing. Training data cutoffs make historical knowledge unreliable for current
market prices.

### Scripts

Any script large enough to be pulled out into its own file MUST NOT be bash. Use
nushell (`.nu`) instead. Bash is acceptable only for short inline blocks (CI
workflow `run:` steps, npm `scripts`, Makefile recipes); the moment a script
grows into a standalone file, it must be nushell. Shebang: `#!/usr/bin/env nu`.

Reasons: nushell has structured data, real error handling, typed pipelines, and
predictable quoting/word-splitting. Bash files accumulate footguns (unquoted
expansions, `set -e` corner cases, IFS surprises) that nushell avoids by
construction.

---

## Rust Code Style

### Package by feature, not by layer

Organize code by business domain, not by language primitives or technical
layers.

**FORBIDDEN file names** (Rust): `types.rs`, `error.rs`, `errors.rs`,
`models.rs`, `utils.rs`, `helpers.rs`, `impl.rs`, `traits.rs`, `structs.rs`,
`enums.rs`, `config.rs`, `constants.rs`, `common.rs`, `shared.rs`, `core.rs`

**FORBIDDEN file names** (TypeScript): `types.ts`, `interfaces.ts`, `utils.ts`,
`helpers.ts`, `constants.ts`, `common.ts`, `shared.ts`

**CORRECT**: `portfolio.rs`, `position.rs`, `rebalancer.rs` (organized by
business domain). Each feature module contains all related code: types, errors,
logic.

When a project is small, put everything in `main.rs` or `lib.rs`. Only split
into modules when there are clear domain boundaries.

### Type modeling

**Make invalid states unrepresentable.** This is non-negotiable. Every type must
constrain its values to only valid states.

**Never use String when the domain has a finite set of valid values:**

```rust
// FORBIDDEN: String accepts infinite invalid values
struct Config { log_level: String }  // "info", "debug", but also "banana", ""

// CORRECT: enum restricts to valid values only
enum LogLevel { Trace, Debug, Info, Warn, Error }
struct Config { log_level: LogLevel }
```

**Use enums to encode valid states, newtypes for domain concepts:**

```rust
// Bad: fields can contradict each other
struct Order { status: String, order_id: Option<String>, error: Option<String> }

// Good: each state has exactly the data it needs
enum OrderStatus {
    Pending,
    Completed { order_id: String },
    Failed { reason: String },
}
```

**Parse, don't validate.** If a value exists, it must be valid. Validation
happens at construction through smart constructors:

```rust
// Bad: validation can be forgotten
pub struct ApiKey(pub String);
impl ApiKey { pub fn validate(&self) -> Result<(), Error> { ... } }

// Good: if ApiKey exists, it's valid
pub struct ApiKey(String);  // Private inner
impl ApiKey {
    pub fn new(value: String) -> Result<Self, Error> { ... }  // Only way to create
}
```

**When deserializing from external sources** (config files, API requests), parse
into proper types immediately at the boundary. Never pass raw strings through
the system.

**Persistent IDs must be newtypes.** Never use raw `String` or `&str` for domain
identifiers that are persisted or passed between async boundaries:

```rust
// Bad: easy to mix up different persistent IDs
enqueue_ingestion("ingestion-123").await;
load_portfolio("ingestion-123").await;  // Oops, wrong ID type

// Good: type system prevents mixing IDs
struct IngestionRunId(String);
struct PortfolioId(String);
```

If a future framework exposes stringly-typed IDs, wrap it at the boundary and
keep raw strings out of application call sites.

### Avoid deep nesting

Keep code flat in function bodies, module structure, and test organization.

**Function bodies**: Use early returns and `let-else`:

```rust
fn validate(data: Option<&Data>) -> Result<(), Error> {
    let data = data.ok_or(Error::NoData)?;
    if data.qty <= 0 { return Err(Error::InvalidQty); }
    Ok(())
}
```

**Modules**: Don't nest modules inside modules. Keep hierarchy shallow.

**Tests**: No nested modules inside `mod tests`. Use descriptive function names:

```rust
// Bad
mod tests { mod symbol { fn normalizes() { ... } } }

// Good
mod tests { fn symbol_normalizes_hyperliquid_format() { ... } }
```

**Exception - types**: Nesting in type definitions is fine when it makes invalid
states unrepresentable. An enum with struct variants is better than flattening
into mutually exclusive optional fields.

### Error handling

- Use `?` operator and proper error types
- Never create `SomeError(String)` variants that throw away type information
- Use `#[from]` with thiserror to preserve error chains
- Don't think ahead about error variants - use `?` wherever needed, then
  `cargo check` tells you exactly which `#[from]` variants to add

**Never fabricate errors from other crates.** If you need to signal a condition,
define your own error type. Manually constructing `std::io::Error::new(...)` or
similar is data corruption - it lies about the error's origin and misleads
anyone debugging:

```rust
// FORBIDDEN: pretending std::io produced this error
Err(std::io::Error::new(ErrorKind::InvalidInput, "bad path"))

// CORRECT: define your own error variant
#[derive(Debug, Error)]
enum MyError {
    #[error("invalid path encoding")]
    InvalidPathEncoding,
}
```

**`#[from]` variant naming**: When using thiserror's `#[from]` attribute,
variant names must be generic (matching the source error type) and MUST NOT
claim what operation failed. The `?` operator auto-converts any matching error
type to the variant, so specific claims become false if another operation
produces the same error type.

- **FORBIDDEN**: `ReadConfig(#[from] std::io::Error)` - claims config reading
  failed, but any `?` on io::Error will use this variant
- **CORRECT**: `Io(#[from] std::io::Error)` - generic, makes no false claims
- **FORBIDDEN**: `ParseConfig(#[from] toml::de::Error)` - claims config parsing
- **CORRECT**: `Toml(#[from] toml::de::Error)` - generic, truthful

Rule: If `#[from]` is used, the variant name should mirror the error type, not
the operation.

### Zero tolerance for panics in non-test code

**FORBIDDEN in production code:**

- `unwrap()`, `expect()`
- `panic!()`, `unreachable!()`, `unimplemented!()`
- Index operations that can panic (`vec[i]`) - use `.get(i)` instead
- Unchecked arithmetic where overflow is possible

**ALLOWED in `#[cfg(test)]` code:** All of the above are fine in tests.

**`todo!()` macro:** Encouraged during TTDD types-first stage to stub
signatures. Must be removed before completion - any `todo!()` in final code is
unacceptable.

### Module organization

Public API first, private helpers below.

### Minimal visibility

Always use the most restrictive visibility possible:

- Private (default) over `pub(super)`
- `pub(super)` over `pub(crate)`
- `pub(crate)` over `pub`

This enables robust dead code detection by the compiler. When something is
`pub`, the compiler can't know if external code uses it, so it won't warn about
unused items. Restrictive visibility makes the relevance scope explicit and lets
tooling catch unused code.

### Import organization

Two groups only:

1. External imports (`std`, `tokio`, `serde`, etc.)
2. Internal imports (`crate::`, `super::`)

Blank line between groups. No function-level imports.

**No import aliases for name conflicts.** When two types have the same name, use
qualified paths instead of `as` aliases. Aliases require jumping around to
figure out what's what:

```rust
// Bad: reader must find the alias to understand the code
use crate::ingestion::Timeframe as IngestionTimeframe;

// Good: meaning is clear at the usage site
impl From<Timeframe> for crate::ingestion::Timeframe { ... }
```

**Tracing macros are unqualified.** We use tracing and nothing else for logging,
so `tracing::error!` qualification adds no disambiguation value - it's just
verbose bloat:

```rust
// Bad: verbose, no added clarity
tracing::error!(error = %err, "failed");

// Good
use tracing::error;
error!(error = %err, "failed");
```

### Spacing

Leave empty lines between code blocks for readability and vim navigation.

---

## Testing

### Testing pyramid

Follow the pyramid - more tests at lower levels, fewer at higher:

1. **Property tests** - Most numerous. Use proptest for invariant testing
2. **Unit tests** - Exhaustive edge cases, fast feedback
3. **Integration tests** - Components working together, mocked externals
4. **E2E tests** - Fewest, but essential for full system orchestration

The pyramid is about quantity, not avoidance. You should have MANY property/unit
tests, SOME integration tests, and a FEW e2e tests. But e2e tests are still
required when testing full system orchestration.

**When e2e tests ARE required:**

- Testing that multiple async processes coordinate correctly
- Testing startup/shutdown behavior and recovery
- Testing flows that span multiple components AND external systems
- Testing that the service handles events that occurred before it started

A single well-designed e2e test can cover orchestration, while dozens of unit
tests cover edge cases in each component.

### E2E tests: strict definition

E2E tests live in `./tests/`, not in `src/`.

A test is ONLY e2e if it:

1. Spins up the full HTTP service
2. Uses ONLY the public API as an external consumer would
3. Mocks only truly external systems
4. Asserts correctness via API responses

A test is NOT e2e if it touches implementation details for setup or
verification. If a test requires internal types, it belongs in `src/` as a unit
or integration test.

### Testing guidelines

- Tests must assert CORRECT behavior, never "document gaps"
- Add context to failing `assert!` macros instead of `println!` debugging
- Never test language features - test business logic
- Only cover happy paths in integration/e2e tests; cover edge cases in unit
  tests

**Hands-off: `src/factors/fixture_tests.rs`.** Do not edit this file unless the
user gives a direct, explicit instruction to do so. These tests pin expected
factor values calculated by hand in Google Sheets; they are the source of truth
for factor semantics. When a fixture test fails, fix the production code (or
update `data_test/` only when the user supplies corrected spreadsheet values) --
never relax tolerances, rewrite assertions, or delete cases to make broken code
pass.

**Bug reproduction must exercise real code paths.** When reproducing a bug:

```rust
// BAD: Manually constructs incompatible DataFrames - proves nothing
let existing = df! { "a" => [1], "b" => [2], "extra" => [3] }.unwrap();
let new = df! { "a" => [1], "b" => [2] }.unwrap();
merge_and_deduplicate(Some(existing), new); // Obviously fails

// GOOD: Uses actual code paths with realistic fixtures
let existing = read_csv(fixture_path("legacy_ohlcv.csv")).await?; // 8 columns
let candles = vec![Candle { ... }]; // Real domain objects
let new = candles_to_dataframe(candles).await?; // 7 columns from real code
merge_and_deduplicate(existing, new); // Proves the actual bug
```

The first test shows that incompatible things are incompatible. The second
proves the system produces incompatible things - that's the bug.

```rust
// Bad: tests struct assignment, not our code
fn test_fields() {
    let request = Request { qty: 100, symbol: "AAPL".into() };
    assert_eq!(request.qty, 100);
}

// Good: tests our validation logic
fn test_validates_quantity() {
    let result = validate_order(OrderRequest { qty: -10, symbol: "AAPL".into() });
    assert!(matches!(result, Err(OrderError::InvalidQuantity)));
}
```

---

## shadcn-solid

Never manually create component files. Use the CLI:

```bash
cd frontend && bunx shadcn-solid@latest add <component-name>
```

### Avoid createEffect

Before adding `createEffect`, consider: `@tanstack/solid-query` for data
fetching, `createMemo` for derived state. When `createEffect` IS required
(imperative DOM manipulation, side-effects on signal changes, global event
listeners), add an inline comment explaining why.
