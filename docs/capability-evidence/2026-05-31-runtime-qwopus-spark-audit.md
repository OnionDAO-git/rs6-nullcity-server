# Runtime qwopus + SPARK timeout audit — 2026-05-31

## Summary

This slice restarted the controller after the local SPARK timeout parity fix (`ae777084`), prompt-token inference audit fix (`1b943359`), and Claude's S-INFER-4 limit changes (`51fd02e9`). The old controller process had become orphaned after its `screen` session exited, so the first restart hit the controller lock, then the stale PID was terminated and the stale lock file was removed after confirming PID `60762` was gone.

Result: the stack is running again with controller PID `62228`, gateway connected, dashboard endpoints live, and post-S-INFER-4 inference health is good in the sampled window. Live behavior is still yellow on several residents because smoke found action timeouts, hold loops, and hero template cadence, but the immediate "qwopus never answers" failure was not present in the post-restart audit.

## Commands and Evidence

- `npm run build` — pass, `842` files compiled.
- Restarted only `nullcity-controller-codex`; left infra/game/dashboard running.
- Controller log: `/tmp/nullcity-runtime/controller-20260531T204829Z.log`.
- Controller PID after final restart: `62228`.
- HTTP probes:
  - `http://127.0.0.1:43596/v1/wall/snapshot` returned a wall payload.
  - `http://127.0.0.1:43611/api/nullcity/economy/heartbeat` returned `residentCount=25`, `activeResidentCount=23`, `degradedFlags=[]`.
  - `http://127.0.0.1:8787/api/overview` returned gateway/controller availability.
- `npm run inference:canary -- --endpoints=default,spacetower_qwopus_q4 --timeout-ms=90000`
  - `default`: PASS, `2250ms`, model `qwopus3.5-27b-v3@q4_k_s`.
  - `spacetower_qwopus_q4`: PASS, `2350ms`, model `qwopus3.5-27b-v3@q4_k_s`.
- `npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible`
  - Returned WARN, not FAIL.
  - 23 residents observed.
  - Strong live proofs included `res:qa-woodcutter` 14 actions / 16 results / 16 successes, `res:qa-survivor` 14 actions / 15 results / 13 successes, `res:qa-priest` 5 actions / 6 successes, and `res:qa-cook` 7/7 successes.
  - Remaining yellow signals: effect timeouts for several residents, `follow_listen_hold` on trader, `combat_hold` on survivor, and hero template cadence.
- `npm run controller:inference-audit -- --start=2026-05-31T20:48:29.000Z --end=2026-05-31T20:50:27.000Z --top=20`
  - `residents=23`
  - `brainDecisions=55`
  - usable brain/SPARK rate `92.7%` (`clean=51`, `cancelled=3`, `schema=1`, no think-only/empty in this post-S-INFER-4 window)
  - `goalsEmitted=20`
  - goal follow-through `73.0%` (`138/189` attributable actions)
  - artifact: `data/benchmarks/capability-qa-2026-05-31/inference-audit/inference_health_audit_20260531T205034Z.json`

## Live Behavior Seen

The restarted controller immediately produced successful evidence suggestions for ordinary workflows:

- `res:qa-cook` moved along the starter-fishing route and succeeded in fishing/cooking-related routines.
- `res:qa-woodcutter` moved to a tree, chopped, and lit a fire successfully.
- `res:agent` resumed woodcutting route movement.
- `res:qa-guardian` moved toward a safe-combat target area.
- `res:qa-survivor` landed a safe combat attack on a `Man` NPC.

These are routine/SPARK-assisted actions, but they are real RuneScape actions with observed effects after the current restart.

## Remaining Risks

- The 60s smoke is still yellow: effect timeouts and hold loops remain visible.
- Heroes still emit "Still here as..." template cadence even while they move/speak; better authored hero cadence remains a separate work item.
- The controller log still shows a `MaxListenersExceededWarning` on `GatewayClient`; no crash observed, but it is worth a follow-up if it correlates with action queue pressure.

## Next

Keep the controller running, then rerun a longer post-S-INFER-4 audit:

```bash
npm run controller:smoke -- --observe-seconds 120 --allow-recent-visible
npm run controller:inference-audit -- --duration-ms=600000 --top=30
```

Success target: keep usable brain/SPARK rate above `85%`, reduce quiet/hold-loop smoke warnings, and raise goal follow-through above `70%` over a longer window.
