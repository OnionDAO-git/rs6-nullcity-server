# Multi-Agent Coordination Protocol

**Audience:** Any agent (Claude, Codex, future) or human working in this repo or the residents-dashboard repo.
**Date:** 2026-05-21; tightened 2026-06-02.
**Status:** Live rules below; historical context further down.

**Current rule:** if this file conflicts with `AGENTS.md` or `docs/README.md`, those files win. Domain plans/specs control only the issues or roadmap rows that link to them.

**New here?** Start with `AGENTS.md`, `docs/README.md`, the tail of `docs/agent-status.md`, and `docs/issue-register.md`. Then use this file for coordination rules and historical context.

## Why This Exists

Multiple humans and agents may be active across two repos:

- Server/runtime work in `rs6-nullcity-server`.
- Dashboard/human-facing UI work in `rs6-nullcity-residents-dashboard`.

We do not have a shared message bus, real-time presence, or a job queue. Coordination must therefore be:

- **Async** — agents commit and read; they do not negotiate live.
- **Repository-grounded** — the source of truth is files in git, not chat.
- **Cheap to follow** — overhead must be smaller than the cost of a merge conflict.

## Source Of Truth

The canonical "what is happening right now" is the union of:

1. `git status` in your own clean worktree.
2. `docs/agent-status.md` tail — live STARTING/HANDOFF locks and runtime requests.
3. `docs/issue-register.md` — discovered QA findings, weak evidence, and blockers.
4. `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — parent task status.
5. `docs/release-qa-status.md` — QA Marshal release/readiness gate.

If these disagree, `git status` wins for in-flight file reality, `docs/agent-status.md` wins for live locks, `docs/issue-register.md` wins for known blockers, and the roadmap wins for parent-task intent.

## Historical Workstream Ownership (2026-05-21 Snapshot)

The original workstream-ownership table (workstreams A–O with `[x]`/`[>]`/`[ ]`/`[!]` markers) lived
here through the 2026-05-30 tightening pass. It was preserved only to explain older status-log entries,
and is now redundant — current active workstreams live in
`docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` (Workstream S + CQA packets) and in
`docs/2026-05-30-final-32hr-sprint-plan.md`. To recover the original table, see
`git show e74064c1:docs/agent-coordination.md` or earlier.

## Conflict Avoidance Rules

### Rule 1 — Work from a clean tree and check before opening

Use a clean worktree based on `origin/agents/wip` whenever possible. If the main checkout is dirty or diverged, do not "clean it up" unless James explicitly asks; create or reuse an isolated worktree instead.

Before editing a file, every agent does:

```bash
git fetch origin
git status --short
git log -n 10 --oneline
```

If a file appears as `M` or `??` in `git status --short`, another worker has it open. Do not touch.

### Rule 2 — Claim the smallest unit, then name exact files

Before editing, prefer an unclaimed Open P0/P1 issue. If no issue fits, claim the smallest linked roadmap/domain packet. Do not grab a whole parent workstream when a smaller packet exists.

Roadmap `[>]` markers show parent-task intent; they are not sufficient file locks. The hard coordination lock is a `STARTING` line in `docs/agent-status.md` that names exact files. After the work is done and verified, update the issue/roadmap/capability docs that changed truth.

Exception: while Codex has the roadmap dirty, other agents propose roadmap changes via a delta file (e.g., `docs/superpowers/specs/2026-05-21-roadmap-delta-evidence-loop.md`) instead of editing the roadmap directly.

### Rule 3 — Shared agent branch, curated milestones to default

**Revised 2026-05-23** after the default-branch history (`nullcity`) grew too noisy for Dev to read — ~3 commits per slice (STARTING / work / HANDOFF) plus correction commits and format-only commits. **Sharpened 2026-05-30** with explicit no-feature-branches statement per maintainer MEMORY.

The workflow has two layers:

**Layer 1 — `agents/wip` (shared agent branch):** all claude / codex / antigravity in-progress work goes here. Push freely. Small commits, STARTING/HANDOFF lines, status-log appends, format fixes, correction lines — all fine on this branch. This is where coordination happens.

**Layer 2 — `nullcity` (default branch):** Dev reads this. Only curated milestones land here, via **squash-merge from `agents/wip` → `nullcity`** with one descriptive commit subject and a detailed body. Per-slice breakdown lives in the commit body. The default branch should read as a milestone log, not an in-progress sync channel.

**No feature branches** (maintainer rule, 2026-05-30): do NOT create `claude/<topic>`, `codex/<topic>`, or other per-agent feature branches. Push directly to `agents/wip`. The only sanctioned exceptions are: (a) a short-lived personal worktree (see Rule 10) that exists only between cycles and is folded back into `agents/wip` before HANDOFF, and (b) a single-commit critical hotfix that goes direct to `nullcity` (judgment call).

Implications:

- Daily work: commit to `agents/wip` and push. **Fetch + rebase on `origin/agents/wip` before pushing** to avoid non-fast-forwards. On a rebase conflict in `docs/agent-status.md`, prefer "accept both" (append both entries) — never overwrite another agent's STARTING line.
- On milestone completion (workstream slice done + tests + lint + typecheck green), squash-merge `agents/wip` → `nullcity` with a curated commit. Cadence: workstream completion, every ~24h, or on maintainer ask.
- `docs/agent-status.md` lives on `agents/wip` and **does not get merged to `nullcity`**. It's a coordination artifact, not a deliverable.
- File-level collision avoidance still primary. Read `git status` + the status log on `agents/wip` before editing.
- The dashboard repo (`rs6-nullcity-residents-dashboard`) has its own conventions — follow Dev's existing pattern there.
- Dashboard or human-facing UI belongs in the dashboard repo. Server agents may add JSON/control APIs and contract docs only.
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

Runtime requests also go through this log; see `docs/runtime-stewardship.md`. If an agent needs a shared process restart, it posts `RUNTIME-REQUEST` and keeps working elsewhere. Only the runtime steward restarts controller/game/infra/dashboard sessions while an owner note is active.

### Rule 5b — Issue register and QA Marshal

`docs/issue-register.md` tracks discovered problems. Use it when a benchmark fails, a capability claim lacks evidence, a doc contradiction could mislead another agent, or a fix crosses packet/file ownership.

`docs/release-qa-status.md` is the QA Marshal gate for `agents/wip` -> `nullcity`. Do not claim broad release readiness while open `P0` issues remain.

Direct fix is fine when the bug is inside your claimed packet, can be proven in the same cycle, and no other STARTING line owns the files. Otherwise add or update an issue row.

Capability evidence is not a parallel task tracker. A weak row in `docs/resident-capabilities.md` becomes either a capability-evidence note plus matrix update, or an issue-register row if it needs dev work.

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

### Rule 12 — Parallel-worktree pattern + idle fallback (added 2026-05-30)

After multiple multi-agent overnight cycles where same-cwd edits caused phantom `M` modifications, `--amend` swept Codex WIP into Claude commits, and `git add -A` swept untracked files (HD-010 + Rule 10 history):

**Parallel-worktree pattern (recommended for any multi-file slice when another agent is active):**

```bash
cd <repo-root>
git fetch -q origin
WT=/tmp/<repo>-<topic>
git worktree remove --force "$WT" 2>/dev/null || true
git worktree add --detach "$WT" origin/agents/wip
ln -sfn <repo-root>/node_modules "$WT/node_modules"
cd "$WT"
# work, commit, push to agents/wip (rebase if push race)
```

The worktree isolates your file edits from another agent's in-progress edits in the main checkout. After push, the worktree is disposable. This is the workflow this `agent-coordination.md` itself was edited in.

**Idle fallback (when fired by cron with no obvious cloud-doable packet):**

Do NOT idle and do NOT pick speculative refactors. Instead, in priority order:
1. Pick a P0 from `docs/issue-register.md`.
2. Pick a `next=<packet>` from the most recent HANDOFF in `docs/agent-status.md`.
3. Pick an unproven row from `docs/resident-capabilities.md` (standing CQA lane).
4. **If nothing fits, DESIGN + SPEC a new packet** — output a 50-150 line design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` plus an issue-register row, then HANDOFF.

