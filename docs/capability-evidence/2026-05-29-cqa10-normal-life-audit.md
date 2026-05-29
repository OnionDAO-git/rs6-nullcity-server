# CQA10 - One-hour multi-resident normal-life audit (2026-05-29)

Packet: `CQA10`  
Issue: `QA-20260529-006`  
Owner: `codex`  
Date: 2026-05-29

## Scope

Run a fresh one-hour audit over ordinary controller logs (not benchmark residents) and produce:

- Multi-resident activity coverage.
- Cause histogram.
- Capability deltas vs current matrix claims.

Window audited:

- UTC: `2026-05-29T01:41:00Z` -> `2026-05-29T02:41:00Z`
- America/Chicago (CDT): `2026-05-28 20:41:00` -> `2026-05-28 21:41:00`

Source files:

- `data/controller/logs/res:*/actions/2026-05-29.jsonl` (excluding `res:bmk_*`)
- `data/controller/memory/library/res-*/timeline.jsonl`

## Coverage summary

- Active ordinary residents in window: `23`
- Total action attempts: `7424`
- Successful action submissions (`result.ok=true`): `7386`
- Failed submissions: `38`
- Action success rate: `99.49%`

## Top action kinds (one-hour window)

| Kind | Count |
|---|---:|
| `move_to` | 4135 |
| `say` | 2531 |
| `interact` | 387 |
| `use_item_on_item` | 229 |
| `eat` | 73 |
| `use_item_on` | 68 |
| `attack` | 1 |
| `equip` / `wield` / `wear` | 0 / 0 / 0 |

## Top causes (one-hour window)

| Cause | Count |
|---|---:|
| `idle_initiative` | 3088 |
| `stuck_pre_inference_explore` | 774 |
| `explore_patrol` | 701 |
| `none` | 491 |
| `woodcutting_level1_routine` | 347 |
| `faction_landmark_return` | 246 |
| `firemaking_fallback` | 229 |
| `stuck_move_recovery` | 163 |
| `faction_ledger_audit_work` | 158 |
| `nervous:request-attention` | 91 |
| `starter_fishing_net` | 74 |
| `combat_seek_safe_target` | 69 |
| `opportunistic_pickup` | 58 |

## Timeline histogram (one-hour window)

| Timeline kind | Count |
|---|---:|
| `say` | 2535 |
| `stuck_detected` | 2091 |
| `stuck_recovered` | 2072 |
| `first_xp` | 12 |

Not observed in this window: `logout`, `death`, `city_attention_credit`, `city_gold_observed`, `city_gold_burn`, `city_ap_gp_exchange`, `trade_completed`, `trade_cancelled`, `level_up`, `quest_complete`.

## AP life-force signal

`attention_after` values dropped across all 23 residents during the one-hour window.

- Residents with measurable drop: `23/23`
- Aggregate drop across residents: `35543.5`

Top AP drops (sample):

- `res:qa-woodcutter`: `39687.5 -> 36938` (`-2749.5`)
- `res:qa-scout`: `40097.5 -> 37352` (`-2745.5`)
- `res:qa-banker`: `41506.5 -> 38762` (`-2744.5`)

## Capability deltas from this audit

1. Strong live proof remains for movement + voice loops (`move_to`, `say` dominate volume).
2. Stuck recovery is active in normal life (`stuck_detected` and `stuck_recovered` both >2k events in one hour), but stuck churn remains high.
3. AP pressure behavior is visible (`nervous:request-attention` appeared 91 times) and attention decayed for all audited residents.
4. Normal-loop combat/trade/equip proof remains weak in this hour:
   - `attack=1`
   - `trade_*` actions all `0`
   - `equip`/`wield`/`wear` actions all `0`

## Repro commands

```bash
node <ad-hoc JSONL audit script over data/controller/logs and data/controller/memory/library>
```

Ad-hoc audit scripts were executed in this run and summarized directly in this evidence note.
