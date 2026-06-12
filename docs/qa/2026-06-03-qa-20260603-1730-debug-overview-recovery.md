# QA Packet `qa-20260603-1730-debug-overview-recovery`

- Time: 2026-06-03 17:31 CDT
- Repo/branch: `rs6-nullcity-server` / `agents/wip`
- Commit: `53b7761ddee492ebcfde706148fecf072191a908`
- Classification: READ-ONLY
- Target: Dashboard `/debug` truth surface recovery after the earlier false-empty regression packet `qa-20260603-1631-debug-overview-regression`

## Why This Packet

The previous QA packet at 16:31 CDT reported `/debug` rendering `gateway offline`, `controller quiet`, and `online 0` despite a healthy runtime. This follow-up rechecks the same human-visible route before any fix claim is trusted.

## Commands And Routes

- `screen -ls`
- `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(43591|43592|43594|43595|43596|43610|43611|5174|8787)\\b'`
- `npm run controller:status -- --json`
- `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible`
- Browser route: `http://127.0.0.1:5174/`
- Browser route: `http://127.0.0.1:5174/debug`

## Evidence

### Source A: runtime/controller truth

- `screen -ls` showed all expected shared sessions present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`.
- Listening ports present on `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`.
- `controller:status` reported `HEALTH: ok`, `residents=25`, `erroring=0`, with 10 active cohort residents and 2 currently marked `STUCK` (`res:hans`, `res:qa-guardian`).
- `controller:smoke --observe-seconds 15 --allow-recent-visible` observed 9 `OK` residents and 1 `WARN`:
  - `WARN res:qa-trader ... issues=observed_no_action_decision_loop:follow_listen_hold`
  - No gateway/controller outage signal appeared in smoke.

### Source B: human-visible dashboard truth

- Attendee `/` rendered live truth, including `CITY ALIVE` -> `10 / 23 active`.
- Debug `/debug` rendered a healthy hydrated overview after a 12 second wait:
  - `GATEWAY connected`
  - `CONTROLLER available`
  - `ONLINE 10`
  - `RUNTIME 27`
  - `EVENT READINESS READY`
  - `Resident cohort 10 ACTIVE IN CONTROLLER COHORT; 13 PAUSED/COHORT-EXCLUDED OF 23 KNOWN RESIDENTS`
- Debug text artifact saved to `/private/tmp/qa-20260603-1730-debug-overview-recovery-debug.txt`
- Attendee text artifact saved to `/private/tmp/qa-20260603-1730-debug-overview-recovery-attendee.txt`

## Expected vs Observed

- Expected: `/debug` should reflect the same healthy runtime/controller state already visible from controller status and smoke.
- Observed: It does on this run. The earlier false-empty state did not reproduce.

## Result

- Packet verdict: PASS
- Status for this cycle: the `/debug` overview is currently truthful, not regressed.
- Interpretation: either the earlier failure was transient or another agent/runtime change already corrected it. No new issue is warranted from this run alone.

## Constraints / Notes

- Shell loopback HTTP probes remain blocked in this sandbox, so direct `curl` verification of controller/BFF JSON endpoints was not possible here.
- Browser direct navigation to raw JSON endpoints like `:43596/v1/*` and `:8787/api/*` was blocked by the browser client, so this packet relies on visible dashboard hydration plus controller-side CLI truth rather than direct JSON bodies.
- Shared docs `docs/agent-status.md` and `docs/issue-register.md` were already dirty at packet start and were intentionally not edited.
