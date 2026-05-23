# Multi-Agent Coordination Protocol

**Audience:** Any agent (Claude, Codex, future) or human working in this repo or the residents-dashboard repo.
**Date:** 2026-05-21.
**Status:** Draft; revise as the team learns what actually prevents collisions.

**New here? Start by skimming this file end-to-end, then read `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` for the canonical workstream board, then the spec at `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` for the active design work.**

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

1. `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — workstream board with `[ ] [>] [~] [x] [!]` task markers. *Note: as of 2026-05-21 the roadmap reflects Workstreams A–H only. Workstream I and the proposed J–O candidates live in `docs/superpowers/specs/2026-05-21-roadmap-delta-evidence-loop.md` and will be merged into the roadmap after Codex's `nullcity` branch lands.*
2. `git status` on the active branch.
3. `docs/agent-status.md` — short append-only log of who-is-doing-what (see below).

If those three disagree, the roadmap wins for intent and `git status` wins for in-flight reality.

## Workstream Ownership (as of 2026-05-21)

All routine work targets `nullcity` directly (see Rule 3). Workstream owners commit and push there as they go; cross-repo work (Dev's dashboard) is in a separate repo with its own default branch.

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

Workstreams I–O are proposed in `docs/superpowers/specs/2026-05-21-roadmap-delta-evidence-loop.md`. They do not exist in the roadmap file yet because Codex has uncommitted edits there; apply the delta after the Codex merge. Candidate idea provenance and "next step" hooks for J–O live in `docs/null-city-ideation-backlog.md`.

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

**Brevity convention (added 2026-05-23 after the log grew to ~150 entries):** keep STARTING and HANDOFF lines under ~250 characters each. Required fields: timestamp, agent, branch, workstream, STARTING/HANDOFF, one-sentence summary, commit SHA (HANDOFF only), test count (HANDOFF only), collision note. Everything else — multi-slice arc rollups, prose narrative, file-by-file changes, before/after counts — belongs in the **commit body**, not the status log. The log is a coordination signal, not a deliverables narrative. Long HANDOFFs make the tail expensive to read every cycle and bury the coordination signal.

Good HANDOFF (≈220 chars):
```
2026-05-23 02:00 claude  branch=nullcity  workstream=P  HANDOFF — added 2 economy entries (coin-handling + early-gp-sources). Commit 14a00dda. typecheck/lint PASS; Jest 120/120 + 1008/1008. Collision: none.
```

Bad HANDOFF (don't): 1500-char rollup of the multi-cycle arc + per-entry summaries + impact paragraph. Put that in the commit message body.

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

The first instance is `docs/strategic-review-2026-05-23.md`.

## Specific Coordination For Workstream I (Evidence Layer)

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

- Claude pulls `nullcity`, applies the roadmap delta, marks Workstream I tasks `[>]`, and proceeds with P1 — committing and pushing directly to `nullcity` per Rule 3.

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
