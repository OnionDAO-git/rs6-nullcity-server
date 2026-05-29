# Multi-Agent Coordination Protocol

**Audience:** Any agent (Claude, Codex, future) or human working in this repo or the residents-dashboard repo.
**Date:** 2026-05-21.
**Status:** Draft; revise as the team learns what actually prevents collisions.

**Current rule:** if this file conflicts with `AGENTS.md`, `docs/README.md`, or `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md`, the newer docs win for current weekend packet work.

**New here?** Start with `AGENTS.md`, `docs/README.md`, `docs/agent-status.md`, `docs/issue-register.md`, and the Workstream S implementation plan. Then use this file for coordination rules and historical context.

## Why This Exists

Three agents are active across two repos:

- **Claude (Anthropic)** operated by the maintainer in `rs6-nullcity-server`.
- **Codex (OpenAI)** operated by the maintainer in `rs6-nullcity-server`.
- **Dev's agent** working in `rs6-nullcity-residents-dashboard`.

We do not have a shared message bus, real-time presence, or a job queue. Coordination must therefore be:

- **Async** — agents commit and read; they do not negotiate live.
- **Repository-grounded** — the source of truth is files in git, not chat.
- **Cheap to follow** — overhead must be smaller than the cost of a merge conflict.

## Source Of Truth

The canonical "what is happening right now" is the union of:

