# CQA10 - self-initiated AP/GP recurrence

## TL;DR

Status: **partially proven, keep tuning**.

- A normal hot-stack 30 minute audit was healthy and non-idle: 23 active residents, 6,767 action submissions, 6,767 successes, and 0 failed submissions.
- The same unconditioned 30 minute window did **not** naturally produce `city_ap_gp_exchange`, `trade_completed`, `trade_cancelled`, `level_up`, `logout`, or `death` timeline moments.
- A controlled named-resident proof pushed real `res:qa-cook` into the low-AP band while it held real RuneScape GP item `995`; on the next nervous-system turn it self-initiated AP-for-GP, burned 50 GP, credited 100 AP, recorded Library + economy events, and resumed ordinary fishing/cooking behavior.
- Gap found and fixed in this packet: the production `city_exchange_ap_gp` intercept bypassed the body action log, so future QA could see the Library/economy side effects but not an `actions/*.jsonl` action record. `ResidentRuntime` now appends action-log entries for city exchange attempts.

## Evidence

### Normal-life audit

Command:

```bash
npm run controller:normal-life-audit -- --duration-ms=1800000 --top=20 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-self-init-ap-gp-recurrence
```

Artifact:

`data/benchmarks/capability-qa-2026-05-31/cqa10-self-init-ap-gp-recurrence/normal_life_audit_20260531T062503Z.json`

Summary:

- Window: `2026-05-31T05:55:03.736Z` to `2026-05-31T06:25:03.736Z`
- Residents: 23 active
- Actions: 6,767 total, 6,767 successful, 0 failed, 100% submit success
- Top action kinds: `noop=3601`, `move_to=1590`, `say=1146`, `interact=202`, `use_item_on_item=98`, `attack=66`, `eat=27`, `use_item_on=26`, `item_action=11`
- AP pressure: 23 residents with attention, 13 with AP drops, aggregate drop `16455`
- Timeline: `say=1142`, `stuck_detected=865`, `stuck_recovered=651`, `first_xp=106`
- Not observed: `city_ap_gp_exchange`, `trade_completed`, `trade_cancelled`, `level_up`, `quest_complete`, `logout`, `death`

Interpretation:

The stack is doing a lot of ordinary work, including combat, cooking, eating, interaction, movement, speech, XP, and AP decay. It is still not independently producing economy/social closure often enough in an unaided 30 minute window.

### Controlled named-resident recurrence proof

Target: `res:qa-cook`

Pre-state:

```json
{"attention":6848,"tick":824}
```

Pre-wealth:

```json
{"ok":true,"resident":"res:qa-cook","itemId":995,"amount":275}
```

Operator drain used only to place an ordinary named resident into the nervous exchange band:

```bash
curl -sS -X POST \
  -H 'Authorization: Bearer operator-token' \
  -H 'Content-Type: application/json' \
  'http://127.0.0.1:43611/api/nullcity/admin/residents/res%3Aqa-cook/ap-drain' \
  --data '{"amount":6833,"reason":"CQA10 self-init AP/GP recurrence proof: lower named resident with real GP into nervous exchange band"}'
```

Drain result:

```json
{"ok":true,"resident":"res:qa-cook","attentionBefore":6848,"attentionAfter":15,"requestedDrain":6833,"actualDrain":6833}
```

Library proof:

```json
{"schemaVersion":1,"ts":"2026-05-31T06:27:29.524Z","tick":824,"sessionId":"external","kind":"city_ap_gp_exchange","exchangeId":"apgp:res:qa-cook:self-ap-gp:res:qa-cook:825","status":"complete","apAmount":100,"gpAmount":50,"cityUserId":"resident:self","lifeIndex":4,"significanceReasons":["city:ap_gp_exchange"]}
```

Economy live proof:

- `countsByKind.ap_decay=1`
- `countsByKind.ap_gp_exchange=1`
- `city.attentionDelta=-6733` (`-6833` drain plus `+100` exchange)
- `city.gpNetDelta=-50`
- Event note: `exchanged 50 GP for 100 AP`

Post-wealth:

```json
{"ok":true,"resident":"res:qa-cook","itemId":995,"amount":225}
```

Post-exchange ordinary action evidence:

- `move_to` at AP `104.5` with cause `starter_fishing_find_range`
- `use_item_on` at AP `100.5` with cause `starter_fishing_cook_catch`
- `eat` at AP `96.5` with cause `starter_fishing_eat_cooked_fish_for_space`
- `interact` at AP `57` with cause `starter_fishing_net`

Interpretation:

This is a real named-resident runtime proof. The operator did not call the exchange route directly; it only moved the resident into the survival band. The resident then self-funded AP using real RuneScape coins and continued normal gameplay. The remaining weakness is tuning: `+100 AP` is enough to resume briefly, but the resident decays back toward low-AP quickly.

## Code Fix

Problem:

`ResidentRuntime.submitActionWithWatchdog` correctly intercepted `city_exchange_ap_gp` and routed it to `CityIntegrationService.exchangeApForGp`, but because it bypassed `ResidentBody.submit`, no row appeared in `data/controller/logs/<resident>/actions/*.jsonl`.

Fix:

`ResidentRuntime.executeCityExchangeApForGp` now appends an action-log row for every city exchange attempt, including failure cases before the city service is available or when amounts are invalid.

Focused test:

```bash
npm test -- --runInBand src/controller/resident-runtime.test.ts --testNamePattern='routes city_exchange_ap_gp' --no-coverage
```

Focused suite:

```bash
npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/nervous-system/nervous-system.test.ts src/controller/benchmarks/tasks/self-initiated-ap-gp-exchange-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts --no-coverage
```

Result: 4 suites passed, 121 tests passed.

## Follow-Ups

1. Tune self-exchange amount and trigger band so a resident buys a useful AP runway instead of only a few dozen ticks.
2. Re-run a post-restart named-resident proof and verify `city_exchange_ap_gp` appears in `actions/*.jsonl` from the new build.
3. Keep CQA10 open until unconditioned windows show recurrent `city_ap_gp_exchange`, `trade_completed`/`trade_cancelled`, and lower stuck churn.
