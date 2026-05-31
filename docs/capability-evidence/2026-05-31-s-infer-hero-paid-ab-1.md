# S-INFER-HERO-PAID-AB-1 — paid model follow-through proof

Date: 2026-05-31
Owner: Codex
Primary commit: `730fff20` (`fix(benchmarks): preserve goal causation in follow-through proof`)

## What This Proved

This packet turned the model-intelligence benchmark from a misleading activity counter into a real goal-causation proof, then ran a capped Qwen-vs-Haiku comparison on the same `goal-follow-through-5m` task.

Result: **OpenRouter Haiku passed; local Qwen timed out.**

| Profile | Status | Duration | Goal Actions | Goal Changes | Speech | Stuck Ticks | Notes |
|---|---:|---:|---:|---:|---:|---:|---|
| OpenRouter Haiku (`anthropic/claude-3.5-haiku`) | PASS, score `1` | `48.8s` | `9/10` on-goal | `0` | `8` trajectory says | `0` | Hit the stricter 10-action sample quickly. |
| Local Qwen (`qwen/qwen3.6-27b`) | TIMEOUT, score `0` | `300.5s` | `5/5` on-goal | `0` | `0` trajectory says | `57` | Never reached the 10-action evidence floor. |

## Code Fixes

- `BenchmarkArtifact.evidence.actionAttempts` now persists `goalId` and `tick`.
- `ResidentRuntime.submitActionWithWatchdog()` tags action attempts with the active goal id at submit time.
- Autonomous benchmark recording now prefers `attempt.goalId` and metadata tick, falling back to runtime state only for older attempts.
- `goal-follow-through-5m` now compacts paired thinking/body records by `requestId`, prefers final body outcomes, requires at least `10` compacted actions, and gives autonomous tasks a `2s` runner timeout grace so verifier metrics are not erased at the exact boundary.

## Artifacts

- Haiku canary: `data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1/openrouter_haiku_canary.json`
  - endpoint OK, latency `1163ms`, canary cost `$0.0001136`.
- Haiku committed-code pass: `data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1-committed/bench_20260531195929_goal_follow_through_5m.json`
  - `status=passed`, `score=1`, `totalActions=10`, `goalAttributedActions=9`, `goalChangeCount=0`, `finalGoalIsSeedOrSuccessor=1`.
- Qwen committed-code comparison: `data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1-committed-qwen/bench_20260531200028_goal_follow_through_5m.json`
  - `status=timeout`, `score=0`, `totalActions=5`, `goalAttributedActions=5`, `stuckProgressTicks=57`.

Pre-fix artifacts are intentionally retained because they explain why the old benchmark was misleading:

- `data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1/bench_20260531192555_goal_follow_through_5m.json`
  - Haiku had `112` selected-module actions and `42` says, but the artifact stripped goal ids.
- `data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1-fixed/bench_20260531194357_goal_follow_through_5m.json`
  - trajectory had `36/36` actions/says on `follow-through-goal`, but paired thinking/body records made the artifact report `36/72`.

## Commands

```bash
npm test -- --runInBand \
  src/controller/benchmarks/tasks/goal-follow-through-5m.test.ts \
  src/controller/benchmarks/benchmark-runner.test.ts \
  src/controller/benchmarks/autonomous-runtime.test.ts

npm run check:no-ui
npm run build

OPENROUTER_API_KEY=<env> OPENROUTER_STORYTELLER_MODEL=anthropic/claude-3.7-sonnet \
  npm run controller:bench -- \
  --task goal-follow-through-5m \
  --module onion.runescape.standard \
  --mode autonomous \
  --config config/controller.paid-example.yml \
  --output data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1-committed

npm run controller:bench -- \
  --task goal-follow-through-5m \
  --module onion.runescape.standard \
  --mode autonomous \
  --config config/controller.model-benchmark.yml \
  --output data/benchmarks/capability-qa-2026-05-31/s-infer-hero-paid-ab-1-committed-qwen
```

## Interpretation

This is strong evidence that a better paid model can improve resident behavior on at least one cognition-sensitive workflow: Haiku produced enough on-goal actions and speech to pass in under a minute, while local Qwen stayed sparse and stuck-prone for the full five minutes.

It is **not** proof that paid models fix authored heroes. The live hero channel still needs a copied-soul twin A/B because starter heroes use the legacy Spark path and had previously shown `84/84 empty_completion_idle_initiative` decisions. This packet proves the benchmark harness and one autonomous standard-module task now discriminate model quality cleanly.

## Validation

- `npm test -- --runInBand src/controller/benchmarks/tasks/goal-follow-through-5m.test.ts src/controller/benchmarks/benchmark-runner.test.ts src/controller/benchmarks/autonomous-runtime.test.ts` passed: `43/43`.
- `npm run check:no-ui` passed.
- `npm run build` passed.
- The OpenRouter key was supplied only through the shell environment for the capped run; no paid-model key or secret was written to source.

## Current Decision Value

Use this result as a green light to keep paying for small, capped intelligence experiments on hard cognition tasks. Do not use it as a green light to put all residents on paid models or to call hero intelligence healthy. The next useful decision requires copied-soul hero twins and cost accounting, not another aggregate activity counter.

## Follow-Ups

1. Run a tiny copied-hero twin A/B from ignored `data/benchmarks/**` temp config: Hans-local vs Hans-Haiku, then Father Aereck or Duke local vs paid.
2. Compare local Qwen vs local Qwopus on the same fixed follow-through harness once the S-INFER-AB-1 docs/probe lane is done.
3. Add aggregate token/cost accounting to `controller:bench` artifacts for paid profiles.
4. Keep body reliability separate from model intelligence: Haiku still had two action timeouts and one failure inside the pass window.