1. `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — workstream board with `[ ] [>] [~] [x] [!]` task markers. Workstream S is the active weekend sprint.
2. `git status` on the active branch.
3. `docs/agent-status.md` — short append-only log of who-is-doing-what (see below).
4. `docs/issue-register.md` — discovered QA findings, weak evidence, and blockers.
5. `docs/release-qa-status.md` — QA Marshal release/readiness gate.

If these disagree, the roadmap wins for planned intent, `git status` wins for in-flight file reality, and `docs/issue-register.md` wins for known blockers.

## Historical Workstream Ownership (2026-05-21 Snapshot)

This table is historical. Routine server work now targets `agents/wip` (see Rule 3), and Workstream S plus CQA packets are the active weekend claim units.

| Workstream | Owner | Status |
|---|---|---|
| A: SPARK Capability Facades | done; no current owner | `[x]` |
| B: Standard RuneScape Module Extraction | unassigned | `[ ]` |
| C: Benchmark Harness — `combat-prayer-10m` | Codex | `[>]` |
| D: Dashboard Debugging | Dev (separate repo) | `[>]` |
| E: Knowledge & Agent Skill | done | `[x]` |
| F: Human-Like Behavior | unassigned | `[~]` partial |
| G: Real Gameplay Workflows | unassigned | `[ ]` |
| H: Railgun & Operations | unassigned | `[~]` partial |
| **I: Evidence Layer & Library of Souls** | merged | `[x]` mostly done — see roadmap |
| **J: Patron / Human-Attention Loop** | unassigned | `[ ]` spec exists, see `specs/2026-05-22-patron-loop-design.md` |
| **K: Factions Adapted For Runescape** | unassigned | `[!]` spec exists, blocked on maintainer creative input |
| **L: Cross-Resident Memory & Lore** | unassigned | `[ ]` no spec yet — deferred |
| **M: Hero Residents & Story Arcs** | unassigned | `[ ]` spec exists, see `specs/2026-05-22-hero-residents-design.md` |
| **N: Physical Event & Embassy** | unassigned | `[ ]` spec exists, see `specs/2026-05-22-embassy-and-event-design.md` |
| **O: Engineering & Tooling Polish** | unassigned | `[ ]` no spec needed — independently scoped tasks |

This table is preserved only to explain older status-log entries. Current workstreams, including Workstream S, live in the roadmap file.

## Conflict Avoidance Rules

### Rule 1 — Check before opening

Before editing a file, every agent does:

```bash
git status --short
git log -n 10 --oneline
```

If a file appears as `M` or `??` in `git status --short`, another worker has it open. Do not touch.

### Rule 2 — Update the marker before the code

Before editing a file owned by a roadmap task, set the task marker to `[>]` in the roadmap. Other agents read the roadmap before starting work; the marker is the lock.

After the work is done and verified, set the marker to `[x]` or `[!]` as appropriate.

Exception: while Codex has the roadmap dirty, other agents propose roadmap changes via a delta file (e.g., `docs/superpowers/specs/2026-05-21-roadmap-delta-evidence-loop.md`) instead of editing the roadmap directly.

### Rule 3 — Shared agent branch, curated milestones to default

**Revised 2026-05-23** after the default-branch history (`nullcity`) grew too noisy for Dev to read — ~3 commits per slice (STARTING / work / HANDOFF) plus correction commits and format-only commits.

The workflow now has two layers:

**Layer 1 — `agents/wip` (shared agent branch):** all claude / codex / antigravity in-progress work goes here. Push freely. Small commits, STARTING/HANDOFF lines, status-log appends, format fixes, correction lines — all fine on this branch. This is where coordination happens.

**Layer 2 — `nullcity` (default branch):** Dev reads this. Only curated milestones land here, via **squash-merge from `agents/wip` → `nullcity`** with one descriptive commit subject and a detailed body. Per-slice breakdown lives in the commit body. The default branch should read as a milestone log, not an in-progress sync channel.

Implications:

- Daily work: commit to `agents/wip` and push. Pull `agents/wip` before pushing to avoid non-fast-forwards.
- On milestone completion (workstream slice done + tests + lint + typecheck green), squash-merge `agents/wip` → `nullcity` with a curated commit. Cadence: workstream completion, every ~24h, or on maintainer ask.
- `docs/agent-status.md` lives on `agents/wip` and **does not get merged to `nullcity`**. It's a coordination artifact, not a deliverable.
- Per-agent topic branches (`claude/<foo>`, `codex/<foo>`) are still discouraged — they fragment history. Bigger experimental work uses a branch off `agents/wip` and merges back there.
- File-level collision avoidance still primary. Read `git status` + the status log on `agents/wip` before editing.
- The dashboard repo (`rs6-nullcity-residents-dashboard`) has its own conventions — follow Dev's existing pattern there.
- Single-commit critical fixes that Dev needs to see immediately (security patch, hotfix) can still go direct to `nullcity` — judgment call. Default to `agents/wip`.

The pre-existing noisy history on `nullcity` stays as-is; rewriting shared history is dangerous. The new convention applies forward.

**Merge owner + cadence floor (added 2026-05-23 PM after audit found `agents/wip` was 112 commits ahead of `nullcity` with zero squash-merges since the cutover):**

- **Merge owner.** The agent that posts the final HANDOFF on the most recent full workstream slice MUST also perform the squash-merge to `nullcity` within the same cycle. Stage from `agents/wip@<that-completion-sha>` (not `HEAD`) so in-flight WIP from other agents is not pulled in early.
- **Cadence floor.** If 48h pass since the last squash-merge AND `agents/wip` is >20 commits ahead of `nullcity`, the next cron-fired agent (regardless of workstream) is REQUIRED to spend that cycle doing a squash-merge instead of new work. The commit subject names the rolled-up slices (e.g. "Squash: J-α-3..J-ε + RB-MCP α..ε + N-α..α-3 + L-α..β + M-α..α-2 + K-α"); the body lists per-slice SHAs from `agents/wip`.
- **Counter-trip.** A merge that itself counts toward the cadence: after the squash-merge, the agent appends a STARTING+HANDOFF pair to `agent-status.md` recording the SHA range merged and the resulting `nullcity` tip.

### Rule 4 — Cross-repo seams are contracts

The dashboard repo reads from the server repo via:
- HTTP/WS gateway protocol (`message-codecs.ts`)
- File-system artifacts written by the server (e.g., benchmark artifacts, future `library/<resident>/portrait.json`)
- Read-only memory dir contents

These are versioned contracts. If the schema changes, the changing side updates the schema doc and bumps a version field; the consuming side reads the version before parsing.

For Workstream I, the relevant contracts are:

- `portrait.json` shape (read by dashboard's resident page)
- `timeline.jsonl` line schema (read by dashboard's resident detail page)
- `reward.json` shape (read by dashboard benchmark detail page)

Each is documented in the spec at `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md`. Bump the `schemaVersion` field in writes; readers honor it.

### Rule 5 — Sync log

`docs/agent-status.md` is an append-only short log. Add a line when you start meaningful work and when you finish. Format:

```
2026-05-21 18:14 claude  workstream=I  starting P1 ProgressTracker + EvidenceStore (on nullcity)
2026-05-21 22:02 claude  workstream=I  P1 pushed to nullcity at <sha>; tests green
```

One line, plain text, no editorializing. Other agents read the tail before starting work.

**Brevity convention (revised 2026-05-23 PM after audit found 148/217 entries — 68% — over the soft 250-char target, longest at 2486 chars):** STARTING and HANDOFF lines are HARD-capped at **280 characters** (one tweet). The cap is enforced by the agent: if your draft is longer, cut it. Required fields only: timestamp, agent, branch, workstream, STARTING|HANDOFF, one-sentence summary, commit SHA (HANDOFF only), test count (HANDOFF only), collision note. Multi-slice rollups, slice-by-slice arcs, line-count deltas, before/after comparisons, "next-slice recommendations" — these belong in the **commit body** OR a separate `docs/slice-notes-YYYY-MM-DD.md` file, NEVER in the status log. Self-check before appending: count chars. If over 280, delete the longest sentence and ship. The log is a coordination signal, not a release-notes channel.

**STARTING lines must enumerate touched files explicitly (added 2026-05-23 PM after audit found vague `Files: thinking/runtime/roadmap` STARTING lines that other agents could not pattern-match against):** every STARTING MUST include a `Files:` segment listing each touched file by repo-relative path (no directory shorthand). The set of "STARTING without matching HANDOFF" lines is the live file-lock table. Before editing, every agent greps the last 100 lines of `agent-status.md` for an unhandled STARTING that names any file in its candidate file set; if there's a match, the agent either waits, picks a different slice, or posts a brief "BLOCKED-ON: <other-STARTING-timestamp>" line and yields. The roadmap marker is *intent*; the status log STARTING is the *lock*. Use both.

Good HANDOFF (≈220 chars):
```
2026-05-23 02:00 claude  branch=nullcity  workstream=P  HANDOFF — added 2 economy entries (coin-handling + early-gp-sources). Commit 14a00dda. typecheck/lint PASS; Jest 120/120 + 1008/1008. Collision: none.
```

Bad HANDOFF (don't): 1500-char rollup of the multi-cycle arc + per-entry summaries + impact paragraph. Put that in the commit message body.

### Rule 5b — Issue register and QA Marshal

`docs/issue-register.md` tracks discovered problems. Use it when a benchmark fails, a capability claim lacks evidence, a doc contradiction could mislead another agent, or a fix crosses packet/file ownership.

`docs/release-qa-status.md` is the QA Marshal gate for `agents/wip` -> `nullcity`. Do not claim broad release readiness while open `P0` issues remain.

Direct fix is fine when the bug is inside your claimed packet, can be proven in the same cycle, and no other STARTING line owns the files. Otherwise add or update an issue row.

### Rule 6 — No silent refactors of shared files

If a refactor of a shared file is unavoidable, post intent to `docs/agent-status.md` first, wait for the other agent's next status line that doesn't conflict, then proceed.

Shared files (high-collision risk, agree before touching):
- `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`
- `src/controller/spark/spark.ts`
- `src/controller/resident-runtime.ts`
- `src/controller/actions/action-coordinator.ts`
- `src/server/agent/gateway.ts`

These are not exclusive — they are flagged for explicit coordination, not for locking.

### Rule 7 — Tests are the receiver

Tests are the only reliable handoff. Before claiming a task done, every agent runs:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
```

