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

### E3 — action-result outcome histogram across all residents

**Status:** OPEN (3 sub-findings; 2 file new HD entries)
**Tier:** 1 (read-only)
**Date:** 2026-05-24 12:55 claude

**Hypothesis.** E1 found 88% action success on a single res:agent session. Test: does this rate generalize across all 7 configured residents and recent sessions? Also: what's the per-action-kind breakdown?

**Repro.** `python3` aggregate over the most-recent 3 trajectory files per resident in `data/controller/memory/<res>/evidence/trajectory/`. Count `begin_tick`, `action.kind`, `action.cause`, `action_result.status`.

**Observation.**

```
resident             ticks  actions  results   top outcomes
res-agent             6802     444      499    399 success  100 timeout
res-hans              6802       0        0    (deceased)
res-father-aereck     6802       0        0    (deceased)
res-duke-horacio      6802       0        0    (deceased)
res-wise-old-man      6803       0        0    (deceased)
res-pip               6803       0        0    (deceased)
res-thrand            6803       0        0    (deceased)
```

Aggregate outcomes (only res:agent contributes):
- **success: 399 / 499 = 80.0%**
- **timeout: 100 / 499 = 20.0%**

Aggregate action kinds:
- move_to:           406 (91.4%)
- interact:           23 (5.2%)
- use_item_on_item:   15 (3.4%)

Action causes (top 8):
1. explore_patrol: 251
2. woodcutting_level1_routine: 106
3. return_to_visibility_anchor: 18
4. routine_loop_break: 16
5. stuck_pre_inference_explore: 10
6. woodcutting_chain_firemaking: 10
7. continue_move: 7
8. stuck_move_recovery: 6
9. firemaking_fallback: 5
10. scouting_woodcutting_opportunity: 5
11. **explore_talk_to_npc: 5** ← Brain is trying to talk to NPCs

**Findings (3 separate sub-findings, each classified).**

**F3a — Only 1 of 7 configured residents produces ANY behavior** (the other 6 are deceased and tick-leak).

