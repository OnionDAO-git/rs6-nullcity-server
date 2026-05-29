#!/usr/bin/env bash
# Deploy the nullcity-server stack to Railway as three services (game, login,
# update) backed by the same Dockerfile.railway. Idempotent: re-run to update.
#
# Usage:
#   ./deploy-railway.sh                       # uses defaults
#   PROJECT_NAME=my-game ./deploy-railway.sh  # custom project name
#   RSA_MOD=... RSA_EXP=... ./deploy-railway.sh
#
# Requires: railway CLI (https://docs.railway.com/cli), python3 (for JSON
# parsing), an authenticated session (`railway login`).
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-nullcity}"
ENVIRONMENT="${RAILWAY_ENV:-production}"
WORKSPACE="${RAILWAY_WORKSPACE:-}"

SERVICES=(game login update)
VOLUME_MOUNT="/usr/src/app/data"

# --- helpers ---------------------------------------------------------------

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fatal]\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

jq_py() { python3 -c "$@"; }

# Run `railway` and capture both stdout and exit status.
rw() { railway "$@"; }

# Pluck a value from JSON on stdin: jget '["foo"]["bar"]'
jget() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

# --- preflight -------------------------------------------------------------

need railway
need python3
need curl

if ! railway whoami >/dev/null 2>&1; then
    die "not logged in. Run 'railway login' (or set RAILWAY_API_TOKEN) and retry."
fi

cd "$(dirname "$0")"
[[ -f Dockerfile.railway ]] || die "Dockerfile.railway not found; run from repo root."
[[ -f scripts/railway-entrypoint.sh ]] || die "scripts/railway-entrypoint.sh not found."
[[ -d cache ]] || warn "cache/ directory missing — the game server needs game assets."

log "user: $(railway whoami 2>/dev/null | head -1)"
log "project: $PROJECT_NAME  env: $ENVIRONMENT"

# --- ensure project + link -------------------------------------------------

# `railway list --json` returns a flat list of project objects. Each project
# carries its workspace via `.workspace.{id,name}`. We match by id first (if
# PROJECT_ID was set explicitly) then by name. Caller can scope name lookup
# to a workspace via RAILWAY_WORKSPACE (id or name).
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

# Export for the python heredocs above.
export PROJECT_NAME PROJECT_ID="${PROJECT_ID:-}" WORKSPACE

PROJECT_ID="$(find_project_id || true)"

if [[ -z "$PROJECT_ID" ]]; then
    # Need to create — workspace is required if there is more than one.
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

# --- ensure services -------------------------------------------------------

# Map of existing service name -> id, built once.
service_map() {
    railway service list --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d if isinstance(d, list) else d.get('services', d.get('items', []))
for s in items:
    print(f\"{s.get('name')}\t{s.get('id')}\")"
}

ensure_service() {
    local name="$1"
    local existing
    existing="$(service_map | awk -F'\t' -v n="$name" '$1==n {print $2}' | head -1)"
    if [[ -n "$existing" ]]; then
        log "service '$name' exists (id=$existing)"
        return 0
    fi
    log "creating service '$name'"
    railway add --service "$name" --json >/dev/null
}

for s in "${SERVICES[@]}"; do
    ensure_service "$s"
done

# --- ensure volumes (game + login) -----------------------------------------

# Lookup service id once for each service we need volumes on. Bash 3.2 has no
# associative arrays, so we use a sentinel-prefixed var name.
service_id_for() {
    local name="$1"
    service_map | awk -F'\t' -v n="$name" '$1==n {print $2}' | head -1
}

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
" | grep -q yes
}

ensure_volume() {
    local svc="$1"
    if volume_exists_on "$svc"; then
        log "volume on '$svc' exists"
        return 0
    fi
    log "creating volume on '$svc' at $VOLUME_MOUNT"
    # railway 4.58 `volume -s` panics with the API call; linking first avoids it.
    railway service link "$svc" >/dev/null 2>&1 || die "service link $svc failed"
    railway volume add --mount-path "$VOLUME_MOUNT" --json >/dev/null \
        || die "volume add failed for $svc"
}

ensure_volume game
ensure_volume login
# update: no persistent state needed (read-only cache lives in image)

# --- set per-service variables ---------------------------------------------

set_var() {
    local svc="$1" key="$2" val="$3"
    # --skip-deploys: avoid triggering a deploy per variable; we'll deploy at end.
    railway variable set "$key=$val" --service "$svc" --skip-deploys >/dev/null
}

# Shared across all roles (RSA keys, gameplay tunables).
SHARED_VARS=(
    "NODE_ENV=production"
    "HOST=0.0.0.0"
    "GAME_PORT=43594"
    "LOGIN_SERVER_PORT=43591"
    "UPDATE_SERVER_PORT=43592"
)
if [[ -n "${RSA_MOD:-}" ]]; then SHARED_VARS+=("RSA_MOD=$RSA_MOD"); fi
if [[ -n "${RSA_EXP:-}" ]]; then SHARED_VARS+=("RSA_EXP=$RSA_EXP"); fi

log "setting shared variables on all services"
for svc in "${SERVICES[@]}"; do
    for kv in "${SHARED_VARS[@]}"; do
        set_var "$svc" "${kv%%=*}" "${kv#*=}"
    done
done

# Per-role variables.
log "setting role-specific variables"
set_var game SERVICE_ROLE game
# Game forwards login/update sockets internally → use Railway private DNS.
set_var game LOGIN_SERVER_HOST '${{login.RAILWAY_PRIVATE_DOMAIN}}'
set_var game UPDATE_SERVER_HOST '${{update.RAILWAY_PRIVATE_DOMAIN}}'

set_var login SERVICE_ROLE login
set_var login LOGIN_SERVER_HOST 0.0.0.0

set_var update SERVICE_ROLE update
set_var update UPDATE_SERVER_HOST 0.0.0.0

# --- deploy each service ---------------------------------------------------

log "uploading and deploying (this builds the image per-service; first run takes a while)"
for svc in "${SERVICES[@]}"; do
    log "deploying '$svc' …"
    railway up --service "$svc" --detach --ci -m "deploy-railway.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        || warn "deploy command exited non-zero for '$svc' — check 'railway logs --service $svc'"
done

# --- post-deploy: TCP proxy instructions -----------------------------------

cat >&2 <<EOF

\033[1;32m[deploy] all services uploaded.\033[0m

One manual step remains: enable a TCP Proxy on each public service. The Railway
public API does not expose TCP proxy creation, so this must be clicked once
per service in the dashboard.

Open the project:
  railway open

Then for each service below, go to:
  Settings → Networking → TCP Proxy → "+ Generate TCP Proxy"
and paste the internal port:

  - game    →  43594
  - login   →  43591
  - update  →  43592

Railway will return a domain like 'shuttle.proxy.rlwy.net:NNNNN' per service.

Useful follow-ups:
  railway logs --service game
  railway status --json
  railway open
EOF