And records the result in the roadmap task note. Another agent can re-run those locally and trust the green.

### Rule 8 — Recurring strategic review (every ~30 cycles or ~24h)

**Established 2026-05-23** after the runtime-knowledge expansion drifted into saturation (12 cycles of diminishing-returns +entries before the pattern was caught) and the L-deferred / I-overstated drift in `docs/null-city-rs6-vision.md` went unnoticed for days.

Whenever the next agent fires and notices:
- It has been ~24h since the last `docs/strategic-review-YYYY-MM-DD.md`, OR
- Roughly 30 status-log STARTING lines have accumulated since the last review, OR
- The maintainer asks ("are we doing the right things?")

…the agent runs a strategic review slice:

1. Dispatch parallel audit subagents (RuneBench coverage + Null City coverage + any other large source-of-truth doc set).
2. Synthesize a pillar scorecard (the three OnionDAO pillars: autonomous agents / human guidance / emotional connection). Note which pillar is underweight.
3. Surface drift: where spec, code, vision, and roadmap disagree.
4. Decide refinements: process, designs, coordination conventions.
5. Write a dated `docs/strategic-review-YYYY-MM-DD.md`.
6. Add TaskCreate entries for the highest-leverage gaps.
7. Fix immediately-correctable drift in the same slice (e.g., stale vision lines).

