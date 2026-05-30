# CQA8 — Cross-Resident Awareness (World Event Memory Routing)

Date: 2026-05-30  
Packet: CQA8  
Owner: codex

## Goal

Improve the weak cross-resident awareness row by ensuring LoreBus `world_event` signals are not transient-only. Residents should retain durable memory facts from nearby resident world events.

## What changed

- Added `world_event` durable-fact routing in `MemoryRouter`:
  - New durable path: `facts/world-events.md`
  - `fire_lit` world events now produce explicit first-person-usable facts with source and position.
  - Malformed world events (missing `loreKind` or `source`) are ignored to avoid noisy memory pollution.

## Verification

Focused tests:

- `npm test -- --runInBand src/controller/memory/memory-router.test.ts`
  - Pass: `7/7`
  - Includes two new assertions:
    - `world_event fire_lit` -> writes to `facts/world-events.md`
    - malformed `world_event` -> no durable write

Repo checks:

- `npm run check:no-ui` (pass)
- `npm run build` (pass)

Follow-up live benchmark:

- `CONTROLLER_BENCHMARK_OUTPUT_DIR=data/benchmarks/capability-qa-2026-05-30 npm run controller:bench -- --task world-event-reaction-5m --module onion.runescape.standard --mode autonomous`
  - Pass: `bench_20260530105802_world_event_reaction_5m`
  - Score: `1`
  - Duration: `25.685s`
  - Metrics: `worldEventQuestions=1`, `sayActions=2`, `sourceMentions=1`, `fireMentions=1`, `selectedModuleActions=4`
  - Evidence path: `data/benchmarks/capability-qa-2026-05-30/bench_20260530105802_world_event_reaction_5m.json`
  - Retained trajectory proof: resident answered `I remember res:duke lit a fire at 3226,3230,0.`
  - Retained durable fact proof: `facts/world-events.md` contains `Observed res:duke lit a fire at 3226,3230,0.`

Additional focused tests:

- `npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/benchmarks/tasks/world-event-reaction-5m.test.ts src/controller/benchmarks/cli.test.ts`
  - Pass: `343/343`
  - Proves runtime drains LoreBus events into durable memory, direct-chat recall sanitizes retrieved fact-memory lines, the benchmark verifier scores post-question selected-module evidence, and CLI dry-run/all-task wiring includes `world-event-reaction-5m`.

## Result

Cross-resident world events now persist as durable memory facts instead of only transient perception events, and a disposable autonomous resident can answer a peer's later question using that memory.

## Remaining gap

This is benchmark-proven, not yet ordinary named-resident proof. The next confidence bump is a normal controller soak where one named hero sees another named hero's `fire_lit`/quest/combat event and references it later without benchmark injection.
