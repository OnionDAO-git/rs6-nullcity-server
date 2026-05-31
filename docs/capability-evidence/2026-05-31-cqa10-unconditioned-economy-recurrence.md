# CQA10 - Unconditioned Economy Recurrence Audit

Date: 2026-05-31

## TL;DR

Status: positive organic AP/GP proof. The normal-life audit now separates controlled AP/GP events from organic self-initiated recurrence and carries forward latest-known GP observations by resident. A no-drain live window then captured a resident organically spending real RuneScape GP item `995` for AP without an operator drain.

- Added `economySummary` to the normal-life audit artifact.
- The summary counts AP/GP exchanges, self-initiated exchanges, exchanges near an admin drain, organic self-initiated exchanges, admin drains, and resident GP runway.
- Hardened the summary after sidecar review: admin drains just before the audit window still classify nearby exchanges as controlled, GP observations compare parsed timestamps, and self-initiated exchange counts require `self-ap-gp` in the exchange ref.
- Ran a no-drain window from `2026-05-31T09:00:30.000Z` to `2026-05-31T09:23:00.000Z`.
- 23 residents emitted 2385/2385 successful action submissions for 100% submit success.
- `lowHealthWaits=0`; no deaths or logouts.
- Organic AP/GP recurrence appeared: `res:qa-guide` emitted `city_exchange_ap_gp`, burned `101 GP`, and received `202 AP`.
- Ordinary activity continued: `cookingActions=100`, `eatingActions=22`, `combatResupplyActions=96`, `combatActions=7`, `xpEvents=40`.
- Trade closure remains absent: `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`.
- Stuck churn remains visible but lower than the prior 60m companion-soak rate: `stuckDetected=167`, `stuckRecovered=128`.

## Commands

```bash
npm test -- --runInBand src/controller/admin/normal-life-audit.test.ts --no-coverage
npm run check:no-ui
npm run build
npm run fin
npm run -s controller:normal-life-audit -- --start 2026-05-31T09:00:30.000Z --end 2026-05-31T09:23:00.000Z --top=40 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-unconditioned-economy-recurrence
```

Artifact: `data/benchmarks/capability-qa-2026-05-31/cqa10-unconditioned-economy-recurrence/normal_life_audit_20260531T092301Z.json`

Verification rerun artifact: `data/benchmarks/capability-qa-2026-05-31/cqa10-unconditioned-economy-recurrence/normal_life_audit_20260531T092910Z.json` reproduced the same window totals: 23 residents, 2385/2385 actions, `lowHealthWaits=0`, `organicSelfInitiatedApGpExchangeEvents=1`, and trade counts still `0`.

## Audit Shape Added

`normal-life-audit` now writes:

| Field | Meaning |
|---|---|
| `economyEventsInWindow` | economy JSONL rows inside the audit window |
| `apGpExchangeEvents` | all AP/GP exchange economy events inside the window |
| `selfInitiatedApGpExchangeEvents` | exchange events with `cityUserId=resident:self` and a `self-ap-gp` ref |
| `controlledApGpExchangeEvents` | exchanges within 10 minutes of an `admin_drain:<resident>:` AP decay, including drains just before the audit window |
| `organicSelfInitiatedApGpExchangeEvents` | self-initiated exchanges not classified as controlled |
| `latestGpByResident` | latest observed coin item `995` count at or before the window end |
| `lowApWithGpResidents` | active residents below `300 AP` with at least `10 GP` observed |
| `requestAttentionWithGpResidents` | active request-attention residents with at least `10 GP` observed |

The GP observations are latest-known evidence, not a fresh in-window inventory scan. Each row includes `observedAt` so stale holdings are visible.

## Recurrence Summary

| Metric | Count |
|---|---:|
| activeResidents | 23 |
| totalActionAttempts | 2385 |
| successfulActionSubmissions | 2385 |
| failedActionSubmissions | 0 |
| actionSuccessRate | 100 |
| apGpExchangeActions | 1 |
| apGpExchangeEvents | 1 |
| tradeRequests | 0 |
| tradeCompleted | 0 |
| tradeCancelled | 0 |
| combatActions | 7 |
| eatingActions | 22 |
| cookingActions | 100 |
| lowHealthWaits | 0 |
| combatResupplyActions | 96 |
| xpEvents | 40 |
| levelUps | 0 |
| deaths | 0 |
| logouts | 0 |
| stuckDetected | 167 |
| stuckRecovered | 128 |

