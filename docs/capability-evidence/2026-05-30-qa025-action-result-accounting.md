# QA-20260530-025 — action result accounting before effect timeout

## Why

After `QA-20260530-023` fast-ACKed `submit_action`, `controller:smoke`
still reported residual action-result timeouts. A read-only scout found these were no
longer gateway ACK timeouts. They were controller-side effect waits: the runtime was
waiting for perception evidence and could record `timeout` even when the gateway had
already emitted an authoritative `action_result` frame for the same request id.

Concrete pattern from live logs:

- `submit_action` ACK was fast and queued.
- Server-side action result arrived with a request id and, for stale targets, a concrete
  failure such as `target_not_found`.
- Runtime trajectory could still record `status="timeout"` with empty or movement-only
  evidence if the perception wait did not observe the desired effect.

## Change

- `ActionCoordinator` now passes the active `ActionAttempt` into `waitForEffect`, so
  effect waiters can see the gateway request id assigned at ACK time.
- `ResidentRuntime` subscribes to `gateway.actionResult`, buffers recent results by
  request id, and races perception/event effect waits against the matching gateway
  result.
- Gateway failures now resolve the action as `failure` with the gateway reason
  (`target_not_found`, etc.) and `source="action_result"` evidence instead of falling
  through to an empty effect timeout.
- When the gateway result wins the race, the runtime aborts the losing perception/event
  wait so stale body waiters do not linger until their original timeout.
- `ResidentRuntime.stop()` removes its gateway listener and clears buffered action
  results/waiters so runtime replacement does not leak stale observers.
- `EffectWaitResult` gained optional `finalReason` so the controller can preserve the
  server's concrete failure reason while still categorizing the effect result as a
  failure.

## Verification

- `npm test -- --runInBand src/controller/resident-runtime.test.ts -t "gateway action_result failures"`
  - PASS. Regression covers a never-settling perception wait plus a gateway
    `actionResult` failure; trajectory records `failure/target_not_found` with
    `gateway_action_result` evidence before the watchdog fires, and confirms the
    losing effect wait signal is aborted.
- `npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/actions/action-coordinator.test.ts src/controller/transport/gateway-client.test.ts`
  - PASS: 87/87 tests, including request-id cache eviction and listener cleanup.
- `npm run check:no-ui`
  - PASS.
- `npm run typecheck`
  - PASS.
- `npm run build`
  - PASS: 803 files compiled.
- `npx biome lint src/controller/resident-runtime.ts src/controller/resident-runtime.test.ts src/controller/actions/action-attempt.ts src/controller/actions/action-coordinator.ts`
  - PASS.

## Live Stack

Controlled controller restart loaded the new build at `19:45 CDT`.

Post-restart smoke:

```text
READY WITH WARNINGS (3 yellow)
23/23 residents alive
20/23 residents had at least one action in the last 5m
yellow: res-agent, res-qa-cook, res-qa-social had rows but 0 actions during the narrow post-restart window
```

Controller smoke:

```text
npm run controller:smoke -- --observe-seconds 45 --allow-recent-visible
23/23 residents OK
notable residual timeouts:
- res:qa-social: 1
- res:qa-survivor: 1
- res:qa-guide: 1
- res:severn-vesta: 1
```

The remaining live timeouts sampled after the restart were mostly explicit movement
timeouts with distance evidence. They are now easier to distinguish from authoritative
gateway failures.

## Follow-up

Run the next CQA5 packet: named `res:qa-survivor` combat heal/re-engage soak. If it
still times out, the verifier can now tell whether the server rejected an action, the
resident moved poorly, or the effect waiter lacked a perception signal.
