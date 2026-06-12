#!/usr/bin/env bash
# Deploy the Null City ALL-IN-ONE container to Railway as ONE service.
#
# This is the single-service counterpart to ../deploy-railway.sh (which deploys
# the 3-service game trio). Here the ENTIRE stack — game, login, update,
# AgentGateway, controller (letters + MCP + city API), storyteller, and the
# dashboard BFF — runs in ONE container built from Dockerfile.railway-allinone,
# backed by ONE Railway Volume mounted at /data. Idempotent: re-run to update.
#
# Usage:
#   railway login                                  # authenticate first
#   cp railway.env.example railway.env             # (if present) then fill it in
#   RAILWAY_ENV_FILE=./railway.env scripts/deploy-railway-allinone.sh
#
#   PROJECT_NAME=nullcity SERVICE_NAME=nullcity-allinone \
#     RAILWAY_ENV_FILE=./railway.env scripts/deploy-railway-allinone.sh
#
# Environment knobs (all optional except where noted):
#   PROJECT_NAME      Railway project name           (default: nullcity)
#   SERVICE_NAME      the one service name            (default: nullcity-allinone)
#   RAILWAY_ENV       Railway environment             (default: production)
#   RAILWAY_WORKSPACE workspace id/name to scope to   (auto if only one)
#   RAILWAY_ENV_FILE  path to a KEY=value env file    (default: ./railway.env)
#                     -> each line is set as a service variable.
#                     Format = the keys documented in docs/railway-env.md.
#                     KEEP IT GITIGNORED — it holds inference + onion secrets.
#   DASHBOARD_REPO    dashboard git URL w/ token      (private repo: embed a PAT)
#   DASHBOARD_REF     dashboard branch/tag/SHA        (default: wip/spec)
#   DEPLOY_MODE       'up' | 'connect'                (default: up)
#                     up      = upload this checkout + build on Railway now.
#                     connect = skip the upload; you connect the GitHub repo +
#                               branch in the dashboard for auto-rebuild
#                               (RECOMMENDED — see docs/railway-deploy-for-dev.md).
#
# Requires: railway CLI (https://docs.railway.com/cli), python3 (JSON parsing),
# an authenticated session (`railway login` or RAILWAY_API_TOKEN).
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-nullcity}"
SERVICE_NAME="${SERVICE_NAME:-nullcity-allinone}"
ENVIRONMENT="${RAILWAY_ENV:-production}"
WORKSPACE="${RAILWAY_WORKSPACE:-}"
RAILWAY_ENV_FILE="${RAILWAY_ENV_FILE:-./railway.env}"
DASHBOARD_REF="${DASHBOARD_REF:-wip/spec}"
DASHBOARD_REPO="${DASHBOARD_REPO:-}"
DEPLOY_MODE="${DEPLOY_MODE:-up}"

VOLUME_MOUNT="/data"
DOCKERFILE="Dockerfile.railway-allinone"

# --- helpers ---------------------------------------------------------------

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fatal]\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

# --- preflight -------------------------------------------------------------

need railway
need python3

if ! railway whoami >/dev/null 2>&1; then
    die "not logged in. Run 'railway login' (or set RAILWAY_API_TOKEN) and retry."
fi

# Resolve the repo root (this script lives in scripts/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

[[ -f "$DOCKERFILE" ]] || die "$DOCKERFILE not found; run from the repo (it lives at repo root)."
[[ -f scripts/railway-allinone-entrypoint.sh ]] || die "scripts/railway-allinone-entrypoint.sh not found."
[[ -f railway.json ]] || warn "railway.json missing — Railway can't auto-detect the all-in-one Dockerfile on repo-connect."

case "$DEPLOY_MODE" in
    up|connect) : ;;
    *) die "DEPLOY_MODE must be 'up' or 'connect' (got '$DEPLOY_MODE')." ;;
esac

log "user: $(railway whoami 2>/dev/null | head -1)"
log "project: $PROJECT_NAME  service: $SERVICE_NAME  env: $ENVIRONMENT  mode: $DEPLOY_MODE"

