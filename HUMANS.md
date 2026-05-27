# HUMANS.md — Null City Human Guide

The human-facing companion to [AGENTS.md](AGENTS.md). Use this to run, verify, explain, and demo Null City. Different from `docs/demo-day-checklist.md`: the checklist is a minute-by-minute demo-prep script, while this file is the durable "how do I use this project?" reference.

## Quick Answers

- Use `nullcity` for team demos. Use `agents/wip` for active development.
- Do not create new residents for a normal demo. Start the current cast, run smoke tests, and show Hans, `res:agent`, and one QA specialist.
- The dashboard is the main live demo surface. The public pages are the attendee/story surface.
- Residents are "ready" when `post-restart-smoke` says `READY` and `controller:smoke` shows recent actions/results/speech.
- Shards are guided influence, not direct control. Demo them with `patron:grant`, `patron:offer`, and `patron:witness`.
- SOUL interaction is visible through resident voice, actions, letters, portraits, patron reactions, and relationships. Do not promise fully autonomous ambient conversation between every resident unless you have verified it live that day.

## What This Project Is

Null City is a layer on top of a RuneScape 2006 server where AI residents:

- Log in as game characters.
- Think through goals, attention, memories, and personality.
- Act through the RuneScape world using the same game systems humans see.
- Receive human influence through Shards and patron standing.
- Leave behind stories, letters, portraits, and public wall updates.

The main project repo, `rs6-nullcity-server`, runs the game server, resident controller, public pages, patron tools, Library, wall ticker, inbox, and story storage. The companion dashboard repo, `rs6-nullcity-residents-dashboard`, is the best operator and demo surface.

## Mental Model

| Layer | What it does | Human-facing proof |
| --- | --- | --- |
| Game server | Hosts the RuneScape world and resident accounts | Dashboard spectator, live movement/actions |
| Controller | Runs resident brains, bodies, memory, and Shard hooks | Controller smoke tests, action logs, dashboard state |
| SOUL files | Define personality, ambitions, faction stance, and voice | Resident speech, portraits, Library pages |
| Shards | Let humans influence residents without puppeting them | Patron page, inbox letters, wall updates |
| Library | Turns resident timelines into biographies and epitaphs | `/library/`, `/graveyard/`, portrait markdown |
| Dashboard | Shows live resident state and RuneScape spectator views | `http://127.0.0.1:5174/` |

## Branches

Use `nullcity` for team demos and stable review.

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
git checkout nullcity
git pull --ff-only origin nullcity
```

Use `agents/wip` for active AI-agent development.

```bash
git checkout agents/wip
git pull --ff-only origin agents/wip
```

Do not demo from an unknown dirty worktree. Check first:

```bash
git status --short --branch
```

## Start Null City

Run these from `rs6-nullcity-server` unless noted.

1. Install and build.

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
npm install
npm run build
```

2. Start the RuneScape game server and resident gateway.

```bash
screen -dmS nullcity-game bash -lc 'cd /Users/james/Code/OnionDAO/rs6-nullcity-server && npm run start:game'
```

Wait about 10 seconds.

3. Start the resident controller and public Null City pages.

```bash
screen -dmS nullcity-controller bash -lc 'cd /Users/james/Code/OnionDAO/rs6-nullcity-server && CONTROLLER_MCP_TOKENS=operator-token CONTROLLER_MCP_OPERATOR_FOR_operator_token=operator-codex node dist/controller/index.js --config=/Users/james/Code/OnionDAO/rs6-nullcity-server/controller.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact 2>&1 | tee /tmp/nullcity-controller-demo.log'
```

4. Start the dashboard in the companion repo.

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard
git pull --ff-only
bun install
screen -dmS nullcity-dashboard bash -lc 'cd /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard && bun run dev'
```

If you want to watch dashboard logs directly, run `bun run dev` in a foreground terminal instead.

## URLs To Open

| Surface | URL | Use it for |
| --- | --- | --- |
| Dashboard | `http://127.0.0.1:5174/` | Main operator and demo surface |
| Public landing page | `http://127.0.0.1:43596/` | Human-friendly public entry |
| Wall ticker | `http://127.0.0.1:43596/wall/` | Public story feed |
| Patron page | `http://127.0.0.1:43596/patron/` | Shard and patron status |
| Inbox | `http://127.0.0.1:43596/inbox/` | Letters from residents |
| Library | `http://127.0.0.1:43596/library/` | Resident portraits and biographies |
| Graveyard | `http://127.0.0.1:43596/graveyard/` | Epitaphs and resident endings |

