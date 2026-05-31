# OPS-LIVE-DRESS-2 - hot-stack dress rehearsal

Run time: 2026-05-30 19:13-19:07 CDT

## Verdict

READY-WARN.

The controller, residents, and dashboard are usable for continued autonomous weekend work. The main dashboard false-negative was fixed during this pass: `/api/overview` now shows `23 online of 23 known residents` and readiness `ok`.

## Commands and evidence

- `scripts/post-restart-smoke.sh`
  - Result: `READY`
  - Residents: all 23 alive.
  - Recent activity: every resident had recent trajectory rows and actions in the last 5 minutes.
  - Patron registry: 1 patron configured.

- `npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible`
  - Result: PASS, 23/23 residents OK.
  - Heroes with visible speech/actions in window: Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, Thrand, Mother Anvil, Severn Vesta, The Hush, Wren Calix.
  - QA residents also acted; `res:qa-survivor` still had one combat/loot timeout but remained active and observable.

- Browser dashboard checks with the in-app browser:
  - `/residents`: renders, no console errors. After fix: quiet bucket says "No residents in this bucket right now"; dashboard still has expected plan/GP/capability warnings for work not yet proven.
  - `/story`: renders Storyteller digest feed, no console errors. Current queue is review/dry-run heavy.
  - `/profile?human=demo@onion`: renders without login; AP=6, letters=19, standing ally, no undated latest letter.
  - `/economy`: renders AP/GP economy panel, no console errors.

- HTTP probes:
  - `curl -m 10 http://127.0.0.1:5174/api/overview`: `residentCount=23`, `online=23`, `readiness=ok`, resident cohort detail `23 online of 23 known residents`.
  - `curl -m 5 http://127.0.0.1:43596/v1/health`: timed out after 5s. `scripts/post-restart-smoke.sh` confirmed `/v1/inbox` fallback worked, but `/v1/health` is not demo-safe under load.
  - `/v1/inbox?human=demo@onion`: 19 letters.
  - `/v1/patron/balance?human=demo@onion`: balance 6 AP.
  - `/v1/wall/snapshot`: returned 11 public residents but 0 letters in this hot window.

## Fix shipped during rehearsal

Dashboard `76cbcf6` exposed public attendee profiles. During this rehearsal, a new dashboard fix was added:

- `RuntimeRepository.listRuntimeResidentSummaries()` synthesizes residents from fresh controller `runtime-state.json` files when the gateway roster returns empty.
- `/api/overview` falls back to that runtime roster instead of showing zero residents online.
- Resident triage now treats a resident with fresh action and live feed as active even if it has no fresh speech line.

Verification:

- `bun test packages/server/src/runtime.test.ts packages/server/src/readiness.test.ts packages/web/src/lib/resident-loop.test.ts`: 53 pass.
- `bun test && bun run typecheck && bun run check && bun run build`: 272 pass; typecheck/check/build pass. Build warnings are the existing `SCC1_Florestan.sf2` runtime asset and large chunk notices.

## Remaining risks

1. Gateway action latency is still high under 23-resident load. `/tmp/nullcity-game-gateway.log` had 193 `AgentGateway slow message kind=submit_action` lines in the last sampled 1000 log lines, with many submit actions taking 10-13s.
2. `/v1/health` times out under load; use `/api/overview`, `/residents`, `/story`, and `post-restart-smoke.sh` as operational checks until the health endpoint is made constant-time.
3. Storyteller feed is alive but mostly review/dry-run. That is acceptable for operator work, but public canon needs S-STORY follow-up.
4. Dashboard still correctly flags missing plan/GP/capability proof for many residents. Those are product truth warnings, not stack failures.

## Next recommended packet

`P0-action-latency-stabilization`: diagnose why `submit_action` is routinely 10-13s under 23 residents, then either reduce tick pressure, tune gateway action scheduling, or make control-plane health independent from action throughput.
