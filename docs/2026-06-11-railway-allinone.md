# Railway All-In-One Container — Null City Full Stack on One Volume

**2026-06-11** · ships: `Dockerfile.railway-allinone`, `scripts/railway-allinone-entrypoint.sh`, `railway.allinone.json`, `src/engine/util/data-root.ts`.

> **NOT yet build-verified.** Authored with the Docker daemon DOWN. The scripts
> are `bash -n`-clean, the code change is `tsc --noEmit` + `jest` green (274
> suites / 4361 tests), and the image is reasoned-through — but it has NOT been
> `docker build`-run. A real build on Railway or Dev is required before deploy.
> See **§7 What Dev/Railway must do**.

## 1. Goal

Run the ENTIRE Null City server-side runtime in ONE Railway container, with
ONE Railway Volume mounted at `/data`, so the stack runs with the laptop OFF
and state survives restarts/redeploys. Every server-side runtime WRITE lands
under `$DATA_ROOT` (default `/data`).

This mirrors `scripts/runtime/start-all-supervised.sh` (the Mac bring-up) but
inside a single supervised container.

## 2. Architecture (one container)

```
                          Railway ingress ($PORT → 0.0.0.0)
                                      │
                          ┌───────────▼────────────┐
                          │  dashboard BFF (bun)    │  serves SPA + /api/*
                          │  packages/server        │  /api/health (healthcheck)
                          └───────┬─────────┬───────┘
              http 127.0.0.1:43611│         │127.0.0.1:43596  (city API / letters)
                          ┌───────▼─────────▼───────┐
                          │  controller (node)      │  letters :43596
                          │  + MCP :43610           │  city API :43611
                          │  + storyteller (ts-node)│  storyteller scheduler
                          └───────────┬─────────────┘
                       ws 127.0.0.1:43595 (AgentGateway, controller = client)
                          ┌───────────▼─────────────┐
                          │  game server (node)     │  game :43594
                          │  + AgentGateway ws :43595│
                          └───────────┬─────────────┘
                          ┌───────────▼─────────────┐
                          │  login :43591  update :43592 (infra, node)
                          └─────────────────────────┘

  Inference: REMOTE only — INFERENCE_BASE_URL + INFERENCE_API_KEY (never local).
  Volume:    ONE Railway Volume at /data.  DATA_ROOT=/data → all writes here.
```

The BFF is the **only** public surface. Game/gateway/login/update/letters/MCP/city
all bind `127.0.0.1` inside the container.

## 3. Write-path routing — every runtime WRITE → its env knob → its `/data/...` target

`$DATA_ROOT` defaults to `/data` (set by the entrypoint). With no `DATA_ROOT`
(Mac dev), every path falls back to the legacy relative `data/...` layout, so
the Mac scripts are unchanged.

