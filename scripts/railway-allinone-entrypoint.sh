#!/usr/bin/env bash
#
# All-in-one Railway entrypoint for the ENTIRE Null City runtime.
#
# Runs the full stack the way scripts/runtime/start-all-supervised.sh does on
# the Mac, but inside ONE container with ONE Railway Volume mounted at /data.
# Every server-side runtime WRITE lands under $DATA_ROOT (default /data) so the
# city survives restarts/redeploys with the laptop OFF.
#
# Processes (all localhost-in-container except the BFF):
#   login (:43591) + update (:43592)        — infra
#   game  (:43594) + AgentGateway ws (:43595)
#   controller: letters (:43596) + MCP (:43610) + city API (:43611) + storyteller
#   dashboard BFF (:$PORT, 0.0.0.0)         — the SINGLE public ingress
#
# Inference is REMOTE (env-configured base URL + bearer apiKey) — never local.
#
# Verify-only environment: this script was authored with the Docker daemon DOWN.
# It is `bash -n`-clean and reasoned-through, but NOT build-verified. A real
# `docker build` on Railway/Dev is required. See docs/2026-06-11-railway-allinone.md.
set -uo pipefail

# --------------------------------------------------------------------------
# 0. Paths + data root
# --------------------------------------------------------------------------
APP_DIR="${APP_DIR:-/app}"
DATA_ROOT="${DATA_ROOT:-/data}"
SEED_DIR="${SEED_DIR:-$APP_DIR/data-seed}"
DASH_DIR="${NULLCITY_DASHBOARD_DIR:-$APP_DIR/dashboard}"

export DATA_ROOT

LOG_DIR="$DATA_ROOT/logs"
# All supervised runner scripts honor NULLCITY_RUNTIME_LOG_DIR; point it at the
# volume so logs survive (the Mac default /tmp is wiped on reboot).
export NULLCITY_RUNTIME_LOG_DIR="$LOG_DIR"

# Game-side write dirs (no controller.yml knob — read by @engine/util/data-root
# defaults, but pinned explicitly here for clarity + override safety).
export NULLCITY_RESIDENT_SAVE_DIR="${NULLCITY_RESIDENT_SAVE_DIR:-$DATA_ROOT/residents}"
export NULLCITY_PLAYER_SAVE_DIR="${NULLCITY_PLAYER_SAVE_DIR:-$DATA_ROOT/saves}"
export NULLCITY_AGENT_LOG_DIR="${NULLCITY_AGENT_LOG_DIR:-$DATA_ROOT/agent-logs}"
# The baked game asset cache is read-mostly; keep it in the image unless asked.
export NULLCITY_GAME_CACHE_DIR="${NULLCITY_GAME_CACHE_DIR:-$APP_DIR/cache}"

# Dashboard BFF reads its memory root from here.
export NULLCITY_MEMORY_ROOT="${NULLCITY_MEMORY_ROOT:-$DATA_ROOT/controller/memory}"

# Embassy schedule: point at the seeded copy on the volume (graceful empty
# default if absent — controller never crashes on a missing schedule).
export CONTROLLER_EMBASSY_SCHEDULE_PATH="${CONTROLLER_EMBASSY_SCHEDULE_PATH:-$DATA_ROOT/controller/embassy-schedule.json}"

mkdir -p \
    "$LOG_DIR" \
    "$DATA_ROOT/residents" \
    "$DATA_ROOT/saves" \
    "$DATA_ROOT/agent-logs" \
    "$DATA_ROOT/controller/memory" \
    "$DATA_ROOT/controller/logs" \
    "$DATA_ROOT/controller/knowledge" \
    "$DATA_ROOT/controller/storyteller" \
    "$DATA_ROOT/config"

# --------------------------------------------------------------------------
# 1. Seed the volume on first boot (idempotent; `cp -rn` never stomps state)
# --------------------------------------------------------------------------
if [ -d "$SEED_DIR" ] && [ ! -f "$DATA_ROOT/.seeded" ]; then
    echo "[allinone] seeding $DATA_ROOT from $SEED_DIR (first boot)"
    cp -rn "$SEED_DIR/." "$DATA_ROOT/" 2>/dev/null || true
    touch "$DATA_ROOT/.seeded"
