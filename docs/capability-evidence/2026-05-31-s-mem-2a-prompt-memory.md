# S-MEM-2A - Prompt-Visible qmd Memory Block

Date: 2026-05-31
Owner: Codex
Packet: S-MEM-2A

## What Changed

The resident prompt envelope now names retrieved continuity as `Memory:` instead of the older Library-only label. The block explicitly tells Brain/Body/small-talk paths that the entries may include qmd facts, Library notes, patron events, route/social promises, and unfinished story threads.

This keeps S-MEM-2 moving without choosing a mem0 backend yet. `FactsStore` and `MemoryStore.retrieve` already surface qmd facts such as `Fact memory (routes.md): ...`; this packet makes that surface clear to the resident model and to tests.

## Evidence

- Red test first: prompt tests failed because both Brain/Body and small-talk prompts still said `Recent Library memories and resident notes`.
- Green test: `npm test -- --runTestsByPath src/controller/thinking/hybrid-agent-prompts.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand --no-coverage`
  - `2` suites passed
  - `308` tests passed

## Scope Notes

- No mem0 or hosted semantic backend was added.
- No paid model calls were made.
- This is a substrate/prompt clarity packet; live long-delay recall remains S-MEM-3.

## Follow-Ups

- Decide the semantic backend for the rest of S-MEM-2: mem0 local, qmd-only, or MCP snippet fetch.
- Add Brain-driven `rememberFact` decisions and a `memory-write-recall-10m` live benchmark in S-MEM-3.
