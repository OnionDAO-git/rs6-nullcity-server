# Null City Memory Capabilities Report - 2026-05-28

Prepared for James's planning meeting. This is the human-readable version: what resident memory does now, what is weak, what we learned about qmd and mem0, and what changed in the current memory branch.

## TL;DR

**Recommendation: keep the controller-owned memory system, add compact durable facts plus memory telemetry now, then evaluate qmd over those facts before trying a mem0 production switch.**

Why:

- Residents already have persistent memory files, Library timelines, portraits, patron memories, SPARK module memory, and runtime state.
- The weakest part is not "can we store things?" It is "can we reliably retrieve the right old thing after hours of noisy game events?"
- qmd-style search is a good fit for compact resident-local facts, but it should not index raw trajectory logs.
- mem0 is promising for human relationship memory and Storyteller summaries, but its useful mode depends on LLM extraction/update/delete. That adds cost, latency, provider config, and another moving part.
- New telemetry is now available so we can measure whether residents are actually retrieving memories and which source provided them.

## What Residents Remember Today

The current system can persist:

- runtime state: attention, death/revival state, active movement, stuck state, cooldowns, active trades;
- Library timelines: speech, progress, patron events, deaths, revivals, stuck/recovery moments;
- portraits and biography artifacts;
- patron memories with a protected retrieval slice so Shard gifts and asks are not evicted by stuck/say spam;
- social/event/monster/skill markdown memories;
- SPARK module-local memory;
- compact durable facts in `facts/*.md` on the memory branch.

The new durable fact layer records high-signal events:

- human chat/whispers that sound like instructions, promises, requests, patron support, or future commitments;
- NPC dialogue and quest-like prompts;
- death locations and danger hints;
- skill level gains;
- patron gifts, asks, witnesses, and sponsorships.

## Current Quality: Honest Assessment

**Storage: good.** We have resident-local files that survive restarts and are inspectable by humans and agents.

**Retrieval: medium, improving.** Before this branch, old facts buried in scattered markdown or JSONL were easy to miss if qmd was unavailable. The durable fact search fixes the largest near-term gap by searching compact `facts/*.md` before noisy recent timelines.

**Behavioral proof: still needs work.** Existing tests prove memory enters prompts and seeded facts can be recalled. We still need live/benchmark evidence that residents change actions because of memory: avoiding a death location, answering a human based on a past ask, returning to a bank/resource route, or honoring a patron promise.

## qmd vs mem0

### qmd

Best for:

- local, cheap search over resident files;
- "find the relevant fact" from compact markdown;
- agent-readable and human-readable debugging;
- no paid API call per memory query.

Risks:

- the current runtime does not have a reliable qmd install path everywhere;
- the existing controller integration expects one CLI shape, while the npm qmd probe exposed a different shape;
- indexing raw logs is too heavy and noisy. A probe over raw markdown plus JSONL produced a multi-GB index.

Recommended use:

- index only compact durable facts and curated resident notes;
- treat qmd as a retrieval accelerator, not the source of truth;
- keep markdown facts as the canonical memory substrate.

### mem0

Best for:

- higher-level human relationship memory;
- managed updates such as "James used to want X, now he wants Y";
- Storyteller memory and periodic world-state summaries;
- future experiments where a smart model extracts, merges, and deletes memories.

Risks:

- the useful mode depends on LLM inference, provider adapters, API keys, and ongoing cost;
- raw no-LLM vector search did not look strong enough to replace the current system;
- calling mem0 on every tick would be too expensive and operationally fragile.

Recommended use:

- test mem0 in isolation as a background distiller for patron/social/story memory;
- do not replace resident core memory with mem0 before we have benchmark evidence;
- never send raw game spam directly into mem0.

## New Memory Telemetry

The memory branch now logs memory usage to:

```text
data/controller/logs/memory-usage.jsonl
```

Each retrieval logs:

- timestamp;
- resident;
- query hash and bounded preview;
- retrieval limit;
- duration in milliseconds;
- result count;
- source counts for `patron`, `facts`, `library`, `index`, `targeted`, and `qmd`;
- top source labels.

Each memory write logs:

- timestamp;
- resident;
- relative path;
- append/replace mode;
- character count;
- line count;
- content hash and bounded preview.

Why this matters:

- capability agents can see whether a resident is retrieving memory at all;
- qmd and mem0 can be compared against the same source-count/timing surface;
- we can detect "memory exists but the resident never uses it";
- we can later correlate retrieved facts with action outcomes.

## What To Measure Next

Memory should not be judged by a unit test alone. The next benchmark set should test behavior:

1. **Human promise recall.** A human tells Hans, "remember I promised Codex shrimp." Ten minutes later, ask what James promised.
2. **Quest recall.** An NPC asks for items. The resident walks away, then must recall the requested items.
3. **Death avoidance.** A resident dies near a specific danger. On the next life, it should avoid or flee that area earlier.
4. **Patron influence.** A patron gift or ask should appear in memory telemetry and affect the next resident statement or action.
5. **Route memory.** A resident learns a bank/resource location, then later uses it without being re-told.

Success should mean:

- the right memory source appears in `memory-usage.jsonl`;
- the retrieved content is relevant;
- the resident's next speech or action references or uses the memory;
- the behavior improves compared with a no-memory control.

## Recommendation For This Week

Ship compact durable facts and memory telemetry. Then:

1. Run capability QA against the telemetry log for one live session.
2. Add qmd/BM25 search over `facts/*.md` only.
3. Use the telemetry log to prove whether qmd improves hit rate or latency.
4. Test mem0 only for relationship/story distillation, not per-tick resident memory.

This gives us a foundation that is useful today and still leaves room for the harder memory engines when the benchmarks justify them.
