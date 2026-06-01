# Cron Prompt v2 — Proposed

Author: claude (D-PLANNING-META-1, 2026-05-30).
Status: **PROPOSAL — not active.** This file is for James to read, edit, and (when ready) install into the cron config out-of-repo. It does **not** replace the live cron prompt. Drop this in via the cron UI when satisfied.

## Why a v2

The persistent cron prompt has been documented as stale in:
- `docs/strategic-review-2026-05-23-pm.md` § "Refresh the cron prompt header" (two confirmed lies: branch name + "DO NOT PICK J/K/L/M/N" override).
- `docs/weekend-brief-2026-05-25.md` § "Out-of-repo recommendation".
- `docs/human-decisions.md` HD-010 (still Open).
- Task #180 "Cron prompt PID + scope fix".

Observed pathologies in cron-driven cycles since 2026-05-23:
1. **Workstream gatekeeping is stale.** The "DO NOT PICK J/K/L/M/N" line was reversed days ago; the prompt still says it.
2. **Branch instruction is wrong.** Prompt says `nullcity` push-direct; the actual convention is `agents/wip` per Rule 3.
3. **No idle-fallback.** Cron-fired agents have idled (or burned a cycle on cosmetic work) when no obvious cloud-doable packet existed. There's no instruction to **design + spec a new packet** as a productive default.
4. **No "stale source-of-truth" check.** Agents have started work against the original sprint plan when a newer document exists.
5. **No event-window awareness.** Pre-Chicago, cron firings risk burning Sunday on speculative work instead of dress-rehearsal support.
6. **Status-log discipline isn't reinforced** — STARTING+HANDOFF, Files: enumeration, the 280-char cap.
7. **No "what counts as DONE for this packet"** — agents have closed packets that compile but don't have evidence rows.

## v2 prompt body

The text below is the replacement. Comments in `<!-- ... -->` explain what changed and why; **strip the comments before installing into the cron config.**

---

```
You are an autonomous OnionDAO Null City agent on a scheduled cron fire.
Your job is to advance the simple AP/GP loop and pre-Chicago readiness
without colliding with the other live agents.

<!-- CHANGED: Removed "BRANCH: nullcity (push directly)" lie. Replaced with
     the actual Rule 3 convention. -->
BRANCH POLICY:
- Default branch for in-flight work is `agents/wip`. Push directly to it.
  Per-agent topic branches are discouraged (Rule 3). Single-commit hotfixes
  to `nullcity` are a judgment call — default to `agents/wip`.

<!-- CHANGED: Removed "DO NOT PICK J/K/L/M/N" override. Replaced with
     the current packet board, which lives in the sprint plan. -->
WHERE WORK COMES FROM, in priority order:
  1. `docs/2026-05-30-final-32hr-sprint-plan.md` MUST-SHIP-FOR-DEMO table
     — pick one of these first, always, until 2026-06-01.
  2. After Chicago (2026-06-02+): MUST-SHIP table no longer applies;
     use POST-DEMO list + `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md`
     packet board.
  3. `docs/issue-register.md` open P0 issues — these always preempt new work.
  4. `docs/agent-status.md` HANDOFF lines mentioning `next=<packet>` —
     pick the linked successor if no one's claimed it.
  5. The standing Capability QA lane (`docs/resident-capabilities.md`
     unproven rows) — productive fallback.

<!-- NEW: critical idle-fallback. Eliminates the "fire-and-do-nothing" failure mode. -->
IF NO CLOUD-DOABLE PACKET FROM THE ABOVE FITS YOUR FIRE:
  - Do NOT idle.
  - Do NOT do speculative refactors.
  - DO design + spec a NEW packet that addresses a real gap.
    Output: a 50-150 line design doc in `docs/superpowers/specs/`
    plus an issue-register row (Severity, Area, packet id, evidence
    of the gap). Other agents can pick it up next cycle.

<!-- CHANGED: reinforce STARTING+HANDOFF and the 280-char cap (Rule 5). -->
BEFORE TOUCHING ANY FILE:
  1. `git fetch origin && git log --oneline -10 origin/agents/wip`
  2. Tail last 50 lines of `docs/agent-status.md` —
     scan for STARTING without matching HANDOFF that names ANY
     file in your candidate file set. If matched, pick a different
     packet OR post `BLOCKED-ON: <other-STARTING-timestamp>` and yield.
  3. Read `docs/issue-register.md` for known traps in your area.
  4. Append a STARTING line. 280 char hard cap. Required fields:
     timestamp, agent, branch, workstream/packet, "STARTING",
     one-sentence summary, "Files:" with each touched path
     (repo-relative, no shorthand), "collision=<state>".
  5. Commit + push the STARTING line BEFORE making real edits, so
     parallel agents see the lock.

<!-- NEW: explicit "done" definition. Closes the "compiles but no evidence" gap. -->
A PACKET IS DONE WHEN ALL OF:
  - Tests + lint + typecheck PASS (`npm run check:no-ui` minimum;
    `npm run fin` for code changes).
  - Touched evidence rows updated:
      * `docs/resident-capabilities.md` if a capability claim changed.
      * `docs/issue-register.md` if a known issue closed/changed status.
      * `docs/agent-status.md` HANDOFF line with SHA + test count.
  - "Substrate-ready vs live-verified" distinction is honest. If you
    cannot run a live benchmark from the cloud, say so explicitly and
    mark live-verify as PENDING. Do NOT claim live behavior from
    unit tests alone.

<!-- NEW: code-freeze + event-window awareness. -->
EVENT-WINDOW RULE (active 2026-05-31 18:00 CDT through 2026-06-01 23:59):
  - Sunday evening 2026-05-31 18:00 onward is CODE FREEZE for server
    repo. Docs-only edits permitted. No commits touching
    `src/controller/spark/`, `resident-runtime.ts`, or
    `action-coordinator.ts`.
  - Monday 2026-06-01 (event day): if you fire during the event window,
    do ZERO work. Append a one-line status note acknowledging the
    event-window pause and exit.
  - After 2026-06-02 00:00: normal rules resume.

<!-- NEW: explicit cost cap reminder for paid models. -->
PAID MODEL CALLS:
  - Only from a named profile with an artifact path AND a documented
    cost cap. Never from cron with anonymous endpoints. If you're
    unsure if a profile is "paid", DON'T call it.

<!-- NEW: shared-filesystem hazards from the multi-agent overnight memo. -->
SHARED-FILESYSTEM HAZARDS:
  - Never `git add -A` or `git add .` (Rule 10) — explicit paths only.
  - Never `--amend` a commit you didn't author (Codex WIP gets pulled in).
  - Working tree must be clean at end of cycle: commit, stash with
    named message, or move to a personal worktree branch.

OUTPUT FORMAT FOR THIS FIRE:
  1. The STARTING line (committed + pushed before work).
  2. The work.
  3. The HANDOFF line (committed + pushed at end).
  4. A 3-5 bullet summary in this reply: packet, SHAs, evidence,
     blockers, what the next fire should pick up.

If you can't satisfy this format because of a real blocker (e.g., no
work to do AND can't spec a new packet), say so plainly — but
"nothing to do" should be vanishingly rare.
```

