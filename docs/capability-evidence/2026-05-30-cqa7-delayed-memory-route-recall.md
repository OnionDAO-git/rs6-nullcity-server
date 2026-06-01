# CQA7 - Delayed Memory Route Recall Substrate (2026-05-30)

Packet: `CQA7`  
Lane: `F`  
Date: 2026-05-30

## Scope

Close the explicit delayed route-recall gap from `QA-20260529-012` by adding a dedicated benchmark task that seeds a route memory, asks for delayed recall, and rejects JSON-like prompt-echo replies.

## Changes Landed

1. Added a new benchmark task and verifier:
   - `src/controller/benchmarks/tasks/memory-route-recall-5m.ts`
   - `src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts`
2. Registered the new task in benchmark CLI and suite plumbing:
   - `src/controller/benchmarks/cli.ts`
   - `src/controller/benchmarks/cli.test.ts`
3. Follow-up live QA fixed the behavior surfaced by the first loopback run:
   - Addressed route-memory questions now route through direct chat and recall Library route facts before stuck recovery.
   - Retained addressed chat events no longer repeat every perception tick.
   - The verifier now scores delayed route answers after the recall question and prefers chronological event-stream evidence over retained perception windows.

## Verification

- `npm test -- --runInBand src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts src/controller/benchmarks/cli.test.ts`  
  PASS (`29/29` tests)
- `npm run controller:bench -- --task memory-route-recall-5m --module onion.runescape.standard --mode autonomous --dry-run`  
  PASS (task resolves with id/version `memory-route-recall-5m@0.1.0`)
- `npm run controller:bench -- --task memory-route-recall-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-30`  
  FAIL in this sandbox: `connect EPERM 127.0.0.1:43595`
- `npm test -- --runInBand src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts`  
  PASS (`255/255` tests)
- `CONTROLLER_BENCHMARK_OUTPUT_DIR=data/benchmarks/capability-qa-2026-05-30 npm run controller:bench -- --task memory-route-recall-5m --module onion.runescape.standard --mode autonomous`  
  PASS (`bench_20260530103544_memory_route_recall_5m`, score `1`, duration `27.6s`)
- `npm run build`  
  PASS (`Successfully compiled: 782 files with swc`)

## Live Artifact Notes

Artifact: `data/benchmarks/capability-qa-2026-05-30/bench_20260530103544_memory_route_recall_5m.json`

- `status=passed`, `score=1`
- `routePrimerPrompts=2`, `routeRecallQuestions=1`, `sayActions=2`
- `lumbridgeMentions=1`, `varrockMentions=1`, `bankMentions=1`, `routeStepMentions=1`
- `selectedModuleActions=6`, `selectedModuleInferences=3`
- Trajectory shows the selected `onion.runescape.standard@0.1.0` module answering the delayed recall prompt with Lumbridge/Varrock/bank route detail via `direct_chat_memory_recall`.

## Outcome

- The delayed memory route-recall benchmark substrate now exists and is test-covered.
- Live autonomous proof now exists on loopback-permitted infrastructure.
- The first live retry exposed two real behavior bugs (addressed memory questions declined as unknown commands; retained addressed chat reprocessed on every perception tick), and both are now covered by tests.

## Next Action

QA Marshal should review artifact `bench_20260530103544_memory_route_recall_5m` and close `QA-20260529-012` if the delayed-answer semantics are accepted. Next confidence bump: teach a named, long-running resident a new route in ordinary life, wait at least 10 minutes, then ask for recall outside the benchmark harness.
