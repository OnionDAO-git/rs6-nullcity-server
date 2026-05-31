# Null City Runtime Stewardship

Last updated: 2026-05-31 14:20 CDT

This file is the coordination point for running processes on James's machine.

## Current owner

Codex in James's active desktop thread owns runtime restarts until this note is superseded.

## Running stack

- Server repo: `/Users/james/Code/OnionDAO/rs6-nullcity-server`
- Dashboard repo: `/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard`
- Controller HTTP letters/wall API: `http://127.0.0.1:43596`
- Controller MCP/control API: `http://127.0.0.1:43610`
- City control API: `http://127.0.0.1:43611`
- Game gateway: `127.0.0.1:43594`
- Agent gateway: `127.0.0.1:43595`
- Update server: `127.0.0.1:43592`
- Login server: `127.0.0.1:43591`
- Dashboard BFF: `http://127.0.0.1:8787`
- Dashboard web dev server: `http://127.0.0.1:5174`

Codex currently runs these in named `screen` sessions because detached child processes launched from Codex can be cleaned up when a tool call exits.

- `nullcity-infra-codex`
- `nullcity-game-codex`
- `nullcity-controller-codex`
- `nullcity-dashboard-server-codex`
- `nullcity-dashboard-web-codex`

Inspect with `screen -ls`. Attach with `screen -r <name>`, detach with `Ctrl-a d`.

Latest log paths are written to `/tmp/nullcity-runtime/*.log`.

The runtime game session should use the supervised game runner, not the dev
nodemon runner. The supervised runner starts the compiled game server with a
larger heap and restarts it after a crash. Rebuild before restarting it so
`dist/` matches the checked-out source.

## Agent restart request protocol

If an autonomous agent needs a process restarted, it should append a single line to `docs/agent-status.md`:

```text
YYYY-MM-DD HH:MM CDT <agent> RUNTIME-REQUEST target=<controller|dashboard|game|infra|all> reason=<why> required_sha=<sha-or-working-tree> validation=<command-or-url> urgency=<low|normal|high>
```

The runtime steward responds in `docs/agent-status.md`:

```text
YYYY-MM-DD HH:MM CDT codex RUNTIME-ACK target=<...> action=<restart|defer|needs-info> note=<short reason>
YYYY-MM-DD HH:MM CDT codex RUNTIME-HANDOFF target=<...> pid=<pid-or-list> log=<path> validation=<result>
```

## Ground rules

- Do not restart the controller, game, infra, or dashboard directly while this owner note is active unless James explicitly asks you to.
- Dashboard UI changes belong in `rs6-nullcity-residents-dashboard`, not the server repo.
- Server agents may restart only tests or one-shot benchmark commands they start themselves.
- Controller restarts are medium risk because they interrupt live resident cadence.
- Game or infra restarts are high risk and should happen only for health failures, config reloads, or explicit human instruction.
- Prefer dashboard restarts freely after dashboard changes; they do not reset residents.

## Canonical commands

Controller:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
npm run build
node dist/controller/index.js --config="$(pwd)/controller.yml" --mcp-http-port=43610 --letters-http-port=43596 --wall-redact --city-http-port=43611 --city-http-token=operator-token
```

Dashboard:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard
bun run dev
```

Game:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
npm run build
NODE_MAX_OLD_SPACE=4096 npm run start:game:supervised
```

Verification:

```bash
curl -fsS http://127.0.0.1:43596/v1/wall/snapshot >/dev/null
curl -fsS -H 'Authorization: Bearer operator-token' http://127.0.0.1:43611/api/nullcity/economy/heartbeat >/dev/null
curl -fsS http://127.0.0.1:8787/api/overview >/dev/null
curl -fsS http://127.0.0.1:5174/ >/dev/null
```
