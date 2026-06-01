# CQA10 — Post-AP-Cycle Recurrence Summary

Date: 2026-05-31

## TL;DR

Status: substrate verified; live organic window deferred to post-Chicago. S-AP-CYCLE-1 raised the no-floor self-funding threshold from 300 → 3000 AP and targets a 3500 AP runway. S-AP-CYCLE-2 adds `heroSurplusGpExchangeAction` so floor-clamped heroes proactively convert accumulated GP → AP whenever their surplus exceeds the reserve. Both packets have focused unit tests and pass `check:no-ui` and `fin`. The 90-120m no-drain organic verification requires a live game stack and is deferred to post-Chicago.

## S-AP-CYCLE-1 (SHA: aa14bb64)

- `SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD` raised 300 → 3000 AP.
- `SELF_INITIATED_EXCHANGE_RUNWAY_AP` = 3500 AP (target balance after exchange).
- Max exchange per tick unchanged: 250 GP / 500 AP.
- Floor-protected residents keep `floor + 20` AP rule (unchanged).
- `normal-life-audit` now reports `exchangeThresholdAp`, `apUntilExchangeThreshold`, `residentsApproachingExchangeThreshold`, and `aboveRunwayThresholdWithGpResidents`.
- Tests: focused 65; `check:no-ui` PASS; `build` PASS; `fin` 3356/3356 PASS (validated via S-AP-CYCLE-2 run).
- Existing audit evidence: `normal_life_audit_20260531T160104Z.json` (10m window) recorded 23 residents, 964/964 successful actions, 100% success, `exchangeThresholdAp=3000`, GP holders visible in `residentsApproachingExchangeThreshold`; no organic exchange fired because all GP-holding residents were still above the 3000 AP threshold.

## S-AP-CYCLE-2 (SHA: 33b40a46)

- `heroSurplusGpExchangeAction` added to `src/controller/spark/self-initiated-ap-gp-exchange.ts`.
- Fires when: `floor > 0` (hero/floor-clamped resident) AND `gp > HERO_SURPLUS_GP_RESERVE (5) + SELF_INITIATED_EXCHANGE_MIN_GP (10)`, regardless of current AP level.
- Converts `(gp - HERO_SURPLUS_GP_RESERVE)` GP to AP at the standard rate, capped at `SELF_INITIATED_EXCHANGE_MAX_GP`.
- Wired in `NervousSystem.selfInitiatedApGpExchangeReaction` as `?? heroSurplusGpExchangeAction(...)` fallback after the no-floor self-initiation check.
- Tests: 9 new focused tests; 48 nervous-system suite; `fin` 3356/3356 PASS; `check:no-ui` PASS; `build` PASS.

## Constants Reference

| Constant | Value | Role |
|---|---:|---|
| `SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD` | 3000 AP | No-floor trigger band |
| `SELF_INITIATED_EXCHANGE_RUNWAY_AP` | 3500 AP | No-floor target balance |
| `SELF_INITIATED_EXCHANGE_MIN_GP` | 10 GP | Minimum GP for any exchange |
| `SELF_INITIATED_EXCHANGE_MAX_GP` | 250 GP | Per-tick GP cap |
| `HERO_SURPLUS_GP_RESERVE` | 5 GP | Reserve floor heroes always keep |

## Gap: Live Organic Verification Deferred

This CQA10-post-ap-cycle-recurrence pass was executed in a cloud environment with no live controller log data. `npm run controller:normal-life-audit` requires game log files under `CONTROLLER_LOGS_ROOT` (`data/controller/logs/res:*/`), which are absent in this checkout.

The S-AP-CYCLE-2 HANDOFF noted: `next=90-120m no-drain audit to confirm hero surplus events appear organically`. That verification requires a live game stack where floor-clamped residents (Hans, Father Aereck, Wise Old Man, Duke, Pip, Thrand) accumulate GP and fire the surplus-exchange reflex. It is deferred to post-Chicago.

## Follow-ups

1. Post-Chicago: run a 90-120m no-drain normal-life audit. Confirm `hero_surplus_gp_exchange` cause appears in `trackedCauseCounts` for at least one hero resident.
2. Confirm hero floor residents show GP runway drawdown alongside AP level stabilization (GP down, AP up) in economy JSONL.
3. If floors are set low enough that `gp - HERO_SURPLUS_GP_RESERVE` triggers frequently, consider whether the reserve constant needs tuning.
