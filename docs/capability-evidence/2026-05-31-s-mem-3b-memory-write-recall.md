# S-MEM-3B - memory write and recall benchmark

Date: 2026-05-31

## Verdict

Verified. A resident can receive a durable fact, write it to per-resident qmd-compatible memory, retrieve it later through the normal prompt-memory path, and answer a direct recall question in natural text.

## Live Proof

- Command: `npm run controller:bench -- --task memory-write-recall-10m --module onion.runescape.standard --mode autonomous --output data/benchmarks/memory-write-recall-2026-05-31`
- Artifact: `data/benchmarks/memory-write-recall-2026-05-31/bench_20260531154414_memory_write_recall_10m.json`
- Result: `status=passed`, `score=1`, `failure_reason=none`
- Metrics: `factPrompts=1`, `recallQuestions=1`, `qmdFactWrites=1`, `passphraseMentions=1`, `westGateMentions=1`, `jsonLikeReplies=0`, `selectedModuleActions=2`, `selectedModuleInferences=3`
- Fact artifact: `/var/folders/xj/wwg7k2z54psbr2f_jb8xpytr0000gn/T/res-bmk_memory_01nzy4q3-bench-GITkme/memory/res-bmk_memory_01nzy4q3/facts/routes.md`
- Stored fact: `res:bmk_codex_00vhycxk taught: "west gate passphrase is ember-vellum."`
- Recall action: resident said `I remember west gate passphrase is ember-vellum.`

## Root Cause Fixed

Earlier runs proved memory writes and retrieval worked but recall still failed. Memory telemetry showed `facts/routes.md` was returned during `direct_chat_memory_recall`; the formatter only understood routes, world events, patron gifts, and promises, so a generic taught fact fell through to `I do not have a clear Library memory for that yet.`

The fix adds a generic taught-fact recall fallback for relevant non-social `Fact memory (...)` entries, while continuing to reject JSON-like echoes and recall-question social records.

## Tests

- `npm test -- --runTestsByPath src/controller/benchmarks/tasks/memory-write-recall-10m.test.ts src/controller/benchmarks/cli.test.ts src/controller/spark/runescape-brain-planner.test.ts src/controller/benchmarks/autonomous-runtime.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/memory/memory-router.test.ts --runInBand --no-coverage` - 442/442 pass
- `npm run check:no-ui` - pass
- `npm run build` - pass via benchmark command
- `npm run fin` - pass, 3345/3345 tests

## Remaining Gaps

- This is a benchmarked local fact with a short delay, not a multi-hour ordinary-life memory soak.
- Full semantic memory backend choice remains open: mem0, qmd search, or MCP snippet fetch.
- Next confidence bump: teach a named hero an NPC/quest/death fact, wait at least 10 minutes in ordinary controller life, then ask them to use it.
