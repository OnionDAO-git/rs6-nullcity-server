# QA-20260602-001 Handoff: Print Queue Claim

## Issue

The dashboard print bridge endpoint `POST /api/admin/print-queue/claim` always returned no job, and the dashboard store contract had no method for claiming queued print work. A bridge could heartbeat, but it could not receive work from `print_queue`.

## Fix

Dashboard commit: `9ed29d8 fix(print): claim queued bridge jobs`

Changed dashboard server code:

- Added `CityStore.enqueuePrintRequest` and `CityStore.claimNextPrintQueueJob`.
- Implemented claim logic for both `InMemoryCityStore` and `PostgresCityStore`.
- The Postgres implementation claims the next eligible `print_queue.status='queued'` row with `FOR UPDATE SKIP LOCKED`, ordered by `priority ASC, created_at ASC`, and assigns an eligible enabled printer for the requesting bridge.
- Replaced the route stub for `/api/admin/print-queue/claim` with token-gated body parsing, `bridgeId`/`printerIds` validation, and store-backed job response.
- Kept print request status within the existing `PrintRequestStatus` values; the queue row moves to `claimed`.

## Evidence

Red/green regression:

- Before route implementation, `bun test packages/server/src/city/routes.test.ts` failed because the claim endpoint returned `{}` and accepted an empty `printerIds` list.
- After implementation, `bun test packages/server/src/city/routes.test.ts` passed: `39 pass, 0 fail, 119 expect() calls`.

Dashboard gates:

- `bun run typecheck`: all packages exited 0.
- `bun run check`: all packages exited 0.
- `bun run build`: all packages built; existing Vite asset/chunk-size warnings only.

## Notes

`docs/issue-register.md` was not edited from the clean server worktree because the newest QA rows are still dirty/local-only in the shared checkout. This handoff plus the `docs/agent-status.md` STARTING/HANDOFF lines are the durable evidence until the register is reconciled.

Next likely issue: `QA-20260602-004` if `QA-20260602-002` and `QA-20260602-003` are considered fixed by their pushed dashboard commits.

