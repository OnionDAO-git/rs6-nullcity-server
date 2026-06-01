# GP Coin 995 Earning Evidence — 2026-05-29

| Field | Value |
|---|---|
| Packet | CQA6 |
| Issue | QA-20260529-002 |
| Capability row | Can they earn/hold GP?; Observe and collect RuneScape GP |
| Resident(s) | `res-bmk_starter_01krcol4` (autonomous); disposable scripted starter resident |
| Mode | scripted benchmark + autonomous benchmark |
| Model profile(s) | `default` |
| Endpoint(s) | local gateway benchmark runtime |
| Command | `npm run controller:bench -- --task starter-gp-pickup-3m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-29` and `npm run controller:bench -- --task starter-gp-pickup-3m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29` |
| Artifact(s) | benchmark:bench_20260529065910_starter_gp_pickup_3m, benchmark:bench_20260529065956_starter_gp_pickup_3m, benchmark:bench_20260529070519_starter_gp_pickup_3m |
| Result | pass (with one earlier autonomous timeout preserved as regression context) |

## Claim Tested

Residents can observe and collect real RuneScape GP by interacting with visible coin item `995`, not by reading an AP ledger balance.

## Success Criteria

- Bench result reports pass with `coinItemId=995`.
- Autonomous run shows selected-module `opportunistic_pickup` behavior.
- Post-run metrics show positive ground-GP gain and observed inventory GP amount.

## Evidence Summary

`bench_20260529065910_starter_gp_pickup_3m` (scripted) passed in 710ms with `coinItemId=995`, one successful pickup action, and `gpObservedAmount=25`.

`bench_20260529065956_starter_gp_pickup_3m` (first autonomous) timed out after 180s with repeated `stuck_pre_inference_explore` actions and no GP gain, providing regression context.

`bench_20260529070519_starter_gp_pickup_3m` (autonomous after routine fix) passed in 5506ms with `coinItemId=995`, `selectedModuleActions=2`, `successfulCoinPickupActions=2`, `gpGainedFromGround=1`, and `gpObservedAmount=25`.

## Root Cause If Failed

Layer: pathing

The first autonomous attempt looped on stuck exploration before engaging visible coins. Later run passed after benchmark behavior updates, so no open root-cause fix remains in this packet.

## Capability Doc Update

Suggested update for `docs/resident-capabilities.md`:

> Keep GP claim scoped to visible coin `995` earning/observation as proven; keep broader self-directed GP/hour routes marked low-confidence until separate benchmarks land.

## Follow-Up

`S8c` / `CQA9`: prove AP/GP-aware goal hierarchy and strategy writeback behavior.
