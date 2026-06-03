# RIQ Phase 4 — Arbitrary-Goal Support Design

**Date:** 2026-06-03
**Author:** cron (RIQ-PHASE4-DESIGN, issue QA-20260603-089)
**Status:** Design spec — no code yet. Phase 3 source done; live A1 verify PENDING.

Extends `docs/superpowers/plans/2026-06-01-resident-intelligence-roadmap.md` §4/§8.

---

## 0. Gap this fills

Phase 3 shipped `PlanStore`, `PlannerPass`, `planStageRouter`, and plan Library events. The gap:
`planStageRouter` returns `undefined` for any stage that does not match a RuneScape skill keyword.
Open/creative goals have no template path and no machine-checkable done criterion.

Phase 3 live A1 verification (Firemaking plan survives restart) is PENDING on a hot stack and is the
hard gate before Phase 4 code begins (or explicit maintainer override to start in parallel).

---

## 1. Schema extensions (`planner-pass.ts`)

**`GoalClass`** — new union type: `'runescape_skill' | 'spatial' | 'creative' | 'social'`.
Added as optional `goalClass?: GoalClass` on `Plan`. Absent → defaults to `'runescape_skill'`
(Phase 3 plans unaffected, no migration).

**`PrimitiveStep`** — `{ action: AgentAction; advanceWhen: 'action_result' | 'next_tick' }`.
Added as optional `steps?: PrimitiveStep[]` (max 8) on `Stage`. Holds concrete game actions
(`move_to`, `drop`, `say`, `interact`, `use_item_on`) authored by the planner for open-goal stages.

**`SuccessPredicate`** — discriminated union, added as optional `successPredicate?` on `Stage`:
- `{ kind: 'library_event_count'; eventPattern: string; threshold: number }` — count of Library timeline events matching a pattern ≥ threshold
- `{ kind: 'items_at_tiles'; objectIds: number[]; tileCount: number }` — ground items visible at target tiles
- `{ kind: 'ticks_elapsed'; ticks: number }` — elapsed ticks since stage started
- `{ kind: 'self_assessment' }` — never auto-closes; triggers a re-plan so the Brain judges

Zod validators extend `stageDraftSchema`/`planDraftSchema` with the new optional fields.

---

## 2. Open-goal stage router (`runescape-body-routines.ts`)

Extend `planStageRouter` with a final `steps`-based branch inserted before `return undefined`:
when `stage.steps` is non-empty, call `openGoalStageStep(stage, perception)` instead.

`openGoalStageStep` advances a `_primitiveStepIdx` counter stored in `CognitiveState` (keyed by
`stageId`). Advance condition mirrors `PlanExecutor`: `'action_result'` → advance after non-null
`lastActionResult`; `'next_tick'` → advance on the following tick. When all steps are exhausted,
call `evaluateSuccessPredicate` → return `stage_done` or `stage_blocked`.

Fallback: `steps` absent or empty on a non-skill stage → `planStageRouter` returns `undefined` →
Body falls through to LLM inference (identical to today's behavior, graceful degradation).

---

## 3. Success predicate evaluator (`plan-predicates.ts` — new file, ~50 lines)

`evaluateSuccessPredicate(stage, perception, libraryTimeline?)` dispatches on `successPredicate.kind`:
- `library_event_count`: filter `libraryTimeline` entries by `eventPattern` substring match; return count ≥ threshold
- `items_at_tiles`: scan `perception.nearby.objects` for ground items with matching `objectId`; return count ≥ `tileCount`
- `ticks_elapsed`: compare `perception.tick - stage._startedAtTick` ≥ `pred.ticks`
- `self_assessment`: always returns `false` (re-plan gate)

`_startedAtTick` set transiently on `Stage` when it first becomes active in `routeActivePlanStage`.

---

## 4. Library logging (`library-updater.ts`)

Add `observeOpenGoalProgress(residentId, { goalId, stageId, note })` emitting
`open_goal_progress` event into the Library timeline.

Called from `routeActivePlanStage` when `stage_done` fires on a plan where `goalClass` is not
`'runescape_skill'` (and `steps` was present). This makes open-goal progress narratable and visible
to the Storyteller substrate.

---

## 5. PlannerPass prompt extension

`buildPlannerPassPrompt` gains a `## GOAL CLASSIFICATION` block with:
1. GoalClass definition + one worked example per class
2. For `spatial`/`creative`/`social` goals: require `steps[]` per stage (≤8 actions from the
   existing game action vocab)
3. `successPredicate` schema with one worked example per kind

`parsePlannerPassOutput` validation: non-`runescape_skill` stage with `steps.length === 0` is a
parse error → plan is rejected and re-tried or falls back to LLM-only Body.

---

## 6. Acceptance paths

**A2 — spatial: "spell ONIONDAO with onions on the ground"**
PlannerPass emits `goalClass: 'spatial'`; stages = `gather_onions → place_letter_O → place_letter_N → …`
Each letter stage has `steps: [move_to(tile), drop(onion_id), …]` and
`successPredicate: { kind: 'items_at_tiles', objectIds: [ONION_ITEM_ID], tileCount: N }`.
`evaluateSuccessPredicate` checks `perception.nearby.objects` for ground onions at letter tiles.
On `stage_done` → `observeOpenGoalProgress` writes to Library.

**A3 — creative: "become the best poet"**
PlannerPass emits `goalClass: 'creative'`; stages = `compose_poem_1 → share_poem_1 → reflect → …`
Each poem stage has `steps: [say(poem text)]` and
`successPredicate: { kind: 'library_event_count', eventPattern: 'say', threshold: 1 }`.
A `self_assessment` stage fires the planner to judge overall progress when milestone count is hit.

---

## 7. Registered packets

| Packet | Deliverable | Cloud-doable? | Depends on |
|---|---|---|---|
| **RIQ-4-1** | Schema ext (`GoalClass`/`PrimitiveStep`/`SuccessPredicate`) + Zod + PlannerPass prompt | Yes | Phase 3 source |
| **RIQ-4-2** | `openGoalStageStep` + `_primitiveStepIdx` in `CognitiveState` | Yes | RIQ-4-1 |
| **RIQ-4-3** | `evaluateSuccessPredicate` in `plan-predicates.ts` + helpers | Yes | RIQ-4-1 |
| **RIQ-4-4** | `observeOpenGoalProgress` wired in `routeActivePlanStage` | Yes | RIQ-4-2 |
| **RIQ-4-5** | A2 acceptance test (spatial: onions placed → letters detected) | Hot stack | RIQ-4-2/3 |
| **RIQ-4-6** | A3 acceptance test (creative: poems logged + self-assessed progress) | Hot stack | RIQ-4-2/3 |

---

## 8. Key invariants

1. `goalClass` absent → `'runescape_skill'` (Phase 3 plans unaffected)
2. Open-goal stage with `steps` absent or empty → `planStageRouter` returns `undefined` → Body LLM (graceful degradation)
3. Survival never aborts an open-goal plan — A4 invariant from Phase 3 preserved unchanged
4. PlannerPass calls remain RARE (stage boundary only) — steps are authored once per stage, not per tick
5. `self_assessment` predicate never self-closes; it triggers a re-plan so the Brain judges, not rule-based code

*Start gate for RIQ-4-1:* Phase 3 A1 live-verified on hot stack, or maintainer approves starting Phase 4 source in parallel while A1 verify is pending.
