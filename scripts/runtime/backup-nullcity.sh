#!/usr/bin/env bash
#
# Null City backup — Postgres + controller memory.
#
# 2026-06-11 SRE audit: there were NO backups of the Postgres databases
# (docker container landing-2026-db-1: oniondao + nullcity_city) or of
# data/controller/memory (ledgers, letters, the Library of Souls). One bad
# disk = the whole city's history gone. This script closes that hole.
#
# Writes timestamped artifacts under ~/nullcity-backups (override with
# NULLCITY_BACKUP_DIR):
#   pg-oniondao-<stamp>.sql.gz
#   pg-nullcity_city-<stamp>.sql.gz
#   controller-memory-<stamp>.tar.gz
# Retention: keeps the newest 48 of each artifact kind (hourly cron ≈ 2 days).
#
# Cron (hourly, on the runtime host):
#   0 * * * * /bin/bash /Users/james/Code/OnionDAO/rs6-nullcity-server/scripts/runtime/backup-nullcity.sh >> "$HOME/nullcity-logs/backup.log" 2>&1
#
# Exits NONZERO and loudly on any failure — a silently broken backup is worse
# than no backup. Safe to run while the stack is live: pg_dump takes a
# consistent snapshot, and the memory tar excludes in-flight *.tmp atomic-write
# files.
set -uo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${NULLCITY_BACKUP_DIR:-$HOME/nullcity-backups}"
PG_CONTAINER="${NULLCITY_PG_CONTAINER:-landing-2026-db-1}"
PG_USER="${NULLCITY_PG_USER:-oniondao}"
PG_DATABASES=(oniondao nullcity_city)
RETAIN="${NULLCITY_BACKUP_RETAIN:-48}"
MEMORY_PARENT="$SERVER_DIR/data/controller"
STAMP="$(date +%Y%m%dT%H%M%S)"

fail() {
  echo "[backup] FAILURE: $*" >&2
  echo "[backup] *** BACKUP DID NOT COMPLETE (stamp=$STAMP) — investigate immediately. ***" >&2
  exit 1
}

mkdir -p "$BACKUP_DIR" || fail "cannot create backup dir $BACKUP_DIR"
echo "[backup] starting at $(date) (stamp=$STAMP, dir=$BACKUP_DIR)"

ARTIFACTS=()

# --- 1. Postgres dumps (both databases, from the docker container) ----------
for db in "${PG_DATABASES[@]}"; do
  out="$BACKUP_DIR/pg-${db}-${STAMP}.sql.gz"
  echo "[backup] pg_dump $db from container $PG_CONTAINER -> $out"
  if ! docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" --no-owner "$db" | gzip >"$out"; then
    rm -f "$out"
    fail "pg_dump $db failed (is the $PG_CONTAINER container running? docker compose up -d db in landing-2026)"
  fi
  size="$(wc -c <"$out" | tr -d '[:space:]')"
  if [ "$size" -lt 512 ]; then
    rm -f "$out"
    fail "pg dump for $db is only ${size} bytes — refusing to keep a suspiciously empty dump"
  fi
  ARTIFACTS+=("$out")
done

# --- 2. Controller memory (ledgers, letters, library) ------------------------
[ -d "$MEMORY_PARENT/memory" ] || fail "controller memory dir not found: $MEMORY_PARENT/memory"
out="$BACKUP_DIR/controller-memory-${STAMP}.tar.gz"
echo "[backup] tar data/controller/memory -> $out"
# --exclude '*.tmp': the controller writes JSON atomically (write .tmp, rename),
# so in-flight temp files can vanish mid-tar and abort the archive.
if ! tar --exclude '*.tmp' -czf "$out" -C "$MEMORY_PARENT" memory; then
  rm -f "$out"
  fail "tar of $MEMORY_PARENT/memory failed"
fi
size="$(wc -c <"$out" | tr -d '[:space:]')"
if [ "$size" -lt 512 ]; then
  rm -f "$out"
  fail "controller memory archive is only ${size} bytes — refusing to keep it"
fi
ARTIFACTS+=("$out")

# --- 3. Retention: keep newest $RETAIN of each artifact kind -----------------
prune() {
  # $1 = glob pattern relative to BACKUP_DIR (no spaces in our filenames)
  ls -1t "$BACKUP_DIR"/$1 2>/dev/null | tail -n +"$((RETAIN + 1))" | while IFS= read -r old; do
    rm -f "$old" && echo "[backup] pruned $old"
  done
}
prune 'pg-oniondao-*.sql.gz'
prune 'pg-nullcity_city-*.sql.gz'
prune 'controller-memory-*.tar.gz'

# --- 4. Report ----------------------------------------------------------------
echo "[backup] artifact sizes:"
ls -lh "${ARTIFACTS[@]}"
echo "[backup] total backup dir usage: $(du -sh "$BACKUP_DIR" | awk '{print $1}')"
echo "[backup] OK at $(date) (stamp=$STAMP)"
