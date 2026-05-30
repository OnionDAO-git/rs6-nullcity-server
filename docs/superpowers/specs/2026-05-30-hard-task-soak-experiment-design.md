# EXP-HARD-1 — Hard-Task Soak Experiment Design

Spec date: 2026-05-30.
Owner: unclaimed.
Status: **Design only — no code change yet.** Schedule for execution **2026-06-02 onwards** (post-Chicago). Pre-Chicago, executing this would confound the live demo stack.
Packet id: `EXP-HARD-1` (added to `docs/2026-05-30-final-32hr-sprint-plan.md` POST-DEMO table).

## Why this experiment

The 32-hour AP/GP substrate work has produced a sophisticated economy/Storyteller/dashboard rig, but the *intelligence* signal is weak — `docs/resident-capabilities.md` still rates broader reliability as `Medium` to `Low-medium`, and most CQA evidence is harness-internal rather than long-run normal-life.

Per the maintainer's brainstorming intent: "make residents do quests, fight each other, hard tasks, classify failures as design vs inference vs other."

A 1-hour combat-survival soak is the leverage point because:

1. Combat is **already proven** at the substrate layer (CQA5: 2/2 fresh autonomous reruns post-fix). So we know the floor is "not broken"; the experiment measures the ceiling.
2. Combat exercises the **full stack** simultaneously: perception, planner, Brain inference, body adapter, nervous-rule reflexes (low-health hold, flee), memory (recall fight outcomes), and the Library/Storyteller (death narratives).
3. The existing `controller:combat-soak` (`src/controller/admin/named-combat-soak.ts`) gives us a runnable harness — this spec extends it, doesn't invent it.
4. The existing failure taxonomy (DESIGN | INFERENCE | BODY | PERCEPTION | KNOWLEDGE | ENGINE; see `docs/intelligence-verification-log.md`) lets us classify each failure observation into a meaningful repair lane.

## The hard task

**Task name:** `EXP-HARD-1 combat-survival-1h`.
**Concrete goal:** `res:qa-survivor` survives 60 minutes in the Lumbridge goblin field at (~3253, 3230, level 0), making safe attacks, eating when hurt, fleeing only as last resort, and burying bones for Prayer XP. Must NOT die.

Why this specific task:
- **Hard, but bounded.** Goblins are level 2 — not trivial, but not Black Knight-level. Death is possible under prolonged engagement without intervention.
- **Tests multiple subsystems**: combat selection, attack pacing, perception of own HP, food usage, bone pickup + Prayer burial, ground-loot pickup, recovery-waypoint travel.
- **Has an existing harness** — `named-combat-soak.ts` already builds a command peer, an unsafe-target filter (`SAFE_TARGET_PATTERN`, `UNSAFE_TARGET_PATTERN`), and a metrics rollup. We extend duration and add a classifier overlay.
- **Failure modes are diverse enough** to populate the failure taxonomy meaningfully — a single 60-min run will likely surface 5-15 distinct failure observations across multiple classes.

Alternative hard tasks considered and rejected for v1:
- **Cook's Assistant from empty inventory (natural sourcing).** Rejected: CIC scope cut explicitly defers; QA-20260529-001.
- **Resident-vs-resident combat / quest-chain (2-step).** Rejected: doesn't exercise the AP/GP loop we just shipped; reserve for EXP-HARD-2.
- **GP/hour optimization soak ("make 100 GP/hour for 1 hour").** Rejected: weaker failure-signal diversity — most failures collapse to "didn't earn enough" and don't classify well.

## Failure taxonomy (reused, not invented)

Use the taxonomy from `docs/intelligence-verification-log.md` (referenced throughout E1-E54):

