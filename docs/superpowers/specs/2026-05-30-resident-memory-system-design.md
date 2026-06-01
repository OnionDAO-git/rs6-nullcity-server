# Resident Memory System — Design (S-MEM)

**Status:** Design draft. Recommends an approach; maintainer must approve before integration begins.
**Author:** claude (autonomous, D-WEEKEND-DESIGN packet).
**Date:** 2026-05-30.
**Roadmap:** Workstream S (cross-cutting). Not currently a parent S task; spec proposes adding **S13: Resident Memory System** to the roadmap.
**Read first:**
- `docs/2026-05-29-cic-meetup-decisions.md` — Library as accumulated strategy is core.
- `docs/memory-capabilities-report-2026-05-28.md` — current memory state of the world.
- `src/controller/memory/` — existing durable memory layer (`facts/`, runtime-state, library timelines).
- `src/controller/knowledge/knowledge-retriever.ts` — current retrieval surface used in prompt envelopes.

---

## Purpose

Residents already have: durable Library timelines (per-resident event log), `facts/<topic>.md` files (CQA8 wrote `facts/world-events.md`), runtime state cache, and a static knowledge corpus retrieved into the prompt envelope. What is **missing** is a coherent **resident memory** layer that answers questions like:

- "Six hours ago a patron promised me support. Did they follow through?"
- "Last week res:hans said the fishing spot near Lumbridge bridge yields steady GP. Where exactly?"
- "I tried this combat target three times and died once. Is that a no-go?"

