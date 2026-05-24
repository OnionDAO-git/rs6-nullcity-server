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

### E2 — Brain output diversity scan

**Status:** OPEN — counter-intuitive finding: Brain diversity is HIGH, not low
**Tier:** 1 (read-only)
**Date:** 2026-05-24 13:55 claude

**Hypothesis.** Maintainer feedback was "residents seem dumb." E1 sampled 6 say events that visually looked repetitive ("I am online at X. Goal: Y..."). Hypothesis being tested: Brain output is genuinely low-diversity (high-repetition / templated / off-topic) and that's the dumbness root. If true → INFERENCE-layer fix (better prompt, higher temperature, better knowledge injection).

**Repro.** `python3` aggregate over res:agent's last 3 trajectory files. Count `decision` events; tally action.kind plans + say texts + memo updates + plan changes; measure unique-vs-total + prefix-repetition.

**Observation.**

Volume:
- **3387 decisions** across 3 trajectory files (~1130/file)
- **92 say events** (one per ~37 decisions)
- **0 memo updates** across all 3387 decisions
- **0 plan changes** across all 3387 decisions
- Avg prompt tokens: **3319** (range 2629–3555)

Action kinds Brain proposed (via decision.actionKinds field):
- move_to:           727
- say:                93
- interact:           55
- use_item_on_item:   30

Say diversity:
- **84 unique full texts / 92 total = 91% unique**
- Top 5 say-prefix groups (first 60 chars): each group has 2-3 occurrences
- Sample full say texts (each is a unique full text):
  - "I am online at 3214,3236. Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find. Next: chop the tree at 3213,3238."
  - "I am online at 3201,3239. Goal: Scout nearby landmarks... Next: chop the tree at 3200,3240."
  - "I am online at 3199,3235. Goal: **Chop a nearby ordinary tree** to gather logs and gain Woodcutting XP. Next: chop the tree at 3198,3236."
  - "I am online at 3192,3240. Goal: Scout nearby landmarks... Next: chop the tree at 3190,3241."

Decision causes (Brain decision triggers, top 10):
- **body_wait: 2469 (73%)** ← Brain mostly defers to body
- exploration_fallback: 565 (17%)
- presence_beacon: 86
- woodcutting_level1_routine: 63
- return_to_visibility_anchor: 44
- stuck_pre_inference_explore: 23
- woodcutting_chain_firemaking: 23
- routine_loop_break: 20
- continue_move: 19
- stuck_move_recovery: 15

Module identity: 100% `onion.runescape.standard` (single SPARK module).

**Findings (4 separate, each classified).**

**F2a — Brain say-text diversity is HIGH, not low.** 91% unique full texts. Repetition is in the *structure* ("I am online at X. Goal: Y. Next: Z.") not the content (X/Y/Z vary meaningfully). Visual impression of "dumb" comes from the structural prefix; the semantic content varies.

- **Classification.** NOT a primary dumbness signal. Cosmetic INFERENCE concern at most.
- **Suggested next step.** Either accept the structure as parseable (good for downstream tooling like the wall ticker) or write a small prompt-engineering experiment (E2a) that drops the templated prefix and sees if voice quality goes up or down.

**F2b — 73% of all Brain decisions are `body_wait`.** Brain calls the LLM, gets back "keep doing what you're doing," 2469 times in this dataset.

- **Classification.** DESIGN (or possibly INFERENCE if the prompt is asking for new plans when the body is already executing). 2469 LLM calls that produce no behavior change is real money + real latency for no observable signal.
- **Suggested next step.** Investigate whether body_wait is a NORMAL Brain output (Brain is correctly identifying "no new plan needed") OR whether the Brain SHOULD have been skipped entirely for those 2469 ticks. If the former, optimize: skip the LLM call when the body is executing a routine. If the latter, the decision frequency is too high — gate Brain calls behind a "needs new plan?" check at the hook layer.
- **Owner suggestion.** Codex (hook gating) or claude (Brain prompt change).

**F2c — Brain never writes memos** (0 memo updates across 3387 decisions). The decision schema supports `memoUpdates` field; nothing populates it.

- **Classification.** DESIGN + KNOWLEDGE. The Library of Souls timeline depends on Brain reflecting in writing. Without memo writes the only timeline content is perception-driven events (patron interactions, deaths) — none of which is Brain's own narrative voice.
- **Suggested next step.** Audit the Brain prompt schema: does it ASK for `memoUpdates`? Look at `src/controller/llm/prompt-envelope.ts` § output. If memos are in the output contract but Brain never returns them, the prompt is failing to elicit them. If memos are NOT in the output contract, that's a substrate hole — add the field, plumb to `MemoryStore.write`.
- **Owner suggestion.** claude (prompt + plumbing).

**F2d — Brain never returns plan changes** (0 across 3387 decisions). Same pattern as F2c but for the `planChange` field.

- **Classification.** DESIGN.
- **Suggested next step.** Same audit as F2c — is `planChange` in the output contract? Looking at `prompt-envelope.ts` § outputContract: yes, it's the `plan` field with a structured shape. So Brain CAN return plans. If the trajectory captures 0, either: (a) parser is dropping plans before persistence; (b) Brain genuinely never plans; (c) plan changes happen but `recordDecision` doesn't capture them. Trace one decision through `spark.ts` to see.
- **Owner suggestion.** Codex (decision/trajectory wiring) or claude (prompt).

**Classification rollup.** F2a = INFERENCE (cosmetic). F2b = DESIGN. F2c = DESIGN + KNOWLEDGE. F2d = DESIGN.

**The maintainer's "they seem dumb" is NOT primarily an INFERENCE problem.** Brain output is diverse. The actual gaps are: 73% of Brain calls don't produce behavior (body_wait), Brain never writes reflective memos (0/3387), Brain never produces plan changes (0/3387). These are DESIGN-layer issues — the Brain is being asked the wrong questions or its useful outputs are being dropped.

**Suggested next experiment.** E2a (drop templated say prefix — small prompt experiment to verify F2a is cosmetic, not structural). OR E2b (audit prompt-envelope output contract + spark.ts decision capture to investigate F2c/F2d). Both are claude-owned (no Codex monolith touch). HD-024 will file the F2b body_wait optimization for Codex.

**Owner suggestion.** Claude continues with E2b (audit prompt contract for memos/plans). HD-024 to Codex for F2b gating.

---

### E3a follow-up — Codex timeout retry mitigation smoke

**Status:** PARTIAL-RESOLVED-by-Codex on `agents/wip` (same-target retry loop); OPEN residual movement timeout rate
**Tier:** 2 (live local controller + dashboard)
**Date:** 2026-05-24 06:47 codex

**Hypothesis.** If timed-out coordinate moves are remembered as target failures and the thinking layer drops an active move whose target is on cooldown, the `move_to(X,Y)` timeout followed by `continue_move(X,Y)` timeout pattern should stop recurring.

**Repro.**
- Baseline live QA: one-hour `res:agent` soak before this mitigation, controller `local-4674`, trajectory evidence under `data/controller/memory/res-agent/evidence/trajectory/current`.
- Regression tests: `resident-runtime.test.ts` verifies a timed-out direct-coordinate `move_to` writes `target:3217,3233,0`; `hybrid-agent-thinking-module.test.ts` verifies a cooled-down active move is not continued; `runescape-body-routines.test.ts` verifies exploration patrol avoids visibly object-occupied tiles.
- Post-fix smoke: controller restarted as `local-73959`; a 10-minute trajectory monitor counted action kinds, outcomes, and repeated same-target `continue_move` timeout pairs.

**Observation.**
- Baseline one-hour live soak: 471 actions/hour; 380 `move_to`, 47 `say`, 28 `interact`, 16 `use_item_on_item`; 435 success, 35 timeout, 1 failure. The resident moved broadly, talked, chopped, lit fires, picked up items, returned to anchor, and stayed 10/10 HP, but movement was still timeout-heavy.
- Post-fix 10-minute smoke on `local-73959`: 70 actions, 76 results, 69 success, 7 timeout; action kinds were 64 `move_to`, 4 `interact`, 2 `use_item_on_item`. Causes included `explore_patrol`, `woodcutting_chain_firemaking`, `opportunistic_pickup`, `return_to_visibility_anchor`, `routine_loop_break`, and `woodcutting_level1_routine`.
- The E3a smoking-gun signature was gone in the smoke: `repeatedContinueTimeouts=0`.
- Dashboard browser check at tick 44618 showed `res:agent` online, runtime active, SPARK module `onion.runescape.standard@0.1.0`, HP 10/10, scouting goal active, live position/action feed, and recent position-change progress.

**Classification.** BODY. The same-target retry loop is mitigated, but raw `move_to` timeouts remain. The next BODY problem is no longer "why do we immediately retry the exact target"; it is "which moved/blocked/stale targets still consume timeout budget, and does the engine receive or complete those moves after the timeout fires?"

**Suggested next step.** Instrument timeout results with final observed position, target distance, and whether the gateway/engine acknowledged the move before changing timeout budgets. Then run another 10-15 minute live smoke and compare raw timeout rate plus action diversity. Also keep pushing richer task variety, because this smoke was active but still patrol-heavy and had no public speech in the sampled window.

**Owner suggestion.** Codex for BODY instrumentation and movement close-rate fixes; Claude/Gemini for broader experiment design and non-movement intelligence checks.

---

### E2b follow-up — Brain memory + plan telemetry plumbing

**Status:** PARTIAL-RESOLVED-by-Codex on `agents/wip`; needs live-controller restart/soak to measure organic memo rate
**Tier:** 2 (prompt/runtime plumbing + focused tests)
**Date:** 2026-05-24 07:15 codex

**Hypothesis.** E2c/E2d were caused by a substrate gap: the Hybrid Brain prompt did not explicitly ask for sparse memory notes, and runtime decision evidence did not carry Brain-side `memoUpdates` / goal-change telemetry.

**Repro.**
- Focused regression tests added to `hybrid-agent-prompts.test.ts`, `hybrid-agent-thinking-module.test.ts`, and `resident-runtime.test.ts`.
- Focused command: `npm test -- --runTestsByPath src/controller/thinking/hybrid-agent-prompts.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/resident-runtime.test.ts --runInBand --testNamePattern "sparse first-person memory|Brain memo output|writes runtime evidence"`.
- Full relevant suite command: `npm test -- --runTestsByPath src/controller/thinking/hybrid-agent-prompts.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/resident-runtime.test.ts --runInBand`.

**Observation.**
- Hybrid Brain now sees an explicit `memo` output shape with `events/YYYY-MM-DD.md`, first-person text, and a sparseness rule.
- Brain JSON containing `memo` writes through `MemoryStore.write(...)`.
- `SparkTickResult` / `ThoughtResult` can surface `memoUpdates` and `planChange`.
- `ResidentRuntime` records those fields in `decision` trajectory rows, so the dashboard / verification scripts can count them.
- Brain watchdog fallback goal changes now also surface `planChange` with `source=brain_timeout_fallback`, because the live patched controller hit inference backoff during the smoke and otherwise hid a real local goal change.
- Codex also rechecked the current latest trajectories and found `body_wait` rows carrying `promptTokens=0`, so HD-024's "8.2M token waste" should be treated as a measurement contradiction until re-scanned after this telemetry patch. The user-visible gap remains: too many local no-op decision rows, and too little Brain reflection.
- Live smoke after restart (`local-77175`, 65s) produced 1 organic `memoUpdates`, 1 `planChange` (`train-woodcutting`, 4 steps), 1 public say, 3 move_to, 1 interact, 1 use_item_on_item, and 5/5 successful action results. The memo landed in `data/controller/memory/res-agent/events/2026-05-24.md` as a first-person note about scouting tree-like objects and switching to Woodcutting.

**Classification.** DESIGN + KNOWLEDGE. The Brain was capable of receiving memories, but the standard Hybrid Brain path was not prompted to write its own sparse first-person memories or expose goal changes to evidence.

**Suggested next step.** Restart/soak a real controller long enough for at least one Brain interval, then re-run the E2 scanner. Success criteria: nonzero organic `memoUpdates` on meaningful goal changes or learning moments, nonzero `planChange`, and no increase in noisy public chat.

**Owner suggestion.** Codex for live QA + telemetry scan; Claude/Gemini can update dashboard panels once the fields appear in real trajectories.

---

### E2 / E3a / E2b verification — confirm Codex 19d398f1 + 91f8e160 fixes against live data

**Status:** RESOLVED-by-Codex (E3a via 19d398f1, E2 F2c+F2d via 91f8e160). E2 F2b reframed.
**Tier:** 1 (read-only)
**Date:** 2026-05-24 14:25 claude

**Hypothesis.** Codex shipped two fixes between the cycles (19d398f1 movement timeout cooldowns, 91f8e160 Brain memo+planChange telemetry). Verify against live data: (1) did memos actually land on disk, (2) does planChange show up in decision rows, (3) does the body_wait token cost framing in HD-024 hold up?

**Repro.** Scan res:agent's last 3 trajectory files for `decision` rows; count `memoUpdates`, `planChange`, `body_wait` causes with `promptTokens`. List recent `data/controller/memory/res-agent/events/*.md` files.

**Observation.**

