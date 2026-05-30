# CQA4: Live operator trade evidence audit (2026-05-29)

Packet: `CQA4`  
Issue: `QA-20260529-011`  
Owner: `codex`

## Scope

Goal was to prove or disprove ordinary named-resident trade behavior outside the benchmark harness, with preference for operator-like evidence.

## Evidence Collected

1. Baseline on 2026-05-29: ordinary controller action logs still showed zero trade actions:

```bash
rg -n '"kind":"trade_' data/controller/logs/res:*/actions/*.jsonl -S | wc -l
# 0
```

2. Library timelines currently show zero trade moments:

```bash
rg -n 'trade_(request|open|completed|cancel|offer|accept|decline)' data/controller/memory/library/*/timeline.jsonl -S | wc -l
# 0
```

3. Benchmark-harness trading remains proven (safe trusted trade completion plus unsafe decline):

```json
{"runId":"bench_20260528201331_trading_giving_5m","status":"passed","score":1,"durationMs":35996,"tradeRequests":2,"tradeCompletedEvents":1,"tradeCancelledEvents":0,"unsafeDeclines":1}
{"runId":"bench_20260528201447_trading_giving_5m","status":"passed","score":1,"durationMs":17881,"tradeRequests":6,"tradeCompletedEvents":1,"tradeCancelledEvents":1,"unsafeDeclines":2,"selectedModuleActions":20}
{"runId":"bench_20260523134244_trading_giving_5m","status":"passed","score":1,"durationMs":40129,"tradeRequests":4,"tradeCompletedEvents":1,"tradeCancelledEvents":1,"unsafeDeclines":2,"selectedModuleActions":20}
{"runId":"bench_20260523142857_trading_giving_5m","status":"passed","score":1,"durationMs":17987,"tradeRequests":6,"tradeCompletedEvents":1,"tradeCancelledEvents":1,"unsafeDeclines":2,"selectedModuleActions":20}
```

4. This matches the one-hour CQA10 baseline: ordinary life observed no trade actions (`trade_*=0`) despite active resident movement/speech loops.

5. Follow-up live operator soak on 2026-05-30 passed outside the benchmark harness:

```bash
npm run controller:trade-soak -- --resident res:qa-trader --trusted-peer res:codex-cq42 --unsafe-peer res:alice-cq42 --duration-ms 120000
```

Artifact:

```text
data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530092531.json
```

Verifier summary:

```json
{
  "status": "passed",
  "score": 1,
  "tradeRequests": 2,
  "safeItemOffers": 1,
  "acceptStage1": 1,
  "acceptStage2": 1,
  "unsafeDeclines": 1,
  "tradeCompletedEvents": 1,
  "tradeCancelledEvents": 1,
  "safeInventoryBefore": 3,
  "safeInventoryAfter": 2,
  "safeInventoryDelta": -1
}
```

Ordinary named-resident evidence now exists in `data/controller/logs/res:qa-trader/actions/2026-05-30.jsonl`: `res:qa-trader` sent a trusted `trade_request`, offered one safe shrimp (`itemId=315`), accepted both trade stages, completed the trade, then sent a second trade request to an untrusted peer and declined it with `trade_decline_untrusted_partner`. The matching target events include `trade_completed` with `given:[{itemId:315,amount:1}]` and `trade_cancelled` for the unsafe attempt.

6. Repeated-prompt/no-loop soak on 2026-05-30 also passed after tightening peer placement to keep the harness focused on trade safety rather than pathing drift:

```bash
npm run controller:trade-soak -- --unsafe-repeats=3 --duration-ms=180000 --poll-ms=500
```

Artifact:

```text
data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530125718.json
```

Verifier summary:

```json
{
  "status": "passed",
  "score": 1,
  "unsafeRepeatTarget": 3,
  "tradeRequests": 4,
  "trustedTradeRequests": 1,
  "unsafeTradeRequests": 3,
  "safeItemOffers": 1,
  "acceptStage1": 1,
  "acceptStage2": 1,
  "unsafeDeclines": 3,
  "tradeCompletedEvents": 1,
  "tradeCancelledEvents": 3,
  "safeInventoryDelta": -1,
  "postUnsafeOffersOrAccepts": 0
}
```

The same ordinary `res:qa-trader` action log now shows a trusted trade completion followed by three unsafe `trade_request` actions and three `trade_decline_untrusted_partner` actions. The verifier also checks that once the unsafe peer starts prompting, the resident emits no follow-up `trade_offer_item` or `trade_accept_*` actions, preventing transaction-loop regressions.

## Conclusion

`CQA4` is now proven for one named resident under operator-style live soaks. Trade logic is benchmark-proven, ordinary `res:qa-trader` logs now show the full trusted trade plus unsafe decline path with a real inventory delta outside the benchmark harness, and the no-loop soak proves repeated unsafe prompts are declined without offer/accept follow-through.

## Next Action

Recommended follow-ups:

- Repeat with a human/operator-controlled player actor once the demo operator path is available.
- Fold this proof into the next long-run CQA10 baseline to see whether ordinary life produces trade behaviors without a directed command.
