# QA Dashboard Death Truth Live Verify

Date: 2026-06-03 CDT

Packet: `qa-20260603-1318-dashboard-death-truth`

## TL;DR

- The live dashboard BFF on `http://127.0.0.1:8787/api/overview` is serving the death-broadcast dedupe/suppression fix.
- Current live overview payload reports `23` visible residents, `10` online, `12` recent letters, and `0` death/passing broadcasts tied to an online resident.
- This closes the deploy-needed gap from `QA-20260602-085`.

## Read-only Scope

- No controller, game, infra, dashboard, or BFF restarts.
- No resident mutations.
- Verification only against the already running shared stack.

## Environment Notes

- Shell/Node loopback probes from this Codex sandbox returned `EPERM` for `127.0.0.1` sockets even though listeners existed on `43596`, `43611`, `8787`, and `5174`.
- Browser verification therefore used the in-app browser against the live localhost routes, which could reach the shared stack successfully.

## Commands / Routes Used

Shell inspection:

```bash
screen -ls
lsof -nP -iTCP -sTCP:LISTEN | rg ':(43591|43592|43594|43595|43596|43610|43611|5174|8787)\b'
npm run controller:status
```

Browser verification:

- `http://127.0.0.1:8787/api/overview`
- `http://127.0.0.1:5174/`

## Current-Run Evidence

### Runtime truth

- `screen -ls` showed the expected shared sessions present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`.
- `lsof` showed the expected listeners present on `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, and `5174`.
- `npm run controller:status` reported `HEALTH: ok`, `residents=25`, and the active live cohort included `res:agent`, `res:qa-banker`, `res:qa-cook`, `res:qa-guardian`, `res:qa-scout`, `res:qa-social`, `res:qa-survivor`, `res:qa-trader`, and `res:qa-woodcutter`, with `res:hans` currently `STUCK` rather than offline.

### Live BFF payload truth

Observed via the running BFF route `http://127.0.0.1:8787/api/overview` at approximately `2026-06-03 13:18 CDT`:

- `gateway.connected=true`
- `controller.available=true`
- `controller.residentsWithRuntime=27`
- `overview.residents.length=23`
- `overview.residents.filter(r => r.online).length=10`
- `recentLetters.length=12`

Death-truth check run against the live payload:

- Built a map of live resident `online` state from `overview.residents`.
- Scanned `recentLetters` for `passing`, `death`, `died`, `epitaph`, or `grave` signals.
- Result: `0` recent death/passing broadcasts referenced a resident currently marked online in the same live payload.

Recent-letter sample from the live payload:

- `[Broadcast] On the passing of res:loop-check`
- `[Broadcast] On the passing of res:death-test`
- `[Broadcast] On the passing of res:restart-test`
- `Mortician's Ribbon — res:agent` (repeated civic milestone rows)

Notably absent from the live payload:

- No passing/death broadcast for `res:qa-social` while `res:qa-social` is online.
- No death/passing broadcast for any other currently online resident.

### Human-visible dashboard surface

Observed via `http://127.0.0.1:5174/`:

- Main dashboard rendered successfully.
- The dashboard summary matched the live overview shape: `10 / 23 active`.
- The page did not surface a contradictory "passing" state for an online resident during this check.

## Result

`QA-20260602-085` is live-verified on the shared `:8787` BFF. The earlier temp-port-only caveat is no longer true for the current running dashboard stack.
