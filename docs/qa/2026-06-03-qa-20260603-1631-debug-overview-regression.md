# QA Packet `qa-20260603-1631-debug-overview-regression`

Date: 2026-06-03 16:31 CDT
Repo: `rs6-nullcity-server`
Branch: `agents/wip`
Server SHA: `53b7761d`
Classification: `READ-ONLY`

## Target

Verify whether the live dashboard debug route still reflects current runtime truth after the earlier same-day packet `qa-20260603-1551-economy-readtruth` recorded a healthy `http://127.0.0.1:5174/debug` surface.

## Why this target

- It is human-visible and demo-relevant.
- It is safe under the runtime stewardship rules because it requires only reads.
- The prior packet already used the same route as evidence, so a same-day contradiction needs explicit capture.

## Runtime truth observed this cycle

### Source 1: shared process ownership and listeners

Read-only shell checks at approximately `2026-06-03 16:28-16:29 CDT` found the expected shared sessions and listeners present:

- Screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`
- Listening ports present:
  - `43591`, `43592` via `nullcity-infra`
  - `43594`, `43595` via `nullcity-game`
  - `43596`, `43610`, `43611` via `nullcity-controller`
  - `8787` via `nullcity-dashboard-server`
  - `5174` via `nullcity-dashboard-web`

### Source 2: controller status CLI

`npm run controller:status`

Observed:

- `HEALTH: ok`
- `residents=25 erroring=0`
- `ALIVE_ACTING`: `res:hans`, `res:qa-banker`, `res:qa-scout`, `res:qa-survivor`, `res:qa-trader`, `res:qa-woodcutter`
- `STUCK`: `res:agent`, `res:qa-cook`, `res:qa-guardian`, `res:qa-social`
- Remaining known residents offline/paused

This is consistent with a live 10-resident controller-held cohort rather than a dead stack.

### Source 3: short live smoke

`npm run controller:smoke -- --observe-seconds 10 --allow-recent-visible`

Observed:

- `OK`: `res:hans`, `res:qa-woodcutter`, `res:qa-survivor`, `res:qa-trader`, `res:qa-banker`, `res:qa-social`, `res:qa-scout`
- `WARN`: `res:agent`, `res:qa-cook` (`no_recent_visible_activity,no_observed_visible_activity`)
- `WARN`: `res:qa-guardian` (`effect_timeouts:1`)

The smoke exited non-zero because of resident-level warnings, not because the controller or runtime was absent.

## Dashboard truth observed this cycle

### Source 4: dashboard BFF health

Browser read of `http://127.0.0.1:8787/api/health` returned:

```json
{"ok":true,"service":"nullcity-residents-dashboard","store":"memory","at":"2026-06-03T21:29:21.752Z"}
```

So the dashboard server process is up and answering at least its health route.

### Source 5: live debug route render

Browser read of `http://127.0.0.1:5174/debug` after load + additional wait rendered:

- `Loading dashboard state`
- `GATEWAY offline`
- `CONTROLLER quiet`
- `ONLINE 0`
- `RUNTIME 0`
- `No residents match the current filters`
- `No recent events`
- `No recent patron letters`

The route did not hydrate to live truth during the observation window.

Console logs only showed Vite connection / hot-update events during this read:

- `[vite] connecting...`
- `[vite] connected.`
- `[vite] hot updated: /src/App.svelte`
- `[vite] hot updated: /src/app.css`

No browser-console error explained the missing overview state during this packet.

## Direct contradiction with earlier same-day evidence

Earlier packet note `docs/qa/2026-06-03-qa-20260603-1551-economy-readtruth-followup.md` recorded the same route `http://127.0.0.1:5174/debug` as:

- `GATEWAY connected`
- `CONTROLLER available`
- `ONLINE 10`
- `RUNTIME 27`
- `Resident cohort 10 ACTIVE IN CONTROLLER COHORT; 13 PAUSED/COHORT-EXCLUDED OF 23 KNOWN RESIDENTS`

This packet therefore documents a same-day regression or drift in the live debug surface rather than a long-standing steady-state bug.

## Assessment

Status: `Reproduced`

The shared runtime appears live, while the human-visible debug dashboard currently reports an empty/offline city. That is a demo-critical truth gap even if the underlying BFF health endpoint remains up.

## Safe next action

- Open or update a canonical issue row as proposed `QA-20260603-091` when `docs/issue-register.md` is no longer dirty in another thread.
- Dashboard follow-up should trace why `/debug` remains on empty defaults while the runtime and earlier same-day browser evidence show live data.
- Re-verify both `http://127.0.0.1:5174/debug` and `http://127.0.0.1:8787/api/overview` once the dashboard owner confirms the current web/BFF state.

## Constraints and notes

- Shell localhost HTTP probes remain sandbox-blocked here, so browser verification and local controller CLI output were used for the human-visible portion of the packet.
- `docs/issue-register.md` was already dirty in another thread, so this packet did not edit the canonical issue ledger.
- No runtime restarts, API writes, or resident mutations were performed.