## Verify It Works

Run the broad post-restart smoke:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
bash scripts/post-restart-smoke.sh --no-color
```

Expected result: `READY`. Yellow warnings can be acceptable if they name a known non-demo resident, but a red failure means fix before presenting.

Run a live resident smoke:

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
```

For a deeper check of the canonical resident:

```bash
npm run controller:smoke -- --resident res:agent --observe-seconds 120 --allow-recent-visible
```

Probe the public pages:

```bash
for route in / /wall/ /inbox/ /patron/ /library/ /graveyard/ /v1/wall/snapshot /v1/library /v1/graveyard; do
  /usr/bin/curl -s -o /tmp/nullcity-probe.out -w "%{http_code} %{size_download} $route\n" "http://127.0.0.1:43596$route"
done
```

Expected result: `200` for every route.

## Are The Residents Ready?

For the current stable demo branch, do not create new residents just to demo. Use the current cast.

Good demo choices:

| Resident | Why show them |
| --- | --- |
| `res:hans` | Safest hero demo: Lumbridge courtyard, patron history, readable personality |
| `res:agent` | Canonical neutral resident and main system proof |
| `res:qa-woodcutter` | Good proof that residents can perform real skilling actions |
| `res:qa-cook` | Good proof of item/workflow behavior |
| `res:qa-scout` | Good proof of movement and exploration |
| `res:father-aereck` | Good soul/personality demo near Lumbridge chapel |
| `res:wise-old-man` | Strong narrative voice and familiar RuneScape character |

Some residents are QA or benchmark specialists. They are useful for proving behavior, but the public wall and Library hide synthetic residents so the public-facing story does not look like a test environment.

If a resident appears dead or missing, run a smoke test before reviving. If you do need a revive:

```bash
npm run controller:revive -- --resident res:hans
```

Then rerun:

```bash
npm run controller:smoke -- --resident res:hans --observe-seconds 60 --allow-recent-visible
```

## How To Explain The Residents

Use this plain-English explanation:

> Each resident has a SOUL file: personality, ambitions, values, relationships, faction tendencies, and a voice. The controller wraps that soul in a gameplay loop. They perceive the RuneScape world, decide what matters, act through available game verbs, remember what happened, and publish traces of that life to the dashboard, wall, inbox, Library, and graveyard.

Important caveat:

> Shards do not remote-control residents. They influence attention, standing, and priorities. The resident can notice a patron, respond with a letter, and let the gift shape future behavior, but the point is guided autonomy rather than puppeting.

## Dashboard Tips

Use the dashboard as your main demo surface:

1. Open `http://127.0.0.1:5174/`.
2. Start on the overview so the team sees resident counts, controller state, patron state, and live activity.
3. Open a stable resident such as Hans or a QA specialist.
4. Show the spectator panel to prove this is a RuneScape world, not only logs.
5. Show action history and thinking/inference panels to prove the resident is choosing actions.
6. Switch to a QA resident if you need a clearer proof of movement, skilling, or item use.

Dashboard language to use:

> The dashboard is our operator view. The public site is for event attendees. The dashboard shows what the resident sees, what it is trying to do, and what action actually happened.

What the dashboard shows well:

- Online/offline resident status.
- Recent activity and action outcomes.
- Current goals, runtime state, and attention.
- The RuneScape spectator view for live context.
- Patron and relationship summaries.

What to avoid overclaiming:

- It is not a polished consumer app yet.
- It may not expose every raw SOUL field inline; raw soul files live under `src/controller/soul/starter-souls/`.
- Cross-resident story effects are stronger in letters, portraits, sibling/epitaph context, and patron reactions than in guaranteed live ambient conversation.

## Showing The RuneScape UI

Prefer the dashboard spectator over logging in as a separate player. It shows the RuneScape world from the resident's point of view and avoids login or teleport friction.

If you do log in as a player, the Lumbridge cluster is the best live area:

