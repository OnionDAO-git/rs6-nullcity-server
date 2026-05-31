# QA-20260530-034: Low-Health Cook/Eat/Reengage Benchmark Substrate

Date: 2026-05-30
Packet: QA-20260530-034
Area: Combat/survival recovery proof

Follow-up:

- 2026-05-31 `QA-20260530-035` (same packet family) added post-connect inventory ensure seeding so the low-health benchmark does not depend on create-time inventory sticking in live gateway conditions.

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

## Verification

Focused packet tests (PASS):

- `npm test -- --runInBand src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts src/controller/benchmarks/cli.test.ts`
- `npm test -- --runInBand src/controller/benchmarks/benchmark-runner.test.ts src/controller/benchmarks/tasks/low-health-cook-eat-reengage-5m.test.ts`

Required server gates:

- `npm run check:no-ui` PASS
- `npm run typecheck` PASS
- `npm run build` PASS
- `npm run fin` FAIL in sandbox-only loopback suites (`listen EPERM 0.0.0.0` in `gateway-client.test.ts`)

## Live Benchmark Attempt

Attempted:

- `npm run controller:bench -- --task low-health-cook-eat-reengage-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-30/qa034-low-health-cook-eat-reengage`

Result:

- Failed before run start due sandbox networking restriction:
  - `connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`

Interpretation:

- Substrate/verifier is implemented and test-covered.
- QA035 hardens run setup by seeding required recovery inventory after connect, which removes a known source of false negatives when live residents spawn with drifted inventory.
- Live capability proof for the strict chain still requires a loopback-capable hot stack rerun outside this sandbox.
