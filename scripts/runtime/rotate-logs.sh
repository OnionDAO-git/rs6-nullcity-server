#!/usr/bin/env bash
set -euo pipefail

log_dir="${1:-${NULLCITY_RUNTIME_LOG_DIR:-/tmp/nullcity-runtime}}"
max_bytes="${NULLCITY_RUNTIME_LOG_MAX_BYTES:-524288000}"
tail_bytes="${NULLCITY_RUNTIME_LOG_TAIL_BYTES:-52428800}"
snapshot_dir="${NULLCITY_RUNTIME_LOG_SNAPSHOT_DIR:-$log_dir/snapshots}"

if [[ ! -d "$log_dir" ]]; then
  exit 0
fi

mkdir -p "$snapshot_dir"

for log_path in "$log_dir"/*.log; do
  [[ -e "$log_path" ]] || continue
  [[ -f "$log_path" ]] || continue

  size="$(wc -c <"$log_path" | tr -d '[:space:]')"
  if [[ "$size" -le "$max_bytes" ]]; then
    continue
  fi

  name="$(basename "$log_path")"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  snapshot="$snapshot_dir/${name}.${stamp}.tail"

  tail -c "$tail_bytes" "$log_path" >"$snapshot"
  : >"$log_path"
  echo "[rotate-logs] truncated $log_path (${size} bytes); saved last ${tail_bytes} bytes to $snapshot"
done