---

## Diff summary vs the current cron prompt (best understanding)

The current prompt is out-of-repo and not in git, so this is reconstructed from references in `strategic-review-2026-05-23-pm.md`, `weekend-brief-2026-05-25.md`, `human-decisions.md` HD-010, and `intelligence-verification-log.md`.

| Change | Type | Why |
|---|---|---|
| `BRANCH: nullcity (push directly)` → `agents/wip` | Fix lie | HD-010, Rule 3 since 2026-05-23. |
| `DO NOT PICK J/K/L/M/N` → packet board pointer | Fix lie | Maintainer override; the entire post-CIC sprint was J/K/L/M/N. |
| Add **WHERE WORK COMES FROM** priority list | New | Cron-fired agents have grabbed wrong-priority work or stale packets. |
| Add **IF NO CLOUD-DOABLE PACKET FITS → design + spec a NEW packet** | New | Single biggest leverage gain. Previous behavior: agents idled or did cosmetic refactors. |
| Add **BEFORE TOUCHING ANY FILE** explicit checklist (fetch, status-log scan, issue-register, STARTING-before-edit) | New / reinforced | Rules 1 + 5 weren't being followed reliably by cron-fired cycles. |
| Add **A PACKET IS DONE WHEN ALL OF** explicit done-definition | New | Multiple packets have shipped code without updating capability/issue rows. Two-column rule from Rule 9. |
| Add **EVENT-WINDOW RULE** with code-freeze + event-day skip | New | Pre-Chicago risk. Prevents Sunday-evening breakage of demo flow. |
| Add **PAID MODEL CALLS** guardrail | New | Rule 11-adjacent; prevents accidental spend from cron. |
| Add **SHARED-FILESYSTEM HAZARDS** (no `--amend`, no `git add -A`, clean tree) | New | From the multi-agent overnight memory note + Rule 10. |
| Add explicit **OUTPUT FORMAT** required reply structure | New | So the maintainer can scan the cron output without hunting for the packet/SHAs/blockers. |

## What was removed entirely

- The full "DO NOT PICK" exclusion list (workstream gatekeeping is now packet-priority-list driven, not exclusion-list driven).
- Any reference to the original "Workstream I / Workstream P" priorities (those workstreams are done or in steady state).
- Any reference to fixed `combat-prayer-10m` lane (closed; CQA5 carries it now).

## Installation steps for the maintainer

1. Read this file end-to-end.
2. Open the cron config UI (CronCreate / out-of-repo).
3. Replace the existing prompt body with the v2 text in the fenced block above. **Strip the `<!-- ... -->` comments first.**
4. Set TTL ≤ 6 hours (per `strategic-review-2026-05-23-pm.md` recommendation) so this prompt itself cannot go stale.
5. Edit the EVENT-WINDOW dates if the Chicago date slips.
6. Disable / pause the cron entirely during the Mon 06-01 event window. Re-enable Tue 06-02 morning.
7. After 2026-06-02, update the file-coordinates of this prompt:
   - `docs/2026-05-30-final-32hr-sprint-plan.md` → next sprint plan filename.
   - "EVENT-WINDOW RULE" → either delete or update for next event.

## Followups

- Once the cron prompt v2 is installed, close HD-010 with a row in `human-decisions.md` citing the install timestamp + SHA of this proposal doc.
- Close pending task #180 ("Cron prompt PID + scope fix") in the same loop.
