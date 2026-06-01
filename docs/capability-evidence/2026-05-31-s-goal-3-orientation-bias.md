# S-GOAL-3 orientation-bias live proof

Packet: `S-GOAL-3`
Date: 2026-05-31
Branch: `agents/wip`

## What This Proves

`orientation-bias-10m` proves a disposable resident with a neutral exploration benchmark goal but a combat-oriented Soul north star picks the orientation goal and emits combat-family actions on the hot stack.

Important nuance: this is not dynamic SPARK module switching yet. The deployed SPARK module is still `onion.runescape.standard`; the proven behavior is goal-as-orientation bias flowing through `soul.orientationGoal -> ensureBenchmarkGoal -> activeGoal -> combat routine`.

## Command

```bash
npm run controller:bench -- \
  --task orientation-bias-10m \
  --module onion.runescape.standard \
  --mode autonomous \
  --output data/benchmarks/capability-qa-2026-05-31/s-goal-3-orientation-bias
```

## Artifact

`data/benchmarks/capability-qa-2026-05-31/s-goal-3-orientation-bias/bench_20260531143014_orientation_bias_10m.json`

Result:

- `status=passed`
- `score=1`
- `totalActions=4`
- `orientationGoalActions=2`
- `combatBiasedActions=2`
- `explorationBiasedActions=0`
- `finalGoalIsOrientation=1`
- `selectedModuleActions=4`
- `selectedModuleInferences=90`
- `meaningfulProgressTicks=10`
- `stuckProgressTicks=0`

Summary excerpt:

```text
orientationGoalTrace=[{"tick":1226,"goalId":"train-combat-safely"},{"tick":1316,"goalId":"train-combat-safely"}]
orientation-bias-10m: 2/4 actions attributed to train-combat-safely; combat-biased actions 2 > exploration-biased 0.
```

## Code Added

- `src/controller/benchmarks/tasks/orientation-bias-10m.ts`
- `src/controller/benchmarks/tasks/orientation-bias-10m.test.ts`
- `BenchmarkTask.orientationGoal` in `src/controller/benchmarks/benchmark-runner.ts`
- `ResidentRuntimeBenchmarkDriver` now copies a task-level `orientationGoal` into the synthetic benchmark Soul.
- `benchmarkGoalForTask('orientation-bias-10m')` returns `scout-nearby-area`, so the combat north star has to beat a neutral exploration benchmark goal.
- `src/controller/benchmarks/cli.ts` registers the task.

## Verification

- Red tests failed before implementation:
  - missing `orientation-bias-10m` module
  - benchmark runtime dropped `orientationGoal`
  - `benchmarkGoalForTask('orientation-bias-10m')` returned `undefined`
- Focused tests passed after implementation:

```bash
npm test -- --runTestsByPath \
  src/controller/benchmarks/tasks/orientation-bias-10m.test.ts \
  src/controller/benchmarks/autonomous-runtime.test.ts \
  src/controller/spark/runescape-brain-planner.test.ts \
  --runInBand --no-coverage
```

Result: `3` suites, `108` tests passed.

## Remaining Work

True dynamic module preference (`preferModuleByTag`) still does not exist. If Null City later has multiple SPARK modules enabled per resident, add a separate packet that ranks/selects SPARK modules directly. For now, the resident intelligence path is goal bias into action-family routines.
