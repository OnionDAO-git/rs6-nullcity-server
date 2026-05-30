# S8c AP/GP Hierarchy + Library Strategy Evidence Attempt (2026-05-29)

Packet: `S8c` (lane D)  
Issue link: `QA-20260529-008`

## What Landed

- Added AP/GP hierarchy knowledge entry: `economy-ap-gp-goal-hierarchy`.
- Added AP/GP/Library hierarchy guardrails to Brain/Body prompts.
- Added benchmark goal mapping and task substrate:
  - `ap-gp-library-strategy-5m`
  - benchmark resident attention override for low-AP pressure
  - CLI/core benchmark wiring + tests.

## Verification That Passed

- Focused tests:
  - `src/controller/knowledge/knowledge-retriever.test.ts`
  - `src/controller/knowledge/game-skill-context.test.ts`
  - `src/controller/thinking/hybrid-agent-prompts.test.ts`
  - `src/controller/spark/runescape-brain-planner.test.ts`
  - `src/controller/benchmarks/tasks/ap-gp-library-strategy-5m.test.ts`
  - `src/controller/benchmarks/cli.test.ts`
- Boundary/build checks:
  - `npm run check:no-ui`
  - `npm run build`
- Benchmark dry-run proof:
  - `npm run controller:bench -- --task ap-gp-library-strategy-5m --module onion.runescape.standard --mode autonomous --dry-run`
  - Output task id/version: `ap-gp-library-strategy-5m@0.1.0`.

## Live Proof

Live autonomous benchmark proof now passes on loopback-ready infra:

- Command: `npm run controller:bench -- --task ap-gp-library-strategy-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29`
- Artifact: `data/benchmarks/capability-qa-2026-05-29/bench_20260530030614_ap_gp_library_strategy_5m.json`
- Result: `passed`, score `1`, elapsed `3081ms`.
- Metrics:
  - `lowAttentionObserved=1`
  - `coinGroundObserved=1`
  - `coinPickupActions=2`
  - `successfulCoinPickupActions=2`
  - `gpGainedFromGround=1`
  - `gpObservedAmount=25`
  - `practicalStrategySayActions=2`
  - `selectedModuleActions=5`
  - `meaningfulProgressTicks=2`

Observed behavior:

- Benchmark seeded visible RuneScape GP item `995`.
- The selected `onion.runescape.standard` module picked up the coins via `opportunistic_pickup` with successful action-effect evidence.
- The resident emitted AP/GP/Library strategy narration under low AP pressure: keep Attention alive, gather coins, then spend GP toward the Soul goal.
- The nervous-system low-AP attention request fired at `attentionAfter=10`, proving the strategy happened under real AP pressure rather than a high-AP idle plan.

Code hardening landed with the proof:

- Critical AP now lets the body act immediately instead of waiting for normal body cadence.
- The AP/GP Library strategy routine retries the visible GP pickup path under critical AP and narrates strategy only after real carried GP is observed.
- The benchmark verifier accepts low-AP evidence from live action metadata when gateway perceptions omit attention.
- Autonomous verifier filtering retains untagged nervous-system low-AP context while still requiring selected-module pickup/strategy actions.

## Historical Blocker

## Rerun Attempt (2026-05-29 13:07 CDT)

- Command:
  - `npm run controller:bench -- --task ap-gp-library-strategy-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29`
- Result:
  - Build step succeeded; benchmark startup failed before artifact creation.
  - Error remained `connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`.
- Outcome:
  - This specific attempt was infra-blocked in the sandbox.
  - No new benchmark artifact id was produced.

## Earlier Attempts (2026-05-30 CDT)

- `bench_20260530025003_ap_gp_library_strategy_5m.json` and `bench_20260530025906_ap_gp_library_strategy_5m.json` both showed useful behavior (successful GP pickup + AP/GP/Library strategy say + low-AP nervous appeal) but timed out before verifier fixes. They are retained as debugging evidence, not final proof artifacts.
