# QA-20260602-082 Trade Recurrence Analysis

## TLDR

Ordinary trade recurrence was not failing because the trade FSM was broken. It was failing because the live `res:qa-trader` starter soul had drifted away from the trade contract:

- `legacy.parameters.benchmarkTask` was set to `woodcutting-firemaking-10m`.
- `behavior.followPlayer` was absent.

That made `res:qa-trader` behave like a skilling resident during normal-life audits, so long windows could not naturally produce `trade_keepalive`, `trade_starter_offer`, or `trade_request`.

The fix restores `res:qa-trader` to `trading-giving-5m` and `followPlayer: codex`, while preserving its q4 brain/body settings.

## Evidence

Fresh audit artifact:

- `data/benchmarks/capability-qa-2026-06-02/normal_life_audit_20260602T200640Z.json`
- Window: `2026-06-02T18:36:40.645Z` through `2026-06-02T20:06:40.645Z`
- Active residents: `10`
- Action submissions: `5094/5094`
- `res:qa-trader` action submissions: `836/836`
- `res:qa-trader` trade counters:
  - `trade_request=0`
  - `trade_offer_item=0`
  - `trade_accept_stage_1=0`
  - `trade_accept_stage_2=0`
  - `trade_decline=0`
  - `trade_completed=0`
  - `trade_cancelled=0`
  - `trade_keepalive=0`
  - `trade_starter_offer=0`

Historical comparison:

- `docs/capability-evidence/2026-05-31-s-trader-trade-1.md` previously changed `res:qa-trader` to `trading-giving-5m` and `followPlayer: codex`.
- `docs/capability-evidence/2026-05-31-s-trade-visible-target-1.md` then proved proactive visible-target trade closure.
- The current soul file had regressed from that contract, so the normal-life audit no longer exercised the ordinary trade path.

## Fix

- Restored `src/controller/soul/starter-souls/res-qa-trader.md` to `legacy.parameters.benchmarkTask: trading-giving-5m`.
- Restored `behavior.followPlayer: codex`.
- Added a starter-soul regression in `src/controller/soul/soul-loader.test.ts` requiring QA Trader to keep `followPlayer: codex`, `followRadius: 1`, `commandPrefix: trade`, and `trading-giving-5m`.

## Verification

```bash
npm test -- src/controller/soul/soul-loader.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand --no-coverage
```

Result: `333/333` passing.

## Remaining Follow-Up

This restores the precondition for ordinary trade recurrence. It does not prove recurrence on the running stack until a steward deploys/restarts the controller onto this build and reruns a normal-life or trade-focused audit.

Recommended post-deploy proof:

```bash
npm run controller:normal-life-audit -- --duration-ms=1800000 --top=20 --output-dir data/benchmarks/capability-qa-2026-06-02/qa082-post-trader-soul-30m
```

Pass target: `res:qa-trader` shows nonzero `trade_keepalive` without a visible target and/or `trade_starter_offer` / `trade_request` when an eligible Codex/operator target is visible.
