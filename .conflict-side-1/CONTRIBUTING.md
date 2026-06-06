# Contributing

This project follows Extreme Programming (XP), adapted for a world where the
primary pairing model is human-AI and AI-AI rather than human-human. The
practices are the same; the medium is different.

---

## Philosophy

XP's core insight is that the highest-risk assumptions in software are about
what to build and whether it works — not how to build it. The practices exist to
surface those assumptions as early and cheaply as possible: small releases,
test-first development, short planning cycles, collective ownership, continuous
integration.

The AI age does not change any of that. What it changes is communication. In
classic XP, much coordination happens through conversation — pair programming,
stand-ups, the customer on-site. When your collaborators are AI agents, that
ambient, verbal coordination disappears. Everything must be written down with
enough precision that an agent with no prior context can act on it correctly.
This means stories, acceptance criteria, and context fields are not
documentation you write after the fact — they are the medium of collaboration.

---

## Roles

**Human owner** (Gleb): Writes stories. Prioritizes the backlog. Accepts or
rejects completed stories. Reviews and merges PRs. The customer in XP's planning
game. Makes architectural decisions and resolves ambiguity when agents surface
it. Does not write implementation code day-to-day — that is what the agents are
for.

**AI coding agent** (e.g., Claude, Cursor): Implements stories. Writes and runs
tests. Follows the TTDD workflow. Respects story scope — does not touch code
outside the story boundary. Surfaces blockers rather than guessing. Marks work
done only when all acceptance criteria pass and all quality gates are green.

**AI orchestrator** (AI-AI pairing): In AI-AI sessions, one agent takes the
navigator role — breaking a story into tasks, reviewing the implementor's
output, catching scope drift. The other agent implements. Neither agent merges
to main; human review is still required at the PR stage.

---

## The Planning Game

The planning game runs in short cycles. At the start of each cycle:

1. The human reviews the backlog in `docs/user-stories/` and selects which
   stories to pull into the current iteration. Priority is set by business
   value, not technical convenience.
2. Stories selected for the iteration are marked `status: in progress`.
3. Each story goes to one agent session (or one AI-AI pair). An agent must not
   hold multiple stories in parallel without explicit instruction.

Stories in the backlog are options, not a schedule. Ordering within a theme file
does not imply implementation order. The human decides what comes next.

---

## Pairing Models

### Human-AI

The human plays the navigator: sets direction, provides the story, reviews
output, accepts or rejects. The agent plays the driver: implements, tests,
raises blockers. The human should be available during the session to answer
questions the agent surfaces — this is the XP equivalent of the on-site
customer.

Practical rules:

- Start each session by giving the agent the story ID and content.
- The agent reads the story, states its interpretation of the acceptance
  criteria, and asks any clarifying questions before writing code.
- The human answers, then the agent proceeds.
- The agent reports progress and blockers inline during the session.

### AI-AI

The orchestrator agent receives the story and owns decomposition and review. The
implementor agent receives individual tasks and owns code. The orchestrator
reviews each task's output against the acceptance criteria before declaring the
story done. A human reviews the final PR.

This model is suited to larger stories where task decomposition benefits from an
agent that holds the full story in context while the implementor works narrowly.

---

## The Story Contract

A story is the unit of work. Agents do not write code outside of a story.
Stories live in `docs/user-stories/` — read `docs/user-stories/README.md` for
format and conventions.

**Entering a story**: Before writing any code, the agent reads the full story
including context. If anything in the acceptance criteria or context is
ambiguous, the agent asks the human to resolve it — in the session, not in a
comment buried in a PR.

**Scope**: The story defines the boundary. If implementation reveals that
adjacent code needs to change to make the story work correctly, the agent notes
it and asks whether to extend the story or create a new one. It does not
silently expand scope.

**Done**: A story is done when every acceptance criterion passes and every
quality gate is green. Not before. Marking a story done with failing tests or
suppressed lints is a contract violation.

---

## TTDD Workflow

See `AGENTS.md` for the full TTDD (Type-driven TDD) sequence. Short version:

1. Types and signatures first — model the domain before writing logic.
2. Failing tests second — tests that compile and fail, not build errors.
3. Implementation third — make the tests pass.

Agents run `cargo check` continuously during steps 1 and 2. Quality gates
(`cargo test`, `cargo clippy`, `cargo fmt`, `bun run typecheck`, `bun run lint`)
run at the end before the PR.

---

## Quality Gates

These are non-negotiable. No story is done until all gates are green. Agents do
not suppress warnings, disable lints, or comment out tests to make gates pass.
If a gate failure reveals a genuine false positive or a lint that conflicts with
project policy, the agent surfaces it to the human and waits for explicit
permission before suppressing anything.

| Gate          | Command                         | Scope    |
| ------------- | ------------------------------- | -------- |
| Type check    | `cargo check`                   | Rust     |
| Tests         | `cargo test -q`                 | Rust     |
| Lints         | `cargo clippy`                  | Rust     |
| Formatting    | `cargo fmt`                     | Rust     |
| TS type check | `bun run typecheck` (frontend/) | Frontend |
| TS lints      | `bun run lint` (frontend/)      | Frontend |
| TS tests      | `bun run test` (frontend/)      | Frontend |

---

## Pull Requests

- One story per PR. If a story required prerequisite refactoring, that
  refactoring is a separate PR that lands first.
- The PR title is the story title. The PR description explains WHY the story
  exists — what problem it solves — not what changed. Changes are visible in the
  diff.
- Include the story ID (e.g., `PB-01`) in the PR description.
- Do not add "Generated by [Tool]" anywhere. Authorship is implicit in the
  commit history.
- PRs are reviewed by the human. AI-AI review within a session is fine but does
  not replace human review before merge.

---

## Agent Boundaries

What agents own:

- Code and test changes inside this repo.
- Raising questions and blockers to the human.
- Running quality gates and reporting results.
- Proposing refactors within the scope of the current story.

What humans own:

- Prioritization and story selection.
- Accepting or rejecting completed stories.
- Architectural decisions that span multiple stories.
- Production deploys, secrets management, and external system configuration.
- Any action that is irreversible or affects systems outside this repo.

When an agent hits the boundary of its ownership — a decision it cannot make
from the story and context alone — it stops and asks. Guessing is not acceptable
when the cost of being wrong is real.