# --- ensure project + link -------------------------------------------------
# (Same project/workspace resolution shape as deploy-railway.sh.)

find_project_id() {
    railway list --json 2>/dev/null | python3 -c "
import json, sys, os
data = json.load(sys.stdin)
target_name = os.environ.get('PROJECT_NAME', '')
target_id = os.environ.get('PROJECT_ID', '')
ws_filter = os.environ.get('WORKSPACE', '')

projects = data if isinstance(data, list) else data.get('projects', [])
matches = []
for p in projects:
    if not isinstance(p, dict): continue
    pid = p.get('id', '')
    pname = p.get('name', '')
    ws = p.get('workspace', {}) if isinstance(p.get('workspace'), dict) else {}
    ws_id = ws.get('id', '')
    ws_name = ws.get('name', '')
    if target_id and pid == target_id:
        print(pid); sys.exit(0)
    if target_name and pname == target_name:
        if not ws_filter or ws_filter in (ws_id, ws_name):
            matches.append((pid, pname, ws_name))

if len(matches) == 1:
    print(matches[0][0])
elif len(matches) > 1:
    sys.stderr.write(f\"multiple projects named '{target_name}' across workspaces — set RAILWAY_WORKSPACE to disambiguate:\\n\")
    for pid, pname, wsn in matches:
        sys.stderr.write(f'    {pname}  workspace={wsn!r}  id={pid}\\n')
    sys.exit(2)
" || { rc=$?; [[ $rc -eq 2 ]] && exit 1; true; }
}

list_workspaces() {
    railway list --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
projects = data if isinstance(data, list) else data.get('projects', [])
seen = set()
for p in projects:
    ws = p.get('workspace', {}) if isinstance(p, dict) else {}
    if isinstance(ws, dict) and ws.get('id') and (ws.get('id'), ws.get('name')) not in seen:
        seen.add((ws.get('id'), ws.get('name')))
        print(f\"{ws.get('id')}\t{ws.get('name','')}\")
"
}

export PROJECT_NAME PROJECT_ID="${PROJECT_ID:-}" WORKSPACE

PROJECT_ID="$(find_project_id || true)"

if [[ -z "$PROJECT_ID" ]]; then
    if [[ -z "$WORKSPACE" ]]; then
        mapfile -t WS_LINES < <(list_workspaces)
        if [[ ${#WS_LINES[@]} -eq 1 ]]; then
            WORKSPACE="${WS_LINES[0]%%$'\t'*}"
            log "auto-selected workspace: ${WS_LINES[0]#*$'\t'}"
        elif [[ ${#WS_LINES[@]} -gt 1 ]]; then
            warn "multiple workspaces available — set RAILWAY_WORKSPACE to one of:"
            for line in "${WS_LINES[@]}"; do
                printf '    %s  (id=%s)\n' "${line#*$'\t'}" "${line%%$'\t'*}" >&2
            done
            die "rerun with e.g.  RAILWAY_WORKSPACE='<name-or-id>' $0"
        fi
    fi
    log "creating project '$PROJECT_NAME'"
    if [[ -n "$WORKSPACE" ]]; then
        out="$(railway init --name "$PROJECT_NAME" --workspace "$WORKSPACE" --json)"
    else
        out="$(railway init --name "$PROJECT_NAME" --json)"
    fi
    PROJECT_ID="$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d.get('projectId') or d.get('project',{}).get('id',''))")"
    [[ -n "$PROJECT_ID" ]] || die "could not parse project id from: $out"
else
    log "using existing project id=$PROJECT_ID"
fi

# Link the working dir so subsequent commands inherit project/env.
railway link --project "$PROJECT_ID" --environment "$ENVIRONMENT" >/dev/null 2>&1 || \
    railway link --project "$PROJECT_ID" >/dev/null 2>&1 || true

# --- ensure the ONE service ------------------------------------------------

service_map() {
    railway service list --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d if isinstance(d, list) else d.get('services', d.get('items', []))
for s in items:
    print(f\"{s.get('name')}\t{s.get('id')}\")"
}

service_id_for() {
    local name="$1"
    service_map | awk -F'\t' -v n="$name" '$1==n {print $2}' | head -1
}

ensure_service() {
    local name="$1"
    local existing
    existing="$(service_id_for "$name")"
    if [[ -n "$existing" ]]; then
        log "service '$name' exists (id=$existing)"
        return 0
    fi
    log "creating service '$name'"
    railway add --service "$name" --json >/dev/null
}

ensure_service "$SERVICE_NAME"

# Link the service so single-service commands target it.
railway service link "$SERVICE_NAME" >/dev/null 2>&1 || \
    warn "could not 'railway service link $SERVICE_NAME' — later commands may need --service."

# --- ensure ONE volume mounted at /data ------------------------------------
# Railway CLI volume support has historically been flaky (older 4.x `volume -s`
# panicked on the API call; linking the service first is the workaround). If the
# CLI cannot create the volume, we print the exact dashboard steps rather than
# silently continuing — a missing /data volume means state is lost on redeploy.

volume_exists_on() {
    local svc="$1"
    railway volume list --json 2>/dev/null | SVC_NAME="$svc" python3 -c "
import json, sys, os
target = os.environ.get('SVC_NAME', '')
d = json.load(sys.stdin)
items = d if isinstance(d, list) else d.get('volumes', d.get('items', []))
for v in items:
    if not isinstance(v, dict): continue
    if v.get('serviceName') == target:
        print('yes'); sys.exit(0)
" 2>/dev/null | grep -q yes
}

manual_volume_instructions() {
    cat >&2 <<EOF

\033[1;33m[warn] Could not create the /data volume via the CLI.\033[0m
Create it once in the Railway dashboard (this is a known CLI limitation):

  1. railway open
  2. Select the service:  $SERVICE_NAME
  3. Settings -> Volumes (or the "+ Volume" / "+ Create" button)
  4. Mount path:  $VOLUME_MOUNT
  5. Save. Redeploy the service so the volume attaches.

Without this volume the city's state (residents, letters, memory, logs) is
LOST on every redeploy. Re-run this script after creating it; it is idempotent.
EOF
}

ensure_volume() {
    local svc="$1"
    if volume_exists_on "$svc"; then
        log "volume on '$svc' exists (mounted at $VOLUME_MOUNT)"
        return 0
    fi
    log "creating volume on '$svc' at $VOLUME_MOUNT"
    # Link first (the older CLI panics on `volume add` without a linked service).
    railway service link "$svc" >/dev/null 2>&1 || true
    if railway volume add --mount-path "$VOLUME_MOUNT" --json >/dev/null 2>&1; then
        log "volume created at $VOLUME_MOUNT"
    else
        manual_volume_instructions
    fi
}

ensure_volume "$SERVICE_NAME"

# --- set service variables from the env file -------------------------------
# Each non-comment KEY=value line in RAILWAY_ENV_FILE becomes a service variable.
# We DELIBERATELY do not echo values (they include inference + onion secrets).

set_var() {
    local key="$1" val="$2"
    # --skip-deploys: batch all variables, then deploy once at the end.
    railway variables --service "$SERVICE_NAME" --set "$key=$val" --skip-deploys >/dev/null 2>&1 \
        || railway variable set "$key=$val" --service "$SERVICE_NAME" --skip-deploys >/dev/null 2>&1 \
        || warn "could not set variable '$key' (try the dashboard Variables tab)."
}

if [[ -f "$RAILWAY_ENV_FILE" ]]; then
    log "loading service variables from $RAILWAY_ENV_FILE"
    count=0
    while IFS= read -r line || [[ -n "$line" ]]; do
        # strip a leading 'export ', skip blanks + comments.
        line="${line#export }"
        case "$line" in
            ''|\#*) continue ;;
        esac
        [[ "$line" == *=* ]] || continue
        key="${line%%=*}"
        val="${line#*=}"
        # trim surrounding whitespace on the key; strip matching surrounding quotes on the value.
        key="$(printf '%s' "$key" | awk '{$1=$1};1')"
        if [[ "$val" == \"*\" && "$val" == *\" ]]; then val="${val#\"}"; val="${val%\"}"; fi
        if [[ "$val" == \'*\' && "$val" == *\' ]]; then val="${val#\'}"; val="${val%\'}"; fi
        [[ -n "$key" ]] || continue
        set_var "$key" "$val"
        count=$((count + 1))
    done < "$RAILWAY_ENV_FILE"
    log "set $count service variable(s) from $RAILWAY_ENV_FILE"
else
    warn "env file '$RAILWAY_ENV_FILE' not found — skipping bulk variable set."
    warn "create it from docs/railway-env.md (gitignored) or set vars in the dashboard."
fi

# --- set the dashboard build-args as service variables ---------------------
# Railway passes service variables to the Docker build as --build-arg when the
# Dockerfile declares a matching ARG. The all-in-one Dockerfile declares
# DASHBOARD_REPO and DASHBOARD_REF, so setting them here makes the build-time
# dashboard clone work. DASHBOARD_REPO must carry a read token for the (private)
# dashboard repo — see docs/railway-deploy-for-dev.md.

if [[ -n "$DASHBOARD_REPO" ]]; then
    log "setting DASHBOARD_REPO (build-arg) [value hidden]"
    set_var DASHBOARD_REPO "$DASHBOARD_REPO"
else
    warn "DASHBOARD_REPO not provided — the build will use the Dockerfile default"
    warn "(public URL). If the dashboard repo is PRIVATE, the build WILL FAIL at"
    warn "'git clone'. Set DASHBOARD_REPO to https://<token>@github.com/OnionDAO/rs6-nullcity-residents-dashboard.git"
fi
log "setting DASHBOARD_REF=$DASHBOARD_REF (build-arg)"
set_var DASHBOARD_REF "$DASHBOARD_REF"

# --- trigger the deploy ----------------------------------------------------

if [[ "$DEPLOY_MODE" == "connect" ]]; then
    cat >&2 <<EOF

\033[1;32m[deploy] project + service + volume + variables are configured.\033[0m

DEPLOY_MODE=connect: no image was uploaded. Connect the GitHub repo for
auto-rebuild on every push to the branch (RECOMMENDED):

  1. railway open
  2. Service '$SERVICE_NAME' -> Settings -> Source
  3. Connect Repo:  OnionDAO/rs6-nullcity-server   branch:  agents/wip
  4. Railway reads railway.json -> builds $DOCKERFILE automatically.

Railway redeploys on each push to agents/wip. To deploy manually instead,
re-run with DEPLOY_MODE=up.
EOF
else
    log "uploading this checkout and building on Railway (first build is slow)…"
    log "build context = $REPO_ROOT, Dockerfile = $DOCKERFILE (per railway.json)"
    railway up --service "$SERVICE_NAME" --detach --ci \
        -m "deploy-railway-allinone.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        || warn "deploy command exited non-zero — check 'railway logs --service $SERVICE_NAME'"
fi

# --- post-deploy notes -----------------------------------------------------

cat >&2 <<EOF

\033[1;32m[deploy] done.\033[0m

Public ingress = the dashboard BFF on Railway's injected \$PORT (0.0.0.0).
All other ports (game 43594, gateway 43595, login 43591, update 43592,
letters 43596, mcp 43610, city 43611) are in-container only.

Checklist Railway needs from YOU (the operator):
  - ONE Volume mounted at $VOLUME_MOUNT  (state survives redeploys)
  - the env vars from docs/railway-env.md (inference + onion secrets)
  - DASHBOARD_REPO with a read token for the PRIVATE dashboard repo
  - plan ~8-16 GB RAM / >=2 vCPU (the full stack is heavy)
  - healthcheck path /api/health (already in railway.json)

NOTE: the image is NOT yet 'docker build'-verified (authored with the Docker
daemon down). The first Railway build may need a fix or two — watch the logs.

Useful follow-ups:
  railway logs --service $SERVICE_NAME
  railway status --json
  railway open
EOF