The CIC meeting raised this directly (James's Thursday action item): pick one of mem0, qmd, or MCP-snippet-fetch as the resident memory substrate. This spec compares the three options against our concrete needs and recommends one.

## Decisions to make (maintainer-blocking)

1. **Approach choice.** Recommendation in §Proposed approach: mem0 for semantic recall on top of existing durable memory, with qmd as a fallback if Anthropic-managed dependency is unacceptable. Maintainer must pick.
2. **Local vs hosted.** mem0 supports both; hosted is easier, local is safer for resident privacy and offline-ability. Recommendation: **local with file-backed vector store** to match the rest of our file-first persistence story.
3. **Retention policy.** How long does a resident remember a fact before it decays/summarizes? Recommendation: **never delete; summarize after 30 days into a per-topic rollup; keep raw events forever in Library**.
4. **Scope of writes.** Should the memory layer write back from in-game perception (every chat, every action result) or only from explicit "I should remember this" decisions? Recommendation: **explicit-decision-driven writes only**, to avoid memory soup; perception still streams to Library as today.

## Background — the three options

### A. mem0 (https://github.com/mem0ai/mem0)

- Python/TypeScript library that wraps a vector store + an LLM-driven "fact extraction + dedup + update" loop.
- Pros: handles dedup, conflicting-fact resolution, and search-by-meaning out of the box; active community; we can run it locally with a local embedding model.
- Cons: another dependency; designed assuming continuous LLM calls for fact extraction (adds latency + cost); needs vector store config.
- Fit: strong for "what do I remember about <topic>?" lookups in prompt envelope; weak for "list all facts written in last hour" (not its strength).

### B. qmd (quick markdown directory)

- Hypothetical local pattern: just write `data/controller/memory/<resident>/qmd/<topic>.md` and grep it. No deps. CQA8's `facts/world-events.md` is a proto-version.
- Pros: zero deps, zero cost, plays nice with our existing file-first persistence; transparent to humans inspecting `data/`.
- Cons: no semantic search; manual topic naming creates fragmentation (`fishing`, `fishing-spots`, `fish-spots`); scaling to 30 residents × N topics gets messy.
- Fit: strong for small per-topic blocks; weak for cross-topic recall ("what do I know about the patron who funded my birth?").

### C. MCP-snippet-fetch (tool-use, not memory)

- Treat memory not as a store but as a callable MCP tool: resident's Brain calls `tool.search_memory({query})` mid-inference and gets back the top-K snippets from a backing store (could be Library timelines, could be a vector index).
- Pros: aligned with our existing MCP facade (RB-MCP); puts memory under the same authorization/observability layer as routines; lazy — pays cost only when Brain wants memory.
- Cons: requires Brain to learn when to call the tool (training signal, not just prompt); adds a tool-use round trip per memory query.
- Fit: strong for "Brain explicitly asks before deciding"; weak for "memory must already be in the prompt envelope without a round trip" (the common case).

## Proposed approach (recommendation)

**Hybrid: mem0-backed semantic memory + qmd-backed per-topic facts + MCP snippet-fetch as the explicit lookup tool.** Each option wins a different use case; we already have qmd in seed form. The recommendation is to formalize all three under a single `ResidentMemoryService` facade.

```
                      ┌──────────────────────────────────────────────┐
                      │ ResidentMemoryService                        │
                      │   (new: src/controller/memory/resident-     │
                      │   memory.ts)                                 │
                      └──┬──────────────┬──────────────┬─────────────┘
                         │              │              │
            ┌────────────▼─┐ ┌──────────▼──────┐ ┌─────▼────────┐
            │ FactsStore   │ │ SemanticMemory  │ │ LibraryRead   │
            │ (qmd: per-   │ │ (mem0 wrapper:  │ │ (existing     │
            │  topic .md)  │ │  vector + LLM   │ │  timelines    │
            │              │ │  dedup; LOCAL)  │ │  paginator)   │
            └──────────────┘ └─────────────────┘ └───────────────┘
                                        ▲
                                        │
                              ┌─────────┴────────────┐
                              │ MCP tool:            │
                              │ search_memory(query) │
                              │ recall_about(topic)  │
                              │ remember_fact(text)  │
                              └──────────────────────┘
```

### Read paths

- **Prompt envelope (default):** `ResidentMemoryService.relevantTo(currentSituation)` returns top-K facts + top-K semantic snippets. Drops into the existing prompt envelope between knowledge and perception blocks.
- **Brain tool call:** Brain may call `search_memory({query})` mid-inference for follow-up lookups. Returns a list of snippets with source + timestamp.
- **Operator/dashboard:** `GET /api/nullcity/residents/:name/memory?topic=<t>` returns the rendered qmd + the top semantic facts; lets humans see what their resident "knows".

### Write paths

- **Explicit decision:** Brain outputs `{ remember: { topic, fact, why } }` in its decision JSON; the runtime calls `ResidentMemoryService.rememberFact(...)` which writes to both qmd and the semantic index. Prevents memory soup.
- **Library auto-promotion:** A configurable promotion rule (e.g. `goal_achieved`, `patron_witness`, `cross-resident-significant-event`) auto-writes a memory entry without Brain decision.
- **Operator manual:** Admin CLI `npm run memory:set <resident> <topic> <fact>` for emergency surgery (e.g. correct a hallucinated memory).

### Conflict resolution

mem0 already handles "fact A says X, fact B says X', merge or pick newer" via its LLM update loop. For qmd, we use an append-only-with-timestamps pattern; newer entries dominate but older ones remain readable.

### Privacy / cross-resident isolation

`ResidentMemoryService` is **per-resident-isolated**. Resident A cannot read Resident B's memory. The LoreBus (already exists) is the only cross-resident channel; resident A might *learn* something from LoreBus and choose to write it to their own memory. No global memory pool.

### Cost / latency

- qmd writes/reads are free.
- Semantic write requires an embedding (local model, cheap).
- Semantic dedup requires an LLM call (use the cheap profile, not the storyteller profile).
- Brain tool-call read is one extra inference round trip; only when Brain opts in.

## Definition of done

- `ResidentMemoryService` exists with `relevantTo`, `rememberFact`, `searchSemantic`, `readTopic` methods.
- `FactsStore` formalizes qmd path layout and append API; CQA8's `facts/world-events.md` migrates cleanly.
- `SemanticMemory` wraps mem0 (local vector store config, no hosted dependency) behind a typed interface; if mem0 is rejected, the interface allows a swap to a hand-rolled embedding+SQLite store.
- MCP tools `search_memory`, `recall_about`, `remember_fact` are added to the existing RoutineRunner / MCP facade with the same auth model.
- Prompt envelope gets a new "Memory" block; envelope tests pass and capability tests prove a resident recalls a fact written 30+ minutes earlier.
- `GET /api/nullcity/residents/:name/memory` JSON route returns rendered memory.
- Per-resident isolation has a focused test (resident A reads cannot return resident B writes).
- `docs/resident-capabilities.md` gains a "remembers explicit fact across runtime restart" row with proof.

## Open questions

- **OQ-1:** What embedding model? Local options: `bge-small-en-v1.5`, `all-MiniLM-L6-v2`. Recommendation: BGE small for quality/size balance.
- **OQ-2:** Should runtime restart reload the semantic index from disk or rebuild? Default: reload from disk (mem0 supports persistent backends).
- **OQ-3:** When the Brain decides "remember this", should the fact also stream to LoreBus so peer residents could learn? Default: no — explicit memory is private; LoreBus stays event-driven.
- **OQ-4:** What's the retention cap before summarization kicks in? Default: 90 days raw, then summarize via cheap LLM into a topic rollup. Maintainer should agree before turning on.

## Out of scope

- Cross-resident shared memory pool (no global "city brain").
- Image / non-text memory.
- Replacing the existing Library timelines (memory layers on top, doesn't replace).
- Memory editing UI in the dashboard (read-only first; edit comes later).
- A separate "personal journal" surface (covered by qmd facts; no extra layer).

## Packet decomposition

- **S-MEM-1: ResidentMemoryService facade + FactsStore formalization** (cloud-doable). Build the typed interface, migrate CQA8's `facts/world-events.md` to the new path layout, add `relevantTo` + `readTopic` reads, document the surface. No mem0/semantic yet. Tests: per-resident isolation, append-only with timestamps, restart-survival. DoD: existing `world-events.md` flow keeps working through the facade. **No live stack needed.**

- **S-MEM-2: Semantic memory (mem0 local) + prompt envelope block** (cloud-doable for substrate, live for capability proof). Wire mem0 with local embedding + persistent backend, add `searchSemantic` API, inject "Memory" block into prompt envelope, write tests proving a fact written N minutes earlier is retrievable. DoD: a fixture resident remembers a fact across runtime restart and the envelope shows it. **Substrate cloud-doable; live recall benchmark needs hot stack.**

- **S-MEM-3: Brain-driven `rememberFact` decisions + MCP tool surface** (needs hot stack + benchmark). Brain outputs `{remember: {...}}` decisions; runtime writes; MCP `search_memory` tool callable by maintainer. Capability test: a resident writes a fact via Brain decision, then recalls it via prompt-envelope-driven response. DoD: live benchmark `memory-write-recall-10m` passes. **Needs hot stack.**

- **S-MEM-4: Retention + summarization policy** (cloud-doable). Add 90-day summarization rollup via cheap LLM profile, append-only design preserved, operator override CLI. DoD: focused test: synthesized 100-fact history rolls up into a topic summary deterministically with a stub LLM. **No live stack needed (uses stub).**
