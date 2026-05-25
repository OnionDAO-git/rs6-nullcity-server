#!/usr/bin/env bash
# post-restart-smoke.sh — go/no-go health check after a controller restart.
# Usage: bash scripts/post-restart-smoke.sh [--no-color]
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

USE_COLOR=1; [[ "${1:-}" == "--no-color" ]] && USE_COLOR=0; [[ -t 1 ]] || USE_COLOR=0
if [[ $USE_COLOR -eq 1 ]]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'
else R=""; G=""; Y=""; B=""; N=""; fi
RED_COUNT=0; YEL_COUNT=0
red()    { echo "${R}[RED]${N}    $*"; RED_COUNT=$((RED_COUNT+1)); }
yellow() { echo "${Y}[YELLOW]${N} $*"; YEL_COUNT=$((YEL_COUNT+1)); }
green()  { echo "${G}[GREEN]${N}  $*"; }
section(){ echo; echo "${B}== $* ==${N}"; }

HEROES=(res-hans res-father-aereck res-wise-old-man res-duke-horacio res-pip res-thrand)
hero_floor() {
  case "$1" in
    res-pip|res-thrand) echo 3000 ;;
    *) echo 5000 ;;
  esac
}
# Glob the full active roster: heroes + res:agent + Codex QA cohort (qa-angler, qa-banker, ...).
# Falls back to the hardcoded heroes if the memory dir doesn't exist yet.
# Avoids bash-4 `mapfile` so it runs under macOS default bash 3.2.
RESIDENTS=()
if [[ -d data/controller/memory ]]; then
  while IFS= read -r dir; do
    RESIDENTS+=("$dir")
  done < <(find data/controller/memory -maxdepth 1 -type d -name 'res-*' -not -name 'res-bmk_*' -exec basename {} \; 2>/dev/null | sort)
fi
[[ ${#RESIDENTS[@]} -eq 0 ]] && RESIDENTS=(res-agent "${HEROES[@]}")
PORT=43596
BASE="http://127.0.0.1:${PORT}"

section "1. Controller process"
# Prefer the actual node process (filter out SCREEN/login wrappers)
PROC_LINE=$(ps -axo pid,lstart,command | grep "dist/controller/index.js" | grep -v grep | grep -vE "SCREEN |login -pflq" | head -1 || true)
[[ -z "$PROC_LINE" ]] && PROC_LINE=$(ps -axo pid,lstart,command | grep "dist/controller/index.js" | grep -v grep | head -1 || true)
if [[ -n "$PROC_LINE" ]]; then
  PID=$(awk '{print $1}' <<<"$PROC_LINE")
  START=$(awk '{print $2" "$3" "$4" "$5}' <<<"$PROC_LINE")
  green "controller alive (pid=$PID, started $START)"
else
  red "no controller process found (dist/controller/index.js)"
fi

section "2. Letters HTTP server bound (:$PORT)"
if curl -fs "$BASE/v1/health" >/dev/null 2>&1; then
  green "v1/health 200 OK"
elif curl -fs "$BASE/v1/inbox?human=health-check" >/dev/null 2>&1; then
  green "v1/inbox responded (no v1/health, fallback OK)"
else
  red "Controller restarted without --letters-http-port=${PORT} (HD-026)"
fi

section "3. Wall snapshot redaction"
SNAP=$(curl -fs "$BASE/v1/wall/snapshot" 2>/dev/null || true)
if [[ -z "$SNAP" ]]; then
  yellow "could not fetch /v1/wall/snapshot (skipping redaction check)"
else
  REDACT=$(printf '%s' "$SNAP" | python3 -c '
import json,re,sys
try:
    d = json.loads(sys.stdin.read())
except Exception as e:
    print("PARSE_ERR"); sys.exit(0)
lst = d.get("recentLetters") or []
if not lst:
    print("EMPTY"); sys.exit(0)
first = lst[0]
body = first.get("body","")
recip = first.get("recipient","")
if body != "" or (recip and "***" not in recip and re.match(r"^[a-z]{2,}", recip)):
    print("LEAK")
else:
    print("OK")
' 2>/dev/null)
  case "$REDACT" in
    OK)        green "wall snapshot redacted (body empty, recipient masked)" ;;
    EMPTY)     yellow "wall snapshot has no recentLetters (nothing to verify yet)" ;;
    PARSE_ERR) yellow "wall snapshot JSON parse error" ;;
    LEAK|*)    red "Wall redaction not active — controller missing --wall-redact flag (HD-013)" ;;
  esac
fi