The pattern is preventive, not punitive. The 30-cycle / 24h cadence is a default — the maintainer's "we are doing the right things?" prompt always wins.

The first instance is `docs/strategic-review-2026-05-23.md`. The second is `docs/strategic-review-2026-05-23-pm.md`.

### Rule 9 — Roadmap is the only shared task tracker (added 2026-05-23 PM)

After a reconciliation cycle found 7 tasks marked `[pending]` in claude's CLI task list that were actually `[completed]` in code (J-α-3, J-α-4, J-β, I-β, I-β-2, RB-MCP-γ, RB-MCP-ε — shipped by codex/antigravity without updating the roadmap):

The maintainer-facing source of truth for task state is **the roadmap markdown file** (`docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`), not any agent's CLI task list. After a HANDOFF that completes a roadmap-tagged slice, the same commit (or the immediately following one) MUST flip the roadmap marker from `[>]` → `[x]` (or `[!]` if blocked). Agents that don't maintain a CLI task list (codex, antigravity) only need to update the roadmap. Agents that do (claude) reconcile their CLI list FROM the roadmap at the start of each cycle, not the other way around. The CLI task list is a private scratchpad; treat it as derived state.

### Rule 10 — No untracked WIP across cycles + never `git add -A` (added 2026-05-23 PM)

