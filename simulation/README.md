# Resident Simulation

The simulation harness drives residents through the agent gateway using the same `AgentAction` and `Perception` boundary as external controllers.

## Scripts

- `npm run simulation:birth -- --count 5 --goal wander` creates residents and records assignments in `data/simulation/assignments.json`.
- `npm run simulation:assign-goals -- --goal collect_items` updates assigned goals.
- `npm run simulation` runs the assigned residents against the gateway.
- `npm run simulation:report -- --out data/logs/simulation/report.md` summarizes bug and unimplemented-action logs.

The game server must be running with `agentGateway.enabled: true`. The default gateway URL is `ws://127.0.0.1:43595/agent`.

## Goals

Goals are intentionally black-box and map to public resident actions:

- `wander`: move around the resident's home position.
- `collect_items`: pick up nearby world items, otherwise wander.
- `talk_to_npcs`: talk to nearby NPCs, otherwise wander.
- `socialize`: say short status lines near other players, otherwise wander.
- `work_loop`: interact with nearby objects, then collect items, otherwise wander.
- `survive`: attack nearby NPCs and report low health.

## Logs

JSONL logs are written under `data/logs/simulation`:

- `actions`: submitted actions and later action results.
- `perceptions`: compact perception summaries unless `logFullPerceptions` is enabled.
- `events`: resident and gateway lifecycle events.
- `bugs`: classified action failures, missing content, infrastructure failures, and likely unimplemented surfaces.
