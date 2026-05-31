# Null City Runtime Stewardship

Last updated: 2026-05-31 17:11 CDT

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

## Model policy

- **S-INFER-9 — the Brain and Body run SPLIT model tiers (supersedes the old "both run q4" policy).** The deliberate-planner + fast-executor split: the rare, cadenced **Brain** runs the smarter/slower **`qwopus3.5-27b-v3@q8_0`** on the **spark host** (`inf.nullcity.ai:1234`, `llm.endpoints.brain_q8`, thinking ON, 240s ceiling); the fast every-few-seconds **Body** runs **`qwopus3.5-27b-v3@q4_k_s`** on the **tower host** (`spacetower.nullcity.ai:8100`, `llm.endpoints.body_q4`, thinking OFF, 30s tight timeout). The ~10 cohort souls route via `behavior.brain.endpoint: brain_q8` + `behavior.body.endpoint: body_q4` in their frontmatter; `endpointFor(profile)` resolves the two tiers to separate endpoints (proven by `hybrid-agent-thinking-module.test.ts` S-INFER-9). A slow q8 brain (~60–150s) is fine: it emits a PLAN the Body executes for a while, and the 240s ceiling accommodates it; the Body fires independently every tick on its own endpoint so the resident stays lively while the brain thinks. **`res:hans` is a hook-hero exception** — single thinking-off tier, no deliberative q8 brain; it routes to `body_q4` via `model.endpoint`.
  - **STEWARD: keep q8 hot on spark.** Ask Dev to keep `qwopus3.5-27b-v3@q8_0` resident/warm on `inf.nullcity.ai:1234` so the q8 brain stays nearer ~60s than ~150s. ALSO: as of 2026-05-31 the inf host was rejecting qwopus probes ("Context size has been exceeded") and the LIVE `default` was failed over to spacetower — **verify inf serves `@q8_0` before relying on brain_q8**; if inf is still degraded, point `brain_q8.baseUrl` at `spacetower:8100` (it serves `@q8_0` per `/v1/models`) so the q8 brain still works.
- (Historical) Before S-INFER-9, Brain + Body both ran `qwopus3.5-27b-v3@q4_k_s` (the `llm.endpoints.default` model). Brain ran thinking ON; Body thinking OFF; same endpoint.
- **`qwen/qwen3.6-27b` is NON-SERVING** as of 2026-05-31. Live A/B (S-INFER-AB-1, `docs/capability-evidence/2026-05-31-qwen-vs-qwopus-ab.md`) showed it hung on a trivial thinking-off prompt on **both** `inf` and `spacetower` hosts (0/24 usable), while qwopus answered fine on the same hosts. **Do NOT re-point any `llm.endpoints.*.model`, soul `model.endpoint`, or behavior back at qwen** (cron/Codex/agents included) until Dev confirms qwen serves again.
- **Inference boxes should serve qwopus-only** (Dev action): dedicating VRAM to qwopus keeps it hot and cuts its ~40s latency under 19–25 concurrent residents. See HD-053.
- Future model mix — a fast small model for the high-frequency Body + a stronger model (Haiku/Claude) for the rare deep Planner — is tracked in `docs/superpowers/plans/2026-06-01-resident-intelligence-roadmap.md` and HD-052.

## Inference timeouts (S-INFER-8)

- **The brain request timeout (240s) and thinking watchdog (250s) are GENEROUS "inference server is broken" ALARMS, NOT thinking bounds.** Real q4 qwopus full-envelope thinking is ~40s; these ceilings are ~6x that, with headroom for the future longer-thinking deliberative planner.
- **A brain timeout / watchdog firing is a RARE event that means: investigate the inference server.** It is logged LOUD (`[inference-alarm] … the inference server may be degraded`). The real fast "server dead" detector is the health probe in `src/controller/llm/inference-health.ts` (`degradedFlags`) — check that.
- **Do NOT lower these to throttle thinking.** Before S-INFER-8 the watchdog was 45s and the request timeout 75s — the 45s watchdog fired BEFORE the request timeout and cut legitimate ~40s deliberations (the live guillotine). The watchdog now sits slightly ABOVE the request timeout (250 > 240) so the cleaner request-timeout signal fires first; the watchdog is a pure last-resort backstop.
- Constants: `DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS = 240_000` (`hybrid-agent-chat.ts`, `hybrid-agent-helpers.ts`, `hybrid-agent-thinking-module.ts`); `DEFAULT_THINKING_WATCHDOG_MS = 250_000` (`resident-runtime.ts`). The `llm.endpoints.default.timeoutMs` in `controller.yml` must be `>= 240000` so the HTTP layer does not cut earlier.
- The **Body** timeout (`DEFAULT_BODY_INFERENCE_TIMEOUT_MS = 10_000`) and the fast **action** watchdogs (ack 15s / say 10s / action-effect grace 10s) stay tight — they guard fast action EXECUTION, not deliberation. A stuck body/action call SHOULD time out fast.

## Active resident cohort

The local controller is intentionally capped to a small active cohort while the
owned inference machines are being benchmarked. Local `controller.yml` is
gitignored operator config, and on James's machine it currently sets
`souls.discoverResidents: false`, so the controller runs only the residents
listed in `residents:` instead of auto-controlling every starter soul file.

Current active cohort:

- `res:agent` — canonical resident / general loop
- `res:hans` — human-facing hero and patron demo anchor
- `res:qa-woodcutter` — woodcutting, firemaking, XP and item loops
- `res:qa-cook` — fishing, cooking, food and eating loops
- `res:qa-survivor` — survival, combat pressure and flee/recovery loops
- `res:qa-guardian` — combat/prayer guard behavior
- `res:qa-trader` — safe trade FSM and human exchange probes
- `res:qa-banker` — AP/GP economy and banking-adjacent loops
- `res:qa-social` — chat, commands and non-repeat name-response behavior
- `res:qa-scout` — movement, exploration, stuck recovery and memory recall

Residents outside this list are not deleted. Their soul files and Library
history remain in the repo/data store; they are simply not controlled by the
local runtime cohort. If the dashboard still shows them from gateway history,
treat them as paused/offline rather than dead.

To add a temporary resident for a benchmark, append it to `controller.yml`
`residents:` and post a `RUNTIME-REQUEST target=controller` line in
`docs/agent-status.md`. Do not re-enable broad soul discovery on the shared
local stack unless James asks for an all-resident soak.

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
