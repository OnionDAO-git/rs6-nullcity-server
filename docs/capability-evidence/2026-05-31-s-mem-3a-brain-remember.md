# S-MEM-3A - Brain rememberFact Substrate

Date: 2026-05-31
Owner: Codex
Packet: S-MEM-3A

## What Changed

Brain completions can now emit a structured `rememberFact` object or array:

```json
{
  "rememberFact": {
    "topic": "quests",
    "fact": "Cook asked for an egg, flour, and milk.",
    "reason": "NPC dialogue gave concrete quest requirements"
  }
}
```

The runtime writes those facts into the resident's formal qmd facts store through `MemoryStore.rememberFact`, so future prompt memory retrieval can surface them as `Fact memory (<topic>.md): ...`.

## Evidence

- Red tests first:
  - Parser rejected `rememberFact`.
  - `MemoryStore` had no `rememberFact` method.
  - Brain prompt did not advertise `rememberFact`.
  - Thinking-module Brain side effects did not write durable qmd facts.
- Green focused tests:
  - `npm test -- --runTestsByPath src/controller/llm/completion-parser.test.ts src/controller/memory/memory-store.test.ts src/controller/thinking/hybrid-agent-prompts.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand --no-coverage`
  - `4` suites passed
  - `318` tests passed

## Scope Notes

- No mem0, embeddings, hosted services, or paid model calls.
- This is the substrate for Brain-driven durable memory. The live `memory-write-recall-10m` benchmark remains the next confidence step.

## Follow-Ups

- Add a live benchmark where a resident hears a new fact, Brain emits `rememberFact`, waits, and later answers from qmd memory.
- Add an operator/MCP memory lookup surface after the write path has live proof.