section "4. Residents alive in runtime state"
DEAD=()
for slug in "${RESIDENTS[@]}"; do
  f="data/controller/memory/${slug}/runtime-state.json"
  [[ -f "$f" ]] || { DEAD+=("$slug(missing)"); continue; }
  status=$(python3 -c "import json; d=json.load(open('$f')); print('DEAD' if d.get('deceased') else 'ALIVE')" 2>/dev/null || echo PARSE_ERR)
  [[ "$status" == "ALIVE" ]] || DEAD+=("$slug")
done
if [[ ${#DEAD[@]} -eq 0 ]]; then green "all ${#RESIDENTS[@]} residents alive"; else red "dead/missing: ${DEAD[*]}"; fi

section "5. Hero attention floors"
for slug in "${HEROES[@]}"; do
  f="data/controller/memory/${slug}/runtime-state.json"
  [[ -f "$f" ]] || { yellow "$slug: runtime-state missing"; continue; }
  att=$(python3 -c "import json; print(json.load(open('$f')).get('attention',0))" 2>/dev/null)
  floor=$(hero_floor "$slug")
  awk -v a="$att" -v f="$floor" 'BEGIN{exit !(a+0 >= f+0)}' \
    && green "$slug attention=$att (floor=$floor)" \
    || yellow "$slug attention=$att (<floor $floor, investigate attention clamp)"
done

section "6. Library index health"
for slug in "${RESIDENTS[@]}"; do
  f="data/controller/memory/library/${slug}/index.json"
  [[ -f "$f" ]] || { yellow "$slug: library index.json missing"; continue; }
  out=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('lives',0), d.get('currentState',''))" 2>/dev/null)
  lives=$(awk '{print $1}' <<<"$out"); state=$(awk '{print $2}' <<<"$out")
  if [[ "$state" == "living" && "${lives:-0}" -ge 1 ]]; then green "$slug lives=$lives state=$state"
  else yellow "$slug lives=$lives state=$state (expected living, lives>=1)"; fi
done

section "7. Recent activity (last 5 min in newest trajectory)"
NOW=$(date +%s)
for slug in "${RESIDENTS[@]}"; do
  dir="data/controller/memory/${slug}/evidence/trajectory"
  [[ -d "$dir" ]] || { yellow "$slug: no trajectory dir"; continue; }
  newest=$(ls -t "$dir"/*.jsonl 2>/dev/null | head -1)
  [[ -n "$newest" ]] || { yellow "$slug: no trajectory files"; continue; }
  counts=$(python3 -c "
import json,calendar,time
cutoff=time.time()-300; rows=acts=0
try:
    for line in open('$newest'):
        try: o=json.loads(line)
        except: continue
        try: epoch=calendar.timegm(time.strptime(o.get('ts','')[:19],'%Y-%m-%dT%H:%M:%S'))
        except: continue
        if epoch>=cutoff:
            rows+=1
            if o.get('kind') in ('action','action_result','action_attempt','step'): acts+=1
except: print('ERR'); raise SystemExit
print(rows, acts)" 2>/dev/null)
  rows=$(awk '{print $1}' <<<"$counts"); acts=$(awk '{print $2}' <<<"$counts")
  if [[ "$rows" == "ERR" || -z "$rows" ]]; then yellow "$slug: trajectory read error"
  elif [[ "$rows" -eq 0 ]]; then yellow "$slug: 0 trajectory rows in last 5m (likely frozen, HD-032)"
  elif [[ "$acts" -eq 0 ]]; then yellow "$slug: $rows rows but 0 actions in last 5m"
  else green "$slug: $rows rows, $acts actions in last 5m"
  fi
done

section "8. Patron registry loaded"
PATRONS=$(python3 -c "
import re
try: txt=open('controller.yml').read()
except: print(0); raise SystemExit
m=re.search(r'^patrons:\s*\n((?:[ \t]+-[^\n]*\n?)*)', txt, re.M)
print(0 if not m else sum(1 for ln in m.group(1).splitlines() if ln.strip().startswith('-')))" 2>/dev/null)
if [[ "${PATRONS:-0}" -gt 0 ]]; then green "$PATRONS patrons configured"
else yellow "Empty patrons[] — populate before Chicago doors (HD-011)"; fi

section "Summary"
if [[ $RED_COUNT -eq 0 && $YEL_COUNT -eq 0 ]]; then
  echo "${G}READY${N}"; exit 0
elif [[ $RED_COUNT -eq 0 ]]; then
  echo "${Y}READY WITH WARNINGS ($YEL_COUNT yellow)${N}"; exit 0
else
  echo "${R}NOT READY ($RED_COUNT red, $YEL_COUNT yellow)${N}"; exit 1
fi