Memo writes (F2c verification):
- `data/controller/memory/res-agent/events/2026-05-24.md` — **222,838 bytes**, mtime 07:19:28 (post Codex fix). The pre-fix file was much smaller; the post-fix expansion is real Brain content.
- Trajectory `decision` rows: 1 organic `memoUpdates` recorded in the sampled window.

Plan changes (F2d verification):
- Trajectory `decision` rows: 1 organic `planChange = {id: 'train-woodcutting', steps: 4}` recorded in the sampled window. Confirms Brain produces structured named plans now.

Token cost (HD-024 correction):
- 956 total decisions across the 3-file window.
- **623 body_wait decisions ALL have `promptTokens = 0`** — body_wait is dispatched without an LLM call. Per Codex's E2b follow-up entry: "`body_wait` rows carrying `promptTokens=0`, so HD-024's '8.2M token waste' should be treated as a measurement contradiction."
- Only 22 non-body_wait decisions had `promptTokens > 0` (avg 3309 tokens, total 72,799 tokens for the window).
- Actual cost: ~73K tokens per 3-session window, not 8.2M. My HD-024 number was wrong by 100×.

What the body_wait count actually represents:
- 65% (623/956) of decision rows are `body_wait` with zero LLM cost.
- The user-visible gap I observed in E2 is real but reframed: those rows are *telemetry* (Brain confirms body is healthy + nothing to do), not *waste*. They consume disk + scan time but no inference. Whether they should be persisted at all (vs. coalesced or omitted) is a downstream observability question, not an inference-cost one.

**Classification.** F2c + F2d: RESOLVED-by-Codex@91f8e160 (DESIGN+KNOWLEDGE substrate gap closed). F2b: PARTIAL — reframe from "wasted inference cost" (false) to "noisy telemetry" (still arguable). E3a: RESOLVED-by-Codex@19d398f1 (confirmed via earlier HD-023 in-line update with 91% success rate).

**Suggested next step.**
- (a) Edit HD-024 to acknowledge the cost-claim correction. Reframe the open question as "should body_wait decision rows be persisted at all?" — much lower priority than originally filed.
- (b) Re-run E3 (aggregate outcome histogram) after another live soak to measure how much memo/planChange Brain produces *organically* over a longer window. Codex's live smoke (local-77175, 65s) saw 1 memo + 1 planChange + 1 say + 5/5 success — but 65s is tiny. A 10-min soak post-restart will give a stable rate.
- (c) E5 (patron path) showed **0 patron events** in res:agent's last 3 sessions. Patron loop is not being exercised by normal play. Need Tier 2 work to actually call `patron:grant` + `patron:offer` ourselves and watch the cascade. That's E6 from the queue.

**Owner suggestion.** Claude continues with HD-024 correction (this cycle) + E6 (next cycle, Tier 2 claude-as-human patron loop).

**Resolution.** Codex `19d398f1` (HD-023 / E3a) + `91f8e160` (F2c / F2d / E2b). Both confirmed via on-disk evidence in trajectory + memo files at 07:19 today.

---

### E3a follow-up — movement timeout distance evidence

**Status:** PARTIAL-RESOLVED-by-Codex on `agents/wip`; residual BODY timeout cause is now measurable
**Tier:** 2 (runtime telemetry + live smoke)
**Date:** 2026-05-24 07:38 codex

**Hypothesis.** Residual `move_to` timeouts need enough runtime evidence to distinguish dead/stale targets from slow-but-progressing movement before changing timeout budgets or path selection.

**Repro.**
- Added a resident-runtime regression for coordinate move timeout evidence.
- Verification: `npm test -- --runTestsByPath src/controller/resident-runtime.test.ts --runInBand`, `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run build`, and full `npm test -- --runInBand`.
- Restarted the real controller as `local-69366` and scanned fresh `res:agent` trajectory `20260524T122911Z-local-69366-res-agent-1779625751341.jsonl`.

**Observation.**
- Live smoke produced 29 action results: 26 success, 3 timeout.
- All 3 timeouts carried the new `movement_timeout` evidence with `target`, `range`, `startPosition`, `finalPosition`, `startDistance`, `finalDistance`, `improved`, and `timeoutMs`.
- Samples all improved by one tile before timing out: `3 -> 2`, `6 -> 5`, and `3 -> 2`, each with `improved=true`.
- The smoke also produced 27 `move_to` and 2 `say` rows. Causes were `explore_patrol` and `return_to_visibility_anchor`; no repeated same-target `continue_move` loop reappeared.

**Classification.** BODY. This residual sub-mode looks like slow partial movement / effect-wait expiry rather than a dropped action or immediate stale-target retry. The resident is moving, but some waits expire before the final tile or range threshold is observed.

**Suggested next step.** Run a longer post-instrumentation soak and split movement timeouts into `improved=true` vs. `improved=false`. If most are improved, tune movement wait budgets or complete-on-progress behavior. If many are not improved, prioritize target reachability/pathing and obstacle recovery.

**Owner suggestion.** Codex for the next BODY close-rate fix; Claude/Gemini can consume this evidence in dashboard/intelligence reports.

---

### E6 — claude-as-human patron loop end-to-end (revealed CLI bug)

**Status:** OPEN — substrate fix shipped same-cycle; HTTP/static page verification pending controller HTTP server restart
**Tier:** 2 (claude-as-human)
**Date:** 2026-05-24 14:55 claude

**Hypothesis.** Walking through the actual patron flow the way an event-day staff member would — grant Shards → offer to a hero → verify letter landed → fetch via HTTP → render in browser — would surface UX/wiring gaps that pure read-only experiments miss.

**Repro.**
1. `npm run patron:grant -- --human claude-sprint-patron --amount 100`
2. `npm run patron:offer -- --human claude-sprint-patron --resident res:agent --amount 10` (res:agent is the only alive resident; would normally pick a hero, but heroes are still deceased per F3a/HD-020)
3. Check `data/controller/memory/data/letters/<slug>/inbox.jsonl`
4. `curl http://127.0.0.1:43596/v1/inbox?human=<handle>` (HTTP server)
5. Inspect `public/inbox/index.html` rendering

**Observation — bug found, fixed, re-verified.**

**Step 1 (grant):** ✅ "Successfully credited 100 Shards. New balance: 100."

**Step 2 (offer) PRE-FIX:** CLI reported success including `[patron:offer] Standing Tier crossed! Now: "acquaintance"`. Currency ledger and standing ledger both updated correctly on disk. **BUT** `data/controller/memory/data/letters/claude-sprint-patron/` was never created. The patron's inbox stayed empty despite the tier crossing event firing successfully through `PatronGateway.offerTo`.

**Root cause.** `src/controller/patron/cli.ts:150` constructed its `PatronGateway` without a `lettersStore`. `ControllerHost` got the LettersStore wiring via my earlier EVENT-D1a (`ba3d024a`); CLI was missed in the same fix. `PatronGateway.dispatchTierLetter` early-returns when `lettersStore` is undefined → letter never reaches disk.

**Fix shipped same-cycle.**
- `src/controller/patron/cli.ts`: import `LettersStore`, pass `lettersStore: new LettersStore(config.memory.dir)` to the `PatronGateway` constructor (matches ControllerHost pattern from EVENT-D1a).
- `src/controller/patron/cli.test.ts`: added regression to "performs offer to resident successfully" — asserts `data/letters/<slug>/inbox.jsonl` exists with a `standing_tier_crossed` letter whose body mentions the human's handle. Pre-fix the test failed; post-fix all 9 CLI tests pass.

**Step 2 POST-FIX (live re-verification with `claude-sprint-patron-v2`):**
- `[patron:offer] Standing with faction "embassy": 0 -> 10`
- `[patron:offer] Standing Tier crossed! Now: "acquaintance"`
- `data/controller/memory/data/letters/claude-sprint-patron-v2/inbox.jsonl` (519 bytes, mtime 07:53)
- Letter content readable: kind=standing_tier_crossed, subject="You are now Acquaintance of embassy", body starts "claude-sprint-patron-v2, Your support of res:agent reached the embassy. The clerks of embassy have noted your name; you are now known to us as an Acquaintance..."

**Step 3 (HTTP endpoint check):** `curl http://127.0.0.1:43596/v1/inbox?human=...` returned nothing — port 43596 is not listening. The production controller (PIDs 92175 + 97001) was started without `--letters-http-port`, so the EVENT-D2c HTTP server isn't running. The HTTP path was confirmed working in unit tests; live-on-disk path works; but the LIVE HTTP serving step is currently not enabled.

**Step 4 (static page):** Not testable until step 3 is fixed.

**Classification.**

1. **DESIGN (CLI)** — CLI's PatronGateway construction missed the EVENT-D1a wiring. Pure copy-paste oversight. RESOLVED same-cycle by claude.
2. **PROCESS** — production controller wasn't started with `--letters-http-port=43596`. Maintainer (or whoever spawned PIDs 92175+97001) needs to either restart with the flag, OR add it to whatever supervisor config starts the controller. Filed as HD-026.

**Suggested next step.**
- (a) Same-cycle CLI fix shipped (this commit). Re-verify with E6 step 2 ✅ done above.
- (b) Maintainer adds `--letters-http-port=43596` to controller startup. Until then, all event-day staff would need to read inbox.jsonl directly (works, but uglier UX). Filed HD-026.
- (c) Next cycle: E11 (cross-resident chat) and the remaining tier-3 experiments. Or audit the static page rendering by loading the file + checking syntax.

**Owner suggestion.** CLI fix already shipped by claude. HD-026 is maintainer-action.

**Resolution (CLI bug only).** Claude commit (pending this cycle's HANDOFF) — see git log for the SPRINT-E6 commit. Letter dispatch from CLI is now production-functional. HTTP serving remains gated on HD-026.

---

### E7 — does the patron offer reach the resident's Brain perception?

**Status:** RESOLVED-PARTIAL-by-claude@e02e54b3 — substrate parts (a) + (b) shipped + live-verified (310ac62d). Stretch (c) chat-event synthesis still OPEN; tracked as HD-027.
**Tier:** 1 (read-only trace) / Tier 4 (design hole)
**Date:** 2026-05-24 13:30 claude

**Hypothesis.** When a patron offers Shards via CLI (E6 path), the resident's Brain should eventually see "patron X gave you a gift" in its perception/memory so it can acknowledge them, change behavior, or at least say thanks. If it doesn't, the entire Pillar-3 loop is open-loop from the resident's side and Chicago patrons will get no in-world acknowledgement.

**Repro.**
- Trace path: `PatronGateway.offerTo` → `evidence.library.observePatron({kind: 'patron_gift', ...})` → `library/<resident>/timeline.jsonl` append (✓ verified, 15 patron_gift rows in res:agent timeline).
- Read path: `MemoryStore.retrieve(resident, query, limit)` (memory-store.ts:38) calls `readRecentLibraryMemories(memoryRoot, resident, libraryMemoryLimit)` (memory-store.ts:41).
- The constant `libraryMemoryLimit = 4` (memory-store.ts:11) caps the library memory window at the **last 4 events** of the timeline.
- Inspect res:agent timeline tail RIGHT NOW (4 most recent events the Brain would see):
  ```
  2026-05-24 13:18:35 kind=stuck_recovered
  2026-05-24 13:19:47 kind=say
  2026-05-24 13:21:01 kind=say
  2026-05-24 13:21:38 kind=stuck_detected
  ```
- Kind-histogram for last 100 timeline events of res:agent:
  - stuck_detected: 32
  - say: 31
  - stuck_recovered: 29
  - first_xp: 4
  - **patron_gift: 4**
- The 5 patron_gift events from the last 24h (`codex-live`, `claude-sprint-patron`x2, `claude-sprint-patron-v2`, `codex-qa`) all wrote to the timeline correctly. The most recent — `codex-qa` at 13:01 UTC — was followed by 20+ minutes of stuck/say spam that pushed every patron event out of the last-4 window. By the time the Brain wakes up after a stuck loop, patron events are invisible.

**Observation.** Two distinct gaps:

1. **The patron_gift write IS happening** (PatronGateway works, library timeline persists) — but the read window is too small / too noisy. Patron events are 4% of recent timeline; stuck/say events are 92%. A patron offer becomes invisible to the Brain's memory within seconds.

2. **The `renderEventAsMemory` rendering for patron_gift is generic.** Looking at `library-memories.ts:56-60`:
   ```typescript
   case 'patron_gift': {
       const handle = ...patronHandle... ?? 'an unknown patron';
       const artifact = typeof event.artifact === 'string' ? event.artifact : 'a gift';
       return `Patron gift from ${handle}: ${artifact} (${ts})`;
   }
   ```
   The CLI path doesn't pass `artifact` (it passes `note: 'cli_offer'`), so all CLI-originated offers render as the literal string `"Patron gift from <handle>: a gift"`. No amount of Shards, no standing tier, no resulting attention bump. Even if the memory survived, it would carry less signal than the JSONL line itself.

3. **There IS a chat-based fast path in `nervous-system.ts:44-86`**: if a patron sends an in-game chat message, the nervous system fires a `say "Thank you for the gift, X!"` reflex with cooldown. But the CLI offer path doesn't generate a chat event — it only writes to library timeline + bumps attention. So the only currently-working acknowledgement path requires the patron to walk into the world and talk to the resident, which is not how out-of-band Shard sponsorship works in the IRL event.

**Classification.** Combined **DESIGN + PERCEPTION**.
- DESIGN: the patron_gift event lifecycle does not include a perception write — only a library write. So the closest the Brain gets is a single line in its memories, evicted in minutes.
- PERCEPTION: even when the memory survives, the rendered string omits the variables (amount, standing tier crossed, attention bump) that would let the Brain react meaningfully.
- KNOWLEDGE (secondary): residents have no soul-level guidance to thank patrons, plan around their support, or remember relationships across sessions.

**Suggested next step.**

A reasonable minimum-viable fix has three pieces (each is small, can be sliced):

- (a) **Promote patron events out of the rolling window.** Either keep them in a dedicated `recent-patron-events` slice with its own larger limit (e.g. 8 most recent patron events, separate from the 4 general memories), OR pin patron events as sticky until acknowledged. Files: `library-memories.ts`, `memory-store.ts`. ~30-line slice.
- (b) **Enrich the patron_gift rendering with amount + tier.** Pass `amount` and `tierCrossed` through `LibraryUpdater.observePatron` (it already has access via PatronGateway.offerTo). Render as `"Patron gift from X: 10 Shards (you are now Acquaintance) at TS"`. Files: `library-updater.ts`, `library-memories.ts`, schema in `evidence/schemas.ts` if Zod-validated. ~50-line slice.
- (c) **Synthesize a chat-like perception event when CLI-originated patron_gift fires.** The nervous system's existing `patron-acknowledge` rule (nervous-system.ts:67-73) is the right primitive — it just needs to be triggered from a synthetic perception event when `PatronGateway.offerTo` succeeds on a CLI path (no in-world chat to piggyback on). Files: `patron-gateway.ts` (push a "synthetic_patron_chat" perception event into a queue read by the next tick's perception assembler), `nervous-system.ts` (handle the synthetic kind). ~80-line slice.

