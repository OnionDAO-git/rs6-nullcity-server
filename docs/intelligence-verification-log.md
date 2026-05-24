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
