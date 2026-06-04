# QA Packet `qa-20260603-1800-debug-overview-recheck`

Date: 2026-06-03
Mode: READ-ONLY
Scope: Verify live `/debug` dashboard truth against current runtime truth without mutating shared services.

## Summary

The live debug dashboard is not hard-down, but it is still not truth-stable on first load.

- A fresh load of `http://127.0.0.1:5174/debug` initially rendered a false-red state: `GATEWAY offline`, `CONTROLLER quiet`, `ONLINE 0`, `RUNTIME 0`, `No readiness checks reported`.
- A second read after a 10 second wait hydrated to a healthy-looking state: `GATEWAY connected`, `CONTROLLER available`, `ONLINE 10`, `RUNTIME 27`, `READY`.
- The shared runtime itself was healthy during both reads: all five expected `screen` sessions were present, all expected ports were listening, `npm run controller:status` reported `HEALTH: ok`, and `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible` observed `9 OK / 1 WARN` across the active cohort.

This means the earlier `/debug` regression is not fully resolved. The route can still present a human-visible false outage before hydration, and its hydrated runtime count does not match the controller CLI truth.

## Runtime Truth

Read-only runtime checks at capture time:

- `screen -ls`: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web` all present.
- Listening ports: `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`.
- `npm run controller:status`:
  - `HEALTH: ok`
  - `residents=25`
  - active cohort visible and acting/stuck: `res:agent`, `res:hans`, `res:qa-banker`, `res:qa-cook`, `res:qa-guardian`, `res:qa-scout`, `res:qa-social`, `res:qa-survivor`, `res:qa-trader`, `res:qa-woodcutter`
- `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible`:
  - `OK`: `res:agent`, `res:hans`, `res:qa-woodcutter`, `res:qa-cook`, `res:qa-survivor`, `res:qa-guardian`, `res:qa-banker`, `res:qa-social`, `res:qa-scout`
  - `WARN`: `res:qa-trader` with `observed_no_action_decision_loop:follow_listen_hold`

## Browser Evidence

Fresh load text excerpt from `http://127.0.0.1:5174/debug`:

```text
Null City Ops ... Loading dashboard state ... GATEWAY offline CONTROLLER quiet ONLINE 0 RUNTIME 0 EVENT READINESS NEEDS ATTENTION No readiness checks reported ...
```

Reloaded and left open for 10 seconds:

```text
Null City Ops ... GATEWAY connected CONTROLLER available ONLINE 10 RUNTIME 27 EVENT READINESS READY ...
```

Related route checks in the same browser session:

- `http://127.0.0.1:5174/` rendered attendee overview with `10 / 23 active`.
- `http://127.0.0.1:5174/debug/wall` rendered wall content but still exposed stale residents such as `res:wf-verify-born` and `res:restart-test`.
- `http://127.0.0.1:5174/debug/inbox?human=demo@onion` rendered real inbox content.

## Assessment

Current truth:

- `/debug` is reachable.
- `/debug` can mislead an operator on first load by showing a zeroed outage state while the live stack is healthy.
- `/debug` eventually hydrates, but its `RUNTIME 27` count does not match controller CLI truth (`residents=25`).

## Recommended Next Action

Open or update a dashboard truth issue for:

1. first-paint false-red `/debug` state while data is still loading
2. hydrated runtime-count mismatch between dashboard and controller CLI (`27` vs `25`)

Do not treat the earlier `ONLINE 0 / RUNTIME 0` screenshot alone as current runtime truth unless the post-hydration state is also captured.
