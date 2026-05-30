# QA023: Starter Angler Route Cooldown Liveness

## Problem

`res:qa-angler` could keep retrying the Lumbridge starter fishing route after movement timeouts. The controller had live target-failure cooldown evidence for `3239,3244`, but the starter-fishing recovery helper used stale local constants from an older Lumbridge spot set, so it did not recognize the failed coordinate.

After routing to the alternate spot, a second loop appeared when both known fishing route coordinates were cooling down: the helper fell through to the pure body route action, which does not know about controller target-failure cooldowns.

## Change

- `hybrid-agent-helpers` now reuses the canonical starter-fishing route constants from `runescape-body-routines`.
- Starter-fishing goal logic now avoids a route action whose move target is on target-failure cooldown.
- When every known route target is cooling down, the resident emits a `starter_fishing_route_blocked` fallback action toward exploration/scouting instead of retrying a known-failed fishing coordinate.

## Regression Coverage

- `abandons a persisted starter fishing move after that coordinate times out`
- `scouts instead of retrying starter fishing route targets when all are cooling down`

## Verification

Local verification after the final patch:

- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "starter fishing|fishing-cooking|Lumbridge spot|coordinate times out|route targets|castle entrance|range" --runInBand --coverage=false`
  - PASS: 18 focused thinking tests
- `npx jest src/controller/spark/runescape-body-routines.test.ts -t "starter fishing|Lumbridge|range|fishing-cooking" --runInBand --coverage=false`
  - PASS: 20 focused body-routine tests
- `npm run check:no-ui`
  - PASS
- `npm run typecheck`
  - PASS
- `npm run build`
  - PASS
- `npm run lint`
  - PASS
- `npm run test:fin`
  - PASS: 217 suites, 3008 tests

Live verification on rebuilt controller `local-21481`:

- `npm run controller:smoke -- --observe-seconds 120 --min-observed-actions 1 --allow-recent-visible --resident res:qa-angler`
  - PASS: `OK res:qa-angler tick=202 actions=4 results=6 success=3 timeout=2 fail=0 says=1 observed=120000ms/+108t actions=4 results=6 success=3 timeout=2 fail=0 says=1 inert=4:body_wait lastAction=move_to lastResult=success`
- `npm run controller:smoke -- --observe-seconds 120 --min-observed-actions 1 --allow-recent-visible`
  - PASS: 23 residents OK, no WARN rows
  - `res:qa-angler`: `actions=5 results=6 success=5 timeout=1 fail=0 says=1 observed=120000ms/+116t ... lastAction=move_to lastResult=success`

Latest qa-angler state after live smoke:

- `stuckSince`: clear
- `lastMeaningfulProgressAt`: 207 at state tick 216
- `targetFailureCooldowns`: only item cooldowns remained (`coins`, `bones`), no active starter-fishing coordinate cooldowns
- latest live route actions showed movement progress instead of a failed route loop