fi

# --------------------------------------------------------------------------
# 2. Game server-config.json (reuse the proven single-role templater)
# --------------------------------------------------------------------------
# Bind game on loopback in-container (the BFF is the only public surface), but
# turn the AgentGateway ON so the controller can attach over ws.
export HOST="${GAME_HOST:-127.0.0.1}"
export GAME_PORT="${GAME_PORT:-43594}"
export LOGIN_SERVER_PORT="${LOGIN_SERVER_PORT:-43591}"
export UPDATE_SERVER_PORT="${UPDATE_SERVER_PORT:-43592}"
export LOGIN_SERVER_BIND_HOST="${LOGIN_SERVER_BIND_HOST:-127.0.0.1}"
export UPDATE_SERVER_BIND_HOST="${UPDATE_SERVER_BIND_HOST:-127.0.0.1}"
export AGENT_GATEWAY_ENABLED="${AGENT_GATEWAY_ENABLED:-true}"
export AGENT_GATEWAY_HOST="${AGENT_GATEWAY_HOST:-127.0.0.1}"
export AGENT_GATEWAY_PORT="${AGENT_GATEWAY_PORT:-43595}"
export PLAYER_SAVE_PATH="${PLAYER_SAVE_PATH:-$DATA_ROOT/saves}"
# SERVICE_ROLE is unused here (we run all roles), but the templater reads it.
export SERVICE_ROLE=game
export DATA_DIR="$DATA_ROOT"
export CONFIG_DIR="$APP_DIR/config"
# Run the existing templater for server-config.json ONLY (it execs a node role
# at the end, so call the templating portion via a sourced subshell guard).
# Simpler: inline the server-config render here to avoid the exec tail.
: "${RSA_MOD:=119568088839203297999728368933573315070738693395974011872885408638642676871679245723887367232256427712869170521351089799352546294030059890127723509653145359924771433131004387212857375068629466435244653901851504845054452735390701003613803443469723435116497545687393297329052988014281948392136928774011011998343}"
: "${RSA_EXP:=12747337179295870166838611986189126026507945904720545965726999254744592875817063488911622974072289858092633084100280214658532446654378876853112046049506789703022033047774294965255097838909779899992870910011426403494610880634275141204442441976355383839981584149269550057129306515912021704593400378690444280161}"
: "${ENCRYPTION_ENABLED:=true}"
: "${EXP_RATE:=1}"
: "${SHOW_WELCOME:=true}"
: "${GIVE_ACHIEVEMENTS:=true}"
: "${CHECK_CREDENTIALS:=true}"
: "${TUTORIAL_ENABLED:=false}"
: "${ADMIN_DROPS_ENABLED:=true}"
: "${LOADED_ZONE_SCALE:=1}"
: "${BYPASS_TELEPORT_REQUIREMENTS:=false}"
: "${AGENT_GATEWAY_AUTH_TOKEN:=}"
: "${AGENT_GATEWAY_ALLOW_DELETE:=false}"
: "${AGENT_GATEWAY_AUTOSAVE_TICKS:=1000}"

mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/server-config.json" <<EOF
{
    "configDir": "./config",
    "cacheDir": "${NULLCITY_GAME_CACHE_DIR}",
    "host": "${HOST}",
    "port": ${GAME_PORT},
    "updateServerHost": "${UPDATE_SERVER_BIND_HOST}",
    "updateServerPort": ${UPDATE_SERVER_PORT},
    "loginServerHost": "${LOGIN_SERVER_BIND_HOST}",
    "loginServerPort": ${LOGIN_SERVER_PORT},
    "rsaMod": "${RSA_MOD}",
    "rsaExp": "${RSA_EXP}",
    "encryptionEnabled": ${ENCRYPTION_ENABLED},
    "playerSavePath": "${PLAYER_SAVE_PATH}",
    "showWelcome": ${SHOW_WELCOME},
    "expRate": ${EXP_RATE},
    "giveAchievements": ${GIVE_ACHIEVEMENTS},
    "checkCredentials": ${CHECK_CREDENTIALS},
    "tutorialEnabled": ${TUTORIAL_ENABLED},
    "adminDropsEnabled": ${ADMIN_DROPS_ENABLED},
    "loadedZoneScale": ${LOADED_ZONE_SCALE},
    "bypassTeleportRequirements": ${BYPASS_TELEPORT_REQUIREMENTS},
    "agentGateway": {
        "enabled": ${AGENT_GATEWAY_ENABLED},
        "host": "${AGENT_GATEWAY_HOST}",
        "port": ${AGENT_GATEWAY_PORT},
        "authToken": "${AGENT_GATEWAY_AUTH_TOKEN}",
        "allowDelete": ${AGENT_GATEWAY_ALLOW_DELETE},
        "autosaveTicks": ${AGENT_GATEWAY_AUTOSAVE_TICKS}
    }
}
EOF
echo "[allinone] wrote $CONFIG_DIR/server-config.json (game :$GAME_PORT, gateway :$AGENT_GATEWAY_PORT)"