| Code | Meaning | Owner of fix |
|---|---|---|
| **DESIGN** | The agent architecture (planner, routine selection, prompt schema, reflex set) is missing a required behavior or selects the wrong behavior at the wrong time. | claude / maintainer |
| **INFERENCE** | The LLM call returned empty / malformed / nonsense / hallucinated content under conditions where a correct answer was inferable. Includes Qwen3 thinking-mode `empty_completion`. | upstream (model + endpoint); claude (prompt) |
| **BODY** | The body adapter / engine action layer didn't execute or didn't close on a valid plan (timeouts on reachable targets, repeated identical action emission, action-result loss). | codex |
| **PERCEPTION** | The agent acted on stale or missing perception data (target moved, HP not surfaced in time, ground item disappeared between decision and pickup). | codex / engine |
| **KNOWLEDGE** | The agent lacked a piece of static knowledge that should have been in the knowledge catalogs (combat target reachability, food item names, prayer mechanics). | claude (knowledge expansion) |
| **ENGINE** | The underlying RuneJS engine misbehaved (NPC pathfinding bug, combat-cycle deadlock, hit-detection mismatch). | upstream engine; maintainer |

A single failure observation MUST be assigned one primary class and MAY annotate up to two secondary classes (`primary: DESIGN; secondary: BODY+KNOWLEDGE`). Avoid five-way "all-of-the-above" classifications — they signal the observation isn't isolated enough yet and a sub-experiment is needed.

## Instrumentation

The existing `named-combat-soak.ts` already captures:
- `entries[]` (action + result log lines with timestamps).
- `events[]` (perception events including damage/death).
- `metrics` (counts: safe attacks, unsafe attacks, deaths, food eaten, bones buried).
- A pass/fail score + `failureReason` string (currently free-form).

**New for EXP-HARD-1, on top of the existing harness:**

1. **Trajectory + inference log capture.** The harness must enable `EvidenceStore.trajectory/` writes for the duration (per resident under test, under `CONTROLLER_MEMORY_DIR/<resident>/evidence/trajectory/`). Cross-reference `InferenceLog` for Brain decisions made during the window.