## Economy Summary

| Metric | Count |
|---|---:|
| economyEventsInWindow | 1 |
| apGpExchangeEvents | 1 |
| selfInitiatedApGpExchangeEvents | 1 |
| controlledApGpExchangeEvents | 0 |
| organicSelfInitiatedApGpExchangeEvents | 1 |
| adminDrainEvents | 2 |
| attentionRunwayThresholdAp | 300 |
| minimumExchangeGp | 10 |
| lowApWithGpResidents | 0 |
| requestAttentionWithGpResidents | 1 |

Organic exchange event:

```json
{"ts":"2026-05-31T09:20:12.371Z","kind":"ap_gp_exchange","residentName":"res:qa-guide","cityUserId":"resident:self","apDelta":202,"gpDelta":-101,"refId":"apgp:res:qa-guide:self-ap-gp:res:qa-guide:10","note":"exchanged 101 GP for 202 AP"}
```

Resident-slice evidence:

| Resident | AP first | AP last | AP drop | Exchange actions | Exchange timeline events |
|---|---:|---:|---:|---:|---:|
| `res:qa-guide` | 1233.5 | 493 | 740.5 | 1 | 1 |

Latest known non-zero GP observations at or before the window end:

| Resident | GP | Observed at |
|---|---:|---|
| `res:agent` | 24133 | `2026-05-31T06:26:17.618Z` |
| `res:qa-trader` | 1368 | `2026-05-31T08:56:20.519Z` |
| `res:qa-social` | 234 | `2026-05-31T08:56:20.363Z` |
| `res:qa-cook` | 225 | `2026-05-31T08:56:20.739Z` |
| `res:qa-guide` | 125 | `2026-05-31T08:58:52.740Z` |
| `res:qa-forager` | 25 | `2026-05-31T08:58:52.647Z` |
| `res:qa-angler` | 9 | `2026-05-31T08:56:20.444Z` |

The only request-attention resident with enough observed GP was:

| Resident | AP last | GP | Request-attention actions | GP observed at |
|---|---:|---:|---:|---|
| `res:qa-social` | 59186 | 234 | 1 | `2026-05-31T08:56:20.363Z` |

## Companion Counts

Tracked actions:

| Kind | Count |
|---|---:|
| city_exchange_ap_gp | 1 |
| trade_request | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| attack | 7 |
| eat | 22 |
| interact | 121 |
| use_item_on | 29 |
| use_item_on_item | 71 |
| item_action | 2 |
| equip | 0 |

Tracked causes:

| Cause | Count |
|---|---:|
| nervous:self-initiated-ap-gp-exchange | 1 |
| nervous:request-attention | 36 |
| low_health_heal_wait | 0 |
| combat_attack_safe_target | 2 |
| combat_seek_safe_target | 96 |
| combat_resupply_food | 96 |
| combat_loot_pickup | 1 |
| combat_bury_looted_bones | 3 |
| starter_fishing_net | 21 |
| starter_fishing_cook_catch | 21 |
| starter_fishing_eat_cooked_fish_for_space | 22 |
| direct_chat_trade | 0 |

Tracked timeline:

| Kind | Count |
|---|---:|
| say | 775 |
| first_xp | 40 |
| stuck_detected | 167 |
| stuck_recovered | 128 |
| city_ap_gp_exchange | 1 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| logout | 0 |
| death | 0 |

## Interpretation

This closes the narrow "will an ordinary resident with real GP organically spend it for AP when the AP runway gets low?" question for one resident. `res:qa-guide` crossed the no-floor runway band, spent real GP item `995`, and recovered AP without a directed drain inside the no-drain window.

This does **not** close the broader economy loop. We still need repeated multi-resident recurrence, fresher GP inventory snapshots, ordinary GP earning/distribution, and trade completion/cancel recurrence. The audit now makes those gaps visible without hand-scanning economy logs.

The QA004 low-health wait fix stayed healthy under the same window, and ordinary cooking/eating/resupply/XP signals continued. Trade closure remains absent.

## Follow-ups

1. Run a longer 30-60m no-drain audit with the new `economySummary` fields and verify repeated organic AP/GP events.
2. Add or run a fresh GP inventory scan near the audit end so `latestGpByResident` is less stale.
3. If low-AP residents still lack GP, continue GP-earning/distribution work before retuning self-funding.
4. Keep trade closure open until ordinary windows show repeated `trade_request`, `trade_completed`, and `trade_cancelled`.