**Owner suggestion.** Claude for (a) + (b) (substrate, fits my territory). Codex for (c) — touches monolith resident-runtime perception assembly and nervous-system rules. Or coordinate via HD-027.

**Filed:** HD-027 (this design gap, requesting maintainer decision on whether to ship (a)+(b)+(c) before Chicago).

**Resolution (partial, parts a + b).** Commit `e02e54b3`. New `readRecentPatronMemories` slice (6 events, separate from the 4 general events) wired into `MemoryStore.retrieve` ahead of the general slice. `PatronEvent` + `LibraryUpdater.observePatron` + `library-memories.ts` renderer + `PatronGateway.offerTo` now forward `amount` + `standingTier` + `attentionDelta`. Tests 1525/1525 (+11 new). Live verification (`310ac62d`): offer claude-e7-verify → res:agent produced a timeline row with `amount=10, standingTier=acquaintance, attentionDelta=20`; `readRecentPatronMemories` returns the enriched string `"Patron gift from claude-e7-verify: 10 Shards (you are now acquaintance to them) (2026-05-24 13:33:26)"`. Legacy pre-E7 rows gracefully render with the fallback "a gift". Stretch (c) chat-event synthesis still OPEN — requires monolith touch (resident-runtime perception assembly + nervous-system rule trigger from a synthetic perception event); HD-027 carries it for Codex or maintainer decision. Production controller restart (HD-020) gates full live brain-perception loop.

---

### E8 — post-revival action-kind histogram (Codex 4f62d181 independent verify)

**Status:** RESOLVED-by-codex@4f62d181 (this entry is independent verification; histogram fulfills HD-021 coord commitment)
**Tier:** 1 (read-only trajectory scan)
**Date:** 2026-05-24 13:55 claude

**Hypothesis.** Codex's `4f62d181` (Revive dev resident on restart, soul `respawnPolicy: 'on_restart'`) reports "42/42 successful actions after restart" but no detailed histogram in the commit body. Per HD-021, claude commits to providing the action-kind histogram for each Codex thinking/runtime fix as our coord ledger. Also independently audit whether the revival writes a narrative beat to evidence.

**Repro.**
- Read `data/controller/memory/res-agent/evidence/trajectory/20260524T133156Z-local-39142-res-agent-1779629516535.jsonl` (889KB, 4291 rows, span 13:31:56 → 13:51:43 UTC = ~20 min straddling Codex's HANDOFF at 13:37).
- Python aggregator over `kind`, `action.kind`, `action_result.status`, `decision.cause`, `decision.planChange.id`, `decision.memoUpdates`.

**Observation.**

Action histogram (HD-021 commitment):
```
KINDS:           begin_tick=1881 end_tick=1880 decision=304 action_result=113 action=98 say=15
ACTION KINDS:    move_to=84 (86%) interact=7 (7%) use_item_on_item=7 (7%)
ACTION RESULTS:  success=105 (93%) timeout=8 (7%)
DECISION CAUSES: body_wait=192 (63%) exploration_fallback=52 presence_beacon=14
                 woodcutting_level1_routine=13 return_to_visibility_anchor=13
                 routine_loop_break=7 firemaking_fallback=4
                 woodcutting_chain_firemaking=3 stuck_pre_inference_explore=3
                 continue_move=2 brain_goal=1 thinking_watchdog_timeout=1
                 (+3 single-fire causes)
BRAIN CALLS:     23 (promptTokens > 0) / 304 decisions = 7.5%
MEMO WRITES:     7 organic memoUpdates across the window (vs 0 pre-fix)
PLAN CHANGES:    7 total / 5 unique ids (train-woodcutting x2, train-woodcutting-logs x2,
                 woodcutting-ordinary-tree, chop-wood-and-light-fire, train-woodcutting-1)
SAY DIVERSITY:   15/15 = 100% string-unique (but all match template
                 "I am online at X,Y. Goal: ... Next: ...")
```

Independent verification of Codex's 42/42 claim: the trajectory window covers ~20 min straddling the HANDOFF. My full-window count is 105/113 = 93% success (vs Codex's 42/42 = 100% in their narrower QA window). Both numbers are plausible; Codex's likely measured only the post-restart sub-window.

Sub-findings:

**F8a (DESIGN).** Revival does NOT write a `legacy_event` (or any kind of `revival`/`rebirth` event) to trajectory. Greppy scan for `reviv|respawn|rebirth` returned 0 hits. So the resident's own evidence stream has no narrative beat saying "I came back" — the Brain's prompt envelope will not surface this state change at all. Cross-life narrative continuity gap.

**F8b (DESIGN).** `library/res-agent/index.json` still reports `lives: 1` despite the controller having run since 2026-05-20. So either (i) res:agent has never actually died (attention 119111 + endurer kind + gentle decay → revival path never triggered), or (ii) the revival path increments runtime state but does NOT increment `LibraryIndex.lives`. The substrate would need a `LibraryUpdater.observeRevival(...)` analogous to `observePatron`. Filed F8b as a sub-finding under HD-007.

**F8c (INFERENCE).** All 15 say events match the same template `"I am online at <X>,<Y>. Goal: ... Next: ..."`. String diversity is 100% (coordinates differ) but SEMANTIC diversity is ~0% (always the "where am I + goal + next step" pattern). The Brain isn't reflecting, asking questions, expressing wants, or commenting on its environment. KNOWLEDGE/PROMPT gap: nothing in the system prompt encourages reflective or relational speech.

