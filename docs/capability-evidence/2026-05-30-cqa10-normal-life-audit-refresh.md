# CQA10 - One-hour multi-resident normal-life audit refresh (2026-05-30)

Packet: `CQA10`  
Issue: `QA-20260529-006`  
Owner: `codex`  
Date: 2026-05-30

## Scope

Repeat the one-hour ordinary controller-life audit after CQA3/CQA4/CQA5 follow-up work and compare whether higher-order behaviors are now visible outside benchmark harnesses.

Window audited:

- UTC: `2026-05-30T11:09:16.234Z` -> `2026-05-30T12:09:16.234Z`
- America/Chicago (CDT): `2026-05-30 06:09:16` -> `2026-05-30 07:09:16`

Source files:

- `data/controller/logs/res:*/actions/*.jsonl` (excluding `res:bmk_*`)
- `data/controller/memory/library/res-*/timeline.jsonl`

## Coverage summary

- Active ordinary residents in window: `23`
- Total action attempts: `2457`
- Successful action submissions (`result.ok=true`): `2434`
- Failed submissions: `23`
- Action success rate: `99.06%`

## Top action kinds (one-hour window)

| Kind | Count |
|---|---:|
| `move_to` | 1388 |
| `say` | 817 |
| `interact` | 150 |
| `use_item_on_item` | 71 |
| `use_item_on` | 11 |
| `eat` | 11 |
| `equip` | 8 |
| `attack` | 1 |

## Top causes (one-hour window)

| Cause | Count |
|---|---:|
| `idle_initiative` | 1145 |
| `stuck_pre_inference_explore` | 239 |
| `explore_patrol` | 224 |
| `woodcutting_level1_routine` | 118 |
| `none` | 102 |
| `faction_landmark_return` | 94 |
| `firemaking_fallback` | 71 |
| `faction_ledger_audit_work` | 51 |
| `starter_fishing_seek_spot` | 49 |
| `faction_bureau_witness_work` | 47 |
| `faction_foundry_fuel_work` | 45 |
| `stuck_move_recovery` | 41 |

## Timeline histogram (one-hour window)

| Timeline kind | Count |
|---|---:|
| `say` | 816 |
| `stuck_detected` | 734 |
| `stuck_recovered` | 557 |
| `first_xp` | 47 |

Not observed in this window: `logout`, `death`, `city_attention_credit`, `city_gold_observed`, `city_gold_burn`, `city_ap_gp_exchange`, `trade_completed`, `trade_cancelled`, `level_up`, `quest_complete`.

## AP life-force signal

- Residents with measurable `attention_after`: `23`
- Residents with net AP drop in window: `13`
- Aggregate drop across dropping residents: `12427`

Top AP drops:

- `res:qa-woodcutter`: `30638.5 -> 29665` (`-973.5`)
- `res:qa-forager`: `32468 -> 31501` (`-967`)
- `res:qa-scout`: `31049 -> 30086.5` (`-962.5`)
- `res:qa-banker`: `32458.5 -> 31497` (`-961.5`)
- `res:qa-survivor`: `31043 -> 30083` (`-960`)

## Delta vs prior CQA10 audit (2026-05-29)

1. Ordinary one-hour liveness remains strong (`99.06%` submit success with all 23 residents active).
2. Equip behavior now appears in ordinary life (`equip=8`) instead of `0`, matching CQA3-live evidence that named residents can equip useful gear outside benchmark harnesses.
3. Trade and combat remain sparse in this sampled hour (`trade_completed=0`, `trade_cancelled=0`, `attack=1`), so ordinary-loop depth is still below the CQA4/CQA5 target confidence.
4. Stuck churn remains high and still dominates non-idle moments.

## Repro commands

```bash
node <ad-hoc JSONL audit script over data/controller/logs and data/controller/memory/library>
```

The ad-hoc script output for this run is captured in the CQA10 working notes and summarized above.
