# CQA4 AP/GP HTTP Exchange Proof - 2026-05-30

## TL;DR

`POST /api/nullcity/residents/:id/ap-gp-exchanges` is now live on the city integration HTTP API. A hot-stack proof exchanged real RuneScape coin item `995` from `res:qa-angler` for AP: GP went `275 -> 250`, AP went `24953 -> 25003`, the Library wrote `city_ap_gp_exchange`, and `/economy/live` plus the dashboard BFF exposed the redacted exchange event.

This proves the operator/dashboard exchange path. It does **not** yet prove an ordinary resident independently decided to sell GP for AP through a social trade; that remains the next confidence bump for `QA-20260529-011`.

## What changed

- Added `POST /api/nullcity/residents/:id/ap-gp-exchanges`.
- The route delegates to `CityIntegrationService.exchangeApForGp`.
- HTTP status mapping:
  - `complete` -> `200`
  - `failed_gp` -> `409`
  - other non-complete exchange statuses -> `500` operator-review required
- AP evidence now accepts fractional `attentionBefore` / `attentionAfter`, because live AP decays between ticks and can be non-integer.

## Test Evidence

Focused red/green:

```bash
npm test -- --runInBand src/controller/city-integration/http-server.test.ts
npm test -- --runInBand src/controller/city-integration/ap-gp-exchange.test.ts src/controller/city-integration/http-server.test.ts
```

Final focused result:

- `src/controller/city-integration/ap-gp-exchange.test.ts`
- `src/controller/city-integration/http-server.test.ts`
- `2` suites passed
- `44` tests passed

Build:

```bash
npm run build
```

Result: `Successfully compiled: 793 files with swc`.

## Live Stack Proof

Controller was rebuilt and restarted with city integration HTTP enabled:

```bash
node dist/controller/index.js \
  --config=controller.yml \
  --mcp-http-port=43610 \
  --letters-http-port=43596 \
  --city-http-port=43611 \
  --city-http-token=operator-token \
  --wall-redact
```

Pre-exchange wealth:

```bash
curl -sS http://127.0.0.1:43611/api/nullcity/residents/res%3Aqa-angler/wealth \
  -H 'Authorization: Bearer operator-token'
```

Observed:

```json
{"ok":true,"resident":"res:qa-angler","itemId":995,"amount":275}
```

Exchange request:

```bash
curl -sS -X POST \
  http://127.0.0.1:43611/api/nullcity/residents/res%3Aqa-angler/ap-gp-exchanges \
  -H 'Authorization: Bearer operator-token' \
  -H 'Content-Type: application/json' \
  --data '{
    "idempotencyKey":"cqa4-apgp-http-qa-angler-20260530T1826Z",
    "apAmount":50,
    "gpAmount":25,
    "cityUserId":"city-user:codex-cqa4-apgp",
    "sourceType":"qa_hot_stack_apgp_http",
    "sourceId":"CQA4-apgp-http"
  }'
```

Observed HTTP `200`:

```json
{
  "exchangeId": "apgp:res:qa-angler:cqa4-apgp-http-qa-angler-20260530T1826Z",
  "resident": "res:qa-angler",
  "status": "complete",
  "apAmount": 50,
  "gpAmount": 25,
  "apEvidence": {
    "creditedAmount": 50,
    "attentionBefore": 24953,
    "attentionAfter": 25003
  },
  "gpEvidence": {
    "itemId": 995,
    "burnedAmount": 25,
    "remainingAmount": 250
  }
}
```

Post-exchange wealth:

```json
{"ok":true,"resident":"res:qa-angler","itemId":995,"amount":250}
```

`/api/nullcity/economy/live` evidence:

- `attentionDelta: 50`
- `gpNetDelta: -25`
- `countsByKind.ap_gp_exchange: 1`
- resident row for `res:qa-angler` had `gpNetDelta: -25`
- recent event kind `ap_gp_exchange`
- note: `exchanged 25 GP for 50 AP`
- handle was redacted as `<patron #1>` in public economy payloads

Dashboard BFF `/api/nullcity/economy/live` returned `available: true` and the same redacted exchange event.

Library timeline evidence:

- `city_gold_observed` for `res:qa-angler`, amount `275`, item `995`
- `city_ap_gp_exchange` at tick `111`
- exchange id `apgp:res:qa-angler:cqa4-apgp-http-qa-angler-20260530T1826Z`
- status `complete`
- `apAmount: 50`
- `gpAmount: 25`

## Bug Found And Fixed

The first live attempt against `res:qa-trader` exposed a real hot-stack bug:

- GP burn and AP credit happened.
- Exchange record validation failed because decayed AP was fractional.
- The old schema required integer `attentionBefore` / `attentionAfter`.

Fix:

- AP evidence still requires positive integer `creditedAmount`.
- `attentionBefore` and `attentionAfter` are now `number().min(0)`.
- Regression test: `accepts fractional attention evidence because live AP decays between ticks`.

Operator note: do not retry the first failed idempotency key from the pre-fix attempt. It failed after mutation and before exchange-record persistence.

## Remaining Gap

This packet proves the **dashboard/operator HTTP exchange** with a real online resident, real GP item `995`, AP credit, Library evidence, economy event, and BFF visibility.

Still open:

- ordinary resident decides it needs AP,
- honestly verifies it has GP,
- asks or offers a trusted exchange,
- completes the social/economy path without benchmark/operator forcing,
- repeats in ordinary-life audits.

That remains tracked under `QA-20260529-011`.
