# CQA10 Post-Agent Cadence Follow-Up (2026-05-31)

Packet: `CQA10-post-agent-cadence-followup`  
Issue: `QA-20260529-006`  
Run date: 2026-05-31

## Goal

After `S-AGENT-VISIBLE-CADENCE-1`, capture a fresh normal-life window from the rebuilt stack and separate the remaining open work from the now-fixed Agent visibility gap.

## Commands

```bash
bash scripts/post-restart-smoke.sh --no-color
npm run controller:normal-life-audit -- --duration-ms=600000 --top=20 --output-dir data/benchmarks/capability-qa-2026-05-31/cqa10-post-agent-cadence-followup
```

## Artifacts

- `data/benchmarks/capability-qa-2026-05-31/cqa10-post-agent-cadence-followup/normal_life_audit_20260531T131056Z.json`

## Results

- `post-restart-smoke`: `READY`.
- Window: `2026-05-31T13:00:56.017Z` to `2026-05-31T13:10:56.017Z`.
- Active residents: `23`.
- Actions: `969/969` successful (`100%`).
- Recurrence summary:
  - `apGpExchangeActions=0`
  - `apGpExchangeEvents=0`
  - `tradeRequests=0`
  - `tradeCompleted=0`
  - `tradeCancelled=0`
  - `lowHealthWaits=0`
  - `combatResupplyActions=32`
  - `cookingActions=34`
  - `eatingActions=8`
  - `xpEvents=6`
  - `deaths=0`
  - `logouts=0`
  - `stuckDetected=54`, `stuckRecovered=47`, `unresolved=7`
- `trackedCauseCounts.agent_keepalive=6`.

## Stuck Readout

Top churn residents in this window:

| Resident | Detected | Recovered | Unresolved | Churn |
|---|---:|---:|---:|---:|
| `res:qa-trader` | 11 | 11 | 0 | 22 |
| `res:agent` | 8 | 8 | 0 | 16 |
| `res:qa-social` | 7 | 7 | 0 | 14 |
| `res:qa-survivor` | 7 | 7 | 0 | 14 |
| `res:thrand` | 5 | 4 | 1 | 9 |
| `res:pip` | 4 | 3 | 1 | 7 |

This confirms the Agent cadence work is doing its narrow job: `res:agent` still creates detected/recovered churn, but it no longer leaves unresolved stuck state in this window and it emits tracked visible status keepalives.

## Economy And Trade Readout

The rebuilt stack stayed active, but the same broad CQA10 gaps remain:

- No AP/GP exchange action or economy event occurred in-window.
- No trade request, completion, or cancellation occurred in-window.
- Latest known GP is still concentrated in `res:agent` (`24133`) and `res:qa-trader` (`1368`), while many residents have `0` GP.
- `lowApWithGpResidents=[]` and `requestAttentionWithGpResidents=[]`, so the AP/GP self-funding route was not expected to fire in this exact window.

## Next

1. Keep `QA-20260529-006` open for ordinary trade/APGP recurrence, not for the Agent visible-cadence substrate.
2. Prefer the next code packet on ordinary `res:qa-trader` trade recurrence without visible-tester dependency, or on a fresh GP-earning/distribution route that can create natural low-AP-with-GP pressure.
3. Continue periodic CQA10 windows after any trade/economy packet so the issue register reflects normal-life recurrence instead of only directed proofs.
