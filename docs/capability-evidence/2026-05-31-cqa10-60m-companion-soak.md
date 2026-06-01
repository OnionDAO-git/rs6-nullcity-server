# CQA10 - 60m companion-metric normal-life soak

Date: 2026-05-31

## TL;DR

Status: mixed. The ordinary loop is alive, the QA004 low-health wait flood stayed fixed, and residents showed real skilling/combat-support activity, but economy/social closure still did not recur organically.

- Ran a fresh 60m normal-life audit using the native companion metric shape.
- 23 residents emitted 7410/7410 successful action submissions for 100% submit success.
- `lowHealthWaits=0`; no deaths or logouts.
- Skilling/survival signals stayed active: `cookingActions=294`, `eatingActions=74`, `combatResupplyActions=181`, `xpEvents=38`.
- AP pressure was visible across 13/23 residents, with aggregate in-window AP drop `35984`.
- Still no unconditioned AP/GP or trade closure: `apGpExchangeActions=0`, `apGpExchangeEvents=0`, `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`.
- Stuck churn stayed high: `stuckDetected=1714`, `stuckRecovered=1592`.

## Command

```bash
npm run -s controller:normal-life-audit -- --duration-ms=3600000 --top=40 --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-60m-companion-soak
```

Artifact: `data/benchmarks/capability-qa-2026-05-31/cqa10-60m-companion-soak/normal_life_audit_20260531T084257Z.json`

Window: `2026-05-31T07:42:57.073Z` to `2026-05-31T08:42:57.073Z`

## Recurrence Summary

| Metric | Count |
|---|---:|
| activeResidents | 23 |
| totalActionAttempts | 7410 |
| successfulActionSubmissions | 7410 |
| failedActionSubmissions | 0 |
| actionSuccessRate | 100 |
| apGpExchangeActions | 0 |
| apGpExchangeEvents | 0 |
| tradeRequests | 0 |
| tradeCompleted | 0 |
| tradeCancelled | 0 |
| combatActions | 4 |
| eatingActions | 74 |
| cookingActions | 294 |
| lowHealthWaits | 0 |
| combatResupplyActions | 181 |
| xpEvents | 38 |
| levelUps | 0 |
| deaths | 0 |
| logouts | 0 |
| stuckDetected | 1714 |
| stuckRecovered | 1592 |

## Companion Counts

Tracked actions:

| Kind | Count |
|---|---:|
| move_to | 4139 |
| say | 2537 |
| interact | 362 |
| use_item_on_item | 223 |
| eat | 74 |
| use_item_on | 71 |
| attack | 4 |
| city_exchange_ap_gp | 0 |
| trade_request | 0 |
| trade_offer_item | 0 |
| trade_accept_stage_1 | 0 |
| trade_accept_stage_2 | 0 |
| trade_decline | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| item_action | 0 |
| equip | 0 |

Tracked causes:

| Cause | Count |
|---|---:|
| idle_initiative | 3011 |
| explore_patrol | 582 |
| stuck_pre_inference_explore | 552 |
| woodcutting_level1_routine | 343 |
| combat_seek_safe_target | 261 |
| woodcutting_chain_firemaking | 220 |
| faction_landmark_return | 216 |
| faction_landmark_recovery | 183 |
| combat_resupply_food | 181 |
| stuck_move_recovery | 163 |
| nervous:request-attention | 80 |
| starter_fishing_net | 76 |
| starter_fishing_eat_cooked_fish_for_space | 74 |
| starter_fishing_cook_catch | 71 |
| nervous:self-initiated-ap-gp-exchange | 0 |
| direct_chat_trade | 0 |

Tracked timeline:

| Kind | Count |
|---|---:|
| say | 2537 |
| stuck_detected | 1714 |
| stuck_recovered | 1592 |
| first_xp | 38 |
| logout | 0 |
| death | 0 |
| city_attention_credit | 0 |
| city_gold_observed | 0 |
| city_gold_burn | 0 |
| city_ap_gp_exchange | 0 |
| trade_completed | 0 |
| trade_cancelled | 0 |
| level_up | 0 |
| quest_complete | 0 |

