# S-EXCHANGE-TUNE-1 - self-initiated AP/GP action-log proof and runway tuning

## TL;DR

Status: **live-proven and tuned**.

- Restarted the controller onto the new `dist` after `0896626a`.
- Proved the newly added `actions/*.jsonl` logging path with real `res:qa-woodcutter`: AP was drained into the nervous exchange band, the resident self-initiated `city_exchange_ap_gp`, burned 25 real GP item `995`, credited 50 AP, and wrote both action-log and Library evidence.
- Tuned self-initiated AP/GP from a fixed small buy (`max 50 GP -> 100 AP`) to a **target runway** buy: residents now try to return to roughly 500 AP above their floor, capped at 250 GP per self-exchange.
- Proved the tuned behavior with real `res:qa-trader`: AP drained to 8.5, resident self-initiated exchange, burned 246 GP, credited 492 AP, landed at 500 AP, and kept 1850 GP.

## Why This Changed

The previous self-exchange was correct but too timid. A resident near AP death could spend 50 GP for 100 AP, briefly resume, and quickly fall back into final-testament/request-attention bands. The new behavior still respects the 2 AP / 1 GP convention, but spends enough to buy an actually useful runway.

## Live Proof 1 - Action Log Path

Target: `res:qa-woodcutter`

Setup:

- Restarted controller on the build containing `0896626a`.
- `res:qa-woodcutter` held 25 GP item `995`.
- Admin AP drain moved it into the exchange band.

Action log proof:

```json
{"t":"2026-05-31T06:40:56.850Z","tick":389,"attention_after":9,"source":"nervous-system","ruleId":"self-initiated-ap-gp-exchange","action":{"kind":"city_exchange_ap_gp","cause":"nervous:self-initiated-ap-gp-exchange","gpAmount":25,"apAmount":50,"idempotencyKey":"self-ap-gp:res:qa-woodcutter:390"},"result":{"ok":true,"status":"complete","exchangeId":"apgp:res:qa-woodcutter:self-ap-gp:res:qa-woodcutter:390","apEvidence":{"creditedAmount":50,"attentionBefore":9,"attentionAfter":59},"gpEvidence":{"itemId":995,"burnedAmount":25,"remainingAmount":0}}}
```

Library proof:

```json
{"schemaVersion":1,"ts":"2026-05-31T06:40:56.719Z","tick":389,"sessionId":"external","kind":"city_ap_gp_exchange","exchangeId":"apgp:res:qa-woodcutter:self-ap-gp:res:qa-woodcutter:390","status":"complete","apAmount":50,"gpAmount":25,"cityUserId":"resident:self","lifeIndex":4,"significanceReasons":["city:ap_gp_exchange"]}
```

## Live Proof 2 - Tuned Runway Buy

Target: `res:qa-trader`

Setup:

- Rebuilt and restarted controller after the tuning change.
- Pre-drain state: `attention=66356.5`, `GP item 995=2096`.
- Admin drain moved attention to `8.5`.

Action log proof:

```json
{"t":"2026-05-31T06:44:29.256Z","tick":176,"attention_after":8,"source":"nervous-system","ruleId":"self-initiated-ap-gp-exchange","action":{"kind":"city_exchange_ap_gp","cause":"nervous:self-initiated-ap-gp-exchange","gpAmount":246,"apAmount":492,"idempotencyKey":"self-ap-gp:res:qa-trader:177"},"result":{"ok":true,"status":"complete","exchangeId":"apgp:res:qa-trader:self-ap-gp:res:qa-trader:177","apEvidence":{"creditedAmount":492,"attentionBefore":8,"attentionAfter":500},"gpEvidence":{"itemId":995,"burnedAmount":246,"remainingAmount":1850}}}
```

Library proof:

```json
{"schemaVersion":1,"ts":"2026-05-31T06:44:29.118Z","tick":176,"sessionId":"external","kind":"city_ap_gp_exchange","exchangeId":"apgp:res:qa-trader:self-ap-gp:res:qa-trader:177","status":"complete","apAmount":492,"gpAmount":246,"cityUserId":"resident:self","lifeIndex":5,"significanceReasons":["city:ap_gp_exchange"]}
```

Economy proof after `2026-05-31T06:40:00Z`:

- `ap_gp_exchange=2`
- `ap_decay=2`
- net AP delta includes the controlled drains plus exchange credits
- `gpNetDelta=-271` (`25 + 246` real GP burned)

## Code Behavior

Constants:

- `SELF_INITIATED_EXCHANGE_AP_PER_GP = 2`
- `SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP = 500`
- `SELF_INITIATED_EXCHANGE_MAX_GP = 250`
- `SELF_INITIATED_EXCHANGE_MIN_GP = 10`
- `SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER = 20`

Spend formula:

1. Compute current runway above floor: `max(0, attention - floor)`.
2. Compute needed AP to reach the target runway.
3. Convert to GP using 2 AP per GP.
4. Spend the minimum of inventory GP, max GP cap, and the GP needed for the target runway.

## Verification

```bash
npm test -- --runInBand src/controller/spark/self-initiated-ap-gp-exchange.test.ts src/controller/nervous-system/nervous-system.test.ts --no-coverage
npm test -- --runInBand src/controller/spark/self-initiated-ap-gp-exchange.test.ts src/controller/nervous-system/nervous-system.test.ts src/controller/benchmarks/tasks/self-initiated-ap-gp-exchange-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts src/controller/resident-runtime.test.ts --no-coverage
npm run check:no-ui
npm run build
```

Results:

- Focused self-exchange/nervous tests: 49 passed.
- Broader focused suite: 5 suites passed, 133 tests passed.
- `check:no-ui`: clean.
- `build`: 815 files compiled.

## Runtime Notes

The controller and city APIs were healthy after restart, but `/v1/health` reported default inference timeout at 4003 ms for `qwen/qwen3.6-27b`. This packet did not rely on inference: both live proofs were nervous-system reflexes.

## Follow-Ups

1. Re-run a 30+ minute normal-life audit after this tuning to see whether unconditioned AP/GP recurrence appears.
2. Consider dashboard surfacing for "resident self-funded AP" so operators can distinguish patron top-ups from resident-owned survival buys.
3. If residents still fall back into low AP too often, tune `SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP` upward or adjust the cooldown/trigger band.
