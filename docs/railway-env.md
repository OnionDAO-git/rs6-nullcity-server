# Railway env — Null City all-in-one service

Deploy: ONE Railway service, build `Dockerfile.railway-allinone` (config `railway.allinone.json`).
Volume: mount at `/data`. Plan: ~8–16 GB RAM. Healthcheck: `/api/health`.
Build args (to clone the dashboard into the image): `DASHBOARD_REPO` (+ GitHub token if private), `DASHBOARD_REF=wip/spec`.

Two secrets (`ONION_EXTERNAL_API_KEY`, `ONION_CALLBACK_SECRET`) are shared out-of-band, not in this file.

```bash
# Volume / paths — every runtime write lands on /data
DATA_ROOT=/data
NULLCITY_SERVER_ROOT=/data
NULLCITY_MEMORY_ROOT=/data/controller/memory
NULLCITY_LOGS_ROOT=/data/controller/logs
NULLCITY_AGENT_LOGS_ROOT=/data/agent-logs
NULLCITY_SOULS_ROOT=/data/controller/soul/starter-souls
NULLCITY_RESIDENT_SAVE_ROOT=/data/residents
NULLCITY_BENCHMARK_ROOT=/data/benchmarks

# Inference (remote GPU — must be public + token-auth'd)
INFERENCE_BASE_URL=          # e.g. https://inf.oniondao.dev
INFERENCE_API_KEY=
INFERENCE_MODEL=

# Dashboard serving + in-container wiring
DASHBOARD_HOST=0.0.0.0
AGENT_GATEWAY_URL=ws://127.0.0.1:43595
NULLCITY_RS_HOST=127.0.0.1:43594

# Landing / auth (public HTTPS)
LANDING_SESSION_MODE=api
LANDING_AUTH_BASE_URL=https://oniondao.dev
AUTH_COOKIE_NAME=session
AUTH_COOKIE_DOMAIN=.oniondao.dev
CITY_PUBLIC_BASE_URL=https://city.oniondao.dev

# Onions (secrets shared separately)
ONION_API_BASE_URL=https://oniondao.dev
ONION_EXTERNAL_API_KEY=__SHARED_SECRET__
ONION_CALLBACK_SECRET=__SHARED_SECRET__

# Internal auth tokens (generate each: openssl rand -hex 32)
AGENT_GATEWAY_AUTH_TOKEN=
NULLCITY_CITY_API_TOKEN=

# City store DB (recommended: add a Railway Postgres, else in-memory resets on redeploy)
# CITY_DATABASE_URL=

# DO NOT SET in prod:
#   DASHBOARD_WEB_DEV_ORIGIN  (SPA would 307 to a dev origin)
#   LANDING_DATABASE_URL      (leave unset → uses the HTTP session API, no DB needed)
```

## Landing side (Dev's existing landing service)
- `ONION_EXTERNAL_API_KEY` = the same shared value as above (must match or burns reject)
- `AUTH_COOKIE_DOMAIN=.oniondao.dev`
- Confirm `GET /api/public/session` is deployed
- DNS: `city.oniondao.dev` → the Null City service
- Deploy `hotfix/sl1-checkin` → `main` (check-in fix)

⚠️ Image not yet `docker build`-verified (local daemon was down) — first build may need a fix or two.
