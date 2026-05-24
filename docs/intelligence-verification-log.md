# Intelligence Verification Log

**Purpose.** Append-only log of resident-intelligence experiments and findings, run during the 48h autonomous sprint of 2026-05-24 → 2026-05-26 and beyond. See `docs/superpowers/specs/2026-05-24-48h-sprint-design.md` for the sprint design + experiment queue.

**Audience.** The maintainer (James) scans this on Tuesday to assess what residents actually do well + badly. Codex reads this on bootstrap and can pick up any entry tagged `BODY` or `DESIGN` that smells fixable from their territory.

**Append-only.** Do not edit prior entries. To revise, add a new entry with `Follow-up to E-N`.

---

## Failure taxonomy (per `2026-05-24-48h-sprint-design.md` § Failure taxonomy)

| Code | Meaning | Owner-of-fix (default) |
|---|---|---|
| `DESIGN` | Wrong rule/routine/hook fires, or the routine itself is wrongly specified | claude (substrate) or Codex (monolith) |
| `INFERENCE` | Brain LLM returned bad / empty / repetitive / off-topic output | claude (prompt/knowledge) |
| `BODY` | Action emitted correctly but body adapter didn't realize it | Codex (monolith) |
| `PERCEPTION` | Brain didn't see relevant context | claude (perception/knowledge) |
| `KNOWLEDGE` | Brain knew the wrong / nothing / outdated info | claude (knowledge files) |
| `ENGINE` | Game-side bug (gateway, kernel, plugin) | engine maintainer (not us) |

---

## Entry template

```markdown
### E-N — short experiment title

**Status:** OPEN | RESOLVED-by-Codex@<sha> | RESOLVED-by-claude@<sha> | RESOLVED-noop
**Tier:** 1 (read-only) | 2 (claude-as-human) | 3 (synthetic hard) | 4 (design hole)
**Date:** YYYY-MM-DD HH:MM agent

**Hypothesis.** One sentence: what we expected to see.
**Repro.** Exact command(s) / file path(s) / experiment setup someone else could re-run.
**Observation.** What actually happened. Quote actual sample text/JSON where short enough; cite file paths + line numbers where long.
**Classification.** DESIGN | INFERENCE | BODY | PERCEPTION | KNOWLEDGE | ENGINE — one code, with a sentence explaining why this layer.
**Suggested next step.** One paragraph. Concrete. Names a file or function or commit.
**Owner suggestion.** claude | Codex | maintainer | engine.

(If RESOLVED, append:)
**Resolution.** What changed + commit SHA. Date.
```

---

## Experiments

### E1 — replay Codex `a87eed0d` post-fix res:agent soak

**Status:** RESOLVED-by-Codex@a87eed0d (confirmed; this entry documents the verification)
**Tier:** 1 (read-only)
**Date:** 2026-05-24 12:05 claude

**Hypothesis.** Codex's HANDOFF claimed `local-4674 recovered, chopped, lit fire`. We need to verify behavior delta vs the pre-fix res:agent trajectory I read in VERIFY-2 (70 actions / 65 move_to / 8 say / repetitive targets and texts).

**Repro.** `python3` aggregate of action kinds, causes, move-target uniqueness, action_result outcomes, and say samples over the latest res:agent trajectory file (`20260524T095253Z-local-4674-res-agent-...jsonl`).

**Observation.**

Behavior delta (pre-fix VERIFY-2 → post-fix E1):

| Metric | Pre-fix (VERIFY-2, 916 ticks) | Post-fix (E1, 3232 ticks) | Δ |
|---|---|---|---|
| action count | 70 | 162 | +131% |
| unique move targets / total moves | (3 consecutive identical seen in sample) | 109 / 140 = 78% unique | major up |
| action.interact | 3 | 12 | +300% |
| action.use_item_on_item | 2 | 10 | +400% |
| say events | 8 | 27 | +238% |
| action_result success rate | not measured | 165/188 = 88% | strong |
| `firemaking_fallback` causes | 0 | 3 | NEW |
| `woodcutting_chain_firemaking` causes | 0 | 7 | NEW |
| `stuck_*` recovery causes | 0 | 10 | NEW |

Non-degenerate action causes (top 10): `explore_patrol` 86, `woodcutting_level1_routine` 34, `routine_loop_break` 9, `woodcutting_chain_firemaking` 7, `stuck_pre_inference_explore` 6, `return_to_visibility_anchor` 6, `stuck_move_recovery` 4, `firemaking_fallback` 3, `scouting_woodcutting_opportunity` 3, `continue_move` 2.

Say sample (first 6, truncated to ~120 chars):
- "Heading to chop a nearby tree for logs. Steady work builds the foundation."
- "I am online at 3193,3259. Goal: Gather logs from a nearby tree to progress woodcutting and support future firemaking..."
- "I am online at 3193,3258. Goal: Gather logs from a nearby tree to progress woodcutting and support future firemaking..."
- "I am online at 3199,3257. Goal: Gather logs from a nearby tree to progress woodcutting and support future firemaking..."
- "I am online at 3201,3251. Goal: Gather logs from a nearby tree to progress woodcutting and support future firemaking..."
- "I am online at 3199,3240. Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find..."

**Classification.** RESOLVED in res:agent's case — Codex's `a87eed0d` did the work. Two residual sub-classifications:

1. **INFERENCE** (residual, low severity): say-output template starts with "I am online at X" + "Goal: Y. Next: Z." — the first half is the same across consecutive ticks; the second half (Goal/Next) varies more meaningfully. Brain is using a templated structure that reads as repetitive on visual scan but encodes real state changes. Either reduce the templating in the prompt or accept the trade-off (template = parseable for downstream tooling).
2. **BODY** (residual, medium severity): 23 timeouts out of 188 action results (12%). Most plausible cause is move targets that didn't close in time (NPC moved, path was longer than expected, perception lagged). Worth a separate experiment to isolate.

**Suggested next step.** (a) Mark RESOLVED. (b) Run **E3** (action-result outcome histogram across all residents + sessions) to confirm the 88% success rate generalizes vs. being a res:agent peculiarity. (c) Open a smaller experiment E1a investigating the 12% timeout rate.

**Owner suggestion.** Codex's fix already shipped. Claude continues to E3.

**Resolution.** Codex `a87eed0d` (committed 05:01 UTC). Verified post-fix behavior across 3232 ticks of res:agent; the post-fix run shows a different agent in every observable metric.

---
