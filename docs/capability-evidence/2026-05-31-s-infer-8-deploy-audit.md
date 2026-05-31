# S-INFER-8-DEPLOY-AUDIT-1 live audit refresh (2026-05-31)

## Scope

- Packet: `S-INFER-8-DEPLOY-AUDIT-1`
- Goal: verify the currently running 10-resident cohort after the S-INFER-8 timeout/watchdog landing and refresh AP/GP + inference health evidence from live artifacts.
- Runtime control: no controller restart in this pass (existing stack was already live); this packet gathered fresh smoke/audit evidence from the active window.

## Commands run

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
npm run controller:inference-audit -- --duration-ms 1800000 --top 10
npm run controller:normal-life-audit -- --duration-ms 1800000 --top 12
npm run check:no-ui
```

## Results

### Smoke (60s)

- `res:hans`, `res:qa-woodcutter`, `res:qa-cook`, `res:qa-survivor`, `res:qa-guardian`, `res:qa-trader`, `res:qa-banker`, and `res:qa-social` showed visible action/say cadence during observation.
- `res:agent` and `res:qa-scout` returned `WARN` due to `no_recent_visible_activity` / `no_observed_visible_activity` in this narrow 60s window.
- No smoke timeouts were reported in the observed output.

### Inference health (30m window)

Artifact: `data/benchmarks/capability-qa-2026-05-31/inference-audit/inference_health_audit_20260531T231651Z.json`

- Window: `2026-05-31T22:46:51.352Z` to `2026-05-31T23:16:51.352Z`
- Residents: `10`
- Brain-eligible decisions: `124`
- Usable brain rate: `100.0%`
- Breakdown:
  - clean: `124`
  - recovered: `0`
  - think_only_no_answer: `0`
  - thinking_cancelled: `0`
  - schema_mismatch: `0`
  - truly_empty: `0`
- Goal follow-through: `87.5%` (`1330/1520` attributable actions), `goalsEmitted=18`

### Normal-life audit (30m window)

Artifact: `data/benchmarks/capability-qa-2026-05-31/normal_life_audit_20260531T231657Z.json`

- Window: `2026-05-31T22:46:57.156Z` to `2026-05-31T23:16:57.156Z`
- Residents: `10`
- Actions: `1518/1518` successful (`100%`)
- Survival/cadence:
  - `lowHealthWaits=0`
  - `combatResupplyActions=84`
  - `cookingActions=154`
  - `eatingActions=23`
  - `xpEvents=12`
- Economy:
  - `economyEventsInWindow=3`
  - `apGpExchangeEvents=3`
  - `selfInitiatedApGpExchangeEvents=3`
  - `organicSelfInitiatedApGpExchangeEvents=3`
  - `controlledApGpExchangeEvents=0`
  - `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`
- Stuck churn:
  - `stuckDetected=218`, `stuckRecovered=218`, unresolved aggregate `0`
  - top churn residents: `res:agent` (84), `res:qa-trader` (78), `res:qa-scout` (70), `res:qa-banker` (66), `res:qa-social` (65)

## Interpretation

- The live 10-resident cohort currently shows strong inference stability and clean AP/GP recurrence.
- The remaining open behavior gap is ordinary trade closure in passive windows (`tradeRequests=0`) plus persistent stuck churn concentration around `res:agent` and social/trader/scout roles.