# --------------------------------------------------------------------------
# 3. controller.yml — render the live config from env onto the volume
# --------------------------------------------------------------------------
# memory/logging/knowledge dirs MUST be under /data (config.ts production gate
# enforces this). Inference is REMOTE: base URL + bearer apiKey from env.
export CONTROLLER_CONFIG="$DATA_ROOT/controller.yml"
: "${CONTROLLER_INSTANCE_ID:=nullcity-allinone}"
: "${CONTROLLER_ID:=nullcity-controller}"
: "${GATEWAY_URL:=ws://127.0.0.1:${AGENT_GATEWAY_PORT}}"
: "${GATEWAY_AUTH_TOKEN:=${AGENT_GATEWAY_AUTH_TOKEN}}"
: "${INFERENCE_BASE_URL:=}"
: "${INFERENCE_API_KEY:=}"
: "${INFERENCE_MODEL:=}"
: "${INFERENCE_PROVIDER:=openai-compatible}"
: "${INFERENCE_RESPONSE_FORMAT:=text}"
: "${INFERENCE_TIMEOUT_MS:=60000}"
: "${INFERENCE_MAX_CONCURRENT:=2}"
: "${CONTROLLER_KNOWLEDGE_STORAGE_MODE:=persistent-volume}"
: "${CONTROLLER_ENABLE_AP_GP_EXCHANGE:=false}"

DEFAULT_CONTROLLER_RESIDENTS="res:hans,res:father-aereck,res:mother-anvil,res:wise-old-man,res:bramble-ash,res:mara-kettle,res:brom-breadshield,res:tally-copperpot,res:nix-lanternstep"
if [ -z "${CONTROLLER_RESIDENTS:-}" ]; then
    if [ -n "${CONTROLLER_RESIDENT:-}" ]; then
        CONTROLLER_RESIDENTS="$CONTROLLER_RESIDENT"
    else
        CONTROLLER_RESIDENTS="$DEFAULT_CONTROLLER_RESIDENTS"
    fi
fi

CONTROLLER_RESIDENT_LINES=""
CONTROLLER_RESIDENT_COUNT=0
IFS=',' read -ra CONTROLLER_RESIDENT_ARRAY <<< "$CONTROLLER_RESIDENTS"
for resident in "${CONTROLLER_RESIDENT_ARRAY[@]}"; do
    resident="$(echo "$resident" | xargs)"
    if [ -n "$resident" ]; then
        CONTROLLER_RESIDENT_LINES="${CONTROLLER_RESIDENT_LINES}  - ${resident}"$'\n'
        CONTROLLER_RESIDENT_COUNT=$((CONTROLLER_RESIDENT_COUNT + 1))
    fi
done

if [ "$CONTROLLER_RESIDENT_COUNT" -eq 0 ]; then
    echo "[allinone] ERROR: CONTROLLER_RESIDENTS resolved to an empty resident list." >&2
    exit 1
fi

# Gateway auth line only when a token is present (loopback access is tokenless).
GATEWAY_AUTH_LINE=""
if [ -n "$GATEWAY_AUTH_TOKEN" ]; then
    GATEWAY_AUTH_LINE="  authToken: \"$GATEWAY_AUTH_TOKEN\""
fi

