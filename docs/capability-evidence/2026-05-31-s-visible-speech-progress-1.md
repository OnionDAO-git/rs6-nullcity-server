# S-VISIBLE-SPEECH-PROGRESS-1

Date: 2026-05-31

## Problem

`CQA10-post-trader-social-restart` proved that `res:qa-social` and `res:qa-trader` are now visibly saying useful keepalive lines, but the progress tracker still classified those intervals as stuck:

- `res:qa-social`: `social_keepalive=13`, `stuck_detected=9`, `stuck_recovered=8`, `unresolved=1`
- `res:qa-trader`: `trade_keepalive=2`, `stuck_detected=10`, `stuck_recovered=7`, `unresolved=3`

The root cause was that `ProgressTracker` only saw perception deltas (XP, inventory, position, HP). Successful intentional speech was recorded in the trajectory, but not as runtime progress.

## Change

- Added `ProgressTracker.recordMeaningful(tick, reason)` for explicit non-perception progress signals.
- `ResidentRuntime` now marks successful `say` actions with cause `social_keepalive` or `trade_keepalive` as meaningful progress:
  - writes progress evidence with `visible_say:social_keepalive` or `visible_say:trade_keepalive`
  - updates `lastMeaningfulProgressAt`
  - clears `stuckSince`
- Generic template speech remains excluded.
- Failed keepalive speech remains excluded.
- Live smoke now accepts `follow_listen_hold` decision windows when the same resident has visible recent speech in the observation window, so `res:qa-trader` no longer warns merely for waiting while publicly telling humans how to trade.

## Tests

Red/green coverage:

```bash
npm test -- --runTestsByPath src/controller/evidence/progress-tracker.test.ts --runInBand
npm test -- --runTestsByPath src/controller/resident-runtime.test.ts --runInBand --testNamePattern 'visible runtime progress|generic successful speech|failed keepalive speech'
```

Full focused suites:

```bash
npm test -- --runTestsByPath src/controller/evidence/progress-tracker.test.ts src/controller/resident-runtime.test.ts --runInBand
npm test -- --runTestsByPath src/controller/admin/live-smoke.test.ts --runInBand
npm run check:no-ui
npm run typecheck
npm run build
npm run fin
```

Results:

- Progress tracker: `6/6` passed.
- Focused runtime visible-speech tests: `4/4` passed.
- Full progress/runtime suites: `76/76` passed.
- Live smoke helper suite: `27/27` passed.
- `check:no-ui`: passed.
- `typecheck`: passed.
- `build`: passed (`821` files).
- `fin`: passed (`228` suites, `3253/3253` tests).

## Expected Live Effect

Successful social/trade keepalive speech should no longer leave the resident in an unresolved stuck state. This should make dashboard/readiness signals less misleading for QA residents that are intentionally waiting, speaking, and staying findable.

## Live Proof

The running controller was rebuilt onto this code path, then checked with the restart smoke, live smoke, and a 10-minute normal-life audit:

```bash
scripts/post-restart-smoke.sh
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
npm run controller:normal-life-audit -- --duration-ms 600000 --output-dir data/benchmarks/capability-qa-2026-05-31/cqa10-post-visible-speech-progress
```

Results:

- `post-restart-smoke`: ready with warnings; all 23 residents alive, Library healthy, patron registry loaded; 7 residents had no action rows in the last 5 minutes.
- `controller:smoke`: exit `0`; all 23 residents OK. `res:qa-trader` had `actions=0`, `results=3`, `success=3`, `says=3`, and no longer failed merely for `follow_listen_hold` while visibly speaking.
- Normal-life artifact: `data/benchmarks/capability-qa-2026-05-31/cqa10-post-visible-speech-progress/normal_life_audit_20260531T122249Z.json`.
- Normal-life recurrence: `724/724` successful actions, `lowHealthWaits=0`, `combatResupplyActions=20`, `cookingActions=22`, `eatingActions=5`, `xpEvents=23`, `deaths=0`, `logouts=0`.
- Stuck trend vs `CQA10-post-trader-social-restart`: global stuck churn improved from `79 detected / 51 recovered / 28 unresolved` to `44 detected / 18 recovered / 26 unresolved`.
- Target resident trend: `res:qa-trader` improved from `10 detected / 7 recovered / 3 unresolved` to `4 / 2 / 2`; `res:qa-social` improved from `9 / 8 / 1` to `3 / 1 / 2`.
- Economy/trade caveat: the same window still had `tradeRequests=0`, `tradeCompleted=0`, and `apGpExchangeEvents=0`, so this packet fixes false stuck reporting around visible keepalive speech but does not prove trade closure.

## Caveat

Runtime perception progress is sampled before the tick's actions run. If a resident crosses the stuck threshold and then speaks successfully on the same tick, the Library/audit may still record a `stuck_detected` followed by a `stuck_recovered`-style progress line. This patch is intentionally conservative: it fixes lingering false stuck state without hiding true blocked routes or generic template loops. A later audit-ordering packet can reduce same-tick detected/recovered churn if it remains noisy.

## Next Proof

- Run a controlled visible-player or named-resident trade proof so `res:qa-trader` advances from useful public instructions to a real trade request/close.
- Reduce the remaining false stuck churn around `res:agent` and the same-tick stuck-detected/action-progress ordering.
- Keep generic hero template speech excluded from meaningful progress unless it is tied to an explicit gameplay/story outcome.
