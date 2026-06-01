# CQA10 - Post-Restart Recurrence Early Audit

Date: 2026-05-31

## TL;DR

Status: improved but not closed. The rebuilt controller is alive after the AP/GP runway and stuck-churn fixes, the low-health wait flood stayed gone, and the audit now captures a real self-initiated AP/GP exchange event in the normal-life stream. The AP/GP event came from the bounded `res:qa-banker` drain proof, so this is post-restart runtime proof rather than broad unconditioned recurrence.

- Ran a 10m post-restart normal-life audit once controller uptime passed 10 minutes.
- 23 residents emitted 1283/1283 successful action submissions for 100% submit success.
- `lowHealthWaits=0`; no deaths or logouts.
- AP/GP signal appeared: `apGpExchangeActions=1`, `apGpExchangeEvents=1`, cause `nervous:self-initiated-ap-gp-exchange`.
- The AP/GP resident was `res:qa-banker`: tick `470` burned `125` real GP item `995`, credited `250 AP`, and left `0 GP`.
- Skilling/survival remained active: `cookingActions=54`, `eatingActions=15`, `combatResupplyActions=43`, `combatActions=2`, `xpEvents=8`.
- Trade closure remains absent: `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`.
- Stuck churn was much lower than the prior 60m soak but still visible: `stuckDetected=76`, `stuckRecovered=79`.

## Command

```bash
npm run -s controller:normal-life-audit -- --duration-ms=600000 --top=40 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-post-restart-recurrence-early
```

Artifact: `data/benchmarks/capability-qa-2026-05-31/cqa10-post-restart-recurrence-early/normal_life_audit_20260531T090612Z.json`

Window: `2026-05-31T08:56:12.575Z` to `2026-05-31T09:06:12.575Z`

## Recurrence Summary

| Metric | Count |
|---|---:|
| activeResidents | 23 |
| totalActionAttempts | 1283 |
| successfulActionSubmissions | 1283 |
| failedActionSubmissions | 0 |
| actionSuccessRate | 100 |
| apGpExchangeActions | 1 |
| apGpExchangeEvents | 1 |
| tradeRequests | 0 |
| tradeCompleted | 0 |
| tradeCancelled | 0 |
| combatActions | 2 |
| eatingActions | 15 |
| cookingActions | 54 |
| lowHealthWaits | 0 |
| combatResupplyActions | 43 |
| xpEvents | 8 |
| levelUps | 0 |
| deaths | 0 |
| logouts | 0 |
| stuckDetected | 76 |
| stuckRecovered | 79 |

## AP/GP Evidence

The normal-life artifact's `residentSlices` isolate the AP/GP event to `res:qa-banker`:

| Signal | Count |
|---|---:|
| `city_exchange_ap_gp` action | 1 |
| `nervous:self-initiated-ap-gp-exchange` cause | 1 |
| `city_ap_gp_exchange` timeline event | 1 |
| `city_gold_observed` timeline events | 2 |

Direct refs:

- `data/controller/memory/res-qa-banker/evidence/trajectory/20260531T085509Z-local-21004-res-qa-banker-1780217709478.jsonl`: tick `470` emitted `city_exchange_ap_gp` with `gpAmount=125`, `apAmount=250`, and cause `nervous:self-initiated-ap-gp-exchange`.
- Same trajectory file, tick `470` action result: `attentionBefore=223`, `attentionAfter=473`, `itemId=995`, `burnedAmount=125`, `remainingAmount=0`.
- `data/controller/memory/city-integration/economy-events.jsonl`: event `df3a7818-b0a8-41a0-b814-a647bc27b3eb`, `apDelta=250`, `gpDelta=-125`, `cityUserId=resident:self`.

This is important runtime proof because it happened after the rebuilt controller restarted onto the no-floor runway threshold. It should not be counted as broad organic recurrence because the low-AP condition was created by the bounded operator AP drain documented in `docs/capability-evidence/2026-05-31-s-exchange-runway-1.md`.

## Companion Counts

Tracked actions:

| Kind | Count |
|---|---:|
| city_exchange_ap_gp | 1 |
| attack | 2 |
| eat | 15 |
| interact | 59 |
| use_item_on | 15 |
| use_item_on_item | 39 |
| item_action | 2 |
| trade_request | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| equip | 0 |

Tracked causes:

| Cause | Count |
|---|---:|
| nervous:self-initiated-ap-gp-exchange | 1 |
| nervous:request-attention | 13 |
| combat_attack_safe_target | 2 |
| combat_seek_safe_target | 44 |
| combat_resupply_food | 43 |
| combat_loot_pickup | 2 |
| combat_bury_looted_bones | 2 |
| starter_fishing_net | 16 |
| starter_fishing_cook_catch | 14 |
| starter_fishing_eat_cooked_fish_for_space | 15 |
| low_health_heal_wait | 0 |
| direct_chat_trade | 0 |

Tracked timeline:

| Kind | Count |
|---|---:|
| say | 461 |
| city_gold_observed | 12 |
| city_ap_gp_exchange | 1 |
| first_xp | 8 |
| stuck_detected | 76 |
| stuck_recovered | 79 |
| logout | 0 |
| death | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| level_up | 0 |

## Interpretation

The restart did not regress the QA004 low-health fix: the 10m window stayed at `lowHealthWaits=0` while cooking, eating, resupply, combat, and XP signals continued. Stuck churn also looks materially lower than the prior 60m companion soak, but this short window is not enough to declare the stuck-churn issue closed.

The AP/GP path is now visible in the normal-life audit output after restart. That closes the narrow "is the rebuilt runtime really emitting the new route?" question. It does not close the broader CQA10/QA-20260529-006 question because the event was induced by the controlled banker drain and trade still did not recur.

## Follow-ups

1. Run a 30-60m post-restart unconditioned CQA10 window with no directed AP drain and check whether AP/GP recurrence appears for ordinary residents holding real GP.
2. Inspect low-AP residents' item `995` holdings and GP-earning paths if the longer window still has no AP/GP recurrence.
3. Keep trade closure open until ordinary windows show `trade_request`, `trade_completed`, and `trade_cancelled` outside directed soaks.
4. Keep watching stuck churn over a longer window before tuning again.
