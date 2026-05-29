# Door/Path Recovery Evidence — 2026-05-29

| Field | Value |
|---|---|
| Packet | CQA2 |
| Issue | QA-20260529-003 |
| Capability row | Movement / door-path recovery |
| Resident(s) | `res-bmk_equipment_00iw2smf`; `res-bmk_explore_00ikl6ga` |
| Mode | autonomous benchmark artifacts (existing runs) |
| Model profile(s) | `default`; `qwopus3.5-27b-v3@q4_k_s` |
| Endpoint(s) | local gateway benchmark runtime |
| Artifact(s) | benchmark:bench_20260528181711_equipment_prep_3m, benchmark:bench_20260528021111_explore_report_5m |
| Result | pass |

## Claim Tested

Residents can recover from blocked movement by opening nearby obstacles and by switching to explicit recovery movement routes.

## Success Criteria

- At least one benchmark shows `stuck_open_obstacle` with a successful body action.
- At least one benchmark shows `stuck_move_recovery` with a successful body action.
- Artifacts are from real autonomous runs, not dry-run output.

## Evidence Summary

`bench_20260528181711_equipment_prep_3m` passed (`score=1`) and includes a body action attempt with:

- `actionKind: interact`
- `cause: stuck_open_obstacle`
- `finalStatus: success`
- `effectEvidenceCount: 1`

This is direct evidence that the resident attempted and completed the "open obstacle" recovery path.

`bench_20260528021111_explore_report_5m` passed (`score=1`) and includes a body action attempt with:

- `actionKind: move_to`
- `cause: stuck_move_recovery`
- `finalStatus: success`

This is direct evidence that route fallback recovery is used successfully in autonomous exploration.

## Root Cause If Failed

Layer: pathing

No new root-cause code fix was required in this packet; existing benchmark artifacts already prove the previously unproven capability row.

## Capability Doc Update

Update `docs/resident-capabilities.md` movement row from unproven to benchmark-proven, while keeping ordinary long-run confidence at medium until named-resident soak proof is added.

## Follow-Up

Run a named-resident door-heavy soak (`CQA10`/`CQA2` follow-up) to add ordinary-controller proof beyond benchmark harnesses.
