# Null City Runtime Stewardship

Last updated: 2026-06-02 16:10 CDT

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

| Target | Screen session | Primary ports | Restart risk | Notes |
|---|---|---|---|---|
| `infra` | `nullcity-infra` | `43591`, `43592` | High | Login/update services. Restart only for health failure or explicit operator request. |
| `game` | `nullcity-game` | `43594`, `43595` | High | Game + agent gateway. Restart interrupts clients/residents. |
| `controller` | `nullcity-controller` | `43596`, `43610`, `43611` | Medium | Resident brain/body, letters, city API. Rebuild before restart. |
| `dashboard-server` | `nullcity-dashboard-server` | `8787` | Low | Dashboard BFF/API. Usually safe after dashboard/server changes. |
| `dashboard-web` | `nullcity-dashboard-web` | `5174` | Low | Dashboard dev web server. Usually safe after dashboard UI changes. |

Legacy `*-codex` screen sessions are old names. If both suffixed and unsuffixed sessions exist, ask the runtime steward before killing anything.

Inspect with `screen -ls`. Attach with `screen -r <name>`, detach with `Ctrl-a d`.

Latest log paths are written to `/tmp/nullcity-runtime/*.log`. Supervised
runtime logs are bounded: each `*.log` is copy-truncated on supervisor startup
when it exceeds `NULLCITY_RUNTIME_LOG_MAX_BYTES` (default 500 MiB, preserving a
tail snapshot under `/tmp/nullcity-runtime/snapshots`), and supervised process
stdout/stderr streams rotate at `NULLCITY_LOG_MAX_BYTES` (default 64 MiB, five
backups). This prevents a repeat of the 2026-06-01 `game.log` disk-pressure
incident while preserving the newest evidence for diagnosis.

The runtime game session should use the supervised game runner, not the dev
nodemon runner. The supervised runner starts the compiled game server with a
larger heap and restarts it after a crash. Rebuild before restarting it so
`dist/` matches the checked-out source.

## Model policy

- **S-INFER-10 — Brain AND Body both run qwopus q4 (`qwopus3.5-27b-v3@q4_k_s`); q8 dropped — unusable at ~1.4 tok/s (see HD-053).** This reverts the S-INFER-9 brain→q8 split. q8 proved unusable in practice: ~1.4 tok/s, a single full-envelope plan ≈ 12 min, and full resident prompts timed out (180s thinking / 90s no-think) on every host probed (S-INFER-9-PREDEPLOY-GUARD-1, `ff47b826`). Both tiers now run the fast q4 on the **tower host** (`spacetower.nullcity.ai:8100`, `llm.endpoints.body_q4`). The deliberate-planner **Brain** keeps thinking ON + the generous 240s ceiling; the fast every-few-seconds **Body** keeps thinking OFF + the tight 30s timeout — they simply share the q4 endpoint now. The ~10 cohort souls route via `behavior.brain.endpoint: body_q4` + `behavior.body.endpoint: body_q4` in their frontmatter; `endpointFor(profile)` resolves both tiers to the q4 endpoint (proven by `hybrid-agent-thinking-module.test.ts` S-INFER-10). The Body still fires independently every tick on its own endpoint so the resident stays lively while the brain thinks. **`res:hans` is a hook-hero exception** — single thinking-off tier, no deliberative brain; it routes to `body_q4` via `model.endpoint`.
  - The `enable_thinking` flag is **ignored by qwopus** (it always reasons); `response_format: json_schema` is what makes it emit the answer.
  - **No q8 endpoint should be referenced anywhere** (cohort souls, `controller.yml`, tests). If a fresh `controller.yml` still defines `llm.endpoints.brain_q8`, drop it or repoint it at the q4 model/host — nothing routes to it.
- (Historical) S-INFER-9 (`e001cb01`) briefly routed the Brain to `qwopus3.5-27b-v3@q8_0` on the spark host (`inf.nullcity.ai:1234`, `llm.endpoints.brain_q8`) for a deliberate-planner/fast-executor split; reverted by S-INFER-10 after q8 proved unusable. The committed config never deployed live — the live controller stayed on q4 throughout (95.5% usable-brain).
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

- `res:agent` — The Steward; canonical resident / general loop
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

If an autonomous agent needs a shared process restarted, it should append a single line to `docs/agent-status.md`:

```text
YYYY-MM-DD HH:MM CDT <agent> RUNTIME-REQUEST target=<controller|dashboard-server|dashboard-web|game|infra|all> reason=<why> required_sha=<sha-or-working-tree> affected_ports=<ports> interrupts_live_test=<yes|no|unknown> safe_after=<now|time> validation=<command-or-url> rollback=<plan> urgency=<low|normal|high> lease_expires=<iso-or-local-time>
```

The runtime steward responds in `docs/agent-status.md`:

```text
YYYY-MM-DD HH:MM CDT codex RUNTIME-ACK target=<...> action=<restart|defer|needs-info> note=<short reason>
YYYY-MM-DD HH:MM CDT codex RUNTIME-HANDOFF target=<...> pid=<pid-or-list> log=<path> validation=<result>
```

Steward preflight before restart:

1. Read the last 120 lines of `docs/agent-status.md` for unexpired STARTING/RUNTIME leases touching the target.
2. Run `screen -ls` and confirm the target's current session name.
3. Check the target ports if the failure mode is ambiguous.
4. ACK with restart/defer/needs-info before acting.
5. Handoff with screen name, pid/log path, and at least one post-smoke command or URL.

