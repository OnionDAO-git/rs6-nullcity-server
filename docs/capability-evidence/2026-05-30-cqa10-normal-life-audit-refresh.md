# CQA10 - One-hour multi-resident normal-life audit refresh (2026-05-30)

Packet: `CQA10`  
Issue: `QA-20260529-006`  
Owner: `codex`  
Date: 2026-05-30

## Scope

Repeat the one-hour ordinary controller-life audit after CQA3/CQA4/CQA5 follow-up work and compare whether higher-order behaviors are now visible outside benchmark harnesses.
Also replace the prior ad-hoc process with a reproducible CLI artifact generator.

Window audited:

- UTC: `2026-05-30T11:59:25.832Z` -> `2026-05-30T12:59:25.832Z`
- America/Chicago (CDT): `2026-05-30 06:59:25` -> `2026-05-30 07:59:25`

Source files:

- `data/controller/logs/res:*/actions/*.jsonl` (excluding `res:bmk_*`)
- `data/controller/memory/library/res-*/timeline.jsonl`

Generated artifact:

- `data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T143812Z.json`

Freshness rerun artifact:

- `data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T163610Z.json`

## Coverage summary

- Active ordinary residents in window: `23`
- Total action attempts: `2356`
- Successful action submissions (`result.ok=true`): `2336`
- Failed submissions: `20`
- Action success rate: `99.151%`

## Top action kinds (one-hour window)

| Kind | Count |
|---|---:|
| `move_to` | 1318 |
| `say` | 786 |
| `interact` | 135 |
| `use_item_on_item` | 71 |
| `use_item_on` | 15 |
| `eat` | 14 |
| `equip` | 6 |
| `trade_request` | 4 |
| `trade_decline` | 3 |
| `attack` | 1 |

## Top causes (one-hour window)

| Cause | Count |
|---|---:|
| `idle_initiative` | 1040 |
| `stuck_pre_inference_explore` | 253 |
| `explore_patrol` | 220 |
| `none` | 112 |
| `woodcutting_level1_routine` | 109 |
| `faction_landmark_return` | 88 |
| `firemaking_fallback` | 71 |
| `faction_ledger_audit_work` | 47 |
| `starter_fishing_seek_spot` | 44 |
| `faction_bureau_witness_work` | 41 |
| `faction_foundry_fuel_work` | 41 |
| `stuck_move_recovery` | 39 |

## Timeline histogram (one-hour window)

| Timeline kind | Count |
|---|---:|
| `say` | 786 |
| `stuck_detected` | 660 |
| `stuck_recovered` | 570 |
| `first_xp` | 28 |

Not observed in this window: `logout`, `death`, `city_attention_credit`, `city_gold_observed`, `city_gold_burn`, `city_ap_gp_exchange`, `trade_completed`, `trade_cancelled`, `level_up`, `quest_complete`.

## AP life-force signal

- Residents with measurable `attention_after`: `23`
- Residents with net AP drop in window: `13`
- Aggregate drop across dropping residents: `11527`

Top AP drops:

- `res:agent`: `60089.5 -> 59186` (`-903.5`)
- `res:qa-woodcutter`: `30057.5 -> 29156.5` (`-901`)
- `res:qa-social`: `30099.5 -> 29199.5` (`-900`)
- `res:qa-banker`: `31877.5 -> 30984` (`-893.5`)
- `res:qa-scout`: `30470.5 -> 29578.5` (`-892`)

## Delta vs prior CQA10 audit (2026-05-29)

1. Ordinary one-hour liveness remains strong (`99.151%` submit success with all 23 residents active).
2. Ordinary trade intent now appears without soak harness control (`trade_request=4`, `trade_decline=3` in action logs), but completion/cancel timeline events are still absent in this hour (`trade_completed=0`, `trade_cancelled=0`).
3. Combat remains sparse in ordinary life (`attack=1`) and still needs named long-run recurrence alongside CQA5 bounded proof.
4. Stuck churn remains high (`stuck_detected=660`, `stuck_recovered=570`) and still dominates non-idle moments.
5. CQA10 is now reproducible by CLI artifact rather than ad-hoc scripts.

## Freshness rerun (latest wall-clock hour)

To keep CQA10 evidence current, a second audit was run without pinning `--end`, covering the most recent one-hour wall-clock window at run time:

- UTC: `2026-05-30T15:36:10.259Z` -> `2026-05-30T16:36:10.259Z`
- America/Chicago (CDT): `2026-05-30 10:36:10` -> `2026-05-30 11:36:10`
- Artifact: `data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T163610Z.json`

Observed result:

- Active ordinary residents: `0`
- Action attempts: `0`
- Timeline moments: `0`
- AP-drop coverage: `0` residents

Interpretation:

- This is a real readiness signal, not a pass. The latest one-hour window had no live controller traffic, so ordinary-life evidence is currently stale.
- Capability confidence should continue to cite the earlier non-idle window (`normal_life_audit_20260530T143812Z.json`) until CQA10 is rerun against a hot stack with non-zero resident activity.

## Repro commands

```bash
npm run controller:normal-life-audit -- --end 2026-05-30T12:59:25.832Z
npm run controller:normal-life-audit
```

This writes a timestamped JSON artifact under `data/benchmarks/capability-qa-YYYY-MM-DD/`.
