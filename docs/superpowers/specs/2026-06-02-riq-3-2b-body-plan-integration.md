# RIQ-3-2B — Body-PlanStore Integration Design

**Date:** 2026-06-02
**Author:** cron-cloud (Rule-12 design fallback — code blocked by S-TOOL-ACQUIRE-4 lock)
**Status:** Source implemented by RIQ-3-2B on 2026-06-02; live A1 verification pending on hot stack.
**Packet id:** `RIQ-3-2B`
**Phase:** 3 (Durable plan + progress tracking)
**Issue row:** QA-20260602-076

Supersedes nothing. Extends `docs/superpowers/plans/2026-06-01-resident-intelligence-roadmap.md` Phase 3 §4.

---

## 0. What's shipped, what's missing

### Shipped (do not re-implement):
- `PlanStore.save/load/clear/has` — atomic per-resident plan file (`active-plan.json`)
- `Plan { goalId, goalDescription, stages[], currentStageIndex, status }` schema in `planner-pass.ts`
- `Stage { id, subgoal, requirements[], successCriteria, status }` schema
- `advancePlan(plan)` — pure function: marks currentStage `done`, advances index, sets plan `completed` when last stage done
- `blockCurrentStage(plan)` — pure function: marks currentStage `blocked`
- `currentStage(plan)` — returns `stages[currentStageIndex]`
- `maybeTriggerPlannerPass` — fires PlannerPass when plan is `null | completed | abandoned | stage_blocked`
- `HelperContext.options.planStore?: PlanStore` — field exists but **not wired from ResidentRuntime**

### Implemented source-side by RIQ-3-2B:
1. **Production wiring**: `ControllerHost` owns a memory-rooted `PlanStore`; `ResidentRuntime` passes `PlanStore` and `LibraryUpdater` into hybrid thinking.
2. **Body reads currentStage**: `planStageRouter` maps `Stage.subgoal` text to existing body routines.
3. **Stage advancement**: `runBody` advances observable `stage_done` stages and emits routed plan-stage actions before body LLM inference.
4. **Survival-preserves-plan invariant**: explicit tests prove planner/plan-store paths do not clear healthy plans; Nervous still runs before Body routing.

### Still missing:
1. Tick-budget/blocking persistence for non-observable activity criteria.
2. Live A1 hot-stack proof with planner_haiku/planner_local and real XP/action-result evidence.

---

## 1. Production wiring (`resident-runtime.ts`)

`ResidentRuntime` already holds `CONTROLLER_MEMORY_DIR` (the `memoryRoot`). Add:

```ts
// In ResidentRuntime constructor (resident-runtime.ts):
private readonly planStore: PlanStore = new PlanStore(this.memoryRoot);
```

Pass it into `HelperContext` at the construction call site (same location as `libraryUpdater`):

```ts
const ctx: HelperContext = {
  options: {
    ...existingOptions,
    planStore: this.planStore,       // ADD
    libraryUpdater: this.library,   // already present
  },
};
```

This single wiring change unblocks all plan-aware brain behavior — `maybeTriggerPlannerPass` and Library events already gate on `planStore` being defined.

---

## 2. Stage routing in the Body (`runescape-body-routines.ts`)

### 2a. New function: `planStageRouter`

```ts
export type PlanBodySignal = 'stage_done' | 'stage_blocked' | undefined;

export interface PlanBodyResult {
  action?: AgentAction;
  planSignal?: PlanBodySignal;
}

/**
 * Maps the current Stage.subgoal to a body routine.
 * Returns undefined when the subgoal text is not recognized
 * (caller falls back to goal-driven action selection).
 */
export function planStageRouter(
  stage: Stage,
  perception: BodyHybridPerception,
): PlanBodyResult | undefined {
  const sub = stage.subgoal.toLowerCase();

  // Recognizer patterns — extend as new stages are authored.
  if (/axe|woodcutting.*tool|acquire.*axe/.test(sub)) {
    const action = acquireWoodcuttingAxeAction(perception);
    const hasSufficientAxe = perception.inventory.some(i => i && WOODCUTTING_AXE_IDS.has(i.itemId));
    return { action, planSignal: hasSufficientAxe ? 'stage_done' : undefined };
  }
  if (/chop.*log|gather.*log|woodcutting.*log/.test(sub)) {
    const action = levelOneWoodcuttingAction(perception);
    return { action };
  }
  if (/light.*fire|firemaking/.test(sub)) {
    const action = firemakingAction(perception);
    return { action };
  }
  if (/fish|gather.*shrimp|fishing/.test(sub)) {
    const action = starterFishingAction(perception);
    return { action };
  }
  if (/cook|prepare.*food/.test(sub)) {
    const action = starterFishingCookingAction(perception);
    return { action };
  }
  if (/mine|mining|ore/.test(sub)) {
    const action = starterMiningAction(perception, { targets: [] });
    return { action };
  }
  if (/bury.*bone|prayer/.test(sub)) {
    const action = buryBonesAction(perception);
    return { action };
  }

  return undefined; // unknown subgoal — caller falls back
}
```

**Design notes:**
- Pattern matching on `subgoal` text is intentionally fuzzy — the planner prompt language may vary.
- The `hasSufficientAxe` success signal for the axe stage is a concrete observable. Other stages use time-boxing (§2b).
- New patterns are added here as new plan stage types are authored; no other files change.

### 2b. Stage completion via tick-boxing (v1 simplification)

