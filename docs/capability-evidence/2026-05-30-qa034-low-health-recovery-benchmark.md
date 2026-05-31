# QA-20260530-034: Low-Health Cook/Eat/Reengage Benchmark Substrate

Date: 2026-05-30
Packet: QA-20260530-034
Area: Combat/survival recovery proof

Follow-up:

- 2026-05-31 `QA-20260530-035` (same packet family) added post-connect inventory ensure seeding so the low-health benchmark does not depend on create-time inventory sticking in live gateway conditions.
- 2026-05-31 `QA-20260530-036` hardened the verifier after hot-stack artifact review:
  - engine-side `IdleBrain` no longer eats raw/burnt food while waiting for controller ownership,
  - passive Lumbridge guards no longer suppress low-health cooking,
  - the benchmark ignores thinking-only attack proposals and counts live range `interact` cooking evidence.

## Goal

Add a focused benchmark task that can strictly verify the low-health recovery chain:

1. resident starts low HP with raw fish,
2. cooks food,
3. eats,
4. safely reengages combat.

## Code/Test Changes

- Added benchmark task implementation:
  - `src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.ts`
- Added/updated focused tests:
  - `src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts`
  - `src/controller/benchmarks/cli.test.ts`
- Wired task into benchmark CLI/core suite:
  - `src/controller/benchmarks/cli.ts`
- Wired benchmark-goal mapping for the new task id:
  - `src/controller/spark/runescape-brain-planner.ts`
  - `src/controller/spark/runescape-brain-planner.test.ts`
- QA035 follow-up (2026-05-31):
  - `src/controller/benchmarks/benchmark-runner.ts`
  - `src/controller/benchmarks/benchmark-runner.test.ts`
  - `src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.ts`
  - `src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts`
  - Added `ensureInventoryItem` to `BenchmarkTaskContext` (optional), wired through `BenchmarkRunner` when gateway support is available, and used by `low-health-cook-eat-reengage-5m` setup to ensure raw shrimp + tinderbox + logs + axe after resident connect.
- QA036 follow-up (2026-05-31):
  - `src/engine/world/actor/resident/brain/idle-brain.ts`
  - `src/engine/world/actor/resident/brain/idle-brain.test.ts`
  - `src/controller/spark/runescape-body-routines.ts`
  - `src/controller/spark/runescape-body-routines.test.ts`
  - `src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.ts`
  - `src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts`
  - Fixed the raw-food idle race, passive-threat false positive, first-perception inventory race, and two verifier false positives/mismatches found in live artifacts.

## Verification

Focused packet tests (PASS):

- `npm test -- --runInBand src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts src/controller/benchmarks/cli.test.ts`
- `npm test -- --runInBand src/controller/benchmarks/benchmark-runner.test.ts src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts`
- `npm test -- --runInBand src/engine/world/actor/resident/brain/idle-brain.test.ts src/controller/spark/runescape-body-routines.test.ts src/controller/benchmarks/benchmark-runner.test.ts src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts --no-coverage`

Required server gates:

- `npm run check:no-ui` PASS
- `npm run typecheck` PASS
- `npm run build` PASS
- `npm run fin` FAIL in sandbox-only loopback suites (`listen EPERM 0.0.0.0` in `gateway-client.test.ts`)

## Live Benchmark Proof

Attempted:

- `npm run controller:bench -- --task low-health-cook-eat-reengage-5m --module onion.runescape.standard --mode autonomous --output-dir data/benchmarks/capability-qa-2026-05-30/qa034-low-health-cook-eat-reengage`

Result:

- PASS, score `1`
- Artifact: `data/benchmarks/capability-qa-2026-05-30/qa034-low-health-cook-eat-reengage/bench_20260531050333_low_health_cook_eat_reengage_5m.json`
- Resident: `res:bmk_low_hea_01gq3mrx`
- Metrics:
  - `lowHealthStartObserved=1`
  - `rawFishInitiallyCarried=1`
  - `successfulCookingActions=1`
  - `eatActions=1`
  - `hpImprovedAfterEat=1`
  - `safeReengageAttacks=1`
  - `combatEvidence=1`
  - `cookedFishObserved=1`
  - `recoveryChain=1`
- Ordered action evidence included:
  - body `interact` success with cause `low_health_cook_food` and effect evidence,
  - nervous-system `eat` success with cause `nervous:eat-when-low-health`,
  - body `attack` success with cause `combat_attack_safe_target` and effect evidence.
- The same run also recorded one later `combat_retaliate` timeout after the pass condition; keep combat cadence/pathing under the broader combat survival issue.

Interpretation:

- Substrate/verifier is implemented, test-covered, and hot-stack-proven.
- QA035 hardens run setup by seeding required recovery inventory after connect, which removes a known source of false negatives when live residents spawn with drifted inventory.
- QA036 removes the false-positive paths observed in earlier hot-stack artifacts, so this strict pass requires executed body/nervous-system outcomes rather than thinking-only proposals.
