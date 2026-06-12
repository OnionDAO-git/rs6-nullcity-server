# QA Packet `qa-20260603-1901-dashboard-firstpaint-truth`

- Time: 2026-06-03 19:01 CDT
- Classification: READ-ONLY
- Server repo SHA: `53b7761d`
- Dashboard repo SHA: `a67f7b3`
- Runtime type: live shared stack

## Scope

Verify whether human-visible dashboard routes present live truth on first paint or falsely show offline/empty state before hydration.

## Runtime orientation

- Expected screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`
- Listening ports present during the check: `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`
- `npm run controller:status` at `2026-06-03T23:58:31.922Z` reported `residents=25`, `erroring=0`, with 10 active cohort residents and active statuses on `res:qa-banker`, `res:qa-scout`, `res:qa-social`, `res:qa-survivor`, and `res:qa-woodcutter`
- `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible` returned `8 OK / 2 WARN`; warnings were `res:qa-guardian` (`effect_timeouts:1`) and `res:qa-banker` (`effect_timeouts:2`, `observed_effect_timeouts:1`)

## Evidence

### Controller / API truth

- `curl -fsS http://127.0.0.1:8787/api/health`
  - Observed: `{"ok":true,"service":"nullcity-residents-dashboard","store":"memory"...}`
- `curl -fsS http://127.0.0.1:8787/api/overview`
  - Observed truth: `gateway.connected=true`, `controller.available=true`, `readiness.level="ok"`, `residentsWithRuntime=27`, readiness detail `10 active in controller cohort; 13 paused/cohort-excluded of 23 known residents`
- `curl -fsS -H 'Authorization: Bearer operator-token' http://127.0.0.1:43611/api/nullcity/economy/heartbeat`
  - Observed: `residentCount=31`, `activeResidentCount=10`, `degradedFlags=[]`

### Browser truth

Route checked: `http://127.0.0.1:5174/debug`

- `+0s` after load:
  - Observed text included `Loading dashboard state`, `GATEWAY offline`, `CONTROLLER quiet`, `ONLINE 0`, `RUNTIME 0`, `No readiness checks reported`, `No residents match the current filters`
- `+3s` after load:
  - Observed text changed to `GATEWAY connected`, `CONTROLLER available`, `ONLINE 10`, `RUNTIME 27`, readiness `READY`, and the cohort detail `10 active in controller cohort; 13 paused/cohort-excluded of 23 known residents`
- `+10s` after load:
  - Same hydrated live truth persisted

Route checked: `http://127.0.0.1:5174/`

- `+0s` after load:
  - Observed text included `Loading city state`, `CITY ALIVE 0 / 0 online`, `No resident roster loaded yet`, `No Storyteller run is loaded yet`
- `+3s` after load:
  - Observed text changed to `CITY ALIVE 10 / 23 active`, `10 controller-held residents are active`, and a grounded Storyteller headline (`Two Residents Recovered from Stuck State`)
- `+10s` after load:
  - Same hydrated live truth persisted

## Expected vs observed

- Expected: first paint should not present explicit offline/zero/quiet claims that contradict already-available live runtime truth
- Observed: both attendee `/` and operator `/debug` first paint a false offline/empty state for about 3 seconds before hydrating to correct live data

## Conclusion

Human-visible truth gap confirmed. This is not a hard-down outage; it is a first-paint honesty problem. The live stack is up and reporting correctly via controller status, dashboard overview JSON, and City heartbeat, but the browser surfaces initially claim the city is offline/empty.

## Issue linkage

- Matches the previously proposed debug instability issue `QA-20260603-091`
- This packet broadens the finding: attendee `/` has the same first-paint false-zero problem, not just `/debug`
- `docs/issue-register.md` was already dirty, so no row edit was made in this cycle

## Recommended next action

Claim a dashboard-only fix packet to replace explicit offline/0-state copy during initial fetch with a neutral loading state, then verify both `/` and `/debug` no longer flash false red/zero truth.
