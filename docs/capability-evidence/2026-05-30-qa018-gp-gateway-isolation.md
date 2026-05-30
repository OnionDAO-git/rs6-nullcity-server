# QA-20260530-018 GP Gateway Isolation

Date: 2026-05-30

## Finding

The live AP-for-GP route was not failing because the resident inventories lacked coin item `995`. It was failing because the controller's resident-observation gateway could become saturated by many live `submit_action` requests. Under that pressure, low-frequency city/operator GP calls (`inspect_resident_gold`, `burn_resident_gold`) timed out or inherited stale closed sockets.

## Fix

- `ControllerHost.inspectResidentGold` and `ControllerHost.burnResidentGold` now route through isolated city inventory gateways instead of the resident-control gateway.
- Live-owned city inventory calls use a fresh gateway per request with short retry for safe reads and conservative retry for pre-send burn failures.
- `GatewayClient.submitActionWithRequestId` now applies backpressure to resident `submit_action` traffic.
- Queued `submit_action` requests expire before they can become stale delayed actions.

## Verification

Focused tests:

```text
npm test -- --runInBand src/controller/transport/gateway-client.test.ts src/controller/controller-host.test.ts
PASS, 30 tests
```

Integration-adjacent focused tests:

```text
npm test -- --runInBand src/controller/controller-host.test.ts src/controller/city-integration/service.test.ts src/controller/city-integration/http-server.test.ts src/controller/host-economy-wiring.test.ts
PASS, 87 tests
```

Static/build gates:

```text
npm run typecheck
npm run check:no-ui
npm run build
PASS; build compiled 798 files
```

Hot-stack proof after rebuilding and restarting the controller:

```text
GET /api/nullcity/residents/res:agent/wealth
{"ok":true,"resident":"res:agent","itemId":995,"amount":24138}

GET /api/nullcity/residents/res:qa-trader/wealth
{"ok":true,"resident":"res:qa-trader","itemId":995,"amount":1832}

POST /api/nullcity/residents/res:qa-trader/ap-gp-exchanges
{"status":"complete","apEvidence":{"creditedAmount":2,"attentionBefore":22965.5,"attentionAfter":22967.5},"gpEvidence":{"itemId":995,"burnedAmount":1,"remainingAmount":1831}}
```

`npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible` still exited non-zero because 4/23 residents had no visible activity in that one-minute window (`res:qa-guardian`, `res:qa-cook`, `res:qa-trader`, `res:qa-survivor`) and `res:pip` / `res:qa-priest` still had movement timeouts. That is a broader live-behavior QA follow-up, not an AP/GP gateway failure: the AP-for-GP route completed on the hot stack after the fix.

## Notes

During manual diagnostics, Codex burned small live proof amounts:

- `res:agent`: 2 GP total before the final proof window.
- `res:qa-trader`: 3 GP total including the final complete AP-for-GP proof.

These were deliberate one-GP proof burns against live residents and should be treated as QA evidence, not organic resident spending.