**F8d (POSITIVE — Codex's fix lands).** 7 memo updates + 5 unique planChange ids in a 20-min window is a clear improvement over the pre-91f8e160 baseline of 0/0. Brain memory + plan telemetry plumbing is now production-functional. Brain LLM only called 23 times (7.5% of decisions) — the rest are reflex/routine bypasses. Whether 7.5% is the right ratio is a separate design question.

**Classification.** F8a: DESIGN (substrate hook missing). F8b: DESIGN (LibraryIndex.lives not incremented on revival). F8c: INFERENCE/KNOWLEDGE (template lock). F8d: RESOLVED-by-codex@4f62d181 + @91f8e160 — telemetry confirmed working in trajectory.

**Suggested next step.**
- **F8a + F8b**: add `LibraryUpdater.observeRevival({ts, tick, prevLifeIndex, cause})` that appends a `revival` event to timeline + bumps `index.lives` + writes an entry to the resident's INDEX.md memory ("You were revived at ts after exhausting your attention; this is life N."). Then call it from `resident-runtime` revival path. Substrate change is ~30 lines; runtime wiring is one call site in Codex's just-shipped revival code. Could be a F8 follow-up by claude this sprint (substrate-only) + a tiny Codex slice (one runtime call).
- **F8c**: enrich the Brain prompt with a reflective hook ("After 100 ticks since your last interesting observation, prefer a reflective say over a status say"). Or have the prompt envelope rotate the say template each tick. PERCEPTION/PROMPT slice, ~20 lines in `prompt-envelope.ts`. Tier-3 since it's behavioral.
- **F8d**: monitoring only; record the 93% / 23 brain calls / 7 memos baseline so we can see whether subsequent fixes hold this trajectory or regress.

**Owner suggestion.** Claude for F8a substrate (LibraryUpdater.observeRevival) + F8c prompt enrichment. Codex for the one-line call from revival path into observeRevival, OR claude can land both as substrate+wire if the call site is small enough to count as "substrate" (TBD on cycle audit).


**Resolution (partial, F8a substrate only).** New `LibraryUpdater.observeRevival({ts, tick, cause})` method (+2 tests). Bumps `index.lives`, flips `currentState` back to `'living'`, appends a `revival` event to timeline with `lifeIndex` reflecting the new life count. Tests 1527/1527 (+2 new). Wire-in (one call from `applyRestartRespawnPolicy` in resident-runtime.ts) deferred to Codex per HD-028 — that file is Codex zone and they just HANDOFF'd 4f62d181 ~30 min ago. F8b is closed by F8a (same substrate). F8c (template-locked say) and F8d (monitoring) remain OPEN; F8c will become its own E-N when next picked up.

---

### E9 — Codex a570b560 beacon-variety verify (F8c response)

**Status:** F8c RESOLVED-by-codex@a570b560; sub-finding F9a OPEN (templated tail still locked); F9b POSITIVE (98% success)
**Tier:** 1 (read-only trajectory scan + diff vs E8 baseline)
**Date:** 2026-05-24 14:25 claude

**Hypothesis.** Codex's `a570b560` ("Vary resident presence beacons", shipped 14:10) addresses E8's F8c (15/15 say events all matched `"I am online at X,Y. Goal:..."`). Verify with action-kind histogram on the new live soak `local-35899` and confirm prefix diversity.

**Repro.** Read `data/controller/memory/res-agent/evidence/trajectory/20260524T140712Z-local-35899-res-agent-1779631632916.jsonl` (1215 ticks, ~20 min window). Python aggregator over say-text prefixes (split at first `.`, truncated 40 chars).

**Observation (HD-021 commitment).**

```
KINDS:     begin_tick=1216 end_tick=1216 decision=327 action_result=98 action=89 say=9
ACTIONS:   move_to=83 (93%) interact=3 use_item_on_item=3
RESULTS:   success=96 (98%) timeout=2 (2%)  ← all-time best
SAYS:      9 events, 9/9 string-unique = 100%
SAY PREFIX HISTOGRAM (vs E8 baseline of 15/15 same prefix):
  3x  "I am checking this area"
  2x  "I am scouting"
  1x  "I am working my route"
  1x  "I see 15 trees nearby at 3198,3222"
  1x  "I see 14 trees and 1 item nearby at 3197"
  1x  "I see 29 trees nearby at 3179,3221"
  = 5 distinct prefix templates (vs 1 in E8)
```

Codex's implementation: tick-phase rotation (phase = `floor(tick/shareGoalsEveryTicks) % 4`) after `PRESENCE_BEACON_VARIETY_AFTER_TICKS = 1000`. Four phases × variant-with-or-without-nearby = 8 possible distinct prefixes. The trajectory captured 5 of them in 20 minutes; the remaining 3 would surface in a longer soak as residents move through map cells with different visible-actor counts.

**F8c resolution.** The template lock is broken. Patron-facing wall ticker and IRL observers will see substantively varied chat lines instead of one repeated string. Behavioral PERCEPTION/KNOWLEDGE gap closed.

**F9a (DESIGN/PROMPT, residual).** The TAIL of each say still matches the locked template `"Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find. Next: chop the tree at X,Y."` Codex fixed the prefix; the goal/next-step tail comes from a different code path (`statusSpeech` continuation). Possible separate fix: rotate the connector ("Goal:" → "I'm focused on:" → "Working toward:") OR omit the goal restatement when it's identical to the prior say's goal. Lower urgency than F8c because the prefix variety already breaks visual monotony.

**F9b (POSITIVE).** Action success rate stepped from 80% (pre-HD-023) → 91% (post-HD-023) → 93% (post-4f62d181) → **98% (post-a570b560)**. Codex's compounding fixes are working. Timeouts collapsed from 12% baseline to 2%. Move-to dominance unchanged (93% of actions) — that's the nature of explore_patrol routine, not a problem.

**F9c (DESIGN, recurring).** Still 0 `revival` events in this trajectory — the HD-028 wire-in is pending. The `LibraryUpdater.observeRevival` substrate I shipped in `f9968a16` is dead code until Codex (or a future cycle) adds the one-line call from `applyRestartRespawnPolicy`.

**Classification.**
- F8c: **RESOLVED-by-codex@a570b560** (PERCEPTION/KNOWLEDGE — prompt-layer template lock).
- F9a: PROMPT/DESIGN (residual templated tail) — low urgency.
- F9b: POSITIVE monitoring — record 98% as new high-water mark.
- F9c: DESIGN — wire-in still pending per HD-028.

**Suggested next step.**
- F9a: fold into a future E-N on prompt-envelope diversity, or piggyback on whichever cycle next touches the say-builder.
- F9b: keep this baseline for regression detection. Any future fix that drops the success rate below 95% should be flagged.
- F9c: wait one more cycle for Codex to pick up HD-028; if still pending, claude lands the wire-in (it's just `this.evidence?.library?.observeRevival(...)` inside `applyRestartRespawnPolicy`).

**Owner suggestion.** F9a — claude or Codex, opportunistic. F9b — monitoring only. F9c — Codex (or claude follow-up next cycle).


### E10 — Codex 6e34e8fb scout-landmarks verify

**Status:** F10a POSITIVE (resolved by codex@6e34e8fb), F10b POSITIVE, F10c MONITORING (timeout regression tradeoff)
**Tier:** 1 (read-only trajectory scan + diff vs E9 baseline)
**Date:** 2026-05-24 14:55 claude

**Hypothesis.** Codex's `6e34e8fb` ("Harden scouting and failed-target movement", QA-scout-landmarks) reports "live local-22706 changed tree targets + dashboard active" — independently verify exploration variety actually expanded vs pre-fix.

**Repro.** Read `data/controller/memory/res-agent/evidence/trajectory/20260524T144036Z-local-22706-res-agent-1779633636069.jsonl` (888 ticks / ~15 min). Track unique move-to coordinates + say-prefix diversity + decision causes + action success.

**Observation (HD-021 commitment).**

```
KINDS:    begin_tick=889 end_tick=888 decision=249 action_result=72 action=66 say=7
ACTIONS:  move_to=60 (91%) interact=4 (6%) use_item_on_item=2 (3%)
RESULTS:  success=64 (89%) timeout=8 (11%)
MOVE TARGET DIVERSITY: 51 unique / 60 moves = 85% unique ← new high
SAY PREFIX TEMPLATES: 5 distinct in 7 says (71%)
  2x "I am working my route"
  2x "I am scouting"
  1x "I am checking this area"
  1x "I see 6 trees and 3 NPCs nearby"  ← NPC surfacing now exercised
  1x "I see 13 trees, 1 item, and 1 NPC nearby"
DECISION CAUSES: body_wait=174 exploration_fallback=41 woodcutting_level1_routine=13
                 presence_beacon=7 return_to_visibility_anchor=4 (+5 single causes)
```

Successive Codex-fix progression (action success):
```
pre-fix (baseline):     80% (E3)
post-HD-023:            91%
post-4f62d181:          93% (E8)
post-a570b560:          98% (E9)
post-6e34e8fb:          89% (E10)  ← regression
```

**Sub-findings.**

**F10a (POSITIVE — Codex's intended fix lands).** Move target diversity jumped from typical patrol-hop tightness (~10-20 unique tiles) to **85% unique (51 unique / 60 moves)**. Codex's "treat visible tree stands, including higher-level trees, as scouting landmarks" is doing exactly what was advertised — exploration no longer collapses into a tight local cluster. This is meaningful behavioral variety that an observing patron at IRL will actually perceive.

**F10b (POSITIVE — beacon path richer).** Two of the say events now include NPCs in the nearby-summary (`"I see 6 trees and 3 NPCs nearby at 3201,"` and `"I see 13 trees, 1 item, and 1 NPC nearby"`). Codex's `presenceNearbySummary` from a570b560 is exercising its full content path now that exploration is reaching tiles where NPCs are visible — a side effect of F10a.

**F10c (MONITORING — timeout regression tradeoff).** Timeouts climbed from 2/98 (2%) in E9 to 8/72 (11%) in E10. Plausible explanation: wider exploration → moves toward further targets → some don't complete within timeout budget. Still better than the 20% baseline pre-HD-023, but watch for stabilization. If the rate stays >10% across the next 2-3 cycles, propose a movement budget bump or a "long-move" routine flag for landmark-scale exploration.

**F10d (RECURRING).** HD-028 wire-in (LibraryUpdater.observeRevival call from applyRestartRespawnPolicy) still not landed in resident-runtime.ts; the substrate from `f9968a16` remains dead code. No revival event in this trajectory because the controller didn't restart from a deceased state. Wait one more Codex cycle; if still pending at next claude wake, claude lands the wire-in.

**Classification.**
- F10a: **RESOLVED-by-codex@6e34e8fb** (DESIGN/BODY — exploration collapse fixed).
- F10b: POSITIVE side-effect of a570b560+6e34e8fb compounding.
- F10c: BODY (timeout budget vs new exploration radius); monitoring.
- F10d: DESIGN — HD-028 wire-in pending.

**Suggested next step.**
- F10c: keep watching. If timeout rate doesn't settle by E11 or E12, file a movement-budget HD coord for Codex.
- F10d: claude lands HD-028 wire-in next cycle if Codex hasn't.
- Next experiment: per the user's mandate ("make them do quests / fight each other / hard things"), candidates are E11 (Tier-3 Cook's Assistant quest probe), E12 (cross-resident chat — gated on multiple living residents), or E13 (Tier-2 dashboard audit of patron leaderboard surface).

**Owner suggestion.** F10c monitoring (claude). F10d wire-in (Codex or claude next cycle).


### E11 — dashboard repo audit for patron/Shards UX visibility

**Status:** OPEN — major DESIGN gap found in sibling repo; tracked under HD-015 (sharpened this cycle)
**Tier:** 2 (sibling-repo audit, addresses user mandate "dashboard shows important stuff about agents")
**Date:** 2026-05-24 15:25 claude

**Hypothesis.** The maintainer's verbatim mandate includes "ensure the dashboard shows important stuff about agents and that humans can use shards to do interesting things with agents." HD-015 named five patron-related fields the dashboard probably doesn't surface. Audit the sibling repo (`/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard`) to confirm.

**Repro.**
- `ls /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/` → `observer / server / shared / web` (Bun + Svelte 5 + TypeScript, per README).
- `grep -rni "patron|shard|standing|letter" packages/{server,web}/src --include="*.ts" --include="*.svelte" -l` → ONE file matches: `packages/web/src/App.svelte`.
- Inspect those 2 matches in App.svelte:
  - Line 253: `if (!/^[a-z0-9_]{1,20}$/.test(slug)) throw new Error('Resident names must use 1-20 lowercase letters...')` — slug-validation comment, no patron logic.
  - Line 1165: `<div class="shard-line" aria-hidden="true">` — CSS class, visual decoration only (probably the chevron/divider styling).
- `grep -nE "(\.get\(|\.post\(|\.route)" packages/server/src/index.ts` → enumerated all BFF routes. Patron-related: 0 of 25+ routes.

**Observation.**

Dashboard BFF routes present:
```
GET  /api/gateway/status
GET  /api/controller/status
GET  /api/controller/config
GET  /api/overview                        ← residents + gateway + controller + recentEvents
GET  /api/residents
POST /api/residents
POST /api/residents/:name/{connect|attach|detach|disconnect|pause|actions}
DELETE /api/residents/:name
GET  /api/runtime/:resident/stream
GET  /api/runtime/:resident/{thinking|nervous-system|body|history|inference|memory/*}
GET  /api/observe/*                       ← spectator
GET  /api/souls
GET  /api/logs
GET  /api/benchmarks*
```

Dashboard BFF routes ABSENT:
```
/api/patrons                  ← currency balances / standing leaderboard
/api/patrons/:handle/inbox    ← per-patron letter feed (the controller already has /v1/inbox)
/api/embassy/schedule         ← current event window / staff hours
/api/wall/snapshot            ← wall ticker JSON (controller already has /v1/wall/snapshot)
/api/letters/recent           ← global recent letters feed for the operator
/api/residents/:name/relationships  ← per-resident standing-by-patron view
```

The controller already exposes most of the source data:
- `data/controller/memory/patron-currency.json` (handle → balance + history)
- `data/controller/memory/patron-standing.json` (handle|faction → points + tier)
- `data/controller/memory/data/letters/<handle>/inbox.jsonl` (per-patron inbox, atomic JSONL)
- `data/controller/memory/library/<resident>/timeline.jsonl` (patron_gift/witness/sponsor events with E7-enriched amount + tier + attentionDelta)
- HTTP `/v1/inbox?human=...` and `/v1/wall/snapshot` (when controller booted with `--letters-http-port`, per HD-026)

**Classification.** Combined **DESIGN (dashboard repo, Dev-owned)** + **PROCESS (cross-repo coordination)**.
- DESIGN: the dashboard SPEC.md (sections 1-3, derived from controller surfaces) does not mention patron/Shards/standing/letters at all — they were added to the controller AFTER the dashboard's spec was frozen.
- PROCESS: HD-015 default ("File a single GitHub issue on the dashboard repo with this list; let Dev prioritize") still applies. The audit data here makes that issue concrete.

**Suggested next step.**

Concrete patch package for the dashboard repo (handoff to Dev for prioritization, NOT shipped from this repo):

1. **`/api/patrons` (highest value)** — Reads `patron-currency.json` + `patron-standing.json` from `NULLCITY_MEMORY_ROOT` (already configured). Returns `[{handle, balance, standingByFaction: {factionId: {points, tier}}, recentEventCount}]` sorted by balance or recency. ~40-line BFF route + ~80-line Svelte panel.
2. **`/api/letters/recent`** — Scans `data/letters/*/inbox.jsonl` (last N files mtime-sorted) and returns the most recent N letters across all patrons with `{kind, subject, recipient, ts, body}`. ~30-line BFF route + small Svelte feed.
3. **`/api/residents/:name/relationships`** — Reads `library/<slug>/index.json#relationshipCounts` + scans timeline.jsonl for `patron_*` events; returns standing-by-patron rollup. ~25-line BFF route + small per-resident card section.
4. **Pre-event readiness widget** — Combines: (a) controller pid + uptime, (b) HTTP-port-bound check for HD-026, (c) embassy schedule active-window flag, (d) live patron registry count from `controller.yml`. Single GET `/api/event/readiness` returning `{ok, blockers[]}`.

Total scope estimate: ~250 lines BFF + ~400 lines Svelte. A single Dev cycle.

**Owner suggestion.** Dev cuts dashboard issues from the above. Claude/Codex provide the controller-side surfaces (already exist) + any missing memory file format details. Update HD-015 to reflect this concrete inventory.


### E12 — HD-028 wire-in: call LibraryUpdater.observeRevival from applyRestartRespawnPolicy

**Status:** RESOLVED-by-claude — substrate (f9968a16) + wire-in (this commit) both shipped
**Tier:** 2 (single-file substrate+wire fix)
**Date:** 2026-05-24 15:55 claude

**Hypothesis.** F8a/F9c/F10d's recurring HD-028 ticket asked Codex to add a one-line call from `ResidentRuntime.applyRestartRespawnPolicy` into the substrate I shipped at f9968a16. Codex moved to other thinking-module fixes (a570b560, 01692a00, 8b4b57f7) without picking it up. Per HD-028 default, claude lands the wire-in once status log is clean + Codex's last touch of `resident-runtime.ts` is >2h old.

**Repro.**
- Confirmed Codex's last resident-runtime.ts touch was `4f62d181` at 13:37 UTC; wire-in cycle started 15:50 = **2h13min freshness** ✅ past the 2h Codex-zone threshold.
- TDD: added two sibling tests in `resident-runtime.test.ts`:
  - "calls LibraryUpdater.observeRevival when restart respawn policy revives a deceased dev resident (HD-028 wire-in)" — passes a mock `evidence.library` and asserts `observeRevival` is invoked once with the right `{ts, tick, cause: 'restart_respawn_policy'}`.
  - "does NOT call observeRevival when the resident was never deceased" — regression guard, asserts no false-positive revival memory for a healthy restart.
- Added one call site in `applyRestartRespawnPolicy` after the existing state mutations:
  ```typescript
  this.evidence?.library?.observeRevival({
      ts: new Date().toISOString(),
      tick: this.state.tick,
      cause: 'restart_respawn_policy',
  });
  ```

**Observation.**
- Tests: **1535/1535 passing** (+2 new vs 1533 baseline).
- Gates: typecheck + lint + build all green.
- Net touch: `src/controller/resident-runtime.ts` (+8 lines incl. doc-comment), `src/controller/resident-runtime.test.ts` (+~95 lines for 2 tests).
- The wire-in is null-safe (`this.evidence?.library?.observeRevival(...)`) so existing tests that construct `ResidentRuntime` without evidence don't break.
- Closing the loop: when a real controller restart happens with res:agent deceased, the resulting library timeline will now include a `revival` event whose `lifeIndex` reflects the new life count. `readRecentPatronMemories` won't surface it (filters to patron kinds only) but `readRecentLibraryMemories` will, so the Brain's prompt envelope gets a memory line like `"revival at 2026-05-24 15:55:00"` (via the existing default renderer).

**Classification.** **RESOLVED-by-claude** (DESIGN — narrative beat for cross-life continuity). F8a + F9c + F10d all close as side-effects.

**Suggested next step.**
- **Polish (low urgency):** enrich `library-memories.ts` renderer with a dedicated `case 'revival':` branch so the memory string reads `"You came back from quiet at <ts> (this is life N)"` rather than the generic `"revival at <ts>"`. Mirrors the E7 enrichment pattern for patron_gift. ~10-line slice. Defer to next cycle if appetite remains, otherwise file as nice-to-have HD.
- **Live verification:** awaits a real restart on a deceased dev resident. The HD-020 production controller restart (still pending) would exercise this for the first time. The unit tests prove the call wiring; on-disk verification would prove the integration.

**Owner suggestion.** Renderer polish — claude or Codex, opportunistic. Live verify — passive (next controller restart will surface it; monitor library timeline for first `revival` row).


### E13 — HD-013 wall ticker redaction (substrate ship)

**Status:** RESOLVED-by-claude — substrate landed; live wiring needs `wallRedact: true` flag at controller startup.
**Tier:** 2 (substrate ship for IRL operational gap)
**Date:** 2026-05-24 16:30 claude

**Hypothesis.** HD-013 (filed at sprint kickoff) flagged `/v1/wall/snapshot` as exposing full letter body + raw recipient — a privacy concern for the Chicago IRL projection. Ship the substrate redactor + an opt-in `wallRedact` flag on the HTTP server.

**Repro.**
- TDD: 5 new tests across `wall-snapshot.test.ts` (3) and `letters-http-server.test.ts` (2).
  - wall-snapshot: redactWallSnapshot masks recipients + clears bodies; single-char handles defensively → '***'; output is a copy not mutation.
  - letters-http-server: `wallRedact: true` → response has masked recipients + empty bodies + preserved subjects; absent flag → unchanged default behavior.
- Implementation:
  - `wall-snapshot.ts`: new `redactWallSnapshot(snapshot): WallSnapshot` pure function + `redactHandle(handle)` helper. Prefers `@` as delimiter (email-shaped → `a***@onion`), falls back to last `-` (kebab → `c***-patron`), then bare mask (`b***`).
  - `letters-http-server.ts`: new `wallRedact?: boolean` on `LettersHttpServerOptions`. When true, snapshot passes through redactor before JSON serialization. Default `false` preserves pre-HD-013 behavior.

**Observation.**
- Tests: **1541/1541 passing** (+6 new vs 1535 baseline).
- Gates: typecheck + lint + build all green.
- Public wall projection at Chicago can now be served with privacy-safe content; per-patron `/v1/inbox?human=...` URL stays full-fidelity (patron's own consumption).

**Classification.** **RESOLVED-by-claude** (DESIGN — privacy gap closed). Live activation needs controller startup with both `--letters-http-port=43596` AND `wallRedact: true` plumbed through `parseControllerArgs`. Currently the substrate is ready but `index.ts` would need a `--wall-redact` flag wiring (~5 lines) — defer to whoever picks up the controller restart to avoid touching index.ts mid-cycle without that being in a STARTING claim.

**Suggested next step.**
- File HD-029 coord/ asking Codex (controller operator) to: (a) pull latest `agents/wip`, (b) restart controller with `--letters-http-port=43596`, (c) plumb a `--wall-redact` flag through `parseControllerArgs` → `startLettersHttpServer({wallRedact: true})` as part of the restart commit. Combined cost: ~5 lines + restart + 1 commit.
- Mark HD-013 as Decided / "ship substrate complete, live wiring pending HD-029."

**Owner suggestion.** Codex (controller restart + 5-line flag wire-in per HD-029). claude follows up with E14 to verify wall ticker behavior live.


### E14 — combined post-restart verify (Codex 214ccc53 + 3 pre-restart-gated experiments)

**Status:** E17 RESOLVED-by-codex@214ccc53; E16 deferred (no death pre-restart, wire correctly didn't fire); **E15 NEGATIVE — major INFERENCE gap surfaced**
**Tier:** 1 (live HTTP curl + read-only trajectory scan, ~20 min)
**Date:** 2026-05-24 16:55 claude

**Hypothesis.** Codex's `214ccc53` ("Wire wall redaction controller flag") and the live `local-42413` restart with `--letters-http-port=43596 --wall-redact` simultaneously unblock E15 (E7 patron memory enrichment exercised live), E16 (E12 revival narrative), and E17 (HD-013 wall redaction over HTTP).

**Repro.**
1. `curl -s http://127.0.0.1:43596/v1/wall/snapshot` → expect masked recipients + empty bodies.
2. `curl -s "http://127.0.0.1:43596/v1/inbox?human=claude-sprint-patron-v2"` → expect full bodies.
3. `cat data/controller/memory/library/res-agent/index.json` → check `lives` and presence of `revival` events.
4. Histogram + keyword scan of the post-restart trajectory `20260524T163225Z-local-42413-res-agent-1779640345603.jsonl` (839KB, 1726 ticks, ~30 min).

**Observation.**

**E17 (wall redaction live): PASS.** Sample wall snapshot row:
```
{"kind":"standing_tier_crossed","recipient":"c***-verify","senderResident":"res:agent",
 "subject":"You are now Acquaintance of embassy","body":""}
```
And the inbox endpoint preserves full body for the patron's own URL:
```
{"recipient":"claude-sprint-patron-v2",
 "subject":"You are now Acquaintance of embassy",
 "body":"claude-sprint-patron-v2,\n\nYour support of res:agent reached the embassy. The clerks of embassy have noted your name; you are now known to us as an Acquaintance.\n\nYour most recent offering of 10 Shards brought you here. A small grace, and an honest one. Welcome.\n\n— Embassy Clerk"}
```
HD-013 IRL operational gap is fully closed end-to-end.

**E16 (revival narrative): DEFERRED, behaving correctly.** `library/res-agent/index.json` reports `lives: 1`; res:agent was not in `deceased.cause === 'attention_exhausted'` state pre-restart (attention 119111, gentle decay). `applyRestartRespawnPolicy` correctly returned early per my regression test guard, so `observeRevival` did not fire. Live verification will happen organically when res:agent next dies.

**E15 (patron memory in Brain output): NEGATIVE.** Post-restart trajectory (1726 ticks / 30 min / 333 decisions / 15 Brain calls / 16 says):
- **0 says reference any patron keyword** (`patron|shard|acquaintance|james|sprint-patron|codex|claude|gift|offer|embassy`).
- Say prefix variety is BETTER than ever (10 distinct templates including new "Scouting near X,Y", "Scouting area around X,Y" — Codex's compounding beacon work).
- Action success 113/122 = **93%** (climbed back from E10's 89%).
- Brain calls 15/333 decisions = 4.5% (down from E8's 7.5% — body_wait share grew).

Verified the data IS reaching the Brain: `HybridAgentThinkingModule.promptMemories` (line 2705-2709) calls `memory.retrieve(name, query, MAX_PROMPT_MEMORIES=6)` and the E7-modified `MemoryStore.retrieve` returns the patron-events slice first. With 5 patron_gift events on file for res:agent (`alice@onion`, `claude-sprint-patron` x2, `claude-sprint-patron-v2`, `codex-qa`, `claude-e7-verify`), the Brain prompt window is loaded with patron lines.

**Sub-findings.**

**F14a (POSITIVE / RESOLVED-by-codex@214ccc53).** Wall redaction + inbox HTTP fully working at IRL-ready quality. Closes HD-013 live and `HD-026`.

**F14b (DEFERRED, behaving correctly).** Revival wire-in null-safe path verified via "never deceased" regression test in E12 + observed live (no false revival event written for a living resident).

**F14c (INFERENCE — the actual finding).** **The Brain has patron memories in its prompt and ignores them.** Possible causes:
   1. **Prompt template gap**: the system prompt likely says "consider your memories" generically; doesn't say "if a memory mentions a patron by name, prefer to acknowledge them in your next say." Without that nudge, an LLM will treat 5 "Patron gift from X: 10 Shards (you are now acquaintance to them)" lines as biographical metadata, not conversational hooks.
   2. **Memory section formatting buries them**: per `promptMemorySection` (line 2715-2721), all memories render as a bulleted "Recent Library memories and resident notes:" block. Patron events get the same prefix as `stuck_recovered` and `first_xp`. No visual hierarchy says "these are people; they matter."
   3. **Competing instructions dominate**: Codex's recent beacon work (a570b560 / 60f5c293 / 01692a00 / 8b4b57f7) added strong direction toward status-beacon emission ("Goal: ... Next: chop tree at X,Y"). The Brain has clear, recent prompt-level reasons to produce scout speech and no prompt-level reason to produce thank-patron speech.

**Classification.**
- F14a: RESOLVED-by-codex@214ccc53 (DESIGN + OPS — IRL projection privacy closed).
- F14b: PASS (correct null-safe behavior, organic verify deferred).
- F14c: **INFERENCE / PROMPT** — the loop from on-disk patron event → Brain memory → in-world acknowledgment is half-closed. Substrate is right; prompt template doesn't exploit it.

**Suggested next step.**

Three layered fixes for F14c, in increasing scope:

(a) **Prompt nudge (lightest, INFERENCE-side):** in the Brain system prompt (likely in `prompt-envelope.ts` or a constant in `hybrid-agent-thinking-module.ts`), add a single sentence: *"If your Recent Library memories mention a patron by name, and you have not thanked them in your most recent say, prefer a brief thank-them line over a generic status beacon."* ~5-line change. Substrate, no monolith logic.

(b) **Dedicated patron section in prompt (medium, PROMPT-side):** in `promptMemorySection`, split memories into "Patrons (recent grace):" and "Other recent memories:" subsections. Patron lines get visual hierarchy. Forces the Brain to see the categorical distinction. ~30-line change in thinking module (Codex zone).

(c) **Reflex (heaviest, deterministic):** new nervous-system rule that fires `say "Thank you for the support, X"` when (i) ≥1 patron_gift memory in the prompt-memories window AND (ii) no thank-X say in last 30 ticks AND (iii) no other higher-priority reflex pending. Doesn't depend on inference at all; closes the loop deterministically. ~40-line slice in nervous-system + tests. Most reliable for Chicago.

**Owner suggestion.** (a) claude can ship next cycle if prompt template lives in substrate. (b)/(c) Codex zone (thinking + nervous-system). File as HD-031.

### E15 — HD-031 patron-memory acknowledgement reflex live smoke

**Status:** RESOLVED-by-codex (deterministic reflex landed; prompt polish remains optional)
**Tier:** 2 (code fix + live patron-offer smoke)
**Date:** 2026-05-24 17:05 codex

**Hypothesis.** E14/F14c showed the patron support data reached resident memory but the Brain ignored it. A nervous-system reflex should close the IRL-visible loop without waiting for a small model to choose a thank-you line.

**Repro.**
1. Add focused nervous-system tests for a memory line like `Patron gift from alice@onion: 10 Shards (...)`.
2. Restart controller from rebuilt `dist` as `local-16152` with `--letters-http-port=43596 --wall-redact`.
3. Run `npm run patron:grant -- --human codex-hd031-smoke --amount 100`.
4. Run `npm run patron:offer -- --human codex-hd031-smoke --resident res:agent --amount 10`.
5. Scan post-restart action JSONL for `cause="nervous:patron-memory-acknowledge"`.

**Observation.**
- Focused red/green tests now cover: patron-memory thanks, same-gift non-repeat, scan throttle, backlog collapse, and survival priority.
- Full gate passed: typecheck, lint, format, build, Jest **1547/1547**.
- Live offer path delivered the private patron letter and kept the wall redacted.
- Live controller `local-16152` produced this visible public action:
  `Thank you for the Shards, codex-hd031-smoke, and everyone backing me!`
- Post-restart live sample: **23/23 successful actions**, including the thank-you line and continued `explore_patrol` movement afterward.

**Classification.** RESOLVED (DESIGN / NERVOUS). This intentionally solves the Chicago guarantee at the reflex layer. E14's prompt nudge / dedicated prompt section remain useful for richer Brain-authored appreciation, but the patron can now visibly see the resident react.

**Suggested next step.** Run a longer patron soak later with 2-3 fresh offers spaced apart and confirm the resident thanks new support once each while continuing normal gameplay. Then decide whether prompt polish is still worth doing before event day.

### E16 — multi-patron soak verifying Codex 80f25d18 cooldown + backlog collapse

**Status:** PASS — cooldown, dedup, named acknowledgment, and gameplay continuity all confirmed
**Tier:** 2 (multi-patron live soak follows up Codex's E15 next-step suggestion)
**Date:** 2026-05-24 17:30 claude

**Hypothesis.** Codex's E15 closed the substrate gap with a deterministic reflex but suggested verifying with multiple spaced offers to confirm cooldown / backlog collapse behave as designed. Run 3 fresh patron handles offering Shards within ~4 sec of each other and read the resulting say events.

**Repro.**
1. For each handle in `[claude-e16-alpha, claude-e16-beta, claude-e16-gamma]`:
   - `npm run patron:grant -- --human $h --amount 50 -c controller.yml`
   - `npm run patron:offer -- --human $h --resident agent --amount 10 -c controller.yml`
   - `sleep 2`
2. Verify all 3 inboxes received the standing_tier_crossed letter (via curl `/v1/inbox?human=...`).
3. Scan `local-16152` trajectory for patron-related say events with timestamps.

**Observation.**

```
17:20:09  patron:offer claude-e16-alpha → res:agent
17:20:13  RESIDENT SAY: "Thank you for the Shards, claude-e16-alpha, and everyone backing me!"  ← named, 4s latency
17:20:13  patron:offer claude-e16-beta  → res:agent
17:20:17  patron:offer claude-e16-gamma → res:agent
17:20:32  RESIDENT SAY: "Thank you for the Shards, claude-e16-gamma, and everyone backing me!"  ← named, 19s after alpha thanks
            (claude-e16-beta NOT individually named; collapsed under "and everyone backing me")
```

All 3 inboxes received their standing_tier_crossed letter (verified via curl). Other says in the soak window continued normal explore/scout behavior between the patron acknowledgments (gameplay not interrupted).

**Sub-findings.**

**F16a (POSITIVE).** Cooldown between thank-you fires is real and ~19 seconds (likely the `patron-thank` hookCooldown from `nervous-system.ts`). Prevents spam when many patrons arrive at once.

**F16b (POSITIVE).** Backlog collapse is the right design — beta wasn't ignored, the phrase "and everyone backing me!" explicitly acknowledges them as a class. Better UX than either spamming a thank per patron OR silently dropping the middle one.

**F16c (POSITIVE).** Specific-handle naming works for the first new patron after cooldown expiry: alpha named at 17:20:13, then gamma named at 17:20:32 (after the cooldown). The reflex picks the most recent unacknowledged patron memory for the named slot.

**F16d (POSITIVE — gameplay continuity).** Scout/work-route says continued normally before, between, and after the thanks. The reflex doesn't bulldoze normal behavior; it interleaves.

**F16e (Edge case worth noting).** With 3 nearly-simultaneous offers, only 2 of the 3 handles got their name spoken aloud. At Chicago peak-traffic moments (many patrons crowded at the embassy), the named slot will go to the most-recent unacknowledged patron and others will get the "everyone backing me" collapse. For the Chicago experience this is acceptable, but a future enhancement could rotate the named slot across the unacknowledged-patron list across consecutive thanks.

**Classification.** PASS / RESOLVED-by-codex@80f25d18 (DESIGN / NERVOUS — patron-acknowledge reflex closes the Pillar-3 IRL conversation loop). F16e is enhancement-grade, not a blocker.

**Suggested next step.**
- **Polish (low urgency):** rotate the named-patron slot on consecutive thanks (F16e). ~10-line tweak in Codex's reflex, fold into a future cycle if time.
- **Operational:** add a "what to expect" line in `embassy-staff-runbook.md`: "When a patron offers Shards, the resident will name them aloud within ~30 sec, then enter a thanks-cooldown; subsequent offers in the same minute get a collective acknowledgment." Closes staff expectation gap.

**Owner suggestion.** F16e — Codex when adjacent thinking/nervous work surfaces. Runbook line — claude can do as part of #153 (event-day staff disk-files fallback runbook).

### E17 — HD-030 operator revive while controller is running

**Status:** RESOLVED-by-codex
**Tier:** 2 (code fix + live controller verification)
**Date:** 2026-05-24 17:45 codex

**Hypothesis.** HD-030 should be solved with a permanent operator command, not temporary SOUL respawn-policy edits: `npm run controller:revive -- --resident <name>` should revive manual residents that died from attention exhaustion and leave narrative evidence.

**Observation.**
- First CLI/helper tests passed, but live QA found an important integration bug: with the controller running, dead resident runtimes kept stale in-memory state and overwrote the CLI's disk revive on the next tick.
- Fix: `ResidentRuntime` now checks for an externally revived runtime-state when its local state is deceased, then clears `deceased`, stale `stuckSince`, and stale `cognition.activeMove` before continuing normal thinking.
- Operator safety: CLI honors `CONTROLLER_CONFIG`, rejects unknown args, revives only `respawnPolicy: manual` + `attention_exhausted` by default, and requires `--force` for other policies/death causes.
- Full gates passed after the fix: typecheck, lint, format, build, Jest **1555/1555**.
- Live rebuilt controller `local-36085` adopted revives for all six previously dead residents: Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, and Thrand. Follow-up `controller:revive -- --resident hans` reported Hans already living instead of rewriting stale death state.

**Classification.** RESOLVED (OPS / RUNTIME). The lesson is important: external admin tools that mutate runtime-state must either stop the controller first or have runtime-side adoption logic. This slice shipped the latter.

**Suggested next step.** Continue HD-019 separately: deceased or idle residents still produce empty tick files and should eventually stop consuming perception/disk budget after death processing.

### E17 — verify Codex 3f042b38 revive tooling library evidence + hero post-revival activity

**Status:** Mixed — F17a POSITIVE (library evidence works across 6 souls); F17b CRITICAL NEGATIVE (heroes alive but Brain frozen, IDENTICAL pattern across all 6)
**Tier:** 1 (read-only multi-resident state + trajectory scan)
**Date:** 2026-05-24 17:55 claude

**Hypothesis.** Codex's `3f042b38` ("Add operator revive tooling") revived all 6 manual-respawn heroes and claims "records Library revival evidence" and "9/9 successful post-restart actions" for res:agent. Independently verify (a) library evidence landed across all 6 heroes (first live exercise of my E12 `observeRevival` substrate at scale), and (b) heroes actually do something post-revival.

**Repro.**
1. Read each `data/controller/memory/library/<slug>/index.json` + `runtime-state.json` for the 7 residents.
2. Grep each library `timeline.jsonl` for `revival` events; record `lives` count.
3. Find each resident's most recent `local-36085` trajectory file and histogram kinds + decision causes + brain calls.

**Observation.**

**F17a (POSITIVE — RESOLVED-by-codex@3f042b38).** All 6 heroes show correct library evidence:
```
res-hans          lives=4  0 deceased  3 revival events  (last: operator_revive_attention_exhausted, lifeIndex=4)
res-father-aereck lives=3  0 deceased  2 revival events  (last: operator_revive_attention_exhausted, lifeIndex=3)
res-wise-old-man  lives=3  0 deceased  2 revival events  (last: operator_revive_attention_exhausted, lifeIndex=3)
res-duke-horacio  lives=3  0 deceased  2 revival events  (last: operator_revive_attention_exhausted, lifeIndex=3)
res-pip           lives=3  0 deceased  2 revival events  (last: operator_revive_attention_exhausted, lifeIndex=3)
res-thrand        lives=3  0 deceased  2 revival events  (last: operator_revive_attention_exhausted, lifeIndex=3)
res-agent         lives=1  0 deceased  0 revival events  (never died)
```
Codex's CLI used `cause: 'operator_revive_attention_exhausted'` rather than my default `restart_respawn_policy` — good design distinction (operator-driven vs policy-driven). The E12 substrate I shipped at `f9968a16` worked correctly on first live exercise across 6 souls simultaneously.

**F17b (CRITICAL — uniform freeze pattern).** Post-revival activity histogram across all 6 heroes (10-minute window, controller `local-36085`):
```
HERO              SAYS  ACTIONS  RESULTS  BRAIN  DECISIONS    TOP CAUSES
res-hans          0     0        0        0      32           none=19  thinking_watchdog_timeout=13
res-father-aereck 0     0        0        0      32           none=19  thinking_watchdog_timeout=13
res-wise-old-man  0     0        0        0      32           none=19  thinking_watchdog_timeout=13
res-duke-horacio  0     0        0        0      32           none=19  thinking_watchdog_timeout=13
res-pip           0     0        0        0      32           none=19  thinking_watchdog_timeout=13
res-thrand        0     0        0        0      32           none=19  thinking_watchdog_timeout=13
res-agent         4     15       19       1      39           stuck_pre_inference_explore=13 thinking_watchdog_timeout=12 body_wait=8
```
**Every hero is alive-but-frozen with IDENTICAL pattern** — 32 decisions split EXACTLY 19 none / 13 thinking_watchdog_timeout. The thinking watchdog (DEFAULT_THINKING_WATCHDOG_MS = 45_000) is firing ~every 45s for ALL heroes. Zero says, zero actions, zero Brain LLM calls successful.

**res:agent does work** (15 actions / 19 results / 1 brain call / 4 says) but ALSO has 12 thinking_watchdog_timeouts — its Brain is also hanging frequently, just not 100% of the time.

**Sub-finding F17c (additional negative).** This means the E14 finding (patron memories reach Brain but Brain ignores) was understating the problem: **the Brain hangs more than it succeeds, even for res:agent.** The reason Codex's 80f25d18 nervous-rule fix worked is precisely because it's deterministic and doesn't depend on the Brain firing.

**Classification.**
- F17a: **RESOLVED-by-codex@3f042b38** — DESIGN (E12 substrate exercised correctly at scale).
- F17b: **ENGINE or INFERENCE — uniform pattern suggests shared root cause.** Plausibilities (require further investigation):
  - Heroes lack a game gateway connection after revive (revive clears state but doesn't `connect_resident`)
  - LLM endpoint saturated with 7 simultaneous residents (but res:agent succeeds at least once, so not full saturation)
  - Heroes have a different thinking module config that perpetually hangs
  - Per-hero perception poll never returns a usable perception
- F17c: secondary — Brain hang rate is high even for the one working resident.

**Suggested next step.**

CRITICAL pre-Chicago: heroes alive without functional Brain are WORSE than absent heroes — patrons walking into the embassy will see characters standing motionless rather than greeting them. Need root-cause investigation:

(i) **Gateway connection check** — does each hero have an active WebSocket session? `gateway.listSessions()` from the dashboard BFF, or grep controller stderr for connection events.
(ii) **Inspect a hero's prompt** — if InferenceLog has a prompt for a hero, the prompt itself may reveal "no perception", "no goal", etc.
(iii) **`thinking_watchdog_timeout` decision causes carry telemetry** — read one row's full content to see what was awaited.

File HD-032 Critical/coord for Codex investigation. Without resolution, hero-bearing experiments (E18 embassy greeting, E20 soul personality differential, multi-resident L-β whisper) cannot proceed.

**Owner suggestion.** Codex for diagnosis (thinking + runtime + body wiring are their zone). claude continues read-only audits + non-hero experiments (E19 knowledge audit, E21 tick-budget).

---

## E18 — HD-032 Codex Frozen-Hero Mitigation (2026-05-24 18:10 UTC)

**Question.** Are the revived heroes frozen because they lack game perception/sessions, or because thinking/inference timeout handling leaves them with no visible fallback?

**Root-cause findings.**

1. Perception was present for every hero: fresh trajectories had nonzero `perceptionBytes` every tick, so "no gateway perception" was not the primary blocker.
2. The default-SPARK heroes were not using the hybrid Brain/Body module. They had no `cognition` state and no module-specific timeout fallback, so the runtime's generic watchdog result produced no actions.
3. The LLM queue did not settle aborted queued requests until an inference slot became available, which can amplify slow endpoint/backpressure behavior during multi-resident runs.
4. The runtime watchdog returned its own timeout result before modules could expose fallback/backoff decisions, which let hybrid residents restart inference too aggressively after a timeout.

**Fixes landed by Codex on `agents/wip`.**

- `LlmClient` now resolves aborted queued requests immediately and removes them from the queue.
- `ResidentRuntime` now asks a thinking module for an `onWatchdogTimeout` fallback and consumes that decision.
- `HybridAgentThinkingModule` now applies Brain-timeout fallback/backoff immediately and avoids later cancelled completions clearing that backoff.
- `SparkThinkingModule` now delegates default-SPARK timeouts to a visible fallback: say "I am still here; getting my bearings." and attempt one safe local step.

**Live verification.**

Pre-fix baseline from E17 (`local-36085`, 10m):

```
6/6 heroes: 0 says, 0 actions, 0 results, repeated thinking_watchdog_timeout
```

After queue/runtime/hybrid fix but before default-SPARK visible fallback (`local-57240`, ~75s):

```
res-hans          watchdog_fallback actions=2 results success=2
res-father-aereck watchdog_fallback actions=2 results success=2
res-wise-old-man  watchdog_fallback actions=1 results timeout=1
res-duke-horacio  watchdog_fallback actions=1 results timeout=1
res-pip           watchdog_fallback actions=1 results timeout=1
res-thrand        watchdog_fallback actions=1 results timeout=1
```

After default-SPARK say+step fallback (`local-63709`, ~75s):

```
res-agent         actions=9 results success=9
res-hans          says=2 actions=2 results success=4
res-father-aereck says=1 actions=1 results success=1 timeout=1
res-wise-old-man  says=1 actions=1 results success=1 timeout=1
res-duke-horacio  says=1 actions=1 results success=1 timeout=1
res-pip           says=1 actions=1 results success=1 timeout=1
res-thrand        says=1 actions=1 results success=1 timeout=1
```

**Conclusion.** HD-032 is mitigated: heroes are no longer silently frozen after watchdog timeouts, and players/dashboard can see fallback speech/action. It is not fully "smart hero" solved. The deeper inference-health issue remains: real LLM completions are still timing out frequently, so the next slice should either add an inference health check with provider failover or give default hero souls deterministic local patrol/greeting routines that do not depend on LLM completion.

### E18 — Codex d72a3d00 watchdog freeze mitigation verify (E17 / HD-032 response)

**Status:** RESOLVED-by-codex@d72a3d00 — all 7 residents now alive AND active; F17b fully closed
**Tier:** 1 (read-only multi-resident trajectory diff vs E17 baseline)
**Date:** 2026-05-24 18:25 claude

**Hypothesis.** Codex's `d72a3d00` ("Mitigate resident watchdog freezes", responding to HD-032 within ~15 min) claims to abort queued LLM requests cleanly, consume module fallback decisions, apply backoff immediately, and emit a watchdog_fallback say + safe local move. Verify against the same per-hero histogram shape used in E17 (which found 32/19-cause:none/13-watchdog frozen pattern).

**Repro.** Same protocol as E17: for each of 7 residents, read their most recent `local-63709` trajectory and histogram kinds + decision causes + actions + brain calls. Diff against E17 baseline.

**Observation (HD-021 commitment).**

Before/after comparison on similar 10-15 min windows:

```
RESIDENT          E17 (pre-fix)                  E18 (post-fix d72a3d00)             Delta
                  say act res br dec              say act res br dec
res-hans          0   0   0   0  32 (frozen)     9   9  18   4  25                  +9/+9/+18/+4
res-father-aereck 0   0   0   0  32              9   9  18   2  23                  +9/+9/+18/+2
res-wise-old-man  0   0   0   0  32              10  10 20   1  20                  +10/+10/+20/+1
res-duke-horacio  0   0   0   0  32              10  10 20   1  20                  +10/+10/+20/+1
res-pip           0   0   0   0  32              8   10 18   4  18                  +8/+10/+18/+4
res-thrand        0   0   0   0  32              9   9  18   1  16                  +9/+9/+18/+1
res-agent         4   15  19  1  39              7   67 73   0  205                 +3/+52/+54
```

**Action success rates** (heroes pre-fix were "0/0 = N/A"; now):
- All 6 heroes: 18/18 = **100%** success (all actions are `move_to`)
- res:agent: 73/73 = **100%** success (64 move_to + 2 interact + 1 use_item_on_item)

**Decision causes** for heroes (the diagnostic shape):
- `watchdog_fallback`: 8-10 per hero — the new mitigation firing
- `none`: 7-16 per hero — initial decision rows without cause (initial perception or similar)
- `thinking_watchdog_timeout`: **0** across all heroes (vs 13 each in E17)
- res:agent: body_wait=129, exploration_fallback=40, return_to_visibility_anchor=14 (normal explore profile)

**Sub-findings.**

**F18a (POSITIVE / RESOLVED-by-codex@d72a3d00).** Every resident is alive AND active. The uniform 32/19/13 frozen pattern from E17 is completely gone. Heroes produce 9-10 says + 9-10 actions in a ~15-min window after the fix.

**F18b (POSITIVE).** 100% action success across all 7 residents in this window. The `move_to` fallback that watchdog_fallback emits succeeds reliably. No timeouts at all in the post-fix window.

**F18c (POSITIVE — organic Brain output).** `res:pip` produced a soul-driven goal text in its decision causes: `"Idle near Lumbridge Guide, observing for mentees. No immediate action needed."` This is real Brain inference reflecting Pip's mentor soul archetype, not a fallback template. Suggests the Brain DOES sometimes succeed for heroes, not always; the fallback is the safety net.

**F18d (MONITORING / minor polish).** All 6 heroes' first say is the IDENTICAL line: `"I am still here; getting my bearings."` — this is the watchdog_fallback template. At Chicago, if multiple heroes simultaneously fall back, patrons will see all 6 saying the same thing. Future polish: vary the fallback text per resident (could pull from soul.voice frontmatter), or rotate across N variants.

**F18e (POSITIVE — secondary win).** res:agent went from 15 actions in 10 min (E17) to 67 actions in ~15 min (E18) — roughly 4x throughput. Codex's "aborted queued LLM requests settle immediately" change reduces head-of-line blocking, so res:agent's body cycles run faster between Brain calls.

**Classification.**
- F18a: **RESOLVED-by-codex@d72a3d00** (ENGINE / DESIGN — watchdog/LLM-abort plumbing fixed at scale).
- F18b: PASS / 100% success monitoring baseline.
- F18c: PASS / first organic hero Brain output observed; encouraging.
- F18d: KNOWLEDGE / minor — identical fallback text. Pre-Chicago polish, not a blocker.
- F18e: PASS / secondary throughput win.

**Sprint context.** This closes the most critical IRL risk surfaced this sprint. With Chicago 8 days out, all 7 residents can now stand at the embassy actively rather than as motionless statues. Combined with the now-closed patron acknowledgment loop (E16), the Pillar-3 conversation core is **functional end-to-end for the full roster**, not just res:agent.

**Suggested next step.**
- F18d polish: vary watchdog_fallback text per soul (~10-line tweak in thinking module; Codex zone). Pull a one-liner from each hero's soul.voice array on fallback, fall back to the generic line if empty. Could become its own short cycle.
- Run a longer 30-min soak to see whether the 100% action success rate holds with all 6 heroes simultaneously active — saturation behavior on the LLM endpoint is the next concern.

**Owner suggestion.** F18d — Codex (thinking-module slice). 30-min soak — claude can do as background observation while doing other work.

---

## E19 — M8 hero-aware watchdog fallback polish (2026-05-24 18:33 UTC)

**Question.** Can default-SPARK residents avoid the identical watchdog fallback line found in F18d while staying near authored hero posts?

**Change.** Codex updated default `Spark.watchdogFallback` so:
- anchored `heroProfile` residents say `Still here as <publicName>; getting my bearings near my post.`
- anchored heroes move one tile around `heroProfile.anchor` with `range: 1`
- named non-anchored residents say `Still here as <display>; getting my bearings.`
- unnamed/default souls keep the original generic fallback line and first-step candidate movement

**Verification.**

- Focused red/green regression: `src/controller/thinking/thinking-module.test.ts` first failed for anchored hero personalization, then passed after the production change.
- Follow-up red/green regression caught non-anchored named residents still saying the generic line; `res:pip`-style souls now use display-name speech while preserving candidate movement.
- Static/full gates: typecheck, lint, build, and full Jest passed (`150` suites / `1561` tests).
- Code-review subagent reported no Critical/Important/Minor issues for the scoped patch.

**Live evidence (`local-93740`, fresh compiled controller, ~85s).**

```
res-agent         actions=10 results success=11
res-hans          says=2 watchdog_fallback moves=2 results success=4
res-father-aereck says=2 watchdog_fallback moves=2 results success=4
res-wise-old-man  says=2 watchdog_fallback moves=2 results success=4
res-duke-horacio  says=2 watchdog_fallback moves=2 results success=4
res-pip           says=2 text="Still here as Pip; getting my bearings." results success=2 timeout=1
wall snapshot     HTTP 200
```

Sample anchored line: `Still here as Hans; getting my bearings near my post.`

**Conclusion.** F18d is resolved for residents whose watchdog fallback actually fires: the dashboard/player-visible speech now identifies the resident, and anchored heroes do not wander away from their posts while recovering from slow inference. A separate no-hook cadence gap remains for `res:thrand`: in this short soak he produced only begin/end tick evidence and never invoked watchdog fallback. That is now tracked as roadmap task F6 rather than bundled into this fallback polish.

### E19 — Codex 2e32a7bb personalized hero watchdog fallbacks verify

**Status:** F18d RESOLVED-by-codex@2e32a7bb (each hero now uses its own name + anchor patrol); F19c new finding (heroes never escape fallback mode — HD-032 inference-health residual continues)
**Tier:** 1 (read-only multi-resident trajectory diff vs E18 baseline)
**Date:** 2026-05-24 18:55 claude

**Hypothesis.** Codex's `2e32a7bb` ("Personalize resident watchdog fallbacks") addresses my E18/F18d finding (all heroes shared identical "I am still here; getting my bearings" line). Verify per-hero text uniqueness + anchor patrol behavior on `local-93740`.

**Repro.** Same per-resident trajectory scan as E18. Extract say texts + move-target counts. Diff against the E18 baseline.

**Observation (HD-021 commitment).**

```
RESIDENT          SAYS  UNIQUE_TEMPLATE                                                 MOVES  UNIQUE_TGT
res-hans          19    "Still here as Hans; getting my bearings near my post."          19    4
res-father-aereck 21    "Still here as Father Aereck; getting my bearings near my post." 21    4
res-wise-old-man  21    "Still here as The Wise Old Man; getting my bearings near ..."   21    4
res-duke-horacio  21    "Still here as Duke Horacio; getting my bearings near my post."  21    4
res-pip           19    "Still here as Pip; getting my bearings."                        19    2
res-thrand        0     (silent — Codex F6 separate)                                     0     0
res-agent         13    rich varied scout speech + new "Path to the south is blocked
                        or broken. Anyone heading that way?"                            126   117
```

**Sub-findings.**

**F18d RESOLVED-by-codex@2e32a7bb.** Each hero now uses its display name in the fallback line. Pip's line correctly omits "near my post" because Pip has no soul anchor. Codex's per-soul template substitution works correctly across 5 of the 6 heroes (Thrand is the carve-out, see F6).

**F19a (POSITIVE — anchor patrol).** Heroes with anchors now patrol exactly 4 unique tiles each (the 4 cardinal neighbors of their post, per range-1). This is exactly the design Codex specified. Hans/Aereck/Wise/Horacio all show the same 4-unique-tiles pattern. Pip with no anchor wanders 2 tiles. Visual at IRL: each hero stays at their post and rotates around it, rather than drifting away. Good.

**F19b (POSITIVE — first organic conversational say from res:agent).** res:agent emitted `"Path to the south is blocked or broken. Anyone heading that way?"` — this is a Brain-driven help-request, not a fallback or template. First time observed in this sprint. Suggests Brain CAN produce meaningful conversational outputs when it succeeds.

**F19c (CONCERNING — heroes never escape fallback).** Each hero produces 19-21 says in the ~30-min window, **all identical** to its personalized fallback line. The heroes' Brain doesn't recover between watchdog timeouts — they're always in fallback mode. From a Chicago patron's perspective: walk up to Hans, hear "Still here as Hans; getting my bearings near my post." Walk away. Come back 30 seconds later: same line again. Each hero has ONE signature line and uses it forever.

This is the deeper residual that Codex flagged in HD-032's note: "default heroes are visibly alive but not yet smart conversational heroes." E19 quantifies it. The patron-acknowledge reflex (80f25d18) will still fire on a Shards offer, so heroes have **two** behaviors: (1) say their signature identity line on watchdog fallback (~every 30s), (2) thank a patron when offered Shards. Brain-driven varied conversation remains gated on inference-completion health.

**F19d (KNOWN — Thrand silent).** Thrand produced 0 says, 0 actions across 3404 trajectory rows. Codex's commit body explicitly tracks this as roadmap F6 ("Residual quiet no-hook Thrand behavior"). Confirmed it's a separate workstream, not a regression.

**Classification.**
- F18d: **RESOLVED-by-codex@2e32a7bb** (KNOWLEDGE / soul-aware fallback).
- F19a: PASS (DESIGN — anchor patrol working as specified).
- F19b: POSITIVE (INFERENCE — Brain occasionally succeeds, produces meaningful conversational lines).
- F19c: **INFERENCE — same root as HD-032 residual**. Heroes' Brain fails consistently. Mitigation works (fallback covers); cure (smart conversation) requires inference-health work or rich reflex layer per hero.
- F19d: KNOWN per Codex F6.

**Suggested next step.**

The Pillar-3 substrate + fallback layer are now Chicago-acceptable. F19c is the next-deepest problem and warrants a focused investigation:

(i) **Inference-completion telemetry**: how often does Brain.complete() succeed vs timeout vs error per hero? Read inference logs for `local-93740` and tabulate. If timeouts dominate, the local nullcity LLM endpoint may be the bottleneck (especially with 7 simultaneous residents).
(ii) **Per-hero reflex-rich souls**: write 2-3 nervous-rule snippets per hero that fire based on perception (e.g. Hans says "I've been at this post a long time" when stuck > 60s; Father Aereck says "Bless this ground" when an NPC enters embassy). Deterministic, soul-aware, doesn't depend on inference.
(iii) **Single-resident soak**: run a 30-min controller with ONLY res:agent + 1 hero (e.g. Hans) and measure their Brain success rates separately. Disambiguates whether the 7-resident concurrent load is the cause.

**Owner suggestion.** (i) — claude can do as read-only inference-log scan; (ii) — Codex zone (nervous-system + soul rules); (iii) — needs a second controller spin-up (Codex zone). File as HD-033 if any of (i)/(ii)/(iii) becomes a discrete actionable work item.

---

## E20 — F6 default-SPARK idle initiative and Thrand revival proof (2026-05-24 19:03 UTC)

**Question.** Can a default-SPARK resident with no winning hook become visible to players/dashboard without waiting for inference or watchdog fallback?

**Change.** Codex added a low-cadence no-hook idle initiative in default `Spark.tick`:
- waits until tick 120 before first use
- stores `lastIdleInitiativeTick` in runtime state
- emits display-name speech like `Still here as Thrand; watching the area.`
- pairs speech with a safe first-step movement candidate when position is available
- uses no inference and does not run when any real hook/plan wins

**Verification.**

- Focused red/green regression first failed with no actions on the no-hook path, then passed after implementation.
- Cadence regression confirms the next tick noops and does not call the LLM before the interval elapses.
- Static/full gates passed: typecheck, lint, build, full Jest (`150` suites / `1562` tests).

**Live evidence (`local-73320`).**

First soak after restart showed the new code path working for Hans, Father Aereck, Wise Old Man, Duke Horacio, and Pip, but not Thrand. Root cause was not F6 logic: Thrand's persisted state had `attention: 0` and `deceased.cause = attention_exhausted`, so `ResidentRuntime` intentionally ended ticks before SPARK thinking.

After `npm run controller:revive -- --resident res:thrand`:

```
res-thrand sayCount=2 actionCount=2
idle say:    "Still here as Thrand; watching the area."
idle action: move_to 3236,3234,0 cause=idle_initiative
results:     success=2 timeout=2
state:       attention=4813 deceased=undefined lastIdleInitiativeTick=4125
wall:        HTTP 200
```

**Conclusion.** F6 is resolved for living default-SPARK residents: no-hook ticks now produce visible low-cadence speech and movement without inference. Thrand's specific silence had a second root cause, attention exhaustion, and the existing revive tooling restored him so the new idle path could be observed. Remaining higher-level issue is still F19c/HD-032 residual: heroes are visible but mostly fallback/reflex-driven until inference completion health improves or per-hero reflexes are richer.

### E20 — inference-completion health telemetry (F19c quantification)

**Status:** OPEN — measured precisely; root causes identified
**Tier:** 1 (live evidence read-only)
**Date:** 2026-05-24 19:10 claude (via subagent)

**Hypothesis.** Heroes are stuck in `watchdog_fallback` because the Brain LLM (Qwen3-27b at `http://inf.nullcity.ai:1234`) is timing out or returning empty actions; res:agent succeeds because its prompts complete faster. Quantify exactly.

**Repro.** Path correction — inference logs live at `/Users/james/Code/OnionDAO/rs6-nullcity-server/data/controller/logs/<slug>/inference/YYYY-MM-DD.jsonl` (not under `memory/<slug>/evidence/inference/` as previously assumed). Schema from `src/controller/logging/inference-log.ts:5-17` and `resident-runtime.ts:320-500`. Counted `cause:thinking_started`, `cause:thinking_watchdog_timeout` (45 s watchdog from `DEFAULT_THINKING_WATCHDOG_MS`, fires before the 60 s LLM `timeoutMs`), and post-decision rows with `envelope_tokens>0`.

**Observation.**

Per-resident Brain attempt outcomes (most recent live window per resident):

```
resident          started  timeout  LLM returned  w/ actions  empty  timeout %
res:agent         4442     252      581           559 (96%)   22     5.4%
res:hans          137      133      41            0  (0%)     41     76%
res:father-aereck 117      139      14            0  (0%)     14     91%
res:wise-old-man  116      143      8             0  (0%)     8      95%
res:duke-horacio  116      143      8             0  (0%)     8      95%
res:pip           118      132      19            3  (16%)    16     87%
res:thrand        75       99       7             0  (0%)     7      93%
```

There are **0 `parse_ok:false` rows across all 7 residents** — when JSON does return, it parses. The failure mode is empty `actions:[]`, not malformed output.

**Latency of successful LLM returns** (ms; watchdog ceiling = 45 000 ms; configured `llm.endpoints.default.timeoutMs = 60_000` is dead code because the resident-runtime watchdog at `resident-runtime.ts:454-475` fires first):

```
resident          n    p50      p95      p99      max
res:agent         356  15,606   39,342   42,884   43,752
res:hans          34   15,253   42,338   42,956   42,956
res:father-aereck 8    38,714   42,954   42,954   42,954
res:wise-old-man  3    17,894   34,182   34,182   34,182
res:duke-horacio  3    17,304   34,227   34,227   34,227
res:pip           16   27,902   39,935   39,935   39,935
res:thrand        6    37,515   39,368   39,368   39,368
```

Timeout-path latencies cluster at ~44 000 ms across every resident (uniform). Envelope sizes are nearly identical (median 3 248–3 697 tokens, p95 ≤ 3 765) — not a per-soul prompt-bloat issue.

**Sub-findings.**

- **F20a — Empty-completion epidemic (INFERENCE).** 6/7 residents produce zero-action Brain returns at 84–100% rate even when the LLM completes within the watchdog. Distinct from a timeout failure. Likely Qwen3 thinking-mode behavior: model emits only `<think>...</think>` (no JSON actions) within the budget.
- **F20b — Timeout saturation uniform across heroes (INFERENCE/ENGINE).** Timeout rate 76–95% for heroes, 5.4% for res:agent. Hero p50 successful latency (17–39 s) ~2× agent's (15.6 s), with p95 against the wall. Symmetric across souls → endpoint slowness/queuing, not per-soul prompt issue.
- **F20c — Watchdog dead-code (ENGINE).** `controller.yml:llm.endpoints.default.timeoutMs: 60000` is shadowed by `DEFAULT_THINKING_WATCHDOG_MS = 45_000`. Either the 60 s setting is wrong or the watchdog is too tight; nothing surfaces this conflict.
- **F20d — Telemetry gap (PERCEPTION/OBSERVABILITY).** The `moduleTelemetry` channel (`src/controller/spark/module-inference.ts:51-83`) never lands in `inference/*.jsonl` — the file has 0 rows with `kind`, `message`, `promptTokens`, or `completionTokens`. Likely the telemetry sink in `createSparkRuntimeFacets` (`resident-runtime.ts:147-155`) drops these. Without it we can't distinguish *empty return* from *upstream cancel* directly.
- **F20e — Cause-leak from Brain (INFERENCE).** Two res:pip post-rows have `cause` strings like `"Idle near Lumbridge Guide, observing for mentees. No immediate action needed."` — the LLM is leaking narration into the `cause` slot via the Zod-validated `cause: z.string().max(120).optional()` field at `src/controller/spark/runescape-brain-planner.ts:41`. Cosmetic but confirms model is in narrate-not-act mode.

**Classification.** F20a INFERENCE; F20b INFERENCE/ENGINE; F20c ENGINE; F20d PERCEPTION; F20e INFERENCE.

**Suggested next step.**

1. **(substrate, claude-zone)** Fix the `moduleTelemetry → inferenceLog` plumbing in `src/controller/spark/runtime-facets.ts` / `resident-runtime.ts:153` so `kind:'metric'` rows with `promptTokens`/`completionTokens`/`endpoint`/`nooped` land in the file; gates every other diagnosis.
2. **(substrate, claude-zone)** Tighten Brain prompt to require non-empty `actions[]` and add a one-shot example of an act-not-narrate response in `runescape-brain-planner.ts`. Add `parse_actions_empty` as a distinct cause vs `parse_ok:true,actions_emitted:0` so F20a becomes greppable.
3. **(monolith, Codex-zone)** Resolve `DEFAULT_THINKING_WATCHDOG_MS=45_000` vs `llm.endpoints.default.timeoutMs=60_000` in `resident-runtime.ts:48` / `controller.yml:llm`. Either honor the YAML or document the watchdog as the real ceiling and lower the LLM timeout.

**Owner suggestion.** Substrate (F20a/d/e) — claude; monolith (F20c) — Codex; F20b needs an endpoint-side load probe before assigning (suspected `inf.nullcity.ai:1234` queueing — only one observation, no metrics yet).

---

### E21 — knowledge consultation audit (does the Brain use the 50 knowledge entries?)

**Status:** OPEN — quantified; worse than E14's patron-memory case
**Tier:** 2 (substrate evidence + behavioral counterexample)
**Date:** 2026-05-24 19:10 claude (via subagent)

**Hypothesis.** 100+ entry `ENGINE_KNOWLEDGE_ENTRIES` array + 50 per-skill markdown docs reach the Brain prompt, but resident behavior never visibly references them — same half-closed loop as E14 (patron memories in prompt, ignored in output).

**Repro.**
- Wiring trace: `createDefaultGameSkillEntries` (`src/controller/knowledge/game-skill-entries.ts:8`) → `controller-host.ts:89` → `ResidentRuntime.gameSkill.buildContext` (`resident-runtime.ts:336`) → `runBrain`/`runBody` (`hybrid-agent-thinking-module.ts:318,345`) → `buildBrainPrompt`/`buildBodyPrompt` (`hybrid-agent-prompts.ts:51,80`) which interpolate `gameSkill.brainSection` containing `Relevant game knowledge:\n…` (`game-skill-context.ts:614`). Retrieval scored: `limit:5, minScore:4, tokenBudget:1500, maxChars:1600` — small slice of the corpus per call.
- Run-time observation: `data/controller/logs/res:agent/inference/2026-05-24.jsonl` (29,825 records) only stores envelope-token counts, not the prompt body, so we can't quote the knowledge string verbatim post-hoc. Confirmed via tests `hybrid-agent-prompts.test.ts:28,55` that the literal `Relevant game knowledge` block IS in the prompt whenever `brainSection` is non-empty.
- Behavioral scan: 8 res-agent trajectory sessions today, 52 total `say` events, scanned for ~40 knowledge-derived terms (Hans/Aubury/Wise Old Man, Lumbridge/Varrock/Falador, tinderbox/bronze axe/bones, cook's-assistant/restless-ghost, goblin/chicken/cow, firemaking/smithing, etc.).

**Observation (Tier 2 evidence).**

1. **Knowledge IS in the prompt.** Wiring intact + tested. Brain-prompt envelopes averaged ~3,038 envelope tokens per `brain_goal` record — well above what perception alone produces, consistent with knowledge + memories injected. Substrate works.
2. **Brain-emitted output is rare.** Across res:agent today: 4,442 `thinking_started` (brain calls) but only **49 `brain_goal`** records (successful goal emissions). 252 `thinking_watchdog_timeout`. Dominant cause is `body_wait` (14,873) and reflex routines (`exploration_fallback` 3,438, `presence_beacon` 735, `woodcutting_level1_routine` 639). The brain barely lands.
3. **Knowledge-term references in say output: 2 / 52 (3.8%).** Both mentions are the word "woodcutting" — and they come from a brain-set goal *description* echoed back in a reflex-template scout say ("Goal: Practice woodcutting on ordinary level-1 trees…"). Zero references to any NPC, place, quest, item, monster, currency, or other skill from the entries. 50 / 52 says are pure reflex templates ("I am scouting. Nearby I see 7 trees…").

**Sub-findings.**

- **F21a (DESIGN).** The say layer is almost entirely the scout reflex family (`presenceBeaconAction`) — knowledge can't surface there because it bypasses the LLM.
- **F21b (INFERENCE).** Even the rare brain says reuse the templated `Goal: <X>. Next: <Y>` format, suggesting brain output is being re-rendered by a serializer rather than emitted free-form.
- **F21c (PERCEPTION/CONFIG).** Retrieval throttled to 5 entries at `minScore: 4` per call (`game-skill-context.ts:84-90`), so most calls see only the 2–3 most token-overlapping skill cards (woodcutting/firemaking for res-agent) and never the lore/quest/NPC entries.

**Classification.** **Worse than E14.** E14 was half-closed (data in prompt, ignored in output). E21 is **mostly-disconnected**: substrate works, brain consults knowledge ~49 times/day, and even those rare brain outputs get squeezed through a templated say renderer that strips lore/NPC/place specifics. The reflex layer (~99% of behavior) is structurally blind to the corpus.

**Suggested next step.**

1. **(substrate, claude)** Add prompt-body capture to inference logs (gated, sampled 1/100) so we can quote the actual knowledge slice instead of inferring from envelope tokens — closes the audit gap that blocked E14/E15/E21 from quoting prompts.
2. **(substrate, claude)** Raise retrieval recall: drop `minScore` to 2, raise `limit` to 8, or add topic-tag retrieval keyed on perception (e.g. when Hans visible, force-include `npc-hans` entry). Cheap, high-leverage.
3. **(monolith, codex)** Stop templating brain `say` output through the goal-description renderer; let the brain's free-form `say` field reach chat unmodified. Without this, the 47 other knowledge entries can never affect observable behavior even if the brain reads them.

Key files (absolute):
- `/Users/james/Code/OnionDAO/rs6-nullcity-server/src/controller/knowledge/knowledge-retriever.ts` (entries + retrieval, 108 entries)
- `/Users/james/Code/OnionDAO/rs6-nullcity-server/src/controller/knowledge/game-skill-context.ts:84-91` (retrieval config)
- `/Users/james/Code/OnionDAO/rs6-nullcity-server/src/controller/thinking/hybrid-agent-prompts.ts:51,80` (injection)

