# QA-20260530-019 — action backpressure startup regression

## Finding

After `QA-20260530-018` landed, a clean hot-stack restart exposed repeated controller errors:

- `Gateway action queue timed out: submit_action`
- `Gateway request timed out: submit_action`
- dashboard `/api/overview` timed out while the controller was saturated

The root cause was the new controller-side action backpressure default: `maxConcurrentActions=1` with a queue timeout derived from half the request timeout. That protected the game gateway, but serialized all resident actions into one lane and starved startup bursts from ~19 residents.

## Fix

- Keep action backpressure.
- Default to a small action lane pool (`4`) instead of one-at-a-time serialization.
- Give `submit_action` its own 30s request timeout, matching the live reality that action acknowledgements can be delayed behind busy game ticks even when the action eventually applies.
- Give `list_residents` its own 30s request timeout because dashboard overview and live smoke depend on resident list reads during the same busy-tick windows.
- Default queued actions to a 30s queue window so a normal startup burst can drain.
- Keep explicit `maxConcurrentActions: 1` + short `actionQueueTimeoutMs` available for tests and special cases where stale-action expiry is desired.

## Verification

- Red test: `npm test -- --runInBand src/controller/transport/gateway-client.test.ts -t "defaults to a small action lane pool"` failed before the fix because only `res:one` was submitted and queued residents timed out.
- Green test: same focused test passed after the fix.
- Red test: `npm test -- --runInBand src/controller/transport/gateway-client.test.ts -t "submitAction honors"` initially failed because `actionRequestTimeoutMs` did not exist.
- Green test: same focused test passed after adding the per-action timeout override.
- Red test: `npm test -- --runInBand src/controller/transport/gateway-client.test.ts -t "listResidents honors"` initially failed because `listResidentsRequestTimeoutMs` did not exist.
- Green test: same focused test passed after adding the resident-list timeout override.
- Focused suites after all fixes: `gateway-client.test.ts` 9/9 passed; controller-host + city integration + host economy wiring 98/98 passed; `typecheck`, `check:no-ui`, and `build` passed.
- Live rebuilt stack: `/api/nullcity/economy/live` returned 200, dashboard `/api/overview` returned 200 with 23 residents and readiness `ok`, and wall snapshot returned 200. `controller:smoke -- --observe-seconds 60 --allow-recent-visible` still exited 1 because of resident-level action-watchdog/no-activity warnings, but the original queue starvation pattern was gone.

## Follow-up

The remaining live failure is no longer one-lane queue starvation. One `submit_action` request can still exceed the 30s action ACK window while several residents report `action_watchdog_timeout`; the next root-cause target is server-side tick/action-ack instrumentation and the movement watchdog, not controller queue length.
