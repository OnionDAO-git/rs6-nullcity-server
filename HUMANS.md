# HUMANS.md — Null City Human Guide

The human-facing companion to [AGENTS.md](AGENTS.md). Everything you need to run, verify, and operate Null City locally.

For demo prep, see [`docs/demo-day-checklist.md`](docs/demo-day-checklist.md). For what shipped most recently, see [`CHANGELOG.md`](CHANGELOG.md). For current project direction, see [`docs/2026-05-26-meeting-decisions.md`](docs/2026-05-26-meeting-decisions.md).

## What you're running

Null City is a layer on top of a RuneScape 2006 server (RuneJS fork) where AI residents log in as characters, think through goals, act in the world, accept human influence via AP (Attention Points), and leave behind letters, portraits, and stories. Two repos:

- `rs6-nullcity-server` — game server, controller, residents, memory/logs, JSON/control APIs, patron/admin CLI tools (this repo)
- `rs6-nullcity-residents-dashboard` — every human-facing screen: attendee dashboard, operator/debug dashboard, Library, Graveyard, inbox/wall/patron views, spectator UI

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

# 3. Wait ~10s, then controller + JSON APIs
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
screen -dmS nullcity-dashboard bash -lc \
  'NULLCITY_SERVER_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server \
   NULLCITY_MEMORY_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server/data/controller/memory \
   NULLCITY_LOGS_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server/data/controller/logs \
   NULLCITY_AGENT_LOGS_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server/data/agent-logs \
   NULLCITY_SOULS_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server/src/controller/soul/starter-souls \
   NULLCITY_RESIDENT_SAVE_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server/data/residents \
   NULLCITY_BENCHMARK_ROOT=/Users/james/Code/OnionDAO/rs6-nullcity-server/data/benchmarks \
   bun run dev'
```

## URLs

| Surface | URL | Use for |
|---|---|---|
| Dashboard | http://127.0.0.1:5174/ | Operator + demo surface (resident state, RS spectator) |
| Debug dashboard | http://127.0.0.1:5174/debug | Runtime/operator panels |
| Library | http://127.0.0.1:5174/library | Resident lives and portraits |
| Graveyard | http://127.0.0.1:5174/graveyard | Epitaphs and saved/dead residents |
| Dashboard BFF | http://127.0.0.1:8787/api/health | Dashboard health/API server |
| Controller JSON | http://127.0.0.1:43596/v1/health | Controller letters/patron/story read APIs |

All HTML/UI routes should come from `rs6-nullcity-residents-dashboard`. The controller on `43596` is for JSON/read APIs only.

## Verify

```bash
bash scripts/post-restart-smoke.sh            # expect READY
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
                                              # expect all residents OK
```

Quick HTTP health check:

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/overview | jq '{gateway:.gateway.connected, controller:.controller.available, readiness:.readiness.level}'
curl -fsS http://127.0.0.1:43596/v1/health
```

## Patron flow (the demoable loop)

> **Canonical path is the City API on `43611`** (`/api/nullcity/...`, `Authorization: Bearer <city-http-token>`; the live token is whatever the controller was started with via `--city-http-token`, currently `operator-token`). This is the path the dashboard "Support with AP" button actually uses. The older `patron:offer` MCP flow (port `43610`) is **legacy** and is rejected unless the controller was started with `CONTROLLER_MCP_TOKENS` set — the live stack usually is not. See the ⚠️ caveat below before relying on standing/letters.

Known-good live sequence (verified against the running stack):

```bash
TOK='Authorization: Bearer operator-token'      # = controller --city-http-token
API='http://127.0.0.1:43611/api/nullcity'

# 1. Credit a human's AP wallet (ledger write; works without MCP tokens)
npm run patron:grant -- --human demo@onion --amount 50

# 2. Support a resident with AP — refills their attention (the dashboard's action)
curl -fsS -X POST "$API/residents/res:agent/attention-grants" -H "$TOK" \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"demo-'"$(date +%s)"'","amount":50,"cityUserId":"demo@onion","note":"support"}'

# 3. Inspect the effect
curl -fsS -H "$TOK" "$API/economy/residents"        # per-resident attention + GP
curl -fsS -H "$TOK" "$API/economy/totals"           # system-wide AP/GP deltas
curl -fsS -H "$TOK" "$API/storyteller/latest"       # latest canon dispatch (may be empty if no live producer)
```

Inbox / standing read APIs still live on the letters server (`43596`):

```bash
curl -s 'http://127.0.0.1:43596/v1/inbox?human=demo@onion' | jq .
curl -s 'http://127.0.0.1:43596/v1/patron/standing?human=demo@onion' | jq .
```

> ⚠️ **Known split (filed 2026-05-31, packet `E2E-DOC-COHERENCE-1`):** the City API `attention-grants` path moves attention and logs an `ap_topup` economy event but does **NOT** increment patron standing or dispatch tier letters. Standing tiers + tier-crossing letters (the Pride/Attachment payoff) currently come only from `patron:offer` (MCP `43610`), which needs the controller started with `CONTROLLER_MCP_TOKENS=operator-token CONTROLLER_MCP_OPERATOR_FOR_operator_token=operator-codex`. Until the two are unified, a dashboard "Support with AP" produces no letter. `patron:witness` does grant +3 standing without MCP tokens.

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
