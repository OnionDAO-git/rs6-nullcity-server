# S-GP-HARVEST-1 — low-AP/no-GP starter GP harvest

Date: 2026-05-31

## Question

When a resident is low on AP but holds no GP, does it only ask humans for attention, or can it choose a practical starter GP route and keep thinking?

## Result

**Pass for the bounded starter loop.** Low-AP/no-GP floor residents now seed an active goal `earn-starter-gp-via-combat`, emit `nervous:starter-gp-harvest`, continue thinking, route through safe combat, and loot real RuneScape coin item `995`.

## Fix

- Added `starterGpHarvestGoal()` in `src/controller/spark/runescape-brain-planner.ts`.
- Added nervous-system routing before generic AP appeals in `src/controller/nervous-system/nervous-system.ts`.
- Preserved safety behavior:
  - Existing GP still self-funds AP before harvesting.
  - Low-health/no-food residents can still ask humans for AP even if a starter GP harvest goal is active.
  - The verifier requires actual coin item `995`, not merely a tradable drop.
- Added `starter-gp-harvest-choice-5m` to benchmark CLI/core task coverage.
- Added `nervous:starter-gp-harvest` to normal-life audit tracked causes.

## Evidence

Focused tests:

- `npm test -- --runTestsByPath src/controller/benchmarks/tasks/starter-gp-harvest-choice-5m.test.ts src/controller/benchmarks/cli.test.ts src/controller/benchmarks/autonomous-runtime.test.ts --runInBand`
  - 3 suites passed, 47 tests passed.
- `npm test -- --runTestsByPath src/controller/admin/normal-life-audit.test.ts src/controller/spark/runescape-brain-planner.test.ts src/controller/nervous-system/nervous-system.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand`
  - 4 suites passed, 403 tests passed.
- `npm run check:no-ui`
  - Server UI boundary clean.
- `npm run build`
  - 819 files compiled.

Benchmark smoke:

- `npm run controller:bench -- --task starter-gp-harvest-choice-5m --module onion.runescape.standard --dry-run`
  - Task registered and resolved.

Live autonomous benchmark:

- Command:
  - `npm run controller:bench -- --task starter-gp-harvest-choice-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-31/s-gp-harvest-1`
- Artifact:
  - `data/benchmarks/capability-qa-2026-05-31/s-gp-harvest-1/bench_20260531102153_starter_gp_harvest_choice_5m.json`
- Result:
  - `status=passed`, `score=1`, `durationMs=28082`
  - `starterGpHarvestActions=1`
  - `safeAttackActions=2`
  - `kills=2`
  - `lootPickups=2`
  - `gpFromCombat=3`
  - `gpObservedAmount=3`
  - `tradableDropsLooted=0`
  - `deaths=0`
  - `unsafeTargetActions=0`
  - `stuckProgressTicks=0`

## Interpretation

This closes the immediate AP/GP runway gap for floor-protected residents: if they are low on AP and have no GP, the resident can now choose a starter GP-harvest plan instead of only making an AP appeal that suppresses thinking. No-floor residents keep the older last-second AP appeal path for now; broadening their harvest threshold needs a separate runtime-safe design so generic no-floor test/module souls are not hijacked at normal startup AP.

This does **not** prove durable GP/hour economy yet. The next evidence should come from ordinary no-drain windows showing multiple named residents choosing starter harvest, earning fresh GP, and later self-funding AP without benchmark seeding.
