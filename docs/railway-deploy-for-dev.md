# Deploy Null City to Railway — Dev how-to (all-in-one)

The ENTIRE Null City server-side runtime (game, login/update, AgentGateway,
controller = letters + MCP + city API, storyteller, and the dashboard BFF) runs
in **ONE container**, built from `Dockerfile.railway-allinone`, backed by **ONE
Railway Volume mounted at `/data`**. The dashboard BFF is the only public surface
(Railway injects `$PORT`; the entrypoint binds it on `0.0.0.0`).

Pick **Option A** (repo connect — simplest) or **Option B** (CLI script). Both
need the same operator inputs — see the checklist at the bottom.

> The default `railway.json` now points at `Dockerfile.railway-allinone`. The old
> 3-service game-trio config is preserved in `railway.game.json` (deploy it with
> `./deploy-railway.sh`).

---

## Option A — GitHub repo connect (recommended)

1. **New service from the repo.** Railway → your project → **New** → **GitHub
   Repo** → `OnionDAO/rs6-nullcity-server`, branch **`agents/wip`**. Railway reads
   `railway.json` and builds `Dockerfile.railway-allinone` automatically. It will
   auto-rebuild on every push to `agents/wip`.

2. **Add a Volume at `/data`.** Service → **Settings → Volumes** → add one volume,
   mount path **`/data`**. Without it, all city state (residents, letters, memory,
   logs) is **lost on every redeploy**.

3. **Add the env vars.** Service → **Variables**. Paste the keys from
   [`docs/railway-env.md`](railway-env.md). The three `INFERENCE_*` are required;
   the onion secrets (`ONION_EXTERNAL_API_KEY`, `ONION_CALLBACK_SECRET`) are shared
   out-of-band. Generate the internal tokens with `openssl rand -hex 32`.

4. **Add the dashboard build-args** as service variables so the image can clone
   the dashboard at build time (see the two-repo note below):
   - `DASHBOARD_REPO=https://<token>@github.com/OnionDAO/rs6-nullcity-residents-dashboard.git`
   - `DASHBOARD_REF=wip/spec`

5. **Set the plan size.** ~**8–16 GB RAM** / ≥2 vCPU. The full stack is heavy
   (game heap ~4 GB + controller + BFF + login/update + storyteller). Start at
   8 GB; bump if the game OOMs.

6. **Healthcheck.** Already set in `railway.json` (`/api/health`, 300 s timeout).
   The BFF comes up fast but the city isn't interactive until game + controller
   attach, so the long timeout is intentional.

### The two-repo build (read this — it's the easy thing to miss)

The **server** repo (`rs6-nullcity-server`) is what Railway builds. But the
dashboard lives in a **separate** repo (`rs6-nullcity-residents-dashboard`,
branch `wip/spec`), and the Dockerfile **clones it at build time** in a dedicated
build stage (`git clone ${DASHBOARD_REPO} @ ${DASHBOARD_REF}` → `bun run build`).

Both repos are likely **private**, so the build needs read access to the
dashboard repo. Provide it one of two ways:

- **PAT in `DASHBOARD_REPO` (simplest):** a GitHub token with read access to the
  dashboard repo, embedded in the URL:
  `https://<TOKEN>@github.com/OnionDAO/rs6-nullcity-residents-dashboard.git`.
  It's a build ARG in a stage that's discarded, so it does **not** land in the
  final image layer. Use a short-lived / fine-scoped (read-only, single-repo) PAT.
- **Railway build secret:** mount the token as a build-time secret and reference
  it — see Railway's build-secrets docs. More setup, no token in a variable value.

If `DASHBOARD_REPO` has no token and the dashboard repo is private, the build
**fails at `git clone`**.

---

## Option B — CLI script

```bash
railway login                                   # authenticate
cp railway.env.example railway.env              # then fill in real values
#   railway.env keys = docs/railway-env.md ; it is gitignored — never commit it.

DASHBOARD_REPO='https://<token>@github.com/OnionDAO/rs6-nullcity-residents-dashboard.git' \
RAILWAY_ENV_FILE=./railway.env \
  scripts/deploy-railway-allinone.sh
```

What the script does (idempotent — safe to re-run):

1. Preflight: checks the `railway` CLI + `railway whoami` auth.
2. Links/creates the project and the ONE service (`nullcity-allinone`), env
   `production`.
3. Attaches ONE volume at `/data` via the CLI; if the CLI can't, it prints the
   exact dashboard steps (see the limitation note below).
4. Reads every `KEY=value` line in `railway.env` and sets each as a service
   variable. Also sets `DASHBOARD_REPO` / `DASHBOARD_REF` as build-arg variables.
5. Deploys. Default `DEPLOY_MODE=up` uploads this checkout and builds on Railway.
   `DEPLOY_MODE=connect` skips the upload and prints how to GitHub-connect the
   `agents/wip` branch for auto-rebuild (preferred for ongoing deploys).

Key knobs: `PROJECT_NAME`, `SERVICE_NAME`, `RAILWAY_ENV`, `RAILWAY_WORKSPACE`,
`RAILWAY_ENV_FILE`, `DASHBOARD_REPO`, `DASHBOARD_REF`, `DEPLOY_MODE`.

### CLI limitation: volume creation

Railway's CLI volume support is historically flaky (older 4.x `railway volume`
panicked on the API call; linking the service first is the workaround the script
uses). If `railway volume add` still fails, the script prints the manual
dashboard steps and continues — **create the `/data` volume in the dashboard**
(Service → Settings → Volumes → mount path `/data`) and re-run the script.

---

## What Railway needs from the operator (checklist)

- [ ] **Volume at `/data`** — one volume, mount path exactly `/data`. State is
      lost on redeploy without it.
- [ ] **Env vars** — from [`docs/railway-env.md`](railway-env.md). Required:
      `INFERENCE_BASE_URL`, `INFERENCE_API_KEY`, `INFERENCE_MODEL`. Secrets
      (`ONION_EXTERNAL_API_KEY`, `ONION_CALLBACK_SECRET`) shared out-of-band.
      Internal tokens via `openssl rand -hex 32`.
- [ ] **Dashboard-clone token** — `DASHBOARD_REPO` with a GitHub PAT that has
      read access to the (private) dashboard repo, plus `DASHBOARD_REF=wip/spec`.
- [ ] **Plan size** — ~8–16 GB RAM / ≥2 vCPU.
- [ ] **Healthcheck** — `/api/health` (already in `railway.json`).

> ⚠️ **Honesty note:** the image is **NOT yet `docker build`-verified** — it was
> authored with the Docker daemon down. The scripts are `bash -n`-clean and the
> code is reasoned-through, but the first Railway build may need a fix or two
> (likely spots: the Node-on-`oven/bun` NodeSource install, `oven/bun` tag
> pinning, and the dashboard `bun run build`). Watch the build logs on the first
> deploy. See `docs/2026-06-11-railway-allinone.md` §7–8 for the full caveat list.
