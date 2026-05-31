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
