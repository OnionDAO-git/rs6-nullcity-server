# CQA10 Post-AP-Cycle Recurrence 90m (2026-06-01)

Packet: `CQA10-post-ap-cycle-recurrence-90m`  
Issues: `QA-20260529-006`, `QA-20260531-054`  
Run date: 2026-06-01

## Goal

Run a fresh no-drain 90-minute normal-life audit on the live rebuilt stack after `S-AP-CYCLE-1/2`, then confirm the AP/GP recurrence signal is organic (not admin-drain controlled).

## Commands

```bash
npm run controller:normal-life-audit -- --duration-ms=5400000 --top=20 --output-dir data/benchmarks/capability-qa-2026-06-01/cqa10-post-ap-cycle-recurrence-90m
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
```

## Artifacts

- `data/benchmarks/capability-qa-2026-06-01/cqa10-post-ap-cycle-recurrence-90m/normal_life_audit_20260601T001523Z.json`

## Results

- Window: `2026-05-31T22:45:23.724Z` to `2026-06-01T00:15:23.724Z` (`90m`)
- Active residents: `10`
- Actions: `4683/4683` successful (`100%`)
- Recurrence summary:
  - `apGpExchangeActions=8`
  - `apGpExchangeEvents=8`
  - `tradeRequests=0`
  - `tradeCompleted=0`
  - `tradeCancelled=0`
  - `lowHealthWaits=8`
  - `combatResupplyActions=365`
  - `cookingActions=458`
  - `eatingActions=65`
  - `xpEvents=79`
  - `stuckDetected=389`, `stuckRecovered=378`
- Economy summary:
  - `economyEventsInWindow=8`
  - `selfInitiatedApGpExchangeEvents=8`
  - `controlledApGpExchangeEvents=0`
  - `organicSelfInitiatedApGpExchangeEvents=8`
  - `adminDrainEvents=0`
  - `attentionRunwayThresholdAp=3000`
- GP-runway signal:
  - `res:agent` ended at `apLast=3073` with `gp=24133` and `apUntilExchangeThreshold=73`, then repeatedly self-initiated AP top-ups inside the window.

## Readout

This closes the immediate "no organic recurrence" gap for the AP-cycle threshold packet: the live no-drain window shows repeated organic self-initiated AP-for-GP exchanges (`8`) with zero controlled/admin-drain events.

Trade closure still did not recur (`tradeRequests=0`, `tradeCompleted=0`), and stuck churn remains elevated in core residents (`res:agent`, `res:qa-trader`, `res:qa-social`, `res:qa-scout`, `res:qa-banker`).

The 60s smoke confirms the stack is active but still warns on:

- `res:qa-cook` no recent visible activity
- `res:qa-survivor` effect timeout/after-submit interruption
- `res:qa-trader`, `res:qa-banker`, `res:qa-social` after-submit interruptions

## Next

1. Run a trade-closure-focused named resident soak without directed AP drains.
2. Target the remaining top stuck-churn residents with one bounded behavior packet.
