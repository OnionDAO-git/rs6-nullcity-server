# QA-20260602-081 Stuck Churn Live Analysis

## TLDR

`res:qa-trader` was spending a large part of the hot-stack audit repeatedly submitting `acquire_axe_travel_to_shop`. The root cause was a deterministic body-routine loop: after a resident reached Bob's known axe-shop tile but Bob was missing from perception, `acquireWoodcuttingAxeAction` kept returning the same `move_to` target instead of reporting a bounded block or letting higher-level recovery choose another tactic.

This patch prevents the same-target walk loop. At the known shop tile, when Bob is not visible, the routine now emits one bounded `acquire_axe_shopkeeper_missing` status line through the persisted acquisition state, then returns `undefined` until the cooldown expires.

## Evidence

- Source artifact: `data/benchmarks/capability-qa-2026-06-02/normal_life_audit_20260602T200640Z.json`
- Window: `2026-06-02T18:36:40.645Z` through `2026-06-02T20:06:40.645Z`
- Active residents: `10`
- Action submissions: `5094/5094`
- Stuck churn: `443` detected / `442` recovered / `1` unresolved
- Top action cause: `acquire_axe_travel_to_shop=1006`
- `res:qa-trader` was one of the repeated top stuck-churn residents from the issue row and prior CQA10 notes.

The code path matched the artifact: `acquireWoodcuttingAxeAction` travelled to `BOB_AXE_SHOP` whenever Bob was not in nearby NPC perception. There was no guard for already being at `BOB_AXE_SHOP`, so the resident could keep submitting a successful but non-progressing `move_to` to the same coordinate.

## Fix

- Added an arrival guard in `src/controller/spark/runescape-body-routines.ts`.
- Persisted `lastShopkeeperMissingTick` alongside the existing `lastShopOpenTick` in the acquisition state.
- Added a focused regression in `src/controller/spark/acquire-tool.test.ts` proving the routine reports `acquire_axe_shopkeeper_missing` once and does not immediately repeat the same shop travel action.

## Verification

```bash
npm test -- src/controller/spark/acquire-tool.test.ts
```

Result: `7/7` passing.

## Remaining Follow-Up

This closes one concrete repeat-move source, not all stuck churn. Next useful checks:

- Re-run a 15-30 minute normal-life audit after the runtime steward deploys/restarts onto this build.
- Confirm `acquire_axe_travel_to_shop` is no longer a dominant cause.
- Continue with `QA-20260602-082` for ordinary trade/AP-GP recurrence, since the same audit still showed no spontaneous trade closure.