| # | Subsystem / writer | Source | Env knob | `/data` target |
|---|---|---|---|---|
| 1 | Resident saves (`res:*` agents) | `RESIDENT_SAVE_DIR` (`@engine/.../resident.ts`) → `residentSaveDir()` | `NULLCITY_RESIDENT_SAVE_DIR` (else `$DATA_ROOT/residents`) | `/data/residents` |
| 2 | Player saves | `player-data.ts saveFilePath/savePlayer` → `playerSaveDir()`; also game `playerSavePath` in server-config.json | `NULLCITY_PLAYER_SAVE_DIR` / `PLAYER_SAVE_PATH` (else `$DATA_ROOT/saves`) | `/data/saves` |
| 3 | Agent action JSONL logs | `ActionLog` default (`action-log.ts`) → `agentLogDir()` | `NULLCITY_AGENT_LOG_DIR` (else `$DATA_ROOT/agent-logs`) | `/data/agent-logs` |
| 4 | Game asset cache (read-mostly) | `Filestore('cache')` (`game-server.ts`) → `gameCacheDir()` | `NULLCITY_GAME_CACHE_DIR` (default baked `cache/`) | `/app/cache` (baked; relocatable) |
| 5 | Controller memory (letters, ledgers, patron memory, facts, qmd, INDEX.md, hooks, memory-usage.jsonl) | `controller.yml memory.dir` → `MemoryStore` / `FactsStore` | templated `memory.dir` | `/data/controller/memory` |
| 6 | Controller logs (perceptions, action-log, telemetry) | `controller.yml logging.dir` → `ControllerHost` + `ActionLog(config.logging.dir)` | templated `logging.dir` | `/data/controller/logs` |
| 7 | Controller knowledge (suggestions) | `controller.yml knowledge.dir` (storageMode `persistent-volume`) | templated `knowledge.dir` | `/data/controller/knowledge` |
| 8 | Controller lock | `acquireControllerLock({ lockDir: config.memory.dir })` | follows `memory.dir` | `/data/controller/memory/*.lock` |
| 9 | Storyteller memory-root | `scheduler-cli --memory-root` | `STORYTELLER_MEMORY_ROOT` (else `$DATA_ROOT/controller/memory`) | `/data/controller/memory` |
| 10 | Storyteller output (frames, canon, ledger, scheduler lock) | `scheduler-cli --output-dir` | `STORYTELLER_OUTPUT_DIR` (else `$DATA_ROOT/controller/storyteller`) | `/data/controller/storyteller` |
| 11 | Supervised runtime logs (game/storyteller/all) | runner scripts honor `NULLCITY_RUNTIME_LOG_DIR` (Mac default `/tmp/nullcity-runtime`) | `NULLCITY_RUNTIME_LOG_DIR` | `/data/logs` |
| 12 | Dashboard BFF memory reads | `NULLCITY_MEMORY_ROOT` (dashboard config) | `NULLCITY_MEMORY_ROOT` | `/data/controller/memory` (shared with #5) |
| 13 | Game server-config.json (generated) | entrypoint render | `CONFIG_DIR` | `/app/config/server-config.json` (regenerated each boot) |
| 14 | controller.yml (generated) | entrypoint render | `CONTROLLER_CONFIG` | `/data/controller.yml` |

**How #1–4 became routable (the code change):** these four game-side dirs were
hardcoded relative strings resolved from cwd with no env knob. `src/engine/util/data-root.ts`
(new, TDD) centralizes them on `DATA_ROOT` with per-dir overrides, default =
legacy `data/`. Wired into `resident.ts`, `player-data.ts`, `resident-registry.ts`,
`action-log.ts`, `game-server.ts`. #5–7 already env-template via `controller.yml`
(`${...}` interpolation in `config.ts`), and `config.ts`'s production gate already
REQUIRES `/data...` for memory/logging/knowledge — so no controller code change
was needed, only a templated `controller.yml`.

## 4. Environment variables a deployer must set

### REQUIRED (no working brain without these)
| Var | Meaning |
|---|---|
| `INFERENCE_BASE_URL` | Remote inference base URL (e.g. `https://openrouter.ai/api`). Never localhost. |
| `INFERENCE_API_KEY` | Bearer key for the inference endpoint. |
| `INFERENCE_MODEL` | Model slug (e.g. `anthropic/claude-3.5-haiku`). |

### Railway-injected (do not set by hand)
| Var | Meaning |
|---|---|
| `PORT` | Public BFF port. Entrypoint binds it on `0.0.0.0`. |

### Recommended (security + launch posture)
| Var | Default | Meaning |
|---|---|---|
| `CONTROLLER_INSTANCE_ID` | `nullcity-allinone` | Must be explicit in production. |
| `CONTROLLER_CITY_HTTP_TOKEN` | `operator-token` | City API bearer; set a real secret. |
| `NULLCITY_CITY_API_TOKEN` | mirrors city token | BFF→city-API auth. |
| `AGENT_GATEWAY_AUTH_TOKEN` | empty (loopback) | Gateway token; loopback is tokenless, fine in-container. |
| `CONTROLLER_ENABLE_AP_GP_EXCHANGE` | `false` | Keep the AP↔GP exchange OFF for launch (SL-6 exploit gate). |
| `INFERENCE_PROVIDER` | `openai-compatible` | `openrouter` / `openai-compatible`. |
| `INFERENCE_RESPONSE_FORMAT` | `text` | `text` parses cleanest on OpenRouter. |
| `CONTROLLER_RESIDENT` | `res:agent` | Resident(s) the controller runs. |
| `NULLCITY_ENABLE_STORYTELLER_SCHEDULER` | `1` | Set `0` to disable the storyteller loop. |

### Build-args (Dockerfile, dashboard clone)
| Arg | Default | Meaning |
|---|---|---|
| `DASHBOARD_REPO` | `https://github.com/OnionDAO/rs6-nullcity-residents-dashboard.git` | Dashboard repo; embed a token for a private repo. |
| `DASHBOARD_REF` | `wip/spec` | Pinned branch/tag/SHA to build. |

### Tuning (optional)
`GAME_HEAP_MB` (4096), `LOGIN_HEAP_MB` / `UPDATE_HEAP_MB` (512), `DATA_ROOT`
(`/data`), `QMD_BIN` (`qmd`), `CONTROLLER_KNOWLEDGE_STORAGE_MODE`
(`persistent-volume`), and the per-port `CONTROLLER_*_HTTP_PORT/HOST` knobs.

## 5. Dashboard-in-image mechanism — CHOSEN: build-time `git clone` (build-args)

The dashboard is a **separate repo** (`rs6-nullcity-residents-dashboard`, branch
`wip/spec`). The image needs both. Options considered:

| Option | Verdict |
|---|---|
| (i) git submodule | Pins a SHA cleanly, but Railway's Dockerfile builder checks out only THIS repo and its cross-repo submodule fetch over the Dockerfile path is unreliable. Rejected as the primary. |
| **(ii) build-time `git clone` + build-arg token** | **CHOSEN.** A dedicated `dashboard-build` stage clones the pinned `DASHBOARD_REF` and runs `bun install && bun run build`. For a private repo, pass a short-lived PAT inside `DASHBOARD_REPO`; the clone stage is discarded so the token is not in the final image layer. Most Railway-friendly for a separate repo, deterministic via `DASHBOARD_REF`. |
| (iii) prebuilt-image-to-registry | Most decoupled, but adds a second pipeline + registry plumbing. Documented fallback if build times get painful. |

The final stage copies the built `/dashboard` tree (SPA `packages/web/dist` +
BFF source). The BFF serves the SPA from `DASHBOARD_WEB_DIST`
(`$DASH_DIR/packages/web/dist`, pinned by the entrypoint).

**Coordination contract** (a second agent is making the dashboard volume-aware +
prod-ready in parallel). This image assumes the dashboard exposes:
- `bun run build` at repo root → builds all workspace packages, SPA → `packages/web/dist`.
- `bun src/index.ts` (BFF) honoring `PORT`/`DASHBOARD_HOST=0.0.0.0`, serving the SPA, reading `NULLCITY_MEMORY_ROOT=$DATA_ROOT/controller/memory`.
- `GET /api/health` for the Railway healthcheck.

All four are present today (`packages/server/src/config.ts`: `DASHBOARD_HOST`,
`PORT`/`DASHBOARD_PORT`, `NULLCITY_MEMORY_ROOT`, `DASHBOARD_WEB_DIST`;
`index.ts`: `/api/health`).

## 6. Ports & ingress

| Port | Process | Exposure |
|---|---|---|
| `$PORT` (BFF, default 8787) | dashboard BFF | **PUBLIC** (Railway ingress, `0.0.0.0`) |
| 43594 | game server | in-container only |
| 43595 | AgentGateway ws | in-container only |
| 43591 / 43592 | login / update | in-container only |
| 43596 | controller letters HTTP | in-container only |
| 43610 | controller MCP HTTP | in-container only |
| 43611 | controller city API | in-container only |

## 7. What Dev / Railway must do to actually deploy

1. **`docker build` it.** This is NOT build-verified. Build
   `Dockerfile.railway-allinone` locally or on Railway with the dashboard
   build-args. Expect to iterate on: Node-on-Bun-image install (NodeSource
   repo line), `oven/bun` tag pinning, and the dashboard `bun run build` step.
2. **One service, one Volume at `/data`.** Create a single Railway service from
   this repo, point it at `railway.allinone.json` (or set the Dockerfile path),
   attach ONE Volume mounted at `/data`.
3. **Set env** (§4): the three `INFERENCE_*`, the recommended tokens, and the
   dashboard build-args.
4. **Memory/CPU sizing.** The full Mac stack in one container is heavy: game
   heap ~4GB + controller + BFF (bun) + login/update + storyteller (ts-node).
   Provision **~8–16GB RAM** and ≥2 vCPU. Start at 8GB; bump if the game OOMs.
5. **qmd (optional, DEV ASK).** The controller memory store spawns `qmd` for
   semantic recall but **degrades gracefully to markdown-only** when it is
   absent (`memory-store.ts` warns once, then falls back). `qmd` is not an npm
   package and has no pinned install recipe in this repo, so the image ships
   WITHOUT it. To enable richer recall, Dev should add the `qmd` binary to
   `PATH` in the runtime stage (e.g. `COPY --from=<qmd-image> /usr/local/bin/qmd
   /usr/local/bin/qmd`) and/or set `QMD_BIN`.
6. **Healthcheck.** `railway.allinone.json` points at BFF `/api/health` with a
   120s timeout (the game/controller cold-start is slow; the BFF itself is up
   fast but the city is not interactive until game+controller attach).
7. **First-boot seed.** The entrypoint seeds `/data` from the baked `data-seed`
   once (`cp -rn`, idempotent, never stomps existing state) and touches
   `/data/.seeded`.

## 8. What is NOT build-verified (honesty)

- No `docker build` has run. Layer ordering, the Node-on-`oven/bun` NodeSource
  install, and the dashboard clone+build are reasoned-through, not proven.
- `bun run build` / `bun src/index.ts` for the dashboard are assumed from the
  repo's current `package.json` + `railway.json`; the parallel dashboard agent
  owns making that prod-ready.
- `qmd` is intentionally absent (graceful degrade); rich recall is a Dev ask.
- Inference is remote and untested here; residents have no brain until
  `INFERENCE_*` are set and reachable from Railway.

The **code** change (write-path routing) IS verified: `npx tsc --noEmit` clean,
`npx jest` 274 suites / 4361 tests green.
