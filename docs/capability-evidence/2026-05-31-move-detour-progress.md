# S-MOVE-DETOUR-1 - movement detours count as progress

Packet: `S-MOVE-DETOUR-1`  
Issue: `QA-20260531-059`  
Owner: Codex  
Date: 2026-05-31

## Why

Two read-only scouts independently found that current `controller:smoke` movement warnings were often not dead movement. Residents were visibly stepping, but the runtime waited for the original semantic `move_to` target. If the game routed them sideways and Chebyshev distance stayed equal, the attempt became an effect timeout.

Examples from recent live trajectories:

- `res:qa-forager` moved from `3195,3276` to `3194,3276` while trying to reach `3195,3284`; distance stayed `8`.
- `res:qa-banker` moved from `3205,3221` to `3205,3220` while trying to reach `3202,3221`; distance stayed `3`.

That is not completion, but it is real same-plane movement and should not poison `targetFailureCooldowns` as if the target was impossible.

## Fix

`movementWaitToEffect()` now has three timeout outcomes:

- `movement_progress`: resident moved closer to the semantic target.
- `movement_detour`: resident moved on the same plane but stayed the same Chebyshev distance from the semantic target.
- `movement_timeout`: resident did not move, moved farther, changed plane unexpectedly, or otherwise failed to show useful progress.

`movement_detour` returns a successful action result with evidence fields `detoured: true`, `improved: false`, `startDistance`, `finalDistance`, and `waitOutcome: timeout`. Because it is a success, it does not write `targetFailureCooldowns`.

## Evidence

Red/green focused test:

```bash
npm test -- --runTestsByPath src/controller/resident-runtime.test.ts -t "same-distance timed out movement" --runInBand
```

Result: failed before implementation because the same-distance step wrote a target failure cooldown; passed after implementation.

Expanded focused suite:

```bash
npm test -- --runTestsByPath src/controller/resident-runtime.test.ts --runInBand
```

Result: `80/80` tests passed.

Repository gates:

```bash
npm test -- --runTestsByPath src/controller/spark/spark-evidence.test.ts src/controller/admin/inference-health-audit.test.ts src/controller/spark/hook-evaluator.test.ts src/controller/nervous-system/nervous-system.test.ts --runInBand
npm run typecheck
npm run check:no-ui
git diff --check
npm run build
```

Result: adjacent controller suites passed `81/81`; typecheck, server UI boundary, diff check, and build passed (`843` files compiled).

## Notes

- This is a conservative classification. Moving farther still remains a timeout.
- A deeper engine fix would return the effective queued destination from the game action adapter so the controller waits for the actual queued step instead of inferring from perceptions. That is broader than this packet.
