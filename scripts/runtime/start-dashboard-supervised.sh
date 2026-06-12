#!/usr/bin/env bash
#
# Supervised dashboard + web runner for Null City.
#
# Auto-restarts the dashboard BFF, the dashboard SPA dev server, or the landing
# dev server if it exits/crashes — same supervisor pattern as
# scripts/start-controller-supervised.sh (restart 3s after any exit, give up
# after 5 consecutive fast crashes). The BFF (:8787) previously ran
# UNSUPERVISED under `bun --watch` and crashed unattended (2026-06-11 SRE
# audit); this runner uses plain `bun src/index.ts` (NO --watch — watch-mode
# restarts fight the supervisor) and restarts on exit instead.
#
# Usage (one target per invocation, each in its own screen — wired into
# scripts/runtime/start-all-supervised.sh):
#   bash scripts/runtime/start-dashboard-supervised.sh bff       # dashboard BFF      :8787
#   bash scripts/runtime/start-dashboard-supervised.sh web       # dashboard SPA      :5174
#   bash scripts/runtime/start-dashboard-supervised.sh landing   # landing dev server :5173
#
# Logs: rotating logs under ~/nullcity-logs by default — NOT /tmp, because
# /tmp is wiped on reboot and destroyed this week's BFF crash evidence.
# Override the directory with NULLCITY_RUNTIME_LOG_DIR.
#
# Behavior (mirrors the controller supervisor):
#   - Restarts the target 3s after any exit.
#   - Crash-loop guard: if the target dies within 15s of starting 5 times in a
#     row, it stops (so broken deps/config don't hammer the host).
#   - SIGTERM/SIGINT (screen quit) is forwarded to the child.
set -uo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DASH_DIR="${NULLCITY_DASHBOARD_DIR:-$SERVER_DIR/../rs6-nullcity-residents-dashboard}"
LANDING_DIR="${NULLCITY_LANDING_DIR:-$SERVER_DIR/../landing-2026}"
LOG_DIR="${NULLCITY_RUNTIME_LOG_DIR:-$HOME/nullcity-logs}"
mkdir -p "$LOG_DIR"

TARGET="${1:-bff}"
case "$TARGET" in
  bff)
    RUN_DIR="$DASH_DIR/packages/server"
    export DASHBOARD_WEB_DEV_ORIGIN="${DASHBOARD_WEB_DEV_ORIGIN:-http://127.0.0.1:5174}"
    CMD=(bun src/index.ts) # NO --watch (see header)
    LOG="$LOG_DIR/dashboard-server-supervised.log"
    ;;
  web)
    RUN_DIR="$DASH_DIR"
    CMD=(bun run dev:web) # vite SPA on :5174
    LOG="$LOG_DIR/dashboard-web-supervised.log"
    ;;
  landing)
    RUN_DIR="$LANDING_DIR"
    CMD=(bun run dev --host 127.0.0.1) # landing dev server on :5173
    LOG="$LOG_DIR/landing-supervised.log"
    ;;
  *)
    echo "usage: $0 [bff|web|landing]" >&2
    exit 2
    ;;
esac

if [ ! -d "$RUN_DIR" ]; then
  echo "[supervisor:$TARGET] run dir not found: $RUN_DIR — clone the repo or set NULLCITY_DASHBOARD_DIR/NULLCITY_LANDING_DIR" >&2
  exit 1
fi
cd "$RUN_DIR"

log_msg() {
  printf '%s\n' "$1" | bash "$SERVER_DIR/scripts/runtime/rotating-log.sh" "$LOG"
}

child=""
shutdown() {
  log_msg "[supervisor:$TARGET] received signal; stopping (pid ${child:-none})"
  [ -n "$child" ] && kill "$child" 2>/dev/null
  exit 0
}
trap shutdown SIGTERM SIGINT

fast_fails=0
while true; do
  log_msg "[supervisor:$TARGET] starting '${CMD[*]}' in $RUN_DIR at $(date)"
  start=$(date +%s)
  "${CMD[@]}" > >(bash "$SERVER_DIR/scripts/runtime/rotating-log.sh" "$LOG") 2>&1 &
  child=$!
  wait "$child"
  code=$?
  uptime=$(( $(date +%s) - start ))

  if [ "$uptime" -lt 15 ]; then
    fast_fails=$((fast_fails + 1))
  else
    fast_fails=0
  fi
  log_msg "[supervisor:$TARGET] exited code=$code after ${uptime}s (consecutive fast-crashes=$fast_fails)"

  if [ "$fast_fails" -ge 5 ]; then
    log_msg "[supervisor:$TARGET] 5 crashes within 15s each — likely broken deps/config; giving up. Fix + restart manually."
    exit 1
  fi
  sleep 3
done
