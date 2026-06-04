#!/usr/bin/env bash
#
# Supervised Null City controller runner.
#
# Auto-restarts the controller if it exits/crashes, so a single crash or host
# hiccup doesn't leave the city dark with no recovery. Adopt this by running it
# inside the `nullcity-controller` screen INSTEAD of a bare
# `node dist/controller/index.js ...`:
#
#   screen -dmS nullcity-controller bash -lc \
#     'cd /Users/james/Code/OnionDAO/rs6-nullcity-server && bash scripts/start-controller-supervised.sh'
#
# Rebuild first (`npm run build`) so dist/ matches the checked-out source.
# Stop cleanly with: screen -X -S nullcity-controller quit  (SIGTERM is forwarded).
#
# Behavior:
#   - Clears a STALE lock only when no process is actually holding port 43596.
#   - Restarts the controller 3s after any exit.
#   - Crash-loop guard: if the controller dies within 15s of starting 5 times in
#     a row, it stops (so a genuinely broken build doesn't hammer the host).
set -uo pipefail
cd "$(dirname "$0")/.."

LOCK="data/controller/memory/nullcity-controller.lock"
LOG_DIR="/tmp/nullcity-runtime"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/controller-supervised.log"
bash scripts/runtime/rotate-logs.sh "$LOG_DIR"

log_msg() {
  printf '%s\n' "$1" | bash scripts/runtime/rotating-log.sh "$LOG"
}

# Flags must match the canonical launch (see docs/HUMANS.md / runtime-stewardship.md).
CTRL_ARGS=(
  "--config=$(pwd)/controller.yml"
  "--mcp-http-port=43610"
  "--letters-http-port=43596"
  "--wall-redact"
  "--city-http-port=43611"
  "--city-http-token=operator-token"
)

child=""
shutdown() {
  log_msg "[supervisor] received signal; stopping controller (pid ${child:-none})"
  [ -n "$child" ] && kill "$child" 2>/dev/null
  exit 0
}
trap shutdown SIGTERM SIGINT

fast_fails=0
while true; do
  if [ -f "$LOCK" ] && ! lsof -tiTCP:43596 -sTCP:LISTEN -nP >/dev/null 2>&1; then
    log_msg "[supervisor] no live controller on :43596 but lock present — removing stale $LOCK"
    rm -f "$LOCK"
  fi

  log_msg "[supervisor] starting controller at $(date)"
  start=$(date +%s)
  node dist/controller/index.js "${CTRL_ARGS[@]}" > >(bash scripts/runtime/rotating-log.sh "$LOG") 2>&1 &
  child=$!
  wait "$child"
  code=$?
  uptime=$(( $(date +%s) - start ))

  if [ "$uptime" -lt 15 ]; then
    fast_fails=$((fast_fails + 1))
  else
    fast_fails=0
  fi
  log_msg "[supervisor] controller exited code=$code after ${uptime}s (consecutive fast-crashes=$fast_fails)"

  if [ "$fast_fails" -ge 5 ]; then
    log_msg "[supervisor] 5 crashes within 15s each — likely a broken build/config; giving up. Fix + restart manually."
    exit 1
  fi
  sleep 3
done