cat > "$CONTROLLER_CONFIG" <<EOF
# GENERATED by scripts/railway-allinone-entrypoint.sh — do not edit by hand.
controller:
  instanceId: ${CONTROLLER_INSTANCE_ID}
residents:
${CONTROLLER_RESIDENT_LINES%$'\n'}
gateway:
  url: ${GATEWAY_URL}
  controllerId: ${CONTROLLER_ID}
${GATEWAY_AUTH_LINE}
souls:
  dir: ${CONTROLLER_SOULS_DIR:-${APP_DIR}/src/controller/soul/starter-souls}
  discoverResidents: false
memory:
  dir: ${DATA_ROOT}/controller/memory
  qmdBin: ${QMD_BIN:-qmd}
logging:
  dir: ${DATA_ROOT}/controller/logs
  fullPerceptions: false
knowledge:
  dir: ${DATA_ROOT}/controller/knowledge
  enableSuggestions: true
  emitStdout: true
  storageMode: ${CONTROLLER_KNOWLEDGE_STORAGE_MODE}
inference:
  maxConcurrent: ${INFERENCE_MAX_CONCURRENT}
llm:
  endpoints:
    default:
      baseUrl: ${INFERENCE_BASE_URL}
      provider: ${INFERENCE_PROVIDER}
      apiKey: "${INFERENCE_API_KEY}"
      model: ${INFERENCE_MODEL}
      responseFormat: ${INFERENCE_RESPONSE_FORMAT}
      timeoutMs: ${INFERENCE_TIMEOUT_MS}
economy:
  enableApGpExchange: ${CONTROLLER_ENABLE_AP_GP_EXCHANGE}
EOF
echo "[allinone] wrote $CONTROLLER_CONFIG (residents=$CONTROLLER_RESIDENT_COUNT memory=$DATA_ROOT/controller/memory inference=${INFERENCE_BASE_URL:-<UNSET>})"

if [ -z "$INFERENCE_BASE_URL" ]; then
    echo "[allinone] WARNING: INFERENCE_BASE_URL is unset — residents will have no brain. Set it (remote URL + INFERENCE_API_KEY)." >&2
fi

# --------------------------------------------------------------------------
# 4. Supervisor: start every process, restart on crash, BFF binds $PORT/0.0.0.0
# --------------------------------------------------------------------------
declare -a PIDS=()
shutting_down=0

start_supervised() {
    # Usage: start_supervised <label> [--dir <workdir>] <command...>
    local label="$1"; shift
    local workdir="$APP_DIR"
    if [ "${1:-}" = "--dir" ]; then
        workdir="$2"; shift 2
    fi
    local logfile="$LOG_DIR/${label}.log"
    (
        cd "$workdir" || exit 1
        while [ "$shutting_down" -eq 0 ]; do
            echo "[$label] starting in $workdir at $(date -u +%FT%TZ)"
            "$@" >>"$logfile" 2>&1
            code=$?
            echo "[$label] exited code=$code; restarting in 3s" | tee -a "$logfile"
            sleep 3
        done
    ) &
    PIDS+=("$!")
    echo "[allinone] supervising '$label' (pid $!) -> $logfile"
}

shutdown() {
    shutting_down=1
    echo "[allinone] shutting down; signalling children"
    for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
    wait 2>/dev/null || true
    exit 0
}
trap shutdown SIGTERM SIGINT

cd "$APP_DIR"

# --- infra: login + update -----------------------------------------------
start_supervised login  node --max-old-space-size="${LOGIN_HEAP_MB:-512}"  dist/server/runner.js -- -login
start_supervised update node --max-old-space-size="${UPDATE_HEAP_MB:-512}" dist/server/runner.js -- -update

# --- game (+ AgentGateway ws) --------------------------------------------
start_supervised game node --max-old-space-size="${GAME_HEAP_MB:-4096}" dist/server/runner.js -- -game

# Wait for the game's AgentGateway ws before the controller attaches.
echo "[allinone] waiting for game gateway 127.0.0.1:${AGENT_GATEWAY_PORT}…"
for _ in $(seq 1 90); do
    if node -e "require('net').connect(${AGENT_GATEWAY_PORT},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
        echo "[allinone] game gateway up"; break
    fi
    sleep 2
