---
name: pr-tracking
description: "Make a stack of PRs fully tracked: every branch has a PR, every PR Closes a problem-only GitHub issue, every issue is a ticked roadmap item, all cross-linked. Use for: make sure each PR has an issue, track the stack, link issues to PRs, add these PRs to the roadmap."
---

# PR Tracking Skill

The executable procedure for the `AGENTS.md` rule "Every PR is tracked by an
issue and the roadmap". Use `gh` for GitHub and the
[gitbutler](../gitbutler/SKILL.md) skill (`but`) for branch/PR/push operations.

For every branch in the stack, make all of this true:

1. A PR exists (open a **draft** if not: `but pr new --draft`; never
   `gh pr create`, which bypasses GitButler's stack metadata, and never create
   non-draft and flip afterwards -- the initial non-draft ping to reviewers
   cannot be retracted; `but pr set-draft` is only remediation for a PR that
   already exists non-draft). Its base is its downstack parent, or the stack's
   integration branch (`main`/`master`) for the bottom PR.
2. An issue describes the **problem** it solves (`gh issue create`) -- problem
   only, no proposed solution, one per PR.
3. The PR body explains **why** and ends with `Closes #<issue>`
   (`gh pr edit <pr> --body-file <file>`; write the body with Write, never a
   heredoc). GitHub only honors closing keywords on the PR that merges into the
   default branch, so a stacked child PR's `Closes` line is informational --
   when a child PR's commits reach the default branch without auto-closing its
   issue, close the issue explicitly (`gh issue close <issue>`).
4. The PR is assigned to the author (`gh pr edit <pr> --add-assignee @me` --
   `gh`/`but` do not auto-assign).
5. The issue is a checklist item in the right `ROADMAP.md` section, with real
   markdown links to the issue and PR:
   `- [ ] <desc> -- [#<issue>](url) / [#<pr>](url)`. Tick `- [x]` once the work
   is done. Do not group unrelated work into one section; bare `#123` is not a
   link.

The roadmap entry and its tick land on the feature PR itself (step 5), so the
roadmap always matches what merged; only standalone policy or process-doc
changes get their own PR. Re-run whenever the stack changes (new branch, rebased
scope, merge); keep links and ticks current. Never post issue/PR comments or
flip PR state without an explicit instruction.
