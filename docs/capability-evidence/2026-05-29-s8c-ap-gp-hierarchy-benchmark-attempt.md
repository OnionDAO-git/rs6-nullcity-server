# S8c AP/GP Hierarchy + Library Strategy Evidence Attempt (2026-05-29)

Packet: `S8c` (lane D)  
Issue link: `QA-20260529-008`

## What Landed

- Added AP/GP hierarchy knowledge entry: `economy-ap-gp-goal-hierarchy`.
- Added AP/GP/Library hierarchy guardrails to Brain/Body prompts.
- Added benchmark goal mapping and task substrate:
  - `ap-gp-library-strategy-5m`
  - benchmark resident attention override for low-AP pressure
  - CLI/core benchmark wiring + tests.

## Verification That Passed

- Focused tests:
  - `src/controller/knowledge/knowledge-retriever.test.ts`
  - `src/controller/knowledge/game-skill-context.test.ts`
  - `src/controller/thinking/hybrid-agent-prompts.test.ts`
  - `src/controller/spark/runescape-brain-planner.test.ts`
  - `src/controller/benchmarks/tasks/ap-gp-library-strategy-5m.test.ts`
  - `src/controller/benchmarks/cli.test.ts`
- Boundary/build checks:
  - `npm run check:no-ui`
  - `npm run build`
- Benchmark dry-run proof:
  - `npm run controller:bench -- --task ap-gp-library-strategy-5m --module onion.runescape.standard --mode autonomous --dry-run`
  - Output task id/version: `ap-gp-library-strategy-5m@0.1.0`.

## Blocker

Live autonomous benchmark artifact capture failed in this sandbox:

- Command: `npm run controller:bench -- --task ap-gp-library-strategy-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29`
- Error: `connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`

This matches the existing loopback restriction pattern already tracked in weekend QA.

## Next Action

Re-run the same command on a loopback-permitted host, then fold the produced artifact id into:

- `docs/resident-capabilities.md` AP/GP goal-hierarchy row
- `docs/issue-register.md` `QA-20260529-008` status update.
