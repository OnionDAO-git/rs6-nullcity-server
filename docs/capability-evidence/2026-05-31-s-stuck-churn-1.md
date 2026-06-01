# S-STUCK-CHURN-1 - Progress threshold false-positive reduction

Date: 2026-05-31

## Status

Shipped a small runtime progress-threshold fix to reduce normal-life stuck churn false positives.

## Why

The 60m CQA10 companion soak showed `stuckDetected=1714` and `stuckRecovered=1592` while residents were still moving, talking, cooking, eating, resupplying, and gaining XP. A live log spot check showed repeated pairs like:

- `res:qa-social`: `stuck_detected` every normal scouting pause, followed by `stuck_recovered` with reason `position_changed` on the next one-tile `stuck_pre_inference_explore` move.
- `res:qa-banker`: frequent `stuck_detected`/`stuck_recovered` pairs mixed with ordinary patrol, NPC talk, and status speech.

This points to a false-positive cadence problem: the default progress tracker threshold was `20` ticks, which is shorter than many ordinary action/perception gaps in the live loop. That made a resident look stuck between normal scouting movements and then immediately "recover" once the next movement changed position.

## Change

Raised the default `ProgressTracker` `stuckThresholdTicks` from `20` to `45`.

The new regression covers both sides:

- A 30-tick ordinary scouting pause does not emit `newStuck`.
- A 45-tick no-progress stall still emits `newStuck`.

Runtime tests that verify persisted runtime-clock behavior were updated to cross the new default threshold while preserving their original invariant: `stuckSince` is stored on the runtime clock and never in the future.

## Verification

Red proof:

```bash
npx jest src/controller/evidence/progress-tracker.test.ts --runInBand
```

Failed before the production change because tick `31` emitted `newStuck: true` and `stuckSince: 31`.

Green proof:

```bash
npx jest src/controller/evidence/progress-tracker.test.ts src/controller/resident-runtime.test.ts --runInBand
```

Result: 2 suites passed, 71 tests passed.

## Expected Impact

After the running controller picks up this change, ordinary residents should stop producing Library-visible stuck/recovered churn during 20-30 tick action cadence gaps. True no-progress stalls remain visible after 45 ticks, so movement recovery still has room to fire for real blocked routes.

## Follow-up

Run a fresh 20-60m normal-life audit after restart and compare `stuckDetected/stuckRecovered` against the CQA10 60m baseline (`1714/1592`). If churn remains high, the next root cause is likely actual pathing around `faction_landmark_return` / `faction_landmark_recovery` or repeated one-tile `stuck_pre_inference_explore` probes, not the progress threshold.
