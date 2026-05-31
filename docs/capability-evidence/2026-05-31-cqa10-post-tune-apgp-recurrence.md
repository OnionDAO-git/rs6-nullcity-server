# CQA10 - post-tune AP/GP recurrence audit

## TL;DR

Status: **recurrence proven after controlled setup; broad unconditioned recurrence still needs a longer soak**.

- `S-EXCHANGE-TUNE-1` live-proved the first tuned exchange on `res:qa-trader`: AP drained to 8.5, resident spent 246 GP for 492 AP, and landed at 500 AP.
- Then I stopped touching the resident. It decayed through ordinary runtime from ~500 AP back toward the trigger band.
- At `2026-05-31T06:54:22Z`, `res:qa-trader` self-initiated a **second** AP/GP exchange without operator input: 241 GP item `995` burned for 482 AP, landing at 501.5 AP with 1609 GP remaining.
- A clean post-tune normal-life audit window (`06:45:00Z..06:54:48Z`) captured 23 residents, 2,805 successful actions, 0 failed submissions, `city_exchange_ap_gp=1`, and `city_ap_gp_exchange=1`.

This proves the loop can recur after the first low-AP setup. It does **not** yet prove that unrelated residents will naturally acquire GP, hit low AP, and self-exchange in a fully unconditioned multi-hour life.

## Mixed 30-Minute Audit

Command:

```bash
npm run controller:normal-life-audit -- --duration-ms=1800000 --top=20 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-post-tune-apgp-recurrence
```

Artifact:

`data/benchmarks/capability-qa-2026-05-31/cqa10-post-tune-apgp-recurrence/normal_life_audit_20260531T065224Z.json`

Notes:

- Window: `2026-05-31T06:22:24.884Z..2026-05-31T06:52:24.884Z`
- Residents: 23
- Actions: 9,593
- Submit success: 9,593 / 9,593
- `city_exchange_ap_gp=2`
- `city_ap_gp_exchange=3`
- This window includes the controlled drain/exchange proofs, so it is useful as a live-health artifact, not as clean unconditioned recurrence evidence.

## Clean Post-Tune Window

Command:

```bash
npm run controller:normal-life-audit -- --start=2026-05-31T06:45:00.000Z --end=2026-05-31T06:54:48.000Z --top=20 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-post-tune-apgp-recurrence-clean-slice
```

Artifact:

`data/benchmarks/capability-qa-2026-05-31/cqa10-post-tune-apgp-recurrence-clean-slice/normal_life_audit_20260531T065448Z.json`

Summary:

- Window: `2026-05-31T06:45:00.000Z..2026-05-31T06:54:48.000Z`
- Residents: 23
- Actions: 2,805
- Submit success: 2,805 / 2,805
- Action kinds: `noop=1540`, `move_to=649`, `say=459`, `interact=75`, `use_item_on_item=40`, `eat=15`, `use_item_on=13`, `attack=10`, `item_action=3`, `city_exchange_ap_gp=1`
- Timeline kinds: `say=459`, `stuck_detected=300`, `stuck_recovered=269`, `city_gold_observed=25`, `first_xp=21`, `city_ap_gp_exchange=1`
- Not observed: logout, death, city attention credit, city gold burn, trade completed/cancelled, level up, quest complete

## Recurrence Proof

First tuned exchange from S-EXCHANGE-TUNE-1:

```json
{"t":"2026-05-31T06:44:29.256Z","tick":176,"attention_after":8,"source":"nervous-system","ruleId":"self-initiated-ap-gp-exchange","action":{"kind":"city_exchange_ap_gp","cause":"nervous:self-initiated-ap-gp-exchange","gpAmount":246,"apAmount":492,"idempotencyKey":"self-ap-gp:res:qa-trader:177"},"result":{"ok":true,"status":"complete","exchangeId":"apgp:res:qa-trader:self-ap-gp:res:qa-trader:177","apEvidence":{"creditedAmount":492,"attentionBefore":8,"attentionAfter":500},"gpEvidence":{"itemId":995,"burnedAmount":246,"remainingAmount":1850}}}
```

Then the resident decayed through ordinary ticks:

- `06:53:27Z`: 60 AP, 1850 GP
- `06:53:49Z`: 44 AP, 1850 GP
- `06:54:17Z`: 22.5 AP, 1850 GP
- `06:54:21Z`: 20 AP, 1609 GP after the exchange landed

Second exchange, unassisted:

```json
{"t":"2026-05-31T06:54:22.232Z","tick":431,"attention_after":19.5,"source":"nervous-system","ruleId":"self-initiated-ap-gp-exchange","action":{"kind":"city_exchange_ap_gp","cause":"nervous:self-initiated-ap-gp-exchange","gpAmount":241,"apAmount":482,"idempotencyKey":"self-ap-gp:res:qa-trader:432"},"result":{"ok":true,"status":"complete","exchangeId":"apgp:res:qa-trader:self-ap-gp:res:qa-trader:432","apEvidence":{"creditedAmount":482,"attentionBefore":19.5,"attentionAfter":501.5},"gpEvidence":{"itemId":995,"burnedAmount":241,"remainingAmount":1609}}}
```

Library event:

```json
{"schemaVersion":1,"ts":"2026-05-31T06:54:22.147Z","tick":431,"sessionId":"external","kind":"city_ap_gp_exchange","exchangeId":"apgp:res:qa-trader:self-ap-gp:res:qa-trader:432","status":"complete","apAmount":482,"gpAmount":241,"cityUserId":"resident:self","lifeIndex":5,"significanceReasons":["city:ap_gp_exchange"]}
```

Economy API after `06:53:00Z`:

```json
{
  "countsByKind": {
    "ap_gp_exchange": 1
  },
  "city": {
    "attentionDelta": 482,
    "gpNetDelta": -241
  }
}
```

Post-state:

```json
{"attention":488,"tick":459,"deceased":null,"gp":1609}
```

## Interpretation

The tuned reflex now supports repeated self-funded survival for a GP-rich resident. It is doing the intended thing: as AP decays toward the danger band, the resident uses its own RuneScape coins to buy more time instead of immediately asking humans.

Remaining gap:

We still need a longer, less-instrumented soak that proves residents naturally earn/acquire GP, naturally hit low AP, and self-exchange across multiple residents without an operator-created low-AP setup.

## Follow-Ups

1. Run a 60-120 minute unconditioned normal-life audit after no manual drains for at least 30 minutes.
2. Decide whether 500 AP / 250 GP cap is the right economy balance or whether to tune down toward 300 AP / 150 GP.
3. Add dashboard copy/badging that distinguishes "resident self-funded AP" from patron AP top-ups.