## Ground rules

- Do not restart the controller, game, infra, or dashboard directly while this owner note is active unless James explicitly asks you to.
- Dashboard UI changes belong in `rs6-nullcity-residents-dashboard`, not the server repo.
- Server agents may restart only tests or one-shot benchmark commands they start themselves.
- Controller restarts are medium risk because they interrupt live resident cadence.
- Game or infra restarts are high risk and should happen only for health failures, config reloads, or explicit human instruction.
- Dashboard restarts are low risk, but non-stewards still request them; the steward may fast-ack when no active dashboard lease is present.

## Canonical commands

Controller:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
npm run build
screen -S nullcity-controller
node dist/controller/index.js --config="$(pwd)/controller.yml" --mcp-http-port=43610 --letters-http-port=43596 --wall-redact --city-http-port=43611 --city-http-token=operator-token
```

Dashboard:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard
screen -S nullcity-dashboard-web
bun run dev
```

Game:

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
npm run build
screen -S nullcity-game
NODE_MAX_OLD_SPACE=4096 npm run start:game:supervised
```

Verification:

```bash
curl -fsS http://127.0.0.1:43596/v1/wall/snapshot >/dev/null
curl -fsS -H 'Authorization: Bearer operator-token' http://127.0.0.1:43611/api/nullcity/economy/heartbeat >/dev/null
curl -fsS http://127.0.0.1:8787/api/overview >/dev/null
curl -fsS http://127.0.0.1:5174/ >/dev/null
```

## Release-day bring-up (added 2026-06-11)

Background (2026-06-11 SRE audit): a host reboot took the whole city down —
nothing autostarts; the dashboard BFF (:8787) ran unsupervised and crashed
unattended; runtime logs lived in /tmp (wiped on reboot); and there were NO
backups of Postgres or `data/controller/memory`. The scripts below close those
holes. Run the bring-up IN ORDER after any reboot or before doors open.

1. **OrbStack** — make sure the docker daemon is up: `docker info >/dev/null` (open OrbStack if it fails).
2. **Database** — `cd /Users/james/Code/OnionDAO/landing-2026 && docker compose up -d db`, then verify `docker exec landing-2026-db-1 pg_isready -U oniondao`.
3. **Inference** — `curl -m5 http://inf.nullcity.ai:1234/v1/models` (must return a model list before residents wake).
4. **Build** — `cd /Users/james/Code/OnionDAO/rs6-nullcity-server && npm run build` (dist/ must match the checked-out source).
5. **Stack** — `bash scripts/runtime/start-all-supervised.sh` (now also supervises the dashboard BFF/SPA and the landing dev server :5173 via `scripts/runtime/start-dashboard-supervised.sh`).
6. **Landing** — brought up by step 5 (screen `nullcity-landing`); verify `curl -fsS http://127.0.0.1:5173/ >/dev/null`.
7. **Seed** — `cd /Users/james/Code/OnionDAO/landing-2026 && bun scripts/seed-nullcity-mvp.ts` (needs `DATABASE_URL` from `.env`; idempotent points-mode seed).
8. **Smoke** — `bash scripts/post-restart-smoke.sh` and `bash scripts/runtime/healthcheck-nullcity.sh` (both must be green).

Crons to install on the runtime host (`crontab -e`):

```cron
# hourly backup: pg_dump oniondao + nullcity_city, tar of data/controller/memory, keep last 48
0 * * * * /bin/bash /Users/james/Code/OnionDAO/rs6-nullcity-server/scripts/runtime/backup-nullcity.sh >> "$HOME/nullcity-logs/backup.log" 2>&1
# 2-minute health probe; HEAL=1 re-runs start-all-supervised.sh on failure (10-min heal cooldown)
*/2 * * * * HEAL=1 /bin/bash /Users/james/Code/OnionDAO/rs6-nullcity-server/scripts/runtime/healthcheck-nullcity.sh >> "$HOME/nullcity-logs/healthcheck.log" 2>&1
```

Log locations: game/controller/storyteller supervised logs still live under
`/tmp/nullcity-runtime` — **those die on reboot**. The new dashboard/landing
supervisors, the backup script, and the healthcheck log to `~/nullcity-logs`
(override with `NULLCITY_RUNTIME_LOG_DIR`), which survives reboots. Backups
land in `~/nullcity-backups` (override `NULLCITY_BACKUP_DIR`).

## Deploy note (2026-06-01 00:40 CDT, claude)
- Controller restarted from HEAD (f52209b6) to ship FIX-BORN-RESIDENT-PERSIST-1 + FIX-BIRTH-GOAL-CONTRACT-1 (James-authorized). Old controller (pid 58896, screen `nullcity-controller-codex`) gracefully stopped; new controller now runs in screen **`nullcity-controller`** (log `/tmp/nullcity-runtime/controller-claude-deploy.log`). Same flags: `--mcp-http-port=43610 --letters-http-port=43596 --wall-redact --city-http-port=43611 --city-http-token=operator-token`. Game/gateway (`nullcity-game-codex`, 43594/43595) untouched. Both fixes live-verified end-to-end (born resident survives reconcile + thinks; goal->Library saved moment fires).
