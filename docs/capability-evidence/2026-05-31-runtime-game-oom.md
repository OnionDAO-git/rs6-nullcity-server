# Runtime game OOM and gateway detach — 2026-05-31

## Summary

The live controller/dashboard timeout recurrence was not another QA-019 queue-size regression. The game server process behind the agent gateway hit a JavaScript heap OOM, dropped `127.0.0.1:43595`, and left the controller detached from live residents.

## Evidence

- `data/runtime-logs/runtime-steward-game-20260531T141754.log` recorded `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.
- The same log showed nodemon waiting after the crash, then later restarting only because source files changed.
- `lsof -Pan -iTCP:43595 -sTCP:LISTEN` initially returned no listener while the controller process was still present.
- Controller logs then showed `Gateway socket closed`, repeated `ECONNREFUSED 127.0.0.1:43595`, and `Gateway request timed out` / `Gateway action queue timed out` fallout.
- After nodemon restarted the game, the controller remained detached and `/api/nullcity/economy/heartbeat` reported `activeResidentCount: 0`.

## Fix

- Added `npm run start:game:supervised`, a stable game runner that starts `dist/server/runner.js -game` with `NODE_MAX_OLD_SPACE` defaulting to `4096` MB and restarts the game after a crash.
- Raised the dev `start:game` heap from `2048` MB to `4096` MB.
- Included sibling commit `52a2900e`, which bounded `OutboundPacketHandler` spectator packet replay by retained bytes as well as frame count. This prevents large RuneScape client frames from accumulating indefinitely in each player's replay history.
- Updated `docs/runtime-stewardship.md` to use the supervised game runner for the weekend runtime stack.

## Follow-up

- If OOM recurs at 4 GB with bounded spectator replay, capture a heap snapshot or RSS trend and inspect world/player/session retention in the game server.
- The controller should also surface a clearer degraded state when the game gateway is gone and should reconnect cleanly after the gateway returns.

## Post-fix live validation

- Commit `1b962a29` pushed the supervised runner, 4 GB dev heap, gateway send-failure cleanup, and this evidence.
- Game restarted under `npm run start:game:supervised`; `ps` showed `node --max-old-space-size=4096 dist/server/runner.js -- -game` listening on `127.0.0.1:43595`.
- Controller restarted on the fresh build with city API on `127.0.0.1:43611`.
- Heartbeat returned HTTP 200 with `activeResidentCount: 23`, `residentCount: 25`, and `degradedFlags: []`.
- Dashboard BFF `/api/overview` returned HTTP 200 with gateway connected, `23` online residents, and `23` latest inference rows.
- `scripts/post-restart-smoke.sh` returned READY WITH WARNINGS: all 23 residents alive, all hero AP floors green, 22/23 residents had actions in the last 5 minutes (`res:qa-social` had rows but no actions in that narrow window).
- `controller:smoke -- --observe-seconds 60 --allow-recent-visible` still exited non-zero due ordinary behavior warnings, but showed `preAckCancel=0` for all 23 residents. Remaining warnings were effect timeouts/no-visible-activity/after-submit interruptions, not gateway detach.
- `controller:inference-audit` over the post-restart window reported usable brain rate `98.3%` (`403` clean / `410` brain decisions), no empty completions, and artifact `data/benchmarks/capability-qa-2026-05-31/inference-audit/inference_health_audit_20260531T212602Z.json`.
