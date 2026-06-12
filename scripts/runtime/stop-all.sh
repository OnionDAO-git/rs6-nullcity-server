#!/usr/bin/env bash
# Stop the full Null City stack (all supervised screens).
#
# `screen -X quit` can leave child Node/Bun listeners behind if the shell exits
# before forwarding signals. After asking screens to quit, also clear the known
# Null City listener ports so the next bring-up is not shadowed by orphans.
for s in nullcity-landing nullcity-dashboard-web nullcity-dashboard-server nullcity-storyteller nullcity-controller nullcity-game nullcity-infra; do
  screen -X -S "$s" quit >/dev/null 2>&1 && echo "stopped $s" || echo "(no screen $s)"
done
sleep 2
for port in 5173 5174 8787 43591 43592 43594 43595 43596 43610 43611; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN -nP 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "clearing listener(s) on :$port — $pids"
    kill $pids 2>/dev/null || true
  fi
done
