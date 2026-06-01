# S-TRADER-TRADE-1 QA Trader Trade Loop (2026-05-31)

Packet: `S-TRADER-TRADE-1`
Issue: `QA-20260531-050`
Run date: 2026-05-31

## Goal

Reduce `res:qa-trader` stuck churn and restore trade-oriented ordinary behavior. The latest stuck attribution audit identified qa-trader as the top stuck-churn resident, while the same normal-life window recorded zero trade actions.

## Evidence

- `data/benchmarks/capability-qa-2026-05-31/s-stuck-attrib-1/normal_life_audit_20260531T112003Z.json` reported `res:qa-trader` at `61` stuck detections, `61` recoveries, `0` unresolved, and `122` churn.
- The same artifact showed `res:qa-trader` had `trade_request=0`, `trade_offer_item=0`, `trade_accept_stage_1=0`, `trade_accept_stage_2=0`, `trade_decline=0`, `trade_completed=0`, and `trade_cancelled=0`.
- `data/controller/logs/res:qa-trader/actions/2026-05-31.jsonl` showed repeated `explore_patrol`, `explore_talk_to_npc`, `stuck_move_recovery`, and `stuck_pre_inference_explore` actions instead of trade/follow actions.
- `data/controller/memory/res-qa-trader/runtime-state.json` showed a nameless stale paused follow target: `{"paused": true, "setAtTick": 2}`. That suppressed the configured `followPlayer: codex` target before this packet.
- Historical logs from `data/controller/logs/res:qa-trader/actions/2026-05-30.jsonl` confirmed the trade machinery itself works when prompted: direct trade requests, safe offers, accept stages, and untrusted declines were present.

## Change

- Added `tradingGoal()` and mapped `trading-giving-5m` to `trade-with-codex`, a follow-shaped trade goal.
- Changed `res:qa-trader` from `explore-report-5m` to `trading-giving-5m` and tightened its `followRadius` to `1` so follow range is also trade range.
- Repaired anonymous stale paused follow targets so they no longer suppress a configured follow player, while named paused targets and manual pauses still suppress follow.
- Added `tradeStarterAction` for the `trade` command-prefix resident:
  - requests a starter trade from the configured tester when visible, stocked, and off cooldown;
  - approaches the tester to trade range when too far;
  - emits a rate-limited no-tester-visible starter-trade keepalive before the idle stuck loop falls back to generic recovery.
- Made `tradeStarterAction` resolve the current follow target instead of blindly reading `behavior.followPlayer`, so `trade stop following` does not immediately resume a starter-trade request.
- `RuntimeState.cognition` now persists `lastTradeKeepaliveTick`.

## Verification

- Red/green stop-following regression:
  - first failed because the next tick emitted `trade_starter_offer`;
  - passed after `tradeStarterAction` switched to `currentFollowTarget(ctx)`.
- `npm test -- --runTestsByPath src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand --testNamePattern "does not immediately resume trader starter offers|proactively requests a starter trade|anonymous paused" --no-coverage` passed: `3/3`.
- `npm test -- --runTestsByPath src/controller/spark/runescape-brain-planner.test.ts src/controller/soul/soul-loader.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand --no-coverage` passed: `382/382`.
- `npm run check:no-ui` passed.
- `npm run typecheck` passed.
- `npm run build` passed: `821` files compiled.
- `npm run fin` passed in Codex Desktop: `228` suites and `3247/3247` tests passed.

## Live Status

No controller restart was performed for this packet. The running controller has not loaded the rebuilt code or the updated `res:qa-trader` soul yet. Live trade recurrence and stuck-churn reduction remain pending a restart and fresh 30-60 minute `normal-life-audit`.
