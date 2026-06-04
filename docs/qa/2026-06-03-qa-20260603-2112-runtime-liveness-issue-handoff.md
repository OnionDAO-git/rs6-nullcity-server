# QA-20260603-093 Controller Status False ERRORING / Tick Coherence

Packet: `qa-20260603-2112-runtime-liveness-readtruth`

Classification: P1 process/runtime observability. The runtime is live, but the canonical `controller:status` operator check exits non-zero and marks a flagship resident `ERRORING`, which can misdirect automated QA/dev triage.

Owner area: controller observability/status pipeline, especially `src/controller/observability/status-aggregator.ts`, `src/controller/admin/status-cli.ts`, and the runtime-state/progress/trajectory writers.

## Evidence

- `npm run controller:status` at `2026-06-04T02:14:19Z` returned `HEALTH: ok` for `default/qwopus3.5-27b-v3@q4_k_s`, but exited `2` with `residents=25 erroring=1`.
- The flagged row was `res:hans -- ERRORING (inference) -- goal: no active goal`, with `act=362073t`.
- In the same cycle, `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible` showed `OK res:hans`, `+30t`, observed `results=1 success=1`, `lastAction=move_to`, `lastResult=success`.
- The global inference health file was fresh and green: `ok=true`, `status=ok`, `endpoint=default`, `model=qwopus3.5-27b-v3@q4_k_s`, `generatedAt=2026-06-04T02:15:18.342Z`.
- `data/controller/memory/res-hans/runtime-state.json` mtime was current (`2026-06-03 21:16:15 CDT`) but contained `tick=408518`, `stuckSince=408517`, `lastMeaningfulProgressAt=408516`.
- The current Hans trajectory/progress files at the same time were around tick `46645`, with fresh `begin_tick` / `end_tick` rows and progress rows at `2026-06-04T02:16:05Z`.
- Recent Hans trajectory also shows fallback speech/movement succeeding after a `request_timeout` decision, for example `request_timeout` at tick `46570`, followed by successful chat evidence and successful `move_to` result by tick `46577`.

## Why This Looks Like A Status Bug

The status aggregator appears to combine a fresh-but-clock-skewed `runtime-state.json` tick with current trajectory rows, producing huge `ticksSinceAction` values. It also counts all recent `decision` rows in `inferenceErrorSummary()`, including no-cause controller/no-op decisions that are not inference-bearing in the richer `inference-health-audit` classifier. With only a couple recent decision rows, that can classify a still-acting resident as `ERRORING`.

This is distinct from existing stuck-churn issue `QA-20260602-081` / `QA-20260529-006`: Hans was moving and the smoke accepted him; the failing surface here is the operator status contract.

## Suggested Next Action

1. Add a focused regression around `buildCityStatus()` for mixed runtime-state and trajectory clocks plus recent fallback-success evidence.
2. Reuse the inference-bearing gate from `inference-health-audit` or equivalent logic so no-cause controller decision rows do not count as failed inference.
3. Prevent `controller:status` from marking a resident `ERRORING` when fallback action/speech succeeds in the same recent window unless repeated true inference-bearing failures remain above threshold.
4. Investigate why Hans's `runtime-state.json` mtime is fresh while its tick/stuck fields lag the evidence stream by ~362k ticks.

## Verification Recipe

Read-only repro on the shared stack:

```sh
npm run controller:status
npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible
jq '{tick, stuckSince, lastMeaningfulProgressAt, cognition}' data/controller/memory/res-hans/runtime-state.json
tail -1 data/controller/memory/res-hans/evidence/trajectory/current
tail -1 data/controller/memory/res-hans/evidence/progress/current
```

Expected after fix: `controller:status` should not exit non-zero solely because a live fallback-moving resident has recent no-cause/control decision rows or mismatched status clocks.