- **Classification.** DESIGN (resident pool is effectively a single agent right now; doesn't match the IRL-event narrative which assumes a community of heroes interacting in the embassy).
- **Suggested next step.** This blocks every multi-resident experiment in the queue (E4 cross-resident interaction, E11 cross-resident chat, the EVENT-D3 greeting). Either (a) maintainer restarts controller to apply the 14k attention bump per HD-020 → fresh heroes spawn → live experiments resume; OR (b) claude spins up a second controller on port 43596 with isolated `memory.dir` to run experiments. Option B is what the cron prompt explicitly enables.
- **Owner suggestion.** claude (option B) — pick a second-controller path for E9, E10, E11 since (a) is gated on maintainer being online.

**F3b — Typical action success rate is 80%, not 88%.** E1's 88% was a particularly good session.

- **Classification.** BODY (the 100 timeouts out of 499 = ~20% of actions are emitted but never complete).
- **Suggested next step.** Sub-experiment E3a: filter the 100 timeouts by action.kind + action.cause to find the dominant timeout pattern. Hypothesis: move_to targets that the body adapter can't reach because the world moved between the Brain's decision and the action dispatch (NPC walked away, tree was chopped). If true, this is a perception staleness or action-target-validation issue. Codex's recent fixes already addressed `nonclosing-move`; the residual 20% is likely a different sub-mode.
- **Owner suggestion.** Codex (BODY), but blocked on better timeout sub-classification first. Claude runs E3a next cycle.

**F3c — `explore_talk_to_npc` fires 5 times but never produces a `say` action.** Brain is choosing to talk to NPCs but the routine emits a move_to instead.

- **Classification.** DESIGN (routine selects "talk to NPC" intent but emits movement, not a say or chat action). Could also be BODY if the move is the approach-then-talk pattern.
- **Suggested next step.** Trace one `explore_talk_to_npc` event in the trajectory: read the action it emitted, the action_result, and any follow-up actions. If the pattern is `move_to NPC tile → no follow-up say/chat`, it's DESIGN (missing the second-step verb). If `move_to → arrived → say`, it's working as intended. Sub-experiment E3b.
- **Owner suggestion.** claude (trace) → likely Codex (fix if DESIGN, claude knowledge if KNOWLEDGE).

**Classification rollup.** F3a = DESIGN/PROCESS, F3b = BODY, F3c = DESIGN.

**Suggested next experiment after E3.** E3a (timeout sub-classification) AND E3b (talk_to_npc trace). Both are short read-only experiments. Then E4 (cross-resident interaction) is blocked until either heroes are alive (F3a fix) or we spin a second controller.

**Owner suggestion overall.** Claude continues with E3a + E3b before any Tier-2 work.

---

### E3a — timeout sub-classification (paired action+result via requestId)

**Status:** OPEN — sharp BODY-layer finding, HD-023 filed for Codex
**Tier:** 1 (read-only)
**Date:** 2026-05-24 13:25 claude

**Hypothesis.** E3's 100 timeouts are dominated by a specific (action.kind, cause) pattern. Pairing action_results with their requestId-matched actions will isolate which routine + verb fails most.

**Repro.** `python3` walk over res:agent's most-recent 3 trajectory files. Build a request_id → action map per file (latest wins), then look up each timeout result and tabulate.

**Observation.**

Out of 709 action_results scanned, 103 timed out and 606 succeeded.

**Timeouts by (action.kind, action.cause) — top 6 patterns:**

| Timeouts | action.kind | action.cause | % of timeouts | Notes |
|---|---|---|---|---|
| **51** | move_to | woodcutting_level1_routine | 49% | ← dominant |
| 22 | move_to | explore_patrol | 21% | |
| 15 | move_to | continue_move | 15% | continuation after partial |
| 6 | **interact** | explore_talk_to_npc | 6% | NPC chathead approach |
| 2 | move_to | explore_talk_to_npc | 2% | |
| 2 | move_to | stuck_move_recovery | 2% | |

**Aggregate by kind:** 95 move_to timeouts (92%) + 8 interact timeouts (8%).

**Sample of timing-out move_to actions** (all range=1, short hops):
- `{kind: move_to, target: {x:3211, y:3231, level:0}, range:1, cause: explore_patrol}`
- `{kind: move_to, target: {x:3211, y:3231, level:0}, range:1, cause: continue_move}` ← same target as previous
- `{kind: move_to, target: {x:3216, y:3233, level:0}, range:1, cause: explore_patrol}`
- `{kind: move_to, target: {x:3217, y:3233, level:0}, range:1, cause: explore_patrol}`
- `{kind: move_to, target: {x:3220, y:3232, level:0}, range:1, cause: explore_patrol}`

The "same target" pair (explore_patrol then continue_move at the same coord) is the smoking gun: the body adapter starts a move, doesn't reach the tile in the timeout window, the routine re-emits as `continue_move`, also times out.

**For comparison: success counts by kind:** 476 move_to / 31 interact / 22 use_item_on_item / 76 unattributed.

So:
- move_to success rate: 476 / (476 + 95) = **83%**
- interact success rate: 31 / (31 + 8) = **79%**
- use_item_on_item success rate: 22 / (22 + 0) = **100%**

**Classification.**

1. **BODY (dominant, 88/103 = 85% of timeouts) — woodcutting/explore/continue-move don't close.** A short range=1 hop is timing out repeatedly. Either (a) timeout budget is too short for the path-finder's typical case; (b) the body adapter loses dispatch on certain target tiles (blocked by something the perception doesn't surface); or (c) the routine emits the same target repeatedly without the body adapter coalescing or noticing the previous attempt is still in flight.
2. **DESIGN/BODY (8/103 = F3c reclassification) — `explore_talk_to_npc` emits `interact` not `say`.** The routine IS trying to interact with the NPC's chathead (not just movement, as I assumed in E3). 6 of those interacts time out. This is closer to "interact target moved or wasn't really there" than to "missing verb." Reclassify F3c from pure DESIGN to BODY+KNOWLEDGE: the routine knows to interact, but either the target isn't reachable in time, or the chathead protocol the engine expects isn't being followed.

**Suggested next step.**

For Codex (BODY): the dominant fix target is "range=1 move_to timeouts for woodcutting/explore routines." Hypothesis: the timeout is firing before the action even reaches the engine, OR the engine queues the action but doesn't ack within the timeout. Worth instrumenting one such pair to see whether the engine RECEIVED the move and just didn't ack, or whether dispatch dropped. Filed as **HD-023**.

For claude: E3b still useful — trace ONE successful `explore_talk_to_npc` to see what the happy path looks like (find one that returned `success` rather than `timeout`). Verifies the routine isn't fundamentally broken.

**Owner suggestion.** Codex (HD-023). Claude continues with E3b or E2 (Brain output diversity).

---