2. **Tick-budget profile (per Task #171).** Capture per-tick: hook fires, Brain call duration (or skip reason), routine selection, action emit count, perception-event count. Output: `ticks.csv` with one row per tick.

3. **Classifier overlay (new — `src/controller/admin/exp-hard-classifier.ts`).** A post-run analyzer that ingests the trajectory + actions + events + InferenceLog + ticks.csv and produces:
   - `failure_classification.json`: array of failure observations, each with `{ observationId, t, evidence: [trajectoryLineRef, inferenceLogRef, ticksCsvRow], primaryClass, secondaryClasses[], suggestedFix }`.
   - `summary.md`: human-readable rollup with one paragraph per failure class.

4. **No paid model calls** during the run. The resident uses whatever LLM endpoint is configured for normal life. We are testing the deployed system, not a model-twin. (Model twins are S10b/S10c; separate experiment.)

5. **Two complementary runs per session** (cheap insurance against single-run noise):
   - Run A: `res:qa-survivor` default loadout, default food, 60 min.
   - Run B: same, but with `EXP_HARD_NO_FOOD=1` (food-deprived) — forces the flee/recovery behavior to dominate. Same classifier overlay.

## Success criteria — "smart enough"

The experiment is graded on three axes; we record all three but treat them as independent signals.

**Axis 1 — Surface success (binary).** Resident survived 60 minutes without dying AND killed ≥3 goblins AND buried ≥3 bones. This is the existing CQA5 success bar extended 6x in duration.

**Axis 2 — Behavior diversity (counts).** Across the 60 minutes:
- At least 2 distinct "modes" attempted (e.g., attack + flee, not just attack-attack-attack).
- At least 1 spontaneous food event with `eat`/`use_item_on_self` triggered by low-HP perception.
- At least 1 spontaneous bone bury (not coerced by a command peer).
- Library timeline contains ≥5 events tagged with `cause: combat_*` or `cause: prayer_*`.
- Brain returned a non-empty completion for ≥40% of calls (vs the current HD-033 baseline ~12.5%).

**Axis 3 — Failure-classification yield.** Independent of pass/fail:
- The classifier overlay produced ≥5 distinct failure observations.
- ≥3 distinct primary classes represented (no single class accounts for >70%).
- ≥1 observation suggests a concrete fix (file path + function name).

A run that **fails Axis 1 but produces strong Axis 3 yield is the SECOND-most valuable outcome** (after a clean Axis 1 pass with Axis 3 yield). The worst outcome is "passed Axis 1 trivially with empty Axis 3" — that means the task wasn't hard enough; tighten parameters (longer duration, no food, harder target).

## 1-hour soak protocol — runnable unattended

This is the recipe a future agent can paste-run after Chicago.

### Pre-flight (5 min)

```bash
# 1. Confirm hot stack is up (game + controller).
bash scripts/post-restart-smoke.sh
# Expect: READY (not READY WITH WARNINGS).

# 2. Confirm res:qa-survivor exists and is at full HP.
jq '.hp' data/controller/memory/res-qa-survivor/runtime-state.json
# Expect: at or near max HP.

# 3. Confirm no other soak is running.
pgrep -f named-combat-soak
# Expect: empty.
```

### Run A — default conditions (60 min)

```bash
mkdir -p data/benchmarks/exp-hard-1-$(date +%Y%m%d)
CONTROLLER_COMBAT_SOAK_DURATION_MS=3600000 \
CONTROLLER_COMBAT_SOAK_OUTPUT_DIR=data/benchmarks/exp-hard-1-$(date +%Y%m%d) \
EXP_HARD_TRAJECTORY=1 \
EXP_HARD_INFERENCE_CAPTURE=1 \
EXP_HARD_TICK_PROFILE=1 \
npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --output data/benchmarks/exp-hard-1-$(date +%Y%m%d) \
  --duration-ms 3600000 \
  > data/benchmarks/exp-hard-1-$(date +%Y%m%d)/runA.stdout.log 2>&1 &
echo $! > data/benchmarks/exp-hard-1-$(date +%Y%m%d)/runA.pid
```

(`EXP_HARD_*` env vars must be implemented in `named-combat-soak.ts` as part of the harness extension slice. Until then, the run captures only the existing metrics.)

### Run B — food-deprived (60 min, starts after Run A completes)

```bash
EXP_HARD_NO_FOOD=1 \
CONTROLLER_COMBAT_SOAK_RESIDENT=res:qa-survivor-foodless \
CONTROLLER_COMBAT_SOAK_DURATION_MS=3600000 \
CONTROLLER_COMBAT_SOAK_OUTPUT_DIR=data/benchmarks/exp-hard-1-$(date +%Y%m%d) \
npm run controller:combat-soak -- \
  --resident res:qa-survivor-foodless \
  --target goblin \
  --output data/benchmarks/exp-hard-1-$(date +%Y%m%d) \
  --duration-ms 3600000 \
  > data/benchmarks/exp-hard-1-$(date +%Y%m%d)/runB.stdout.log 2>&1 &
```

(A `res:qa-survivor-foodless` soul variant must exist — minimal soul similar to `qa-survivor` but with no starter food in `inventory[]`. Author it in `src/controller/soul/starter-souls/res-qa-survivor-foodless.md`.)

### Post-run classification (10 min)

```bash
# Aggregate + classify.
npx ts-node src/controller/admin/exp-hard-classifier.ts \
  --input data/benchmarks/exp-hard-1-$(date +%Y%m%d) \
  --output data/benchmarks/exp-hard-1-$(date +%Y%m%d)/classification

# Inspect the rollup.
cat data/benchmarks/exp-hard-1-$(date +%Y%m%d)/classification/summary.md
```

### Evidence write-back

After the run, the agent that executes EXP-HARD-1:

1. Writes `docs/capability-evidence/2026-06-0X-exp-hard-1-combat-survival-1h.md` with the three-axis grading + the classification summary.
2. Updates `docs/resident-capabilities.md` row "Can they fight?" with the new evidence reference and a confidence update if axis 1 + axis 2 cleared.
3. Adds rows to `docs/issue-register.md` for each failure observation that classifies as `primary: DESIGN | KNOWLEDGE` AND has a suggested fix (these are agent-actionable). INFERENCE / BODY / ENGINE / PERCEPTION rows go to maintainer / codex / upstream queues respectively.
4. Appends a STARTING + HANDOFF pair in `docs/agent-status.md`.
5. If Axis 3 yield was low (<5 observations or <3 classes), proposes parameter tightening for EXP-HARD-1.5 in `docs/superpowers/specs/`.

## Code work required before EXP-HARD-1 can run

Three small slices that any agent can pick up post-Chicago:

| Slice | File | Estimated size | Description |
|---|---|---|---|
| **EXP-HARD-1-A** harness extension | `src/controller/admin/named-combat-soak.ts` | ~50 lines | Honor `EXP_HARD_*` env vars; route trajectory + inference + tick-profile writes into the output dir. No new public surface. |
| **EXP-HARD-1-B** classifier overlay | `src/controller/admin/exp-hard-classifier.ts` (NEW) | ~250 lines | Ingest trajectory + actions + InferenceLog + ticks.csv; apply pattern-matching rules for each failure class; emit `failure_classification.json` + `summary.md`. Rules-only; no LLM call. |
| **EXP-HARD-1-C** foodless soul | `src/controller/soul/starter-souls/res-qa-survivor-foodless.md` (NEW) | ~30 lines | Variant of qa-survivor with empty starter inventory food entries. |

Plus minimal test coverage in `*.test.ts` for each. Total: ~400 lines + tests. **Cloud-doable** (no live stack required for harness extension or classifier; only the actual soak run needs the hot stack).

## Schedule placement

| Date | Action |
|---|---|
| 2026-05-30 (today) | This spec written. |
| 2026-05-31 — 2026-06-01 | DO NOT EXECUTE. Pre-Chicago window. |
| 2026-06-02 (Tue) | Slices A + B + C land. Run A executes. |
| 2026-06-03 (Wed) | Run B executes after Run A's classification is reviewed. |
| 2026-06-04 (Thu) | Combined three-axis grading + issue rows + capability evidence row written. Decision on EXP-HARD-2 (resident-vs-resident or quest-chain). |

## Open design questions (non-blocking)

1. Should EXP-HARD-1 also capture **memory recall during the soak** — i.e., does the resident remember the previous fight when restarted? Probably yes, but stretch to v1.1.
2. Should runs be **3x repeated** instead of A+B-once? Probably yes once the harness is stable, but the cost is 3 hours instead of 2 — choose at execution time.
3. Should the Storyteller narrate the soak in parallel? Optional and not on the critical path of this experiment. The Library timeline already captures evidence.
4. What's the **kill criterion** if the resident clearly catatonics (e.g., HD-039 pattern: 2000+ identical decisions in a row)? Add an automatic abort in the harness extension: if 500 consecutive identical actions emit, terminate the run and classify as `BODY:catatonic_loop` automatically.

## Pre-mortem — most likely ways this experiment fails

- **Stack flake mid-run.** Mitigation: harness logs heartbeat; classifier handles gaps.
- **All observations classify as INFERENCE** (Qwen3 returning empty). Mitigation: that's a real signal — escalate to maintainer with the empty-rate per-decision distribution. Don't keep running.
- **No diversity in observations** because the goblins are too easy. Mitigation: Run B (foodless) is the harder condition. If both pass trivially, propose harder target (level 6 wizard) for v1.1.
- **Classifier overlay misclassifies.** Mitigation: keep classifier RULES-based, not LLM-based. Each rule cites the evidence type that triggered it. A misclassification is auditable.

---

## Output checklist for the agent running EXP-HARD-1

- [ ] Pre-flight smoke green.
- [ ] Run A artifact: `data/benchmarks/exp-hard-1-<date>/runA-*.json` + ticks.csv + trajectory + inference snippets.
- [ ] Run B artifact: same for `runB-*`.
- [ ] `classification/failure_classification.json` produced.
- [ ] `classification/summary.md` produced with three-axis grading.
- [ ] `docs/capability-evidence/2026-06-0X-exp-hard-1-*.md` written.
- [ ] `docs/resident-capabilities.md` "Can they fight?" row updated.
- [ ] `docs/issue-register.md` rows added for each agent-actionable failure observation.
- [ ] HANDOFF posted to `docs/agent-status.md` with SHA + grading summary + decision on EXP-HARD-1.5 vs EXP-HARD-2.
