# QA-20260530-023 fast submit_action ACK

Date: 2026-05-30 CDT

## Verdict

Code-level fix shipped and focused verification is green. Live verification is partially positive but not a clean controller-smoke pass because concurrent source edits in the active S-NCRI-3 lane repeatedly restarted the game gateway during smoke windows.

## Problem

The hot stack logged clustered slow `submit_action` handlers:

- `2026-05-31T00:15:49Z` four `submit_action` warnings at `10730-10758ms`
- `2026-05-31T00:16:15Z` three `submit_action` warnings at `21630-21889ms`

The gateway was awaiting `ResidentSession.submitActionAndWait(...)` before ACKing the controller. Under tick/event-loop saturation, even the server-side 3s action-result timeout could be delayed past 10s.

## Fix

`src/server/agent/gateway.ts` now queues the action with `ResidentSession.submitAction(action, requestId)` and immediately ACKs:

```json
{ "ok": true, "result": { "ok": true, "status": "queued", "cause": "queued", "requestId": "<controller request id>" } }
```

The existing `action_result` stream remains the final source of the real tick result with the same request id.

## Verification

Commands run:

- `npm test -- --runInBand src/server/agent/gateway.test.ts -t "ACKs as soon as the action is queued"`: PASS after RED failure (`Expected "resolved", Received "pending"`).
- `npm test -- --runInBand src/server/agent/gateway.test.ts src/controller/transport/gateway-client.test.ts`: PASS, 17 tests.
- `npm run check:no-ui`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, 799 files compiled.

Live probes:

- Removed duplicate stale game runner that caused `EADDRINUSE`; stack returned to one listener on `127.0.0.1:43595`.
- `bash scripts/post-restart-smoke.sh`: READY WITH WARNINGS, 23/23 residents alive, 22/23 residents with recent actions, only `res:qa-social` had 0 actions in the last 5 minutes.
- After the new gateway came up, `tail /tmp/nullcity-game-gateway.log` showed no new `AgentGateway slow message kind=submit_action` lines after the rebuilt listener timestamps (`00:18:06Z`, `00:19:05Z`, `00:19:40Z`, `00:20:12Z`, `00:21:28Z`, `00:22:02Z`).

Live caveat:

- `npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible` did not pass while source files in the active S-NCRI-3 lane were being edited. Nodemon restarted the game gateway during the smoke windows (`src/controller/city-integration/service.test.ts` trigger at `00:21:35Z`), resetting many QA residents to low tick counts and producing `no_observed_tick_progress` warnings. This does not invalidate the queued-ACK fix, but it means a clean post-S-NCRI smoke is still needed.

## Remaining risk

Fast ACK makes ACK mean "accepted into the game queue", not "completed on tick." Runtime paths with effect waiters remain accurate; ACK-only paths can still look optimistic until the later `action_result`. Existing body/action logs preserve the request id, so the next improvement should be result-aware throttling or smoke-side final-result correlation if optimistic ACKs become misleading.
