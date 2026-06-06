# User Stories

## What Is a User Story?

A user story is a short, customer-written description of a capability the system
should have, expressed from the perspective of someone who will use it. It is
not a specification. It is not a task list. It is a promise of a conversation —
a shared understanding between the person who wants the capability and the
person (or agent) who will build it.

The canonical form comes from XP:

> **As a** [role], **I want** [capability], **so that** [benefit].

The "so that" is the most important part. It explains why the capability has
value. Without it, implementors optimize for the literal request rather than the
underlying need, and miss the point.

Stories are written by the human owner. Technical tasks within a story are
written by developers or agents. The distinction matters: stories describe what
and why. Tasks describe how.

---

## Themes

Stories are grouped into themes — informal labels for related areas of work. A
theme is not a process artifact. It has no status, owner, or lifecycle. It
exists to make the backlog navigable and to group stories that share
architectural context.

Current themes:

| File                | Theme          | Prefix |
| ------------------- | -------------- | ------ |
| `portfolio-beta.md` | Portfolio Beta | PB     |
| `risk-analytics.md` | Risk Analytics | RA     |
| `screener.md`       | Screener       | SC     |
| `spot-trading.md`   | Spot Trading   | ST     |

Story ordering within a theme file does not imply implementation order. The
human selects which stories enter the current iteration during the planning
game.

---

## Story Format

Each story follows this structure:

```
## US-XX: Title

**As a** [role]
**I want** [capability]
**So that** [benefit]

### Acceptance criteria

- [ ] Concrete, observable, testable condition.
- [ ] Another condition. Each criterion must be independently verifiable.

### Context

Everything an agent needs to implement this story without asking basic
questions. Relevant files, API contracts, architectural decisions, constraints,
and prior art. Do not summarize what the story says — add information the
story does not contain.

### Tasks

Technical breakdown, written by a developer or agent after reading the story.
These are HOW, not WHAT. They should be small enough that each can be verified
independently.

- [ ] Task description.

### Status

`backlog` | `in progress` | `done`
```

---

## Field Guide

**ID** (`US-XX`): Theme prefix plus two-digit number. Assigned sequentially
within a theme. Used to reference stories in PR descriptions, commit messages,
and Linear issues. Never reuse an ID, even if a story is removed.

**Acceptance criteria**: Written before implementation begins. Each criterion
describes an observable outcome, not an implementation detail. "The rebalancer
displays portfolio beta" is a good criterion. "Beta is fetched in a useEffect"
is a task. If a criterion cannot be verified by looking at the running system or
reading a test result, rewrite it.

**Context**: The most important field for AI-human collaboration. Human
developers accumulate context over time through code review, conversation, and
proximity. Agents do not. Context makes institutional knowledge explicit so an
agent starting a fresh session can act correctly without asking questions the
story should answer.

Context should include:

- Relevant source files (paths relative to repo root)
- Existing API contracts the story depends on (request/response shape)
- Architectural decisions that constrain the implementation
- Known edge cases or gotchas
- What has already been tried if this story is a retry

**Tasks**: Optional at story creation. An agent may write tasks as its first
step when implementing a story — decomposing the work before writing code. Tasks
are implementation-level and may change during implementation. Acceptance
criteria may not change without the human owner's approval.

**Status**: Updated as work progresses.

- `backlog` — written, not yet selected for an iteration.
- `in progress` — selected for the current iteration, actively being
  implemented.
- `done` — all acceptance criteria verified, PR merged.

---

## How Agents Should Use Stories

1. Read the full story before writing any code, including the context section.
2. State your interpretation of the acceptance criteria at the start of the
   session. Ask the human to correct any misunderstanding before proceeding.
3. Write tasks as your first output if the story does not already have them. Get
   human confirmation before implementing.
4. Do not touch code outside the story's scope. If you discover that adjacent
   code needs to change, surface it and ask.
5. When all acceptance criteria pass and all quality gates are green, update the
   story status to `done` and open a PR referencing the story ID.
6. If you are blocked — ambiguity in the story, a technical constraint not
   mentioned in context, a quality gate failure you cannot resolve — stop and
   surface the blocker. Do not guess.

---

## Writing Good Stories

Good acceptance criteria are:

- **Observable**: verifiable by looking at the running system or a test result.
- **Atomic**: each criterion tests one thing.
- **Complete**: together, they fully define when the story is done.

Good context anticipates what an agent will need. After writing a story, ask: if
an agent with no knowledge of this codebase reads only this story and
`AGENTS.md`, can it implement the story correctly? If not, what's missing?

Stories should be small enough to complete in one iteration (one to two weeks).
If a story is too large, split it. Prefer more smaller stories over fewer large
ones — small stories deliver value earlier and surface integration problems
sooner.
