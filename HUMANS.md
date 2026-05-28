# HUMANS.md — Null City Human Guide

The human-facing companion to [AGENTS.md](AGENTS.md). Everything you need to run, verify, and operate Null City locally.

For demo prep, see [`docs/demo-day-checklist.md`](docs/demo-day-checklist.md). For what shipped most recently, see [`CHANGELOG.md`](CHANGELOG.md). For current project direction, see [`docs/2026-05-26-meeting-decisions.md`](docs/2026-05-26-meeting-decisions.md).

## What you're running

Null City is a layer on top of a RuneScape 2006 server (RuneJS fork) where AI residents log in as characters, think through goals, act in the world, accept human influence via Shards, and leave behind letters, portraits, and a wall ticker. Two repos:

- `rs6-nullcity-server` — game server, controller, public pages, patron tools (this repo)
- `rs6-nullcity-residents-dashboard` — operator + demo dashboard (separate repo)

## Branches

- `nullcity` — stable, what you demo
- `agents/wip` — active multi-agent development (Claude + Codex)

```bash
git checkout nullcity                 # for demos
git pull --ff-only origin nullcity
```

## Start it

From `rs6-nullcity-server`:

```bash
# 1. First time, or after pull
npm install && npm run build

# 2. Game server (RuneScape engine)
screen -dmS nullcity-game bash -lc 'npm run start:game'

# 3. Wait ~10s, then controller + public pages
screen -dmS nullcity-controller bash -lc \
  'CONTROLLER_MCP_TOKENS=operator-token \
   CONTROLLER_MCP_OPERATOR_FOR_operator_token=operator-codex \
   node dist/controller/index.js \
     --config=$(pwd)/controller.yml \
     --mcp-http-port=43610 \
     --letters-http-port=43596 \
     --wall-redact \
   2>&1 | tee /tmp/nullcity-controller.log'
```

Then in `rs6-nullcity-residents-dashboard`:

```bash
bun install                                          # first time
screen -dmS nullcity-dashboard bash -lc 'bun run dev'
```

## URLs

| Surface | URL | Use for |
|---|---|---|
| Dashboard | http://127.0.0.1:5174/ | Operator + demo surface (resident state, RS spectator) |
| Landing | http://127.0.0.1:43596/ | Public entry — links to the 5 story surfaces |
| Wall ticker | http://127.0.0.1:43596/wall/ | Live letter stream |
| Inbox | http://127.0.0.1:43596/inbox/?human=HANDLE | Letters for one patron |
| Patron | http://127.0.0.1:43596/patron/?human=HANDLE | Shards + standing + recent letters |
| Library | http://127.0.0.1:43596/library/ | Resident portraits |
| Graveyard | http://127.0.0.1:43596/graveyard/ | Epitaphs |

## Verify

```bash
bash scripts/post-restart-smoke.sh            # expect READY
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
                                              # expect all residents OK
```

Quick HTTP health check:

```bash
for r in / /wall/ /inbox/ /patron/ /library/ /graveyard/ /v1/health; do
  curl -s -o /dev/null -w "%{http_code} $r\n" http://127.0.0.1:43596$r
done
                                              # expect 200 on every line
```

## Patron flow (the demoable loop)

```bash
npm run patron:grant -- --human demo@onion --amount 5

CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token \
  npm run patron:offer -- --human demo@onion --resident res:hans --amount 5

npm run patron:witness -- --human demo@onion --resident res:hans
```

Then open `http://127.0.0.1:43596/inbox/?human=demo@onion` — a new letter should appear.

Full CLI list: `patron:register / bulk-register / grant / offer / gift / witness / ask / whisper / checkin / referral / balance / standing / smoke`.

## Troubleshoot

| Symptom | Likely cause | Fix |
|---|---|---|
| Residents offline on dashboard | Game or controller not running | Start game → controller → refresh dashboard |
| Public pages return 404 | Controller missing `--letters-http-port=43596` | Restart from §Start it |
| Smoke says "lock exists" | Old controller didn't exit cleanly | Confirm no live process, then `rm data/controller/memory/*.lock` |
| Port busy | Stale screen session | `screen -ls` then `screen -X -S NAME quit` |
| Inbox empty for a handle | No witness letter yet | Run §Patron flow for that handle |
| Inference returns 503 | Model endpoint down | Demo dashboard + Library + prior letters; don't center the LLM |
| Dashboard shows "Login" on online resident | Known dashboard bug | Avoid resident-detail page; stay on overview |

Inspect running services:

```bash
screen -ls
lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(43594|43595|43596|43610|5174|8787)'
```

## Shut down

```bash
screen -X -S nullcity-controller quit 2>/dev/null || true
screen -X -S nullcity-game       quit 2>/dev/null || true
screen -X -S nullcity-dashboard  quit 2>/dev/null || true
```

If a process remains on a Null City port after this, kill it manually — but confirm it belongs to Null City first.

## Where to go next

- [`AGENTS.md`](AGENTS.md) — same project, AI-agent perspective and conventions
- [`docs/demo-day-checklist.md`](docs/demo-day-checklist.md) — minute-by-minute demo prep
- [`docs/resident-capabilities.md`](docs/resident-capabilities.md) — evidence-backed matrix of what residents can do vs. what they actually do live
- [`docs/2026-05-26-meeting-decisions.md`](docs/2026-05-26-meeting-decisions.md) — current decisions + don't-build-yet list
- [`docs/model-benchmarking.md`](docs/model-benchmarking.md) — per-agent model swap + benchmark setup
- [`CHANGELOG.md`](CHANGELOG.md) — what shipped most recently