This rule is reinforced in the proposed cron prompt v2 (`docs/cron-prompt-v2-proposed.md`); it is repeated here so it applies to any fire (cron, manual, packet-driven).

## Historical: Specific Coordination For Workstream I (Evidence Layer)

The detailed Workstream I file-ownership table that lived here through the 2026-05-30 tightening pass is historical — Workstream I is `[x]` per the roadmap, `combat-prayer-10m` is closed (CQA5), and the roadmap delta was applied long ago. To recover the original section, see `git show e74064c1:docs/agent-coordination.md`.

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

## Launch Blockers Protocol

`docs/launch-blockers.md` is the canonical, cross-repo registry of everything gating the OnionDAO / Null City launch (server, dashboard, oniondao-badge, landing-2026, rs6-3d-viewer). `docs/launch-blockers_discussion.md` is its append-only chatter/history. Both live on `agents/wip`. This is to launch what `issue-register.md` is to QA defects: issue-register = discovered defects/weak evidence; launch-blockers = *everything* (tasks + blockers + external deps + decisions) that must be true before launch.

**Items** are per-`### LB-<AREA>-<rand4>` sections grouped under `## <AREA>` headers, one field per line. The random ID suffix means parallel agents never collide allocating an ID — no read-modify-write, no reservation.

**Editing the registry (in place):**
- `git pull --rebase` first; re-read the item before editing.
- Change ONLY the field line(s) that changed (`- Status:`, `- Owner:`, `- Updated:`). One item per commit. Never reflow/re-sort other items (that rewrites lines you don't own and guarantees conflicts).
- Add a new item by appending its block to the bottom of the correct `## <AREA>` section.
- Closing (`Done`/`Won't-fix`) requires a `- Resolution:` line; then move the block to `## Archive`.

**Claiming (the soft lock, like the roadmap `[>]`):** set `- Owner: <you>` AND move `- Status:` to the first active state (Investigating/Designing/In-progress), push, then append a `decision` entry to the discussion file naming the files you'll touch. If `Owner != unassigned` and `Status` is active, it's taken — pick another. First-pushed claim wins; ties broken by earliest discussion timestamp. Also append a `STARTING` line to `agent-status.md` if the work touches `src/`.

**Discussion file (append-only):** newest at bottom, threaded by `LB-id`, entry header `### YYYY-MM-DD HH:MM | <agent> | <LB-id|meta> | <type>` where type is `question|decision|update|handoff`. Never edit/delete a prior entry; correct yourself by appending a new one. Put all reasoning/evidence/history here, not in the registry.

**Git (consistent with Rule 3, push direct to `agents/wip`, no feature branches):** one logical change per commit; commit msg `docs(blockers): <verb> LB-... — <note>`; `git pull --rebase && git push`; on push reject, `pull --rebase` and push again. Stage explicit paths only (`git add docs/launch-blockers.md`) — never `git add -A`/`.` (the shared tree may carry other agents' phantom `M` files). **Never `git commit --amend` and never `git push --force`** on `agents/wip` — both have lost work on this project before.

**Conflicts** are designed out (different items = different lines; discussion = disjoint EOF appends). If one occurs: discussion file → keep both blocks in timestamp order, drop markers; registry → reconcile to the most-advanced state (`Done > Verifying > In-review > In-progress > Blocked > Open`), keep one line per field, then append a `decision` entry recording the resolution.

The paste-ready RULES OF ENGAGEMENT headers at the top of each file are the short form of the above; this section is the full reference they point to.

## Open Questions

1. Should we adopt a longer sync log format (date + branch + commit sha)? Probably yes once we have more than 3 active agents; not yet.
2. Should `agent-status.md` be auto-generated from git log? Maybe; for now manual entries are fine because they describe intent, not just history.
3. Should we have a dedicated coordination channel outside the repo (Slack, Discord)? Out of scope here; repo-grounded only.