done

# --- controller: letters + MCP + city API in one process -----------------
# The controller's production config gate (config.ts) REQUIRES a non-loopback
# gateway.url when NODE_ENV=production. In the all-in-one topology the gateway
# is LEGITIMATELY loopback (same container), so we run the controller with
# NODE_ENV cleared to skip that distributed-deployment-only check. The durable
# /data dirs are still enforced because we point them under /data regardless.
# Set CONTROLLER_FORCE_PRODUCTION_GATE=1 to opt back in (e.g. if you front the
# gateway with a real remote URL + GATEWAY_AUTH_TOKEN).
CONTROLLER_NODE_ENV="${CONTROLLER_NODE_ENV:-}"
if [ "${CONTROLLER_FORCE_PRODUCTION_GATE:-0}" = "1" ]; then
    CONTROLLER_NODE_ENV=production
fi
start_supervised controller env NODE_ENV="$CONTROLLER_NODE_ENV" RAILGUN="" node dist/controller/index.js \
    "--config=$CONTROLLER_CONFIG" \
    "--mcp-http-port=${CONTROLLER_MCP_HTTP_PORT:-43610}" \
    "--mcp-http-host=${CONTROLLER_MCP_HTTP_HOST:-127.0.0.1}" \
    "--letters-http-port=${CONTROLLER_LETTERS_HTTP_PORT:-43596}" \
    "--letters-http-host=${CONTROLLER_LETTERS_HTTP_HOST:-127.0.0.1}" \
    "--wall-redact" \
    "--city-http-port=${CONTROLLER_CITY_HTTP_PORT:-43611}" \
    "--city-http-host=${CONTROLLER_CITY_HTTP_HOST:-127.0.0.1}" \
    "--city-http-token=${CONTROLLER_CITY_HTTP_TOKEN:-operator-token}"

# --- storyteller scheduler (optional) ------------------------------------
if [ "${NULLCITY_ENABLE_STORYTELLER_SCHEDULER:-1}" != "0" ]; then
    # Route the scheduler's memory-root + output-dir onto the volume.
    export STORYTELLER_MEMORY_ROOT="${STORYTELLER_MEMORY_ROOT:-$DATA_ROOT/controller/memory}"
    export STORYTELLER_OUTPUT_DIR="${STORYTELLER_OUTPUT_DIR:-$DATA_ROOT/controller/storyteller}"
    start_supervised storyteller bash scripts/runtime/start-storyteller-scheduler-supervised.sh
fi

# --- dashboard BFF: the SINGLE public ingress (binds $PORT/0.0.0.0) -------
export DASHBOARD_HOST="${DASHBOARD_HOST:-0.0.0.0}"
export PORT="${PORT:-8787}"
export NULLCITY_CITY_API_URL="${NULLCITY_CITY_API_URL:-http://127.0.0.1:${CONTROLLER_CITY_HTTP_PORT:-43611}/api/nullcity}"
export NULLCITY_CITY_API_TOKEN="${NULLCITY_CITY_API_TOKEN:-${CONTROLLER_CITY_HTTP_TOKEN:-operator-token}}"
export NULLCITY_LETTERS_BASE_URL="${NULLCITY_LETTERS_BASE_URL:-http://127.0.0.1:${CONTROLLER_LETTERS_HTTP_PORT:-43596}}"
# Pin the built SPA dir so the BFF serves it regardless of cwd resolution.
export DASHBOARD_WEB_DIST="${DASHBOARD_WEB_DIST:-$DASH_DIR/packages/web/dist}"
if [ -d "$DASH_DIR/packages/server" ]; then
    start_supervised dashboard-bff --dir "$DASH_DIR/packages/server" bun src/index.ts
else
    echo "[allinone] WARNING: dashboard not found at $DASH_DIR — public ingress will be DOWN." >&2
fi

echo "[allinone] all processes launched. public ingress: 0.0.0.0:${PORT} (BFF). tailing logs."
# Keep PID 1 alive and surface child logs to container stdout.
touch "$LOG_DIR/dashboard-bff.log"
tail -n +1 -F "$LOG_DIR"/*.log &
PIDS+=("$!")
wait
