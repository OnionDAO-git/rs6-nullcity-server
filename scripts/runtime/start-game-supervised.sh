#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

heap_mb="${NODE_MAX_OLD_SPACE:-4096}"
delay_seconds="${GAME_RESTART_DELAY_SECONDS:-5}"

echo "[start:game:supervised] starting RuneScape game server with heap=${heap_mb}MB"
echo "[start:game:supervised] Ctrl-C or SIGTERM stops the supervisor."

stop_requested=0
trap 'stop_requested=1; trap - INT TERM; kill "$child_pid" 2>/dev/null || true' INT TERM

while [[ "$stop_requested" -eq 0 ]]; do
    node --max-old-space-size="$heap_mb" dist/server/runner.js -- -game &
    child_pid=$!
    set +e
    wait "$child_pid"
    status=$?
    set -e

    if [[ "$stop_requested" -ne 0 ]]; then
        exit "$status"
    fi

    echo "[start:game:supervised] game exited with status=${status}; restarting in ${delay_seconds}s"
    sleep "$delay_seconds"
done