After incident `23cf468d` (claude's R-δ slice 2, 2026-05-22 night) where `git add -A` swept codex's untracked `context-derivation.{ts,test.ts}` into an unrelated commit, and after repeated stash-pull-pop friction caused by other agents leaving WIP in the shared tree:

At the end of every cycle, the working tree on `agents/wip` MUST be clean — `git status --short` returns nothing. Acceptable dispositions for in-progress work between cycles:

1. **Commit to `agents/wip`** with a `WIP:` subject prefix (cheap; squash later if you want).
2. **Stash with a named message**: `git stash push -m "<agent>:<topic>"`.
3. **Move to a personal worktree branch** (`<agent>/<topic>`) and switch back.

When staging, agents use **explicit file paths** in `git add`, never `git add -A` or `git add .` — this prevents sweeping in another agent's stashed-but-not-committed work. If you genuinely want to stage everything, list the paths from `git status --short`.

### Rule 11 — Surface decisions you can't make alone (added 2026-05-24)

After the maintainer asked: "you guys are doing lots of work and are keeping lots of documentation but we need a process to surface important information for the OnionDAO team."

The authoritative log is **`docs/human-decisions.md`** (preexisting since 2026-05-20; rebooted with 12 new entries on 2026-05-24). Every AI coder (claude / codex / antigravity) appends to that table whenever:

1. **You hit a question the human team should answer** — calibration values, naming, contract change, UX policy, deployment posture. Status `Open` and Priority per the rules at the top of `human-decisions.md` (`Critical` / `High` / `Normal` / `Low`).
2. **You make a unilateral default that should be auditable later** — e.g., "I picked 14000 for hero starting attention because 6000 was killing them overnight." Add the row with Status `Decided` and the rationale + override-friendliness in the Default column. Cite the commit SHA so the trail is auditable.

Conventions (from the file's own "How To Add A Decision" section):

- Pick the next `HD-###` integer.
- Keep the table row concise. Move long rationale into the cited doc/commit, not into this table.
- Append-only. Do not rewrite prior rows. If a decision needs revision, add a new row and reference the old by id in the question column.
- When a decision becomes `Critical`, also mark the related roadmap task `[!]` with the blocker.

**Why this matters.** Status logs, briefs, and commit messages bury maintainer-facing questions in chronology. The team needs ONE surface they can scan at the start of a design-review session to find "what needs us" without trawling 200+ commits and 8 markdown docs. `human-decisions.md` is that surface.

**Cross-references.** Strategic reviews + briefs (`docs/weekend-brief-*.md`, `docs/strategic-review-*.md`, `docs/live-verification-*.md`, `docs/next-week-handoff-*.md`) may summarize open decisions for narrative context, but the authoritative single-row-per-question log lives in `docs/human-decisions.md`. When summarizing, cite the `HD-###` ids.

**On accidental duplication (2026-05-24 CORRECTION):** claude initially created `docs/maintainer-decisions.md` with the same intent before noticing `human-decisions.md` already existed. The new file was deleted; the 12 entries migrated into `human-decisions.md` as `HD-007` through `HD-018`. Same lesson encoded here: search before you scaffold.

## Historical: Specific Coordination For Workstream I (Evidence Layer)

This section is historical and should not guide current weekend work.

Until Codex's in-flight `combat-prayer-10m` work merges:

- Claude does **not** edit:
  - `src/controller/benchmarks/cli.ts`
  - `src/controller/benchmarks/tasks/combat-prayer-10m.ts`
  - `src/controller/thinking/hybrid-agent-thinking-module.ts`
  - The roadmap file itself
- Claude **does** edit:
  - new files under `src/controller/evidence/`
  - `src/controller/benchmarks/verifier-conventions.ts` (NEW file; does not conflict with cli.ts)
  - new docs under `docs/`
- Claude proposes:
  - roadmap delta in `docs/superpowers/specs/2026-05-21-roadmap-delta-evidence-loop.md`, to be applied after Codex merges

After Codex finishes their combat-prayer-10m work:

- Historical note: Claude would have pulled `nullcity`, applied the roadmap delta, marked Workstream I tasks `[>]`, and proceeded with P1 under the old direct-push convention. Current work uses `agents/wip`.

## Coordination With Dev (Dashboard)

Workstream I produces files Dev's dashboard will eventually read. Pre-commit to:

- A stable `portrait.json` schema documented in the spec.
- A stable `reward.json` schema documented in the spec.
- Field additions only (never removals) without a version bump.
- A short heads-up note in `docs/agent-status.md` whenever a contract field is added.

Dev's `[D2]/[D3]` dashboard work can proceed independently — Workstream I lands the producer, Workstream D lands the consumer.

## When Things Go Wrong

- **Merge conflict in a coordination file (roadmap, agent-status):** preserve both edits, never overwrite; the merging agent posts a status line describing what was preserved.
- **A schema breaks a downstream reader:** the writer rolls forward, not back; add a versioned field and a brief migration note. Downstream consumers detect the bump and adapt or fail loudly.
- **An agent goes silent mid-`[>]`:** another agent may take the task only if `agent-status.md` shows no activity for >24h and the in-progress changes are either committed or trivially recoverable from a stash/branch.

## Open Questions

1. Should we adopt a longer sync log format (date + branch + commit sha)? Probably yes once we have more than 3 active agents; not yet.
2. Should `agent-status.md` be auto-generated from git log? Maybe; for now manual entries are fine because they describe intent, not just history.
3. Should we have a dedicated coordination channel outside the repo (Slack, Discord)? Out of scope here; repo-grounded only.
