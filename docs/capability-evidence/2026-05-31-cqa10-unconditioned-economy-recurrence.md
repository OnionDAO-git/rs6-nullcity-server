# CQA10 - Unconditioned Economy Recurrence Audit

Date: 2026-05-31

## TL;DR

Status: useful negative proof. The normal-life audit now separates controlled AP/GP events from organic self-initiated recurrence and reports the latest known GP runway by resident. A no-drain live window stayed healthy, but it did not show organic AP/GP or trade recurrence.

- Added `economySummary` to the normal-life audit artifact.
- The summary counts AP/GP exchanges, self-initiated exchanges, exchanges near an admin drain, organic self-initiated exchanges, admin drains, and resident GP runway.
- Ran a no-drain window from `2026-05-31T09:00:30.000Z` to `2026-05-31T09:16:52.000Z`.
- 23 residents emitted 1996/1996 successful action submissions for 100% submit success.
- `lowHealthWaits=0`; no deaths or logouts.
- Ordinary activity continued: `cookingActions=82`, `eatingActions=20`, `combatResupplyActions=82`, `combatActions=4`, `xpEvents=24`.
- No unconditioned AP/GP or trade closure appeared: `organicSelfInitiatedApGpExchangeEvents=0`, `apGpExchangeActions=0`, `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`.
- GP runway explains the absence: no active resident ended below the `300 AP` self-funding threshold while holding at least `10 GP`; `res:qa-social` requested attention while holding `234 GP`, but ended at `59529 AP`.
- Stuck churn remained visible but below the prior 60m companion soak rate: `stuckDetected=130`, `stuckRecovered=104`.

## Commands

```bash
npm test -- --runInBand src/controller/admin/normal-life-audit.test.ts --no-coverage
npm run -s controller:normal-life-audit -- --start=2026-05-31T09:00:30.000Z --end=2026-05-31T09:16:52.000Z --top=40 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-unconditioned-economy-recurrence
npm run check:no-ui
npm run typecheck
npm run build
```

Artifact: `data/benchmarks/capability-qa-2026-05-31/cqa10-unconditioned-economy-recurrence/normal_life_audit_20260531T091659Z.json`

## Audit Shape Added

`normal-life-audit` now writes:

| Field | Meaning |
|---|---|
| `economyEventsInWindow` | economy JSONL rows inside the audit window |
| `apGpExchangeEvents` | all AP/GP exchange economy events inside the window |
| `selfInitiatedApGpExchangeEvents` | exchange events with `cityUserId=resident:self` |
| `controlledApGpExchangeEvents` | exchanges within 10 minutes of an `admin_drain:<resident>:` AP decay |
| `organicSelfInitiatedApGpExchangeEvents` | self-initiated exchanges not classified as controlled |
| `latestGpByResident` | latest observed coin item `995` count at or before the window end |
| `lowApWithGpResidents` | active residents below `300 AP` with at least `10 GP` observed |
| `requestAttentionWithGpResidents` | active request-attention residents with at least `10 GP` observed |

The GP observations are latest-known evidence, not a fresh in-window inventory scan. Each row includes `observedAt` so stale holdings are visible.

## Recurrence Summary

| Metric | Count |
|---|---:|
| activeResidents | 23 |
| totalActionAttempts | 1996 |
| successfulActionSubmissions | 1996 |
| failedActionSubmissions | 0 |
| actionSuccessRate | 100 |
| apGpExchangeActions | 0 |
| apGpExchangeEvents | 0 |
| tradeRequests | 0 |
| tradeCompleted | 0 |
| tradeCancelled | 0 |
| combatActions | 4 |
| eatingActions | 20 |
| cookingActions | 82 |
| lowHealthWaits | 0 |
| combatResupplyActions | 82 |
| xpEvents | 24 |
| levelUps | 0 |
| deaths | 0 |
| logouts | 0 |
| stuckDetected | 130 |
| stuckRecovered | 104 |

## Economy Summary

| Metric | Count |
|---|---:|
| economyEventsInWindow | 0 |
| apGpExchangeEvents | 0 |
| selfInitiatedApGpExchangeEvents | 0 |
| controlledApGpExchangeEvents | 0 |
| organicSelfInitiatedApGpExchangeEvents | 0 |
| adminDrainEvents | 0 |
| attentionRunwayThresholdAp | 300 |
| minimumExchangeGp | 10 |
| lowApWithGpResidents | 0 |
| requestAttentionWithGpResidents | 1 |

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
| `res:qa-social` | 59529 | 234 | 1 | `2026-05-31T08:56:20.363Z` |

No resident had both low AP and enough latest-known GP, so the no-fire result is expected for this window rather than evidence that the self-funding route ignored an eligible resident.

## Companion Counts

Tracked actions:

| Kind | Count |
|---|---:|
| city_exchange_ap_gp | 0 |
| trade_request | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| attack | 4 |
| eat | 20 |
| interact | 112 |
| use_item_on | 22 |
| use_item_on_item | 60 |
| item_action | 2 |
| equip | 0 |

Tracked causes:

| Cause | Count |
|---|---:|
| nervous:self-initiated-ap-gp-exchange | 0 |
| nervous:request-attention | 32 |
| low_health_heal_wait | 0 |
| combat_attack_safe_target | 1 |
| combat_seek_safe_target | 82 |
| combat_resupply_food | 82 |
| combat_loot_pickup | 1 |
| combat_bury_looted_bones | 2 |
| starter_fishing_net | 21 |
| starter_fishing_cook_catch | 21 |
| starter_fishing_eat_cooked_fish_for_space | 20 |
| direct_chat_trade | 0 |

Tracked timeline:

| Kind | Count |
|---|---:|
| say | 707 |
| first_xp | 24 |
| stuck_detected | 130 |
| stuck_recovered | 104 |
| city_gold_observed | 0 |
| city_gold_burn | 0 |
| city_ap_gp_exchange | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| logout | 0 |
| death | 0 |

## Interpretation

The audit now answers the exact question that the prior 10m post-restart proof could not: was the AP/GP event organic or induced by the admin drain? In this window there were no admin drains and no AP/GP events at all, so broad unconditioned recurrence remains open.

The absence is not a threshold bug in this slice. Latest-known GP shows several residents hold enough GP, but none of those active residents were below the `300 AP` self-funding trigger during the no-drain window. Conversely, the low-AP pressure was not paired with fresh GP runway. That points the next AP/GP work toward GP-earning/GP-distribution cadence and longer unconditioned windows, not another threshold tweak.

The QA004 low-health wait fix stayed healthy under the same window, and ordinary cooking/eating/resupply/XP signals continued. Trade closure remains absent.

## Follow-ups

1. Run a longer 30-60m no-drain audit with the new `economySummary` fields and compare low-AP+GP eligibility over time.
2. Add or run a fresh GP inventory scan near the audit end so `latestGpByResident` is less stale.
3. If low-AP residents still lack GP, continue GP-earning/distribution work before retuning self-funding.
4. Keep trade closure open until ordinary windows show repeated `trade_request`, `trade_completed`, and `trade_cancelled`.
