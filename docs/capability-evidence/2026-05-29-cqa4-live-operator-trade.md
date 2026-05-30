# CQA4: Live operator trade evidence audit (2026-05-29)

Packet: `CQA4`  
Issue: `QA-20260529-011`  
Owner: `codex`

## Scope

Goal was to prove or disprove ordinary named-resident trade behavior outside the benchmark harness, with preference for operator-like evidence.

## Evidence Collected

1. Ordinary controller action logs still show zero trade actions:

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

## Conclusion

`CQA4` remains unproven for ordinary/operator behavior. Trade logic is benchmark-proven in harness runs, but current ordinary resident/controller evidence still shows zero real trade attempts and zero Library trade moments.

## Next Action

Run a named-resident live trade soak with explicit preconditions and evidence capture:

- Seed a named resident (for example `res:qa-trader`) with tradable inventory and known starting inventory snapshot.
- Run one trusted partner exchange and one unsafe/untrusted attempt.
- Capture ordinary `data/controller/logs/res:*/actions/*.jsonl` `trade_*` attempts plus before/after inventory delta and matching timeline events.

