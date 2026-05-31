# CQA10 Fresh GP Scan 60m (2026-05-31)

Packet: `CQA10-fresh-gp-scan-60m`  
Issue: `QA-20260529-006`  
Run date: 2026-05-31

## Goal

Run a fresh no-drain 60-minute normal-life audit after `S-GP-HARVEST-1` and recent AP/GP routing/stuck-threshold changes, with explicit GP-holdings visibility.

## Command

```bash
npm run controller:normal-life-audit -- --duration-ms=3600000 --top=20 --output-dir data/benchmarks/capability-qa-2026-05-31/cqa10-fresh-gp-scan-60m
```

## Artifact

- `data/benchmarks/capability-qa-2026-05-31/cqa10-fresh-gp-scan-60m/normal_life_audit_20260531T110023Z.json`

## Results

- Window: `2026-05-31T10:00:23.590Z` to `2026-05-31T11:00:23.590Z`
- Active residents: `23`
- Actions: `6694/6694` successful (`100%`)
- Recurrence summary:
  - `apGpExchangeActions=0`
  - `apGpExchangeEvents=0`
  - `tradeRequests=0`
  - `tradeCompleted=0`
  - `tradeCancelled=0`
  - `lowHealthWaits=0`
  - `combatResupplyActions=128`
  - `cookingActions=268`
  - `eatingActions=66`
  - `xpEvents=106`
  - `stuckDetected=537`, `stuckRecovered=394`
- Economy summary:
  - `economyEventsInWindow=0`
  - `organicSelfInitiatedApGpExchangeEvents=0`
  - `lowApWithGpResidents=[]`
  - `requestAttentionWithGpResidents=[]`
  - latest GP snapshot still shows concentrated holdings (`res:agent=24133`, `res:qa-trader=1368`) with many residents at `0`.

## Readout

The hot stack is active and healthy on submission success, low-health waits remain controlled at zero, and combat/cooking/eating/XP signals persist.  
Unconditioned AP/GP exchange and trade closure did not recur in this 60m window, and no fresh economy events were recorded in-window despite non-zero known GP holdings.

## Next

1. Run a trade-closure-focused normal-life pass (or bounded named-resident trade recurrence soak) without drains.
2. Add per-resident stuck-churn attribution in the audit summary to target the next stuck reduction packet.
