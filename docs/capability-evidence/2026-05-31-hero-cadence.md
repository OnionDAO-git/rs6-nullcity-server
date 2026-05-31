# S-HERO-CADENCE-1 - hero visible cadence during slow brain turns

Packet: `S-HERO-CADENCE-1`  
Issue: `QA-20260531-058`  
Owner: Codex  
Date: 2026-05-31

## Why

After the qwopus model switch, flagship heroes can spend a slow brain turn doing useful but non-visible work, such as writing memory, while a 60s smoke/demo window sees no action or speech. That makes an alive resident look dead to operators and to humans watching the dashboard.

Read-only sidecar review found Hans was not dead: the active session had successful visible events, but with gaps up to about 82 seconds. A 60s observe window can land in one of those quiet valleys.

## Fix

`Spark.tick()` now preserves the model's memory/self-modification result, but if a hero completion produces no action and the hero's visible cadence is due, it appends the existing hero idle initiative action pair:

- `say` with the hero presence line
- `move_to` around the hero anchor

The decision cause is suffixed with `_idle_initiative`, for example `completion_memory_update_idle_initiative`, so telemetry still shows that the brain turn wrote memory while the body also produced visible proof of life.

## Evidence

Focused red/green test:

```bash
npm test -- --runInBand src/controller/spark/spark-evidence.test.ts --testNamePattern 'keeps a hero visible when a due brain turn only writes memory'
```

Result: passed after implementation. The test proves a hero brain completion with only `memo` still writes memory and emits `say + move_to` when the hero visible cadence is due.

Expanded focused suite:

```bash
npm test -- --runInBand src/controller/spark/spark-evidence.test.ts
```

Result: `21/21` tests passed.

Live check against the running controller before loading the new code:

```bash
npm run controller:smoke -- --resident res:hans --observe-seconds 60 --allow-recent-visible
```

Result: exit `0`; Hans had `actions=4`, `results=4`, `success=4`, `timeout=0`, `effectTimeout=0` in the observed 60s window. This confirms the current running resident was alive; the code fix addresses the intermittent silent-window case identified from the same live evidence.

## Notes

- This packet intentionally does not change movement effect-timeout semantics. Sidecars found that many current `move_to` warnings are residents making a real local detour while the runtime waits for the original semantic target. That should be fixed separately in `resident-runtime.ts` so a detour can be classified as progress instead of an effect timeout.
- Existing foreign dirty files were left unstaged: inference-health audit changes, goal-follow-through formatting, runtime/hooks changes from other active work.
