# CQA10 - companion metrics for normal-life audit

Date: 2026-05-31

## TL;DR

Status: **instrumentation shipped and rerun on the post-QA004 window**.

- Added native, non-truncated `trackedActionCounts`, `trackedCauseCounts`, `trackedTimelineCounts`, `recurrenceSummary`, and `residentSlices` fields to `normal-life-audit`.
- Reran the exact post-QA004 window with the new artifact shape.
- The new artifact preserves the same verdict without manual raw-log side scans: ordinary life is active and healthier, but AP/GP exchange and trade closure still did not recur organically.

## Code Change

`src/controller/admin/normal-life-audit.ts` now emits:

- `trackedActionCounts`: fixed AP/GP, trade, combat, eating, cooking, equipment action-count map, including zeros.
- `trackedCauseCounts`: fixed AP/GP, AP-help, low-health, combat-resupply, fishing/cooking cause-count map, including zeros.
- `trackedTimelineCounts`: fixed death/logout/AP/GP/trade/XP/stuck/speech timeline-count map, including zeros.
- `recurrenceSummary`: compact release-facing rollup for AP/GP, trade, combat/eating/cooking, low-health waits, XP, death/logout, and stuck churn.
- `residentSlices`: per-resident action totals, failures, AP drop, and tracked action/cause/timeline maps.
- `residentSignalSummary`: backward-compatible alias for `residentSlices`.

The focused unit test proves these tracked signals survive even when `--top=1` hides them from the normal top-N histograms.

## Rerun Command

```bash
npm run -s controller:normal-life-audit -- \
  --start=2026-05-31T07:52:17.000Z \
  --end=2026-05-31T08:22:17.000Z \
  --top=30 \
  --output-dir=data/benchmarks/capability-qa-2026-05-31/cqa10-companion-metrics
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/cqa10-companion-metrics/normal_life_audit_20260531T083614Z.json`

## Recurrence Summary

| Signal | Count |
|---|---:|
| `apGpExchangeActions` | 0 |
| `apGpExchangeEvents` | 0 |
| `tradeRequests` | 0 |
| `tradeCompleted` | 0 |
| `tradeCancelled` | 0 |
| `combatActions` | 4 |
| `eatingActions` | 39 |
| `cookingActions` | 145 |
| `lowHealthWaits` | 0 |
| `combatResupplyActions` | 113 |
| `xpEvents` | 16 |
| `levelUps` | 0 |
| `deaths` | 0 |
| `logouts` | 0 |
| `stuckDetected` | 793 |
| `stuckRecovered` | 755 |

Tracked details also show:

- `nervous:request-attention=50`
- `combat_seek_safe_target=139`
- `starter_fishing_net=39`
- `starter_fishing_cook_catch=37`
- `starter_fishing_eat_cooked_fish_for_space=39`

## Resident Signal Examples

| Resident | Actions | AP drop | Key tracked signals |
|---|---:|---:|---|
| `res:qa-woodcutter` | 316 | 1325 | `use_item_on_item=108`, `first_xp=10`, no stuck churn |
| `res:qa-cook` | 147 | 1306.5 | `eat=20`, `use_item_on=18`, `first_xp=3`, `stuck=20/19` |
| `res:qa-angler` | 142 | 1321.5 | `eat=19`, `use_item_on=19`, `first_xp=3`, `stuck=17/14` |
| `res:qa-priest` | 129 | 1281.5 | `combat_seek_safe_target=43`, `combat_resupply_food=36`, `stuck=23/22` |
| `res:qa-guardian` | 126 | 1313.5 | `combat_seek_safe_target=49`, `combat_resupply_food=42`, `stuck=13/11` |
| `res:qa-survivor` | 123 | 1290 | `combat_seek_safe_target=47`, `combat_resupply_food=35`, `stuck=22/22` |
| `res:qa-trader` | 74 | 1312.5 | no AP/GP exchange or trade request; `stuck=63/61` |

## Interpretation

The previous CQA10 verdict is now backed by artifact-native companion metrics rather than a manual side scan:

- QA004's low-health wait flood fix held (`lowHealthWaits=0`).
- Fishing/cooking/eating and combat-resupply behavior stayed active.
- AP pressure stayed real, with multiple named residents dropping roughly 1290-1325 AP in the window.
- AP/GP exchange and trade closure still did not recur organically (`0` action events and `0` timeline events).
- Stuck churn remains the highest visible liveness tax (`793/755`).

## Follow-Ups

1. Run a fresh 60-120 minute unconditioned CQA10 window with this artifact shape.
2. Use `residentSlices` to choose the next behavior fix: AP/GP recurrence, trade recurrence, or stuck-churn/pathing.
3. Consider adding dashboard ingestion for `recurrenceSummary` so operators can distinguish "healthy active loop" from "active but missing economy/social closure."
