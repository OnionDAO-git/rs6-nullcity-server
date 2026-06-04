# QA Packet `qa-20260603-2201-public-graveyard-route-truth`

Date: 2026-06-03 22:01 CDT
Classification: READ-ONLY
Area: dashboard public route truth
Owner area: dashboard route map / attendee shell

## Summary

The live attendee shell still does not expose the public Graveyard route. `http://127.0.0.1:5174/graveyard` renders the attendee shell's `404 No city route matches /graveyard`, while `http://127.0.0.1:5174/debug/graveyard` renders the real Graveyard page on the same live stack.

This is a human-visible truth gap in the public demo surface. It is distinct from runtime liveness: the shared stack is up, the controller cohort is active, and the debug Graveyard page is reachable.

## Runtime context

- Server repo branch during check: `agents/wip` (`behind 35`)
- Dashboard repo branch during check: `codex/storyteller-overview-bff`
- Expected screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`, `nullcity-storyteller`
- Expected listeners present earlier in the same orientation pass: `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`
- `npm run controller:status --silent`: `HEALTH: ok`, `25` total residents, `10` active cohort residents
- `npm run controller:smoke -- --observe-seconds 10 --allow-recent-visible`: runtime alive with familiar warnings only (`res:agent`, `res:qa-guardian`, `res:qa-trader`)

## Evidence

Browser-visible attendee route:

- Route: `http://127.0.0.1:5174/graveyard`
- Observed text:
  - `NOT FOUND`
  - `404`
  - `No city route matches /graveyard`

Browser-visible debug route on the same stack:

- Route: `http://127.0.0.1:5174/debug/graveyard`
- Observed text:
  - `Null City - Graveyard`
  - `Those who walked here, and are gone`
  - `No residents have died yet.`

Supporting route parity check:

- Route: `http://127.0.0.1:5174/library`
- Observed text starts with attendee-shell fallback content:
  - `City overview unavailable; showing live resident fallback.`
  - `LIBRARY`
  - `SOUL FILES`
- Route: `http://127.0.0.1:5174/debug/library`
- Observed text shows the richer legacy Library surface with resident entries such as `res:mother-anvil` and `res:severn-vesta`

## Interpretation

This does not look like a controller outage or shared-runtime failure:

- attendee `/` hydrated to `10 / 23 active`
- `/debug` rendered `GATEWAY connected`, `CONTROLLER available`, `ONLINE 10`
- `/debug/graveyard` rendered normally

The narrow defect is route/public-shell mapping: the public attendee shell does not recognize `/graveyard` as a valid city route even though the debug Graveyard surface exists and the human operator docs still advertise `/graveyard` as a public route.

## Likely owner lane

Dashboard repo:

- route registration / city-route matching in the attendee shell
- follow-up parity review for `/library` after `/graveyard` is fixed

## Recommended next action

Open a dashboard-facing issue for public Graveyard route parity and fix the attendee route map so `/graveyard` resolves to a real Graveyard page instead of a shell 404.

After the fix, re-verify:

1. `http://127.0.0.1:5174/graveyard` renders the Graveyard page.
2. The attendee and debug Graveyard routes agree on empty-vs-populated state.
3. `/library` parity is checked separately so this packet stays narrow.
