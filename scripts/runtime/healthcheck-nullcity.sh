#!/usr/bin/env bash
#
# Null City health probe — safe to run every 2 minutes from cron.
#
# Probes (each with a 5s budget; read-only, no side effects while healthy):
#   game gateway        tcp  127.0.0.1:43594
#   controller letters  GET  http://127.0.0.1:43596/v1/health
#   city API            GET  http://127.0.0.1:43611/api/nullcity/economy/heartbeat
#                            (sends Authorization: Bearer $CITY_API_TOKEN if set;
#                             without a token, any HTTP response — incl. 401 — counts as alive)
#   dashboard BFF       GET  http://127.0.0.1:8787/api/health
#   dashboard SPA       GET  http://127.0.0.1:5174/
#   landing             GET  http://127.0.0.1:5173/
#   postgres            docker exec landing-2026-db-1 pg_isready (:5432)
#
# On any failure it logs LOUDLY to the log dir (~/nullcity-logs by default,
# override NULLCITY_RUNTIME_LOG_DIR) and exits 1. With HEAL=1 it additionally
# re-runs scripts/runtime/start-all-supervised.sh, which is idempotent (quits +
# relaunches the named screens). NOTE: HEAL restarts the WHOLE stack, so a heal
# cooldown (default 600s, NULLCITY_HEAL_COOLDOWN_SECONDS) stops a persistently
# broken probe from bouncing the city every 2 minutes.
#
# Cron (every 2 minutes, self-healing):
#   */2 * * * * HEAL=1 /bin/bash /Users/james/Code/OnionDAO/rs6-nullcity-server/scripts/runtime/healthcheck-nullcity.sh >> "$HOME/nullcity-logs/healthcheck.log" 2>&1
set -uo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${NULLCITY_RUNTIME_LOG_DIR:-$HOME/nullcity-logs}"
PG_CONTAINER="${NULLCITY_PG_CONTAINER:-landing-2026-db-1}"
PG_USER="${NULLCITY_PG_USER:-oniondao}"
HEAL="${HEAL:-0}"
HEAL_COOLDOWN="${NULLCITY_HEAL_COOLDOWN_SECONDS:-600}"
HEAL_STAMP="$LOG_DIR/.last-heal-epoch"
FAIL_LOG="$LOG_DIR/healthcheck-failures.log"
mkdir -p "$LOG_DIR"

FAILED=()
fail_probe() { FAILED+=("$1"); echo "[healthcheck] FAIL $1 — $2"; }
ok_probe() { :; } # healthy probes stay quiet; summary line at the end

curl_ok() { # $1 name, $2 url, extra args appended
  local name="$1" url="$2"
  shift 2
  if curl --connect-timeout 5 -m 5 -fsS -o /dev/null "$@" "$url"; then
    ok_probe "$name"
  else
    fail_probe "$name" "no healthy response from $url"
  fi
}

# --- game gateway (raw tcp) ---------------------------------------------------
if nc -z -w 5 127.0.0.1 43594 >/dev/null 2>&1; then
  ok_probe "game"
else
  fail_probe "game" "nothing listening on tcp 127.0.0.1:43594"
fi

# --- controller letters API ---------------------------------------------------
curl_ok "controller" "http://127.0.0.1:43596/v1/health"

# --- city API heartbeat -------------------------------------------------------
CITY_URL="http://127.0.0.1:43611/api/nullcity/economy/heartbeat"
if [ -n "${CITY_API_TOKEN:-}" ]; then
  curl_ok "city-api" "$CITY_URL" -H "Authorization: Bearer $CITY_API_TOKEN"
else
  # No token available: a 401 still proves the listener is alive.
  code="$(curl --connect-timeout 5 -m 5 -s -o /dev/null -w '%{http_code}' "$CITY_URL" 2>/dev/null || echo 000)"
  if [ "$code" = "000" ]; then
    fail_probe "city-api" "no HTTP response from $CITY_URL"
  else
    ok_probe "city-api"
  fi
fi

# --- dashboard BFF / SPA / landing ---------------------------------------------
curl_ok "dashboard-bff" "http://127.0.0.1:8787/api/health"
curl_ok "dashboard-spa" "http://127.0.0.1:5174/"
curl_ok "landing" "http://127.0.0.1:5173/"

# --- postgres -------------------------------------------------------------------
if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -t 5 >/dev/null 2>&1; then
  ok_probe "postgres"
else
  fail_probe "postgres" "pg_isready failed in container $PG_CONTAINER (container down? OrbStack down?)"
fi

# --- verdict --------------------------------------------------------------------
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "[healthcheck] OK at $(date) — all probes healthy"
  exit 0
fi

MSG="[healthcheck] *** UNHEALTHY at $(date): ${FAILED[*]} ***"
echo "$MSG"
echo "$MSG" >>"$FAIL_LOG"

if [ "$HEAL" = "1" ]; then
  now="$(date +%s)"
  last=0
  [ -f "$HEAL_STAMP" ] && last="$(cat "$HEAL_STAMP" 2>/dev/null || echo 0)"
  if [ $((now - last)) -lt "$HEAL_COOLDOWN" ]; then
    echo "[healthcheck] HEAL=1 but last heal was $((now - last))s ago (<${HEAL_COOLDOWN}s cooldown) — skipping bring-up" | tee -a "$FAIL_LOG"
  else
    echo "$now" >"$HEAL_STAMP"
    echo "[healthcheck] HEAL=1 — re-running start-all-supervised.sh (full-stack bring-up, log: $LOG_DIR/heal-bringup.log)" | tee -a "$FAIL_LOG"
    bash "$SERVER_DIR/scripts/runtime/start-all-supervised.sh" >>"$LOG_DIR/heal-bringup.log" 2>&1 \
      || echo "[healthcheck] heal bring-up exited nonzero — check $LOG_DIR/heal-bringup.log" | tee -a "$FAIL_LOG"
  fi
fi
exit 1
