#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

interval_minutes="${STORYTELLER_INTERVAL_MINUTES:-30}"
memory_root="${STORYTELLER_MEMORY_ROOT:-data/controller/memory}"
output_dir="${STORYTELLER_OUTPUT_DIR:-data/controller/storyteller}"
daily_cost_cap_usd="${STORYTELLER_DAILY_COST_CAP_USD:-1.00}"
delay_seconds="${STORYTELLER_RESTART_DELAY_SECONDS:-10}"
log_dir="${NULLCITY_RUNTIME_LOG_DIR:-/tmp/nullcity-runtime}"
log_path="${NULLCITY_STORYTELLER_LOG:-$log_dir/storyteller-scheduler.log}"

mkdir -p "$log_dir"
bash scripts/runtime/rotate-logs.sh "$log_dir"

echo "[start:storyteller:supervised] starting Storyteller scheduler every ${interval_minutes}m"
echo "[start:storyteller:supervised] memory-root=$memory_root output-dir=$output_dir"
echo "[start:storyteller:supervised] daily-cost-cap-usd=$daily_cost_cap_usd"
echo "[start:storyteller:supervised] bounded log: $log_path"
echo "[start:storyteller:supervised] model config is loaded by the CLI from env/.env.local/controller config"

stop_requested=0
child_pid=""
trap 'stop_requested=1; trap - INT TERM; [ -n "$child_pid" ] && kill "$child_pid" 2>/dev/null || true' INT TERM

while [[ "$stop_requested" -eq 0 ]]; do
    npm run storyteller:scheduler -- \
      --watch \
      --interval-minutes "$interval_minutes" \
      --memory-root "$memory_root" \
      --output-dir "$output_dir" \
      --daily-cost-cap-usd "$daily_cost_cap_usd" \
      > >(bash scripts/runtime/rotating-log.sh "$log_path") 2>&1 &
    child_pid=$!
    set +e
    wait "$child_pid"
    status=$?
    set -e

    if [[ "$stop_requested" -ne 0 ]]; then
        exit "$status"
    fi

    echo "[start:storyteller:supervised] scheduler exited with status=${status}; restarting in ${delay_seconds}s"
    sleep "$delay_seconds"
done
