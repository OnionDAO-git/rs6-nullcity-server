#!/usr/bin/env bash
# Stop the full Null City stack (all supervised screens). Graceful SIGTERM via screen quit.
for s in nullcity-dashboard-web nullcity-dashboard-server nullcity-storyteller nullcity-controller nullcity-game nullcity-infra; do
  screen -X -S "$s" quit >/dev/null 2>&1 && echo "stopped $s" || echo "(no screen $s)"
done
