# S-TICK-PROGRESS-WEDGE-1

Date: 2026-05-31

Issue: `QA-20260529-006`

## Problem

After `S-AGENT-VISIBLE-CADENCE-1`, a full `controller:smoke --observe-seconds 60 --allow-recent-visible` run reported every resident as `no_observed_tick_progress`. A direct file trace showed the controller was still writing fresh runtime and trajectory ticks, so the stack was not dead. The highest-signal remaining warning was `res:the-hush`: it was visibly saying faction recovery/status lines, but smoke classified it as an inert `budget_exhausted:pause` loop and runtime progress did not count those successful status lines.

## Change

- Successful `say` actions with cause `faction_landmark_recovery` now count as explicit visible progress: `visible_say:faction_landmark_recovery`.
- Failed faction recovery speech still does not count as progress.
- Generic `idle_initiative` speech still does not count as progress.
- `normal-life-audit` now tracks `faction_landmark_recovery` cause counts.
- `controller:smoke` still warns on true no-action inert loops, but accepts residents that maintain a sustained visible cadence during no-action budget ticks.

## Tests

```bash
npx jest src/controller/admin/live-smoke.test.ts src/controller/resident-runtime.test.ts src/controller/admin/normal-life-audit.test.ts --runInBand --no-coverage
npm run check:no-ui
npm run build
npm run fin
```

Results:

- Focused expanded suites: `110/110` passed.
- `check:no-ui`: passed.
- `build`: passed (`825` files).
- `fin`: passed (`3304/3304` tests).

## Live Proof

Targeted pre-restart Hush smoke after the smoke classifier fix:

```bash
npm run controller:smoke -- --resident res:the-hush --observe-seconds 90 --allow-recent-visible
```

Result: exit `0`; `res:the-hush` observed `+131t`, `says=9`, `results=9`, `success=8`, and no inert-loop issue.

The controller was then rebuilt and restarted onto `dist`:

- Controller process: `pid=31932`, screen `nullcity-controller-tick-wedge-1`.
- Game process remained running on screen `nullcity-game-agent-cadence-1`.

Post-restart smoke:

```bash
bash scripts/post-restart-smoke.sh --no-color
```

Result: `READY WITH WARNINGS (2 yellow)`. All residents were alive; Library, wall redaction, and patron registry were green. The two yellow rows were recent-action-window warnings for `res-agent` and `res-qa-social`, both resident types that now intentionally use visible speech/hold cadence.

Targeted post-restart Hush smoke:

```bash
npm run controller:smoke -- --resident res:the-hush --observe-seconds 90 --allow-recent-visible
```

Result: exit `0`; `res:the-hush` observed `+141t`, `says=7`, `results=8`, `success=8`.

Full post-restart cohort smoke:

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
```

Result: exit `0`; all `23/23` residents `OK`. Examples:

- `res:the-hush`: `+95t`, `says=5`, `results=5`, all successful, no inert-loop warning.
- `res:qa-forager`: `+100t`, actions/results observed, `OK`.
- `res:qa-banker`: previous `observed_only_timeouts` warning cleared; `+100t`, `success=4`.

Normal-life audit:

```bash
npm run -s controller:normal-life-audit -- --duration-ms=600000 --top=12 --output-dir=data/benchmarks/capability-qa-2026-05-31/s-tick-progress-wedge-1
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/s-tick-progress-wedge-1/normal_life_audit_20260531T133451Z.json`

Results:

- `23` residents.
- `890/890` successful action submissions.
- `low_health_heal_wait=0`.
- `res:the-hush`: `35/35` action submissions, `faction_landmark_recovery=30`, `say=32`, `stuck_detected=0`, `stuck_recovered=0`.
- Top remaining stuck churn: `res:qa-trader`, `res:agent`, `res:qa-social`, `res:pip`, `res:qa-survivor`.

## Assessment

This packet fixes a false negative in the live QA loop: Hush and similar faction residents can now be visibly alive without being failed as silent inert loops, and their explicit faction recovery speech clears false stuck progress. The stack is not dead; the latest full smoke proves all 23 residents ticking and visible.

The next highest-value work is not more smoke plumbing. It is reducing the recurring trader/agent/social churn and proving ordinary AP/GP/trade recurrence in longer windows.
