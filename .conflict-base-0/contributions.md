# Contributions

Moneymentum uses AI-era extreme programming: small stories, tests first, tight
feedback, and frequent review by humans and agents.

Audience: contributors (human and AI). See [AGENTS.md](./AGENTS.md) for
code-style and testing policies, and [SPEC.md](./SPEC.md) for the architectural
vision.

## Rules

- Start every change from a user story in [Stories](./stories/README.md). A
  story is scoped to the value it delivers, not to a single PR; large stories
  decompose into PR-sized GitHub issues tracked as sub-issues of the story's
  parent issue.
- Keep each **issue** pull-request sized. One issue, one PR.
- Make acceptance criteria verifiable before merge; do not require a follow-up
  PR just to mark the story done.
- Write the failing test before changing behavior. Docs-only, metadata-only, and
  exploratory spike changes may skip the failing test, but the PR description
  must say so and flag any potential footguns the change introduces.
- Pair while implementing: human and AI, AI and AI, or human driver with AI
  reviewer.
- Review before handoff. Reviews should find bugs, missing tests, and unclear
  product behavior.
- Refactor only when it supports the story being delivered.

### Exception: standalone refactors, migrations, and infrastructure work

"Start every change from a user story" and "Refactor only when it supports the
story being delivered" both assume there is a user-facing story driving the
work. Some legitimate changes do not have one: framework migrations, internal
refactors, build/CI/infra cleanup. The sanctioned path for these is a **dev
story** -- a story that lives in [stories/](./stories/README.md) alongside user
stories (the file index is shared and hex-numbered), listed under the "Dev"
sub-heading in the index. A dev story plays the same role for foundational work
that a user story plays for user-facing features: a written contract with
acceptance criteria.

A PR submitted under this exception must:

- Reference its dev story (or the GitHub issue, if the change is small enough
  that a story is overkill) in the PR description.
- Include a short charter: **purpose** (why now), **risk** (what could break),
  and **rollback / migration plan** (how we undo it or move data forward).
- Be covered by CI and tests, or state explicitly in the PR description why
  tests are infeasible (e.g. a build-system change with no behavioral surface).
- Carry a `refactor` or `migration` label so reviewers know which expectations
  apply.

## Story Format

```markdown
---
status: completed | planned
---

# Short Story Name

As a user, I want to ...

## Acceptance Criteria

- [x] Completed or planned behavior
```

Use `As a portfolio manager...`, `As a reviewer...`, or another specific role
when "user" is too vague.

## Done Means

A story is done when a reviewer can audit each item below from the PR alone:

- **Acceptance criteria are satisfied**, with a checked-off list in the PR
  description (or a link to the story file showing all boxes ticked) and a
  pointer to the PR that satisfied each criterion if more than one PR was
  needed.
- **Tests cover the behavior** where practical. The PR description names the
  test files or test IDs that exercise the behavior (e.g.
  `tests/rebalance_e2e.rs::rebalances_long_short_within_tolerance`,
  `frontend/src/components/__tests__/Screener.test.tsx`).
- **A validation note** describes how a reviewer can verify the acceptance
  criteria beyond running the test suite -- either manual steps (with concrete
  inputs and expected outputs) or the name of the CI job that gates the change
  (e.g. `ci / e2e-hyperliquid-testnet`).
- **Errors and disabled states are visible** in the change.
- **The diff contains only story-related changes.**
- **Relevant checks pass.**

Example footer for a PR description:

```markdown
### Done Means

- Acceptance criteria: all boxes ticked in
  stories/0x00b.show-bitcoin-beta-for-active-portfolio.md
- Tests: src/beta_handler.rs::beta_handler_returns_active_weighted_beta,
  frontend/src/**tests**/BetaCard.test.tsx
- Validation: run `cd frontend && bun run dev`, connect testnet wallet with a
  50/50 BTC/ETH portfolio, beta card should read ~0.95
- CI: ci / backend-tests, ci / frontend-tests
```

## Intake

When new behavior is described, write the story first, then decompose it into
PR-sized issues. If the product decision is unclear, stop and ask before coding.
