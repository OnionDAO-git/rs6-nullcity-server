# QA-20260530-020 — action ACK telemetry

## Finding

`QA-20260530-019` fixed the broad startup queue starvation, but the rebuilt hot stack still produced resident-level `action_watchdog_timeout` and occasional slow `submit_action` symptoms. The existing gateway resident log recorded action submission and perceptions, but not:

- how long an action waited for an action result,
- whether the result arrived after the request had timed out,
- how deep the pending action queue was when a timeout happened,
- how many ticks elapsed between enqueue and resolution.

That made it hard to separate "no action was attempted" from "an action was attempted but ACK/result latency exceeded the resident watchdog."

## Fix

`ResidentSession` now appends structured action lifecycle records to `data/agent-logs/<resident>/<date>.jsonl`:

- `type: "action_timeout"` with `requestId`, `actionKind`, `timeoutMs`, `elapsedMs`, `enqueuedTick`, and `pendingDepth`.
- `type: "action_result"` with `requestId` when the result is still correlated, `originalRequestId` when it arrives orphaned after timeout, `actionKind`, `status`, `reason`, `elapsedMs`, `enqueuedTick`, `resolvedTick`, `ticksWaited`, `orphaned`, and `pendingDepth`.

The runtime behavior is unchanged: timed-out results still become orphaned and are not assigned to newer requests. This only makes the gateway/body boundary observable.

## Verification

- Red test: `npm test -- src/server/agent/resident-session.test.ts --runInBand` initially failed because no `action_result` latency record was logged.
- Red test: same command initially failed because no `action_timeout` record was logged before a pending request became orphaned.
- Green test: `src/server/agent/resident-session.test.ts` now passes 9/9.
- `npm run check:no-ui` passed.
- `npm run typecheck` passed.
- `npm run build` passed (`799` files compiled).
- `npm run fin` passed (`217` suites / `2998` tests).
- Hot-stack sample after the nodemon game process picked up the rebuilt `dist`: `controller:smoke -- --observe-seconds 60 --allow-recent-visible` still exited `1` for known resident-level cadence/no-visible-activity issues, but the new server action log telemetry emitted `76` fresh `action_result` lifecycle records and `0` `action_timeout` records during the sample window. Example record:

```json
{"type":"action_result","requestId":"controller-1780177448436-979","actionKind":"say","status":"success","elapsedMs":504,"enqueuedTick":161,"resolvedTick":162,"ticksWaited":1,"orphaned":false,"pendingDepth":0}
```

## Next

This is the server-side resident-session evidence layer. The next root-cause packet should add controller-side trajectory evidence for pre-ACK watchdogs, so `controller:smoke` can distinguish:

- action attempted but never ACKed,
- ACK received but effect wait timed out,
- no visible action attempted.