## Resident Slices

| Resident | Actions | AP first | AP last | AP drop | Notable signals |
|---|---:|---:|---:|---:|---|
| `res:qa-woodcutter` | 661 | 57203 | 54420.5 | 2782.5 | `use_item_on_item=223`, `interact=231`, `first_xp=25`, stuck `1/1` |
| `res:qa-cook` | 310 | 56637 | 53879.5 | 2757.5 | `eat=37`, `first_xp=7`, stuck `41/39` |
| `res:qa-angler` | 306 | 2956 | 181.5 | 2774.5 | `eat=37`, `first_xp=5`, stuck `35/31` |
| `res:qa-priest` | 247 | 4924.5 | 2191.5 | 2733 | `combat_resupply_food=58`, stuck `58/56` |
| `res:qa-guardian` | 245 | 2830 | 78 | 2752 | `combat_resupply_food=68`, low ending AP, stuck `47/42` |
| `res:qa-survivor` | 231 | 3395 | 642 | 2753 | `combat_resupply_food=55`, `first_xp=1`, stuck `61/58` |
| `res:qa-trader` | 161 | 58759.5 | 55990 | 2769.5 | no trade/APGP action, stuck `128/125` |
| `res:qa-social` | 149 | 2877.5 | 99.5 | 2778 | low ending AP, no trade/APGP action, stuck `153/148` |

Highest stuck churn residents:

| Resident | Stuck detected/recovered | Actions | AP last |
|---|---:|---:|---:|
| `res:qa-banker` | 165/163 | 268 | 2036 |
| `res:qa-social` | 153/148 | 149 | 99.5 |
| `res:qa-guide` | 153/151 | 268 | 2073 |
| `res:agent` | 152/148 | 148 | 29606 |
| `res:qa-forager` | 139/137 | 282 | 2155 |
| `res:qa-trader` | 128/125 | 161 | 55990 |
| `res:qa-scout` | 120/119 | 293 | 524 |
| `res:severn-vesta` | 102/96 | 268 | 5000 |

## Interpretation

The stack is behaving like a live city rather than an idle harness: residents moved, spoke, cooked, ate, resupplied, and gained XP over a full hour with no action-submit failures. The QA004 low-health wait flood held at zero, which is the main positive regression signal.

The negative signal is sharper now that the audit emits resident slices and zero-filled recurrence metrics. Residents reached low AP (`res:qa-guardian` ended at `78`, `res:qa-social` at `99.5`, `res:qa-angler` at `181.5`) but none emitted `city_exchange_ap_gp` and no `city_ap_gp_exchange` timeline event appeared. Because `city_gold_observed=0`, the next AP/GP packet should inspect whether low-AP residents actually held coin item `995` or had a reliable GP acquisition path before tuning exchange thresholds again.

Trade closure also stayed absent. `res:qa-trader` remained high-AP but produced no `trade_request`, so the next social/economy pass should not treat trade as recurring ordinary behavior yet.

Stuck churn is the other clear follow-up. The top cause cluster includes `stuck_pre_inference_explore`, `faction_landmark_return`, `faction_landmark_recovery`, and `stuck_move_recovery`; several residents recovered frequently but spent too much of the window in route churn.

## Follow-ups

1. AP/GP recurrence root cause: for low-ending-AP residents, inspect real inventory coin item `995`, `city_gold_observed`, and GP acquisition evidence. If GP is missing, continue the GP earning route rather than retuning exchange thresholds blindly.
2. Stuck churn reduction: rank `stuck_pre_inference_explore`, faction return/recovery, and resident-specific churn before changing planner behavior.
3. Keep trade closure open until ordinary windows show repeated `trade_request`, `trade_completed`, and `trade_cancelled` outside directed soaks.
