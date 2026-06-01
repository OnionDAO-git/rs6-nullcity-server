# CQA10 - post-QA004 ordinary-life recurrence audit

Date: 2026-05-31

## TL;DR

Status: **mixed, but materially healthier than the pre-QA004 window**.

- The low-health wait flood stayed fixed: `low_health_heal_wait=0` for the full 30-minute post-QA004 window.
- The stack was alive: 23 residents, 3599 action submissions, 3599 successes, 0 failed submissions.
- Residents continued doing real RuneScape work: woodcutting/firemaking, fishing/cooking/eating, combat seeking/resupply, and a small amount of combat.
- AP pressure remained visible: 13 residents lost AP in-window, aggregate AP drop `17019.5`, and residents emitted 50 AP help requests.
- Unconditioned economy/social closure did **not** recur in this window: `city_exchange_ap_gp=0`, `city_ap_gp_exchange=0`, `trade_completed=0`, `trade_cancelled=0`.
- Stuck churn remains high: `stuck_detected=793`, `stuck_recovered=755`.

The headline: QA004 fixed the catastrophic wait loop; ordinary life is active again; AP/GP exchange and trade closure still need stronger recurrence proof.

## Command

```bash
npm run -s controller:normal-life-audit -- \
  --start=2026-05-31T07:52:17.000Z \
  --end=2026-05-31T08:22:17.000Z \
  --top=30 \
  --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-post-qa004-recurrence
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/cqa10-post-qa004-recurrence/normal_life_audit_20260531T082217Z.json`

## Main Counts

| Signal | Value |
|---|---:|
| Active residents | 23 |
| Action attempts | 3599 |
| Successful submissions | 3599 |
| Failed submissions | 0 |
| Action success rate | 100% |
| Residents with AP drop | 13 |
| Aggregate AP drop | 17019.5 |
| `low_health_heal_wait` | 0 |
| `combat_resupply_food` | 113 |
| `combat_seek_safe_target` | 139 |
| `attack` | 4 |
| `eat` | 39 |
| `use_item_on` | 37 |
| `use_item_on_item` | 108 |
| `first_xp` | 16 |
| `city_exchange_ap_gp` | 0 |
| `city_ap_gp_exchange` | 0 |
| `trade_completed` / `trade_cancelled` | 0 / 0 |
| `death` / `logout` | 0 / 0 |
| `stuck_detected` / `stuck_recovered` | 793 / 755 |

Top action kinds:

| Action kind | Count |
|---|---:|
| `move_to` | 1992 |
| `say` | 1247 |
| `interact` | 172 |
| `use_item_on_item` | 108 |
| `eat` | 39 |
| `use_item_on` | 37 |
| `attack` | 4 |

Top causes:

| Cause | Count |
|---|---:|
| `idle_initiative` | 1463 |
| `explore_patrol` | 264 |
| `stuck_pre_inference_explore` | 254 |
| `woodcutting_level1_routine` | 160 |
| `combat_seek_safe_target` | 139 |
| `combat_resupply_food` | 113 |
| `woodcutting_chain_firemaking` | 107 |
| `nervous:request-attention` | 50 |
| `starter_fishing_net` | 39 |
| `starter_fishing_eat_cooked_fish_for_space` | 39 |
| `starter_fishing_cook_catch` | 37 |

## Resident-Level Notes

The current artifact is top-N histogram based, so I also scanned the raw logs for tracked signals in the same window.

| Resident | Evidence |
|---|---|
| `res:qa-woodcutter` | 316 actions; 112 interacts; 108 `use_item_on_item`; 10 `first_xp` timeline events. |
| `res:qa-cook` | 147 actions; 22 interacts; 18 cooking actions; 20 eats; 3 `first_xp`; 20 stuck / 19 recovered. |
| `res:qa-angler` | 142 actions; 21 interacts; 19 cooking actions; 19 eats; 3 `first_xp`; 17 stuck / 14 recovered. |
| `res:qa-priest` | 129 actions; 43 `combat_seek_safe_target`; 36 `combat_resupply_food`; 23 stuck / 22 recovered. |
| `res:qa-guardian` | 126 actions; 49 `combat_seek_safe_target`; 42 `combat_resupply_food`; 13 stuck / 11 recovered. |
| `res:qa-survivor` | 123 actions; 47 `combat_seek_safe_target`; 35 `combat_resupply_food`; 22 stuck / 22 recovered. |
| `res:severn-vesta` | 129 actions; 4 attacks; 47 stuck / 46 recovered. |

Interpretation:

- Skilling/fishing/cooking are recurring naturally.
- Combat residents are now trying to resupply instead of flooding low-health waits.
- Actual attack volume was low in this window, so combat is safer but not yet rich.
- Stuck detection/recovery is broadly paired but far too frequent for a polished world loop.

## Follow-Up Instrumentation

This window was rerun by CQA10 companion metrics after the audit learned non-truncated tracked maps and resident slices.

Companion artifact:

- `data/benchmarks/capability-qa-2026-05-31/cqa10-companion-metrics/normal_life_audit_20260531T083614Z.json`

That artifact keeps the same behavior verdict but removes the old top-N ambiguity: AP/GP exchange actions/events are explicitly `0`, trade closure is explicitly `0`, low-health waits are `0`, and per-resident `residentSlices` now show stuck, XP, AP drop, combat-resupply, cooking, and eating signals without manual side scans.

## Verdict

QA004 itself remains good: no low-health wait flood recurred after the fix.

CQA10 remains open: ordinary life is active and healthier, but still does not show unconditioned AP/GP exchange, trade completion/cancel, level-up, quest completion, or low stuck churn.

Next best work:

1. Run a fresh 60-120 minute unconditioned soak with the companion metric shape.
2. Use `residentSlices` to decide whether the next behavior fix is AP/GP recurrence, trade recurrence, or stuck-churn/pathing.
3. Add a targeted benchmark/fix for whichever missing signal remains most important after that soak.