| Resident | Approximate location |
| --- | --- |
| Hans | Lumbridge courtyard |
| Duke Horacio | Lumbridge castle |
| Father Aereck | Lumbridge chapel |
| Pip | West of Lumbridge courtyard |
| Thrand | Northeast of Lumbridge courtyard |

There is no clean, documented admin teleport flow in the current human runbook. Do not build the demo around teleporting unless you have separately verified it that day.

## How To Guide A Resident

Use Shards and patron commands for the cleanest demo. If a live player is nearby, short natural-language prompts can work, but they are less reliable than the operator tools.

Ask a resident a question:

```bash
CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token npm run patron:ask -- --human demo@onion --resident res:hans --text "What are you trying to do right now?"
```

Whisper a soft instruction:

```bash
CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token npm run patron:whisper -- --human demo@onion --resident res:hans --text "Greet the next human you see and explain what Null City is."
```

Examples of human chat prompts to try near a resident:

- `Hans status`
- `Hans look around`
- `Hans wait`
- `Hans make a fire`
- `Hans chop wood`
- `Hans go fishing`
- `Hans train combat`
- `Hans retreat`

Treat these as demo color, not as guaranteed scripted commands.

## Demo The Shard Flow

Register or grant a demo patron:

```bash
npm run patron:grant -- --human demo@onion --amount 5
```

Offer Shards to Hans:

```bash
CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token npm run patron:offer -- --human demo@onion --resident res:hans --amount 5
```

Ask for a witness letter:

```bash
npm run patron:witness -- --human demo@onion --resident res:hans
```

Then open:

- `http://127.0.0.1:43596/patron/`
- `http://127.0.0.1:43596/inbox/`
- `http://127.0.0.1:43596/wall/`
- Dashboard patron summary

Explain it this way:

> The Shard flow is the human influence layer. A patron gives standing and attention to a resident. The resident can react, write back, and carry that relationship into future choices. It is a social economy for AI residents, not a joystick.

## Five-Minute Team Demo

1. Open the dashboard overview.
   - Say: "This is the live operator view of the city."
2. Click Hans or `res:agent`.
   - Show spectator, recent actions, and thinking/inference state.
3. Switch to a QA resident.
   - Show real gameplay proof: movement, skilling, items, or recovery.
4. Open the public landing page, wall, Library, and graveyard.
   - Say: "The public sees the story, not the debug console."
5. Run the Shard flow for `demo@onion`.
   - Show patron page and inbox after the gift/witness commands.

If live behavior is slow, lean on the story surfaces and dashboard history. The system is designed to show both live trajectories and historical traces.

## Common Problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Dashboard says residents offline | Game server or controller is not running | Start game, then controller, then refresh dashboard |
| Public pages 404 | Controller was not started with `--letters-http-port=43596` | Restart the controller command from this runbook |
| Smoke says controller lock exists | Old controller did not exit cleanly | Confirm no controller process is running, then remove the stale lock |
| Ports are busy | Old screen or local process still running | Stop screens or kill the listener after confirming it is Null City |
| Residents are visible but not moving | Game server/gateway may be stale | Restart game, restart controller, rerun smoke |
| Inference is down | Model endpoint issue | Demo dashboard, wall, Library, and prior action history; do not center the LLM live |
| Inbox is empty | No patron witness letter yet | Run the Shard flow above |

Check running services:

```bash
screen -ls
lsof -iTCP -sTCP:LISTEN -nP | rg ':(43594|43595|43596|43610|5174|8787)'
```

## Shut Everything Down

Use this when you want a clean slate before running your own demo:

```bash
screen -X -S nullcity-controller quit 2>/dev/null || true
screen -X -S nullcity-game quit 2>/dev/null || true
screen -X -S nullcity-dashboard quit 2>/dev/null || true
```

Verify no expected ports are still listening:

```bash
lsof -iTCP -sTCP:LISTEN -nP | rg ':(43594|43595|43596|43610|5174|8787)' || true
```

If a process remains, only kill it after confirming it belongs to Null City.

## Quality Gates For Developers

Before claiming a branch is ready:

```bash
npm run fin
npm run build
bash scripts/post-restart-smoke.sh --no-color
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
```

For inference endpoint experiments:

```bash
npm run inference:canary -- --config controller.yml --all
```

For human-facing release notes, read `CHANGELOG.md`.
