# Null City on Railway — Deploy Requirements (2026-06-11, T-1)

**Why:** the maintainer's laptop won't be reliably on, so the whole runtime must move to an always-on host. Target: **James's personal Railway** for the Null City runtime; **Dev's Railway** keeps landing (canonical Onions + Postgres).

## What we fixed tonight (the file-writing problem — DONE in code)

Railway gives persistent disk via a **Volume**, one per service. So the runtime is packaged as **ONE service / ONE container / ONE Volume at `/data`**, and **every runtime write is env-routed under `/data`** (default falls back to relative `data/` on the Mac, so dev is unchanged). Verified by typecheck + full test suites (server 4361, dashboard 678 green). Build artifacts: `Dockerfile.railway-allinone`, `scripts/railway-allinone-entrypoint.sh`, `railway.allinone.json`, `docs/2026-06-11-railway-allinone.md`.

| What writes | Env knob | Lands at |
|---|---|---|
| Player saves | `NULLCITY_PLAYER_SAVE_DIR` | `/data/saves` |
| Resident saves | `NULLCITY_RESIDENT_SAVE_DIR` | `/data/residents` |
| Agent action logs | `NULLCITY_AGENT_LOG_DIR` | `/data/agent-logs` |
| Controller memory (letters, ledgers, patron, facts) | `controller.yml memory.dir` (templated) + dashboard `NULLCITY_MEMORY_ROOT` | `/data/controller/memory` |
| Controller logs | `controller.yml logging.dir` (templated) | `/data/controller/logs` |
| Storyteller | `STORYTELLER_MEMORY_ROOT` / `STORYTELLER_OUTPUT_DIR` | `/data/controller/{memory,storyteller}` |
| Supervised runtime logs (was `/tmp`, died on restart) | `NULLCITY_RUNTIME_LOG_DIR` | `/data/logs` |
| Souls (resident-create) | dashboard `NULLCITY_SOULS_ROOT` | `/data/controller/soul/starter-souls` |
| Game asset cache | `NULLCITY_GAME_CACHE_DIR` | baked at `/app/cache` (read-mostly) |

Also done: dashboard now resolves login sessions over **HTTP** (`GET oniondao.dev/api/public/session`) instead of reading Dev's Postgres directly — so **Dev does not need to expose his database**.

## ⚠️ Honest risk for tomorrow

The Docker image is **NOT build-verified** — the local Docker daemon was down, so the Dockerfile + entrypoint are reviewed and `bash -n`-clean but never `docker build`-run. A first real build will likely need 1–2 rounds of fixes (Node-on-bun base image, native-module glibc, the dashboard clone+build step). **A real `docker build` must happen before doors** — locally (start OrbStack and I'll run it), in CI, or as Railway's first build. Budget time for it. Lower-risk fallback if the container fights back: a single always-on Linux VM running the existing, battle-tested `start-all-supervised.sh` verbatim behind a tunnel — same outcome, no new container surface.

---

# EXACTLY what we need

## From RAILWAY (James's account) — you
1. **One service**, deployed from `Dockerfile.railway-allinone` (set `railway.allinone.json` as the config, or point the service at it).
2. **One Volume**, mounted at **`/data`** (this is where all state + logs persist).
3. **Plan size: ~8–16 GB RAM, ≥2 vCPU.** The whole stack (game with a 4 GB heap + controller + storyteller + BFF + login/update) runs in one container.
4. **The two-repo build decision (the crux).** The image needs BOTH repos (the BFF reads the controller's files, so they must share the image). Pick one:
   - **(a) Build-arg clone (wired today):** the Dockerfile clones the dashboard at build time — needs a **GitHub token** as a build secret (`DASHBOARD_REPO`, `DASHBOARD_REF=wip/spec`). Simplest in Railway.
   - **(b) Prebuilt image → registry:** build locally/CI, push to GHCR, point Railway at the image. Most reliable, needs a registry + one push.
5. **Set the env vars** (full list in `railway.allinone.json` + the all-in-one doc). The criticals: `DATA_ROOT=/data`, `PORT` (auto), inference URL+key (below), `LANDING_SESSION_MODE=api`, `LANDING_AUTH_BASE_URL=https://oniondao.dev`, `AUTH_COOKIE_DOMAIN=.oniondao.dev`, `CITY_PUBLIC_BASE_URL=https://city.oniondao.dev`, `ONION_API_BASE_URL=https://oniondao.dev`, `ONION_EXTERNAL_API_KEY`, `ONION_CALLBACK_SECRET`, `enableApGpExchange=false`.
6. **Run a real `docker build` ASAP** to shake out image bugs (see risk note).

## From DEV
1. **Inference reachable from Railway's cloud, with auth.** This is the #1 hard blocker — Railway is NOT on the home network, so the GPU boxes (`inf.nullcity.ai:1234`, `spacetower:8100`) must be (a) back UP and (b) reachable from the public internet (c) behind a bearer token (our client supports per-endpoint `apiKey`). Give us: the public base URL(s) + the API key. (You already know they're down; this adds "must be publicly reachable + keyed.")
2. **`ONION_EXTERNAL_API_KEY`** — the server-to-server bearer for landing's `/api/public/onions/requests` (burn create/status).
3. **Confirm `GET /api/public/session` is live** on `oniondao.dev` (it's on landing `main`; returns the user for a forwarded `session` cookie). Optionally add `profile_claimed` to its response (we default it to false otherwise).
4. **Set `AUTH_COOKIE_DOMAIN=.oniondao.dev`** on landing prod, so its session cookie is readable by `city.oniondao.dev`.
5. **DNS:** `city.oniondao.dev` CNAME → James's Railway service domain (the zone is on your side).
6. **Deploy the SL-1 check-in hotfix to landing `main`** — deployed main still throws on check-in for badge-linked users. Branch `hotfix/sl1-checkin` is prepared (not pushed); `git push origin hotfix/sl1-checkin:main` deploys it.
7. **(Optional, nicer memory)** the `qmd` binary, if you want richer resident recall — without it, memory degrades gracefully to markdown.

## Sequencing tomorrow
1. Dev: inference up + public + keyed; confirm `/api/public/session`; set cookie domain; deploy SL-1 hotfix; provide the API keys/URLs.
2. James: create the Railway service + `/data` volume + env; pick the two-repo build mechanism; trigger build.
3. First `docker build` → fix whatever it surfaces (have me on it).
4. Boot → DB/inference health → **top-up grants** (residents are now mortal — fill bars or they fade) → cold-path rehearsal (signup → onions → support → approve on OnionDAO → letter).
5. Point `city.oniondao.dev` at the service; done.