The `Stage.successCriteria` field is a free-text string (e.g., "has an axe in inventory", "Firemaking XP increased"). Evaluating arbitrary criteria is a Phase 4+ problem. For v1 (RIQ-3-2B):

- **Observable criteria** (inventory/item checks): `planStageRouter` returns `planSignal: 'stage_done'` when it detects the condition.
- **Activity criteria** (XP gain, kills, etc.): stage advances after `PLAN_STAGE_TICK_BUDGET` ticks of active routing (no permanent `stage_blocked` signals). Default: 600 ticks (~5 minutes at 0.5s/tick).
- **Blocked signal**: if `planStageRouter` returns `action: undefined` for more than `PLAN_STAGE_STUCK_THRESHOLD` consecutive ticks, emit `stage_blocked`. Default: 120 ticks.

These constants go in `runescape-body-routines.ts`:
```ts
export const PLAN_STAGE_TICK_BUDGET = 600;
export const PLAN_STAGE_STUCK_THRESHOLD = 120;
```

---

## 3. Call site in `ResidentRuntime` (the full integration loop)

The integration happens in the body-action selection path — NOT in the Brain tick. Pseudocode:

```ts
// In ResidentRuntime's action selection (after Nervous reflexes, before goal-driven Body):
const plan = this.planStore.load(residentId);
const stage = plan ? currentStage(plan) : undefined;

if (stage && stage.status === 'active') {
  const planResult = planStageRouter(stage, perception);
  if (planResult !== undefined) {
    // Track consecutive non-action ticks for stuck detection
    this.planStageTick[residentId] = (this.planStageTick[residentId] ?? 0) + 1;

    if (planResult.planSignal === 'stage_done' ||
        this.planStageTick[residentId] >= PLAN_STAGE_TICK_BUDGET) {
      const advanced = advancePlan(plan);
      this.planStore.save(residentId, advanced);
      this.planStageTick[residentId] = 0;
      // maybeTriggerPlannerPass will see completed/blocked on next Brain tick
    } else if (!planResult.action &&
               this.planStageTick[residentId] >= PLAN_STAGE_STUCK_THRESHOLD) {
      this.planStore.save(residentId, blockCurrentStage(plan));
      this.planStageTick[residentId] = 0;
    }

    if (planResult.action) return { action: planResult.action, cause: `plan:${stage.id}` };
  }
  // Fall through to goal-driven selection if stage not recognized
}
```

`planStageTick` is a `Map<string, number>` (in-memory per-resident counter, reset on stage advance/block/restart).

---

## 4. Survival-preserves-plan invariant

**Invariant:** a Nervous-system interrupt (eat-when-low-HP, flee-on-attack) must NOT:
- Call `planStore.clear()`
- Call `blockCurrentStage()` or `advancePlan()` on the plan

**How this is guaranteed (already true):**
- Nervous reflexes (`nervous-system.ts`) run in their own path and do not call `planStore`.
- `maybeTriggerPlannerPass` is called only from `runBrain` (the Brain tick), never from Nervous.
- The Body's plan-stage logic in §3 runs AFTER Nervous returns — it only fires when Nervous returns `undefined` (no urgent reflex).

**Test to add (in `plan-store-brain-integration.test.ts`):**
- Simulate a Nervous interrupt firing (low-HP eat reflex).
- Assert `planStore.load()` returns the same plan after the interrupt.
- Assert `maybeTriggerPlannerPass` is NOT called during the interrupt tick.

---

## 5. Files to modify

| File | Change |
|---|---|
| `src/controller/resident-runtime.ts` | Instantiate `PlanStore`; pass to `HelperContext.options.planStore`; add `planStageTick` map; add plan-stage routing block in action selection |
| `src/controller/spark/runescape-body-routines.ts` | Add `PlanBodyResult` type; `PlanBodySignal` type; `planStageRouter` function; `PLAN_STAGE_TICK_BUDGET` / `PLAN_STAGE_STUCK_THRESHOLD` constants |
| `src/controller/spark/runescape-body-routines.test.ts` | Tests for `planStageRouter` per recognized subgoal pattern |
| `src/controller/intelligence/plan-store-brain-integration.test.ts` | Survival-preserves-plan integration test |

> **Note:** The original S-TOOL-ACQUIRE-4 lock was stale when RIQ-3-2B source work landed. The implementation also needed the helper/type seams in `src/controller/thinking/*`, `src/controller/spark/runtime-facets.ts`, and `src/controller/controller-host.ts` so the tested plan path exists in production.

---

## 6. Acceptance test (Phase 3 §4)

> Scenario A1: a resident forms a Firemaking plan, completes ≥2 stages with strictly-increasing XP, 0 deaths, and the plan survives a controller restart.

RIQ-3-2B closes the following sub-conditions of A1:
- ✅ Plan persists across restart (PlanStore, done in RIQ-3-1)
- ✅ PlannerPass fires on null/completed/blocked plan (RIQ-3-2)
- ✅ Library events record plan creation/replan (RIQ-3-3)
- **This packet (RIQ-3-2B):** Body executes the current stage; stage advances to `done`; `maybeTriggerPlannerPass` sees the completed stage and fires a new plan for the next stage.
- **Still needed (live-verify only):** a real planner-model call (needs `planner_haiku` on hot stack) to validate the full A1 loop end-to-end.

---

## 7. Effort estimate

~4–8 hours for an agent with the hot stack available (live A1 verification needs a running planner).

Cloud-only (this agent): implement §1 wiring + §2 `planStageRouter` + §5 tests. Mark live A1 as PENDING.
