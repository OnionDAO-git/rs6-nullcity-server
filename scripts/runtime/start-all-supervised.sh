#!/usr/bin/env bash
#
# One-command full-stack bring-up for Null City — recover the whole city after a
# host reboot/lockup in a single step, always using the SUPERVISED runners so a
# game or controller crash auto-restarts (instead of going dark, as happened
# 2026-06-01 when the bare game server hung for ~1h with no recovery).
#
# Usage:   bash scripts/runtime/start-all-supervised.sh
# Stop:    bash scripts/runtime/stop-all.sh   (or quit each screen)
# Watch:   screen -ls   /   tail -f /tmp/nullcity-runtime/*.log
#
# Brings up (each in its own detached screen):
#   nullcity-infra        login + update servers
#   nullcity-game         game server (SUPERVISED, 4GB heap, auto-restart)
#   nullcity-controller   controller (SUPERVISED, auto-restart) + MCP + City API
#   nullcity-storyteller  Storyteller scheduler (SUPERVISED, 30m by default)
#   nullcity-dashboard-server / -web   the dashboard BFF + SPA (SUPERVISED)
#   nullcity-landing      landing-2026 dev server :5173 (SUPERVISED)
#
# Idempotent: quits any existing same-named screens first.
set -uo pipefail
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DASH_DIR="$SERVER_DIR/../rs6-nullcity-residents-dashboard"
LANDING_DIR="$SERVER_DIR/../landing-2026"
LOG=/tmp/nullcity-runtime; mkdir -p "$LOG"

quit() { screen -X -S "$1" quit >/dev/null 2>&1 || true; }
up() { lsof -tiTCP:"$1" -sTCP:LISTEN -nP >/dev/null 2>&1; }

echo "[bring-up] stopping any existing Null City screens…"
for s in nullcity-infra nullcity-game nullcity-controller nullcity-storyteller nullcity-dashboard-server nullcity-dashboard-web nullcity-landing; do quit "$s"; done
sleep 3
# clear a stale controller lock if no process holds the port
if [ -f "$SERVER_DIR/data/controller/memory/nullcity-controller.lock" ] && ! up 43596; then
  rm -f "$SERVER_DIR/data/controller/memory/nullcity-controller.lock"; echo "[bring-up] cleared stale controller lock"
fi

echo "[bring-up] 1/4 infra (login+update)…"
screen -dmS nullcity-infra bash -lc "cd '$SERVER_DIR' && npm run start:infra >> '$LOG/infra.log' 2>&1"

echo "[bring-up] 2/4 game (supervised, 4GB heap, auto-restart)…"
screen -dmS nullcity-game bash -lc "cd '$SERVER_DIR' && bash scripts/runtime/start-game-supervised.sh >> '$LOG/game-supervised.log' 2>&1"
echo "[bring-up]   waiting for game gateway :43594…"
for _ in $(seq 1 60); do up 43594 && break; sleep 2; done
up 43594 && echo "[bring-up]   game gateway up ✓" || echo "[bring-up]   WARN game gateway not up yet (check $LOG/game-supervised.log)"

CONTROLLER_CONFIG_PATH="${NULLCITY_CONTROLLER_CONFIG:-${CONTROLLER_CONFIG:-$SERVER_DIR/controller.yml}}"
echo "[bring-up] 3/4 controller (supervised, MCP + City API, config=$CONTROLLER_CONFIG_PATH)…"
screen -dmS nullcity-controller bash -lc "cd '$SERVER_DIR' && NULLCITY_CONTROLLER_CONFIG='$CONTROLLER_CONFIG_PATH' CONTROLLER_MCP_TOKENS=operator-token CONTROLLER_MCP_OPERATOR_FOR_operator_token=operator-codex bash scripts/start-controller-supervised.sh"
echo "[bring-up]   waiting for controller :43596…"
for _ in $(seq 1 40); do up 43596 && break; sleep 2; done
up 43596 && echo "[bring-up]   controller up ✓" || echo "[bring-up]   WARN controller not up yet (check $LOG/controller-supervised.log)"

if [ "${NULLCITY_ENABLE_STORYTELLER_SCHEDULER:-1}" != "0" ]; then
  echo "[bring-up] 4/5 Storyteller scheduler (supervised, ${STORYTELLER_INTERVAL_MINUTES:-30}m cadence)…"
  screen -dmS nullcity-storyteller bash -lc "cd '$SERVER_DIR' && bash scripts/runtime/start-storyteller-scheduler-supervised.sh >> '$LOG/storyteller-scheduler.log' 2>&1"
  echo "[bring-up]   storyteller scheduler started (model config comes from env/.env.local/controller config)"
else
  echo "[bring-up] 4/5 Storyteller scheduler disabled by NULLCITY_ENABLE_STORYTELLER_SCHEDULER=0"
fi

echo "[bring-up] 5/5 dashboard (BFF + web, SUPERVISED) + landing…"
if [ -d "$DASH_DIR" ]; then
  screen -dmS nullcity-dashboard-server bash -lc "cd '$SERVER_DIR' && bash scripts/runtime/start-dashboard-supervised.sh bff"
  screen -dmS nullcity-dashboard-web bash -lc "cd '$SERVER_DIR' && bash scripts/runtime/start-dashboard-supervised.sh web"
  echo "[bring-up]   dashboard started (supervised; City API wiring comes from packages/server/.env; logs in ~/nullcity-logs)"
else
  echo "[bring-up]   WARN dashboard repo not found at $DASH_DIR — start it manually"
fi
if [ -d "$LANDING_DIR" ]; then
  screen -dmS nullcity-landing bash -lc "cd '$SERVER_DIR' && bash scripts/runtime/start-dashboard-supervised.sh landing"
  echo "[bring-up]   landing dev server started (supervised, :5173; logs in ~/nullcity-logs)"
else
  echo "[bring-up]   WARN landing repo not found at $LANDING_DIR — start it manually"
fi

echo "[bring-up] done. Verify:  bash scripts/post-restart-smoke.sh"
echo "[bring-up] screens:"; screen -ls 2>/dev/null | grep nullcity || true
