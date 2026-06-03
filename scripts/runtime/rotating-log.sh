#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 <log-path>" >&2
  exit 2
fi

log_path="$1"
max_bytes="${NULLCITY_LOG_MAX_BYTES:-67108864}"
backups="${NULLCITY_LOG_BACKUPS:-5}"

mkdir -p "$(dirname "$log_path")"
touch "$log_path"

rotate_if_needed() {
  local size
  size="$(wc -c <"$log_path" | tr -d '[:space:]')"
  if [[ "$size" -lt "$max_bytes" ]]; then
    return 0
  fi

  local i
  for ((i = backups; i >= 1; i--)); do
    if [[ -f "${log_path}.${i}" ]]; then
      if [[ "$i" -eq "$backups" ]]; then
        rm -f "${log_path}.${i}"
      else
        mv "${log_path}.${i}" "${log_path}.$((i + 1))"
      fi
    fi
  done

  mv "$log_path" "${log_path}.1"
  : >"$log_path"
}

while IFS= read -r line || [[ -n "$line" ]]; do
  rotate_if_needed
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$log_path"
done
