# Overnight Loop Runbook — Resident Conversational Reply

**This file is the source of truth for the loop. On every iteration, re-read it first.** It is written to survive context resets: nothing here assumes memory of prior turns.

- **Plan (the work):** `docs/superpowers/plans/2026-06-02-resident-conversational-reply.md` — 9 TDD slices, in order.
- **Spec (the why/contract):** `docs/superpowers/specs/2026-06-02-resident-conversational-reply-design.md` (v4).
- **Repo:** `/Users/james/Code/OnionDAO/rs6-nullcity-server`. **Branch of record:** `origin/agents/wip`.

## Prime directive
Implement the 9 slices **in order, TDD (red→green)**, committing + pushing each slice, leaving the tree **gate-green** at every stop. Do NOT deploy/restart anything (Codex owns runtime). Do NOT touch files outside the plan's footprint.

## Where am I? (orientation — do this first every iteration)
1. `cd /Users/james/Code/OnionDAO/rs6-nullcity-server && git fetch origin -q`
2. `git log --oneline origin/agents/wip | grep -c "social-reply"` → number of slices already pushed. The next slice = that count + 1 (cross-check the `- [ ]`/`- [x]` boxes in the plan).
3. If 9 slices are pushed and the gate is green → **the feature is DONE**; go to "When complete".

## The isolated worktree (set up ONCE, reuse all night)
Work happens in a dedicated worktree off fresh origin — NEVER in the main checkout (the live controller runs from it; it also holds other agents' WIP).
```
WT=/tmp/nullcity-convreply-wt
# if it doesn't exist:
git -C /Users/james/Code/OnionDAO/rs6-nullcity-server worktree add -q "$WT" origin/agents/wip
cd "$WT" && git checkout -q -B convreply origin/agents/wip
ln -sfn /Users/james/Code/OnionDAO/rs6-nullcity-server/node_modules node_modules
```
If it already exists, just: `cd "$WT" && git fetch origin -q && git rebase origin/agents/wip` (see "Stay current").

## Per-slice cycle (repeat for the next unbuilt slice)
1. **Stay current:** `git fetch origin -q && git rebase origin/agents/wip`. If rebase conflicts → **STOP** (see Stop conditions). My files barely overlap the Loop agent's, so this is normally clean.
2. **Red:** write the slice's failing test(s) from the plan. Run the targeted file: `npx jest src/controller/thinking/social-reply.test.ts` (or the relevant suite) → confirm it FAILS for the right reason.
3. **Green:** implement the minimal code from the plan to pass. Re-run the targeted suite → PASS.
4. **Gate:** run the full gate (see below) → must be green modulo the known baseline failure.
5. **Commit** (explicit paths only — NEVER `git add -A`): the plan gives the message per slice.
6. **Push:** `git push origin HEAD:agents/wip`. Expect a fast-forward. If REJECTED (non-ff) → `git fetch && git rebase origin/agents/wip`, re-gate, retry once. If it still rejects or conflicts → **STOP**.
7. Tick the slice's boxes in the plan (`- [x]`), update the matching task to completed.

## The gate
```
npx tsc -p ./ --noEmit && npx jest 2>&1 | grep -E "Tests:|Test Suites:|FAIL"
```
**Known baseline (NOT a regression — do not chase):** `src/controller/intelligence/plan-store-brain-integration.test.ts` has ONE pre-existing failing test (`marks the current stage blocked...`) on origin, not ours. Baseline before this work = **3819 passing + that 1 known fail**. Gate is "green" iff: typecheck clean AND the only failing test is that known one AND my new/edited suites pass. If ANY other test newly fails, it's mine → fix before committing.

## Guardrails (hard rules)
- **Footprint lock:** only the 7 files in the plan. If a fix seems to need another file (esp. `resident-runtime.ts`, `llm-client.ts`, anything in `city-integration/` or `patron/`) → **STOP** and leave a note; that's a design change or a Loop-agent collision.
- **`hybrid-agent-thinking-module.ts` is soft-shared** with the Loop agent's T1b telemetry. Before Slice 7/8, append a line to `docs/agent-status.md` (explicit-path commit) noting `[>] hybrid-agent-thinking-module.ts — convreply slices 7-8`. If their changes already conflict there on rebase → STOP.
- **No `-A`, no `--amend`** (pulls in others' WIP). Explicit paths only.
- **No runtime/game/controller restart.** Build + test only. "Done" = gate-green + pushed, NOT live-verified.
- **jest, not vitest** — ambient globals, no test-framework imports.

## Stop conditions (leave a clear note in `docs/agent-status.md`, then end the loop)
- A rebase or push conflict you can't cleanly resolve in one retry.
- The gate is red for a reason you can't fix within the slice (don't thrash; document + stop).
- A slice needs a file outside the footprint.
- All 9 slices pushed + gate green (success).
On any stop, write: which slice, what state (red/green), the exact blocker, and the next action — so a human or the next iteration resumes cold.

## When complete (all 9 pushed, gate green)
1. Final full gate in the worktree → confirm green-modulo-baseline.
2. Append a "DONE — conversational-reply built, 9/9 slices, gate green, pushed; live-verify pending a steward-run game restart" note to `docs/agent-status.md` (committed, explicit path).
3. Do NOT restart anything. Stop the loop.
4. Leave the worktree in place (cheap) or remove it: `git worktree remove --force /tmp/nullcity-convreply-wt`.

## One-line status to emit each iteration
`SLICE n/9 — <red|green|gate|pushed> — next: <action>`
