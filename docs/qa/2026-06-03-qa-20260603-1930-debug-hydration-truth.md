# QA Packet `qa-20260603-1930-debug-hydration-truth`

- Date: 2026-06-03
- Time: 19:30-19:33 CDT
- Agent: QA Marshal
- Classification: READ-ONLY
- Target: Dashboard `/debug` hydration truth versus live controller/runtime state

## Scope

Verify whether the operator dashboard at `http://127.0.0.1:5174/debug` reflects live runtime truth promptly enough for demo use, without mutating the shared runtime.

## Environment

- Server repo branch: `agents/wip` at `53b7761ddee492ebcfde706148fecf072191a908`
- Dashboard repo branch: `codex/storyteller-overview-bff` at `a67f7b314cc749f1e70e61845c8a9e0cde78df25`
- Shared screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`
- Listening ports present: `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`
- `qmd`: not present in `PATH`

## Read-Only Evidence

### Source 1: controller CLI

Command:

```bash
npm run controller:status
```

Observed:

- Health `ok`
- `residents=25`
- Five current `ALIVE_ACTING`: `res:qa-banker`, `res:qa-scout`, `res:qa-social`, `res:qa-survivor`, `res:qa-woodcutter`
- Several active-cohort residents present but currently `STUCK`: `res:agent`, `res:hans`, `res:qa-cook`, `res:qa-guardian`, `res:qa-trader`

### Source 2: live smoke

Command:

```bash
npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible
```

Observed:

- Runtime alive with active traffic
- `8 OK`, `2 WARN`
- Warnings limited to `res:qa-guardian` (`effect_timeouts:1`) and `res:qa-trader` (`follow_listen_hold`)

### Source 3: attendee dashboard `/`

Route:

`http://127.0.0.1:5174/`

Observed over time in browser:

- `+0s`: false empty state (`0 / 0 online`, no roster loaded)
- `+3s`: recovers to live fallback truth (`10 / 23 active`)
- `+10s`: still shows the fallback warning `City overview unavailable; showing live resident fallback.`

### Source 4: operator dashboard `/debug`

Route:

`http://127.0.0.1:5174/debug`

Observed over time in browser:

- `+0s`: `GATEWAY offline`, `CONTROLLER quiet`, `ONLINE 0`, `RUNTIME 0`
- `+3s`: still false/offline `0` state
- `+10s`: hydrates to live-ish truth: `GATEWAY connected`, `CONTROLLER available`, `ONLINE 10`, `RUNTIME 27`, readiness `READY`

## Result

Regression confirmed.

The operator dashboard does not present truthful state quickly enough on first load in this run. The attendee `/` route recovers after about 3 seconds but still lacks the primary overview read-model and falls back to resident data. The `/debug` route stays visibly false for roughly 10 seconds before hydrating.

## Current Assessment

- Dashboard web responds: yes
- Dashboard truth on first paint: no
- Operator `/debug` truth within a short demo-safe window: no
- Controller/runtime healthy at the same time: yes

## Issue Handling

No `docs/issue-register.md` update in this cycle because the file is already dirty in the shared worktree and was treated as a collision zone.

## Recommended Next Narrow Target

Dashboard-only investigation of why `/debug` hydrates significantly later than `/`, and why `/` cannot load the primary city overview read-model and falls back to resident truth instead.
