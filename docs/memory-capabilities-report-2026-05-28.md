# Null City Memory Capabilities Report - 2026-05-28

Prepared for James's 7pm meeting. This is a practical readiness report: what memory does today, what is proven by data, what is weak, and whether it is worth switching to a new memory engine right now.

## TL;DR

**Verdict: keep the current custom memory system for this week, add a real retrieval/index layer, and do not switch wholesale to mem0 before tonight's planning meeting.**

What works:

- Residents persist runtime state, routed event memories, social memories, Library timelines, portraits, patron memories, and SPARK module-local memory.
- Memory is read back into brain/body prompts.
- The existing `memory-recall-3m` benchmark passes across Qwen, Qwopus, and Haiku.
- Patron memories have a protected prompt slice so Shard gifts/asks survive normal stuck/say noise.

What is weak:

- `qmd` is configured but not actually available in the current runtime (`qmd not found` locally).
- The fallback retrieval mostly returns recent Library events plus `INDEX.md`; it does not reliably search old scattered facts.
- Raw timelines are very noisy and huge. Indexing all markdown + JSONL with QMD produced a **5.3 GB** local index.
- The current memory benchmark is too easy. It proves plumbing, not robust long-term memory.

Best next step:

1. Add a small, controller-owned "important facts" compaction file per resident.
2. Route durable facts into it: human requests, patron promises, NPC quest asks, death locations, learned routes, bank/resource discoveries.
3. Enable QMD/BM25-style search over compact markdown facts, not raw trajectory JSONL.
4. Add a harder `memory-recall-noisy-10m` benchmark before adopting mem0.

## Current System, High Level

The deployed resident memory system is file-backed and controller-owned:

- `data/controller/memory/<resident>/runtime-state.json`
  - attention, tick counters, active movement, stuck state, death/revival state, cooldowns.
- `data/controller/memory/<resident>/INDEX.md`
  - always included in prompt context.
- `data/controller/memory/<resident>/social/*.md`
  - routed chat/whisper memories by actor.
- `data/controller/memory/<resident>/events/*.md`
  - generic routed events.
- `data/controller/memory/<resident>/monsters/*.md`
  - combat/death-related routed monster events.
- `data/controller/memory/<resident>/skills.md`
  - level-up and skill-related routed events.
- `data/controller/memory/library/<resident>/timeline.jsonl`
  - Library timeline moments: speech, first XP, stuck/recovered, revival, patron events, deaths.
- `data/controller/memory/library/<resident>/portrait.md`
  - human-facing Library biography.
- `modules/<module-id>/...`
  - namespaced SPARK module-local memory, guarded against path traversal.

Prompt use:

- Brain planning retrieves memory with `MemoryStore.retrieve(...)`.
- Body chat uses `promptMemories(...)` and `promptMemorySection(...)`.
- Patron events are read from Library timelines using a dedicated patron-only slice before general recent memories.

## Data Snapshot

Commands/evidence checked:

- `find data/controller/memory -maxdepth 4 -type f | wc -l`
- `find data/controller/memory/library -name timeline.jsonl | wc -l`
- `find data/controller/memory -maxdepth 3 -path '*social/*.md' | wc -l`
- `find data/controller/memory -maxdepth 3 -path '*events/*.md' | wc -l`
- `find data/controller/memory -maxdepth 3 -path '*monsters/*.md' | wc -l`
- Existing benchmark artifacts under:
  - `data/benchmarks/model-intelligence-2026-05-27`
  - `data/benchmarks/model-intelligence-paid-2026-05-27`
  - `data/benchmarks/capability-qa-2026-05-28`
- Focused memory tests:
  - `npm test -- --runInBand src/controller/memory/memory-store.test.ts src/controller/spark/module-memory.test.ts src/controller/benchmarks/tasks/memory-recall-3m.test.ts src/controller/evidence/library-memories.test.ts`

Observed memory substrate:

| Signal | Count |
|---|---:|
| Files under `data/controller/memory` | 1,252 |
| Library timelines | 23 |
| Resident `INDEX.md` files | 25 |
| Resident `runtime-state.json` files | 25 |
| Social memory markdown files | 312 |
| Event memory markdown files | 118 |
| Monster memory markdown files | 3 |

Focused memory/unit verification:

| Test area | Result |
|---|---:|
| MemoryStore + Library memories + SPARK module memory + memory benchmark verifier | 35/35 passing |

Existing memory recall benchmark:

| Profile | `memory-recall-3m` result | Duration |
|---|---:|---:|
| Qwen local | Pass | ~21.6s |
| Qwopus local | Pass | ~10.6-21.3s |
| Haiku via OpenRouter | Pass | ~2.9s |

Interpretation: all profiles can use memory when the fact is freshly seeded and directly asked about. This benchmark is useful regression coverage, but it is too easy to prove durable memory intelligence.

## What Residents Remember Today

They can remember and reuse:

- recent patron gifts, asks, witnesses, Shard amounts, and attention deltas;
- recent Library timeline moments;
- manual/index patch notes in `INDEX.md`;
- routed chat/whisper lines by speaker;
- routed monster/death/combat events when those events are emitted;
- routed skill events;
- SPARK module-local notes.

They do **not yet reliably remember**:

- arbitrary old facts buried in social/event markdown;
- NPC quest asks unless routed/compacted into a searchable fact;
- "where I died" in a way that consistently comes back during future survival planning;
- long-term route/location discoveries unless they land in `INDEX.md`, recent Library memory, or an exact targeted file;
- noisy memories after thousands of stuck/say events without a compaction layer.

## Retrieval Weakness Found

I ran a controlled fixture with four durable facts and 500 noisy stuck/say lines:

- Alice gave a tinderbox and asked the resident to remember a shrimp promise for Codex.
- Draynor bank is near `3092,3243`.
- The resident died to a goblin near Lumbridge cow pen at `3238,3296`.
- Cook asked for egg, milk, and flour.

Current markdown fallback retrieved only `INDEX.md` for natural questions:

| Query | Current fallback result |
|---|---|
| `alice shrimp promise` | `INDEX.md` only |
| `where is draynor bank safe fish` | `INDEX.md` only |
| `where did I die to goblin cow pen` | `INDEX.md` only |
| `what did cook ask for assistant quest` | `INDEX.md` only |

Why: `MemoryStore.retrieve(...)` currently uses recent Library events, `INDEX.md`, an exact query-to-filename targeted lookup, and optional `qmd`. If optional `qmd` is missing, natural queries do not search all resident markdown.

## QMD Evaluation

Two QMD routes were tested in an isolated worktree/branch:

- Branch: `codex/memory-engine-eval-2026-05-28`
- Worktree: `/Users/james/Code/OnionDAO/rs6-nullcity-server-memory-eval`

### QMD Cargo Install

Command:

```bash
cargo install qmd-cli --root /tmp/nullcity-qmd-eval
```

Result:

- Failed because `cmake` is not installed.
- The official shell installer also failed because the GitHub repo has tags but no `latest` release endpoint/assets for the script to download in this environment.

Meaning:

- The current `qmdBin: qmd` configuration is not enough. We need a reliable installation path before depending on qmd in production.

### NPM QMD Probe

Command shape:

```bash
npx --yes @tobilu/qmd --index nullcity-memory-eval collection add \
  /Users/james/Code/OnionDAO/rs6-nullcity-server/data/controller/memory \
  --name controller-memory
```

Markdown-only result:

| Indexed files | Index size |
|---:|---:|
| 523 markdown files | 398.5 MB |

Markdown + JSONL result:

| Indexed files | Index size |
|---:|---:|
| 1,111 files | 5.3 GB |

Retrieval result:

- QMD found exact fact files in the controlled fixture when query terms were clear, while the fallback returned only `INDEX.md`.
- QMD found real patron/Library evidence for Hans when JSONL was included.
- QMD over raw JSONL is too heavy/noisy for the live controller path.

Recommendation:

- QMD/BM25-style retrieval is useful, but only over compact durable markdown facts.
- Do not index raw trajectory/timeline JSONL directly in the resident loop.
- If using npm QMD, the controller integration must change because the current code expects a different CLI shape: `qmd collection add <collection> <root>` and `qmd query --collection <resident> --json <query>`.

## mem0 Evaluation

Isolated environment:

```bash
python3 -m venv /tmp/nullcity-mem0-venv
/tmp/nullcity-mem0-venv/bin/python -m pip install mem0ai
```

Install/import result:

- `mem0ai` installed successfully.
- `from mem0 import Memory` worked.
- `Memory()` without credentials fails with missing OpenAI credentials, as expected.

Local no-LLM probe:

- Installed `fastembed` and `faiss-cpu`.
- Configured mem0 with FAISS + FastEmbed and `infer=False`.
- Raw facts could be added.
- Search worked mechanically, but rankings were bad in the tiny fixture: relevant memories often appeared below unrelated memories.

Interpretation:

- mem0 is not attractive as a cheap raw vector store replacement.
- mem0's real value is likely its LLM-mediated memory extraction/update/delete flow (`infer=True`), user/agent/run scoping, and memory lifecycle.
- That flow means API keys, provider adapters, costs, and a second service/runtime boundary. It is too risky to switch the resident core to mem0 before tonight's planning meeting.

Best use of mem0 later:

- Human relationship memory: "James asked me for shrimp", "Alice is a supporter", "Dev instructed this resident to avoid combat".
- Storyteller memory: periodic distilled world state.
- Cross-session patron memory if we want managed update/delete semantics.

Not recommended this week:

- Replacing all resident game memory with mem0.
- Sending raw trajectory logs into mem0.
- Calling mem0 on every tick.

## Recommended Architecture For This Week

Use a three-tier memory stack:

### Tier 1: Runtime State

Keep current `runtime-state.json`.

Purpose:

- attention;
- stuck state;
- active movement;
- cooldowns;
- death/revival;
- active trade state;
- current goal/runtime flags.

### Tier 2: Durable Fact Markdown

Add or formalize a compact fact file:

```text
data/controller/memory/<resident>/facts.md
```

or per-domain files:

```text
facts/social.md
facts/routes.md
facts/quests.md
facts/deaths.md
facts/patrons.md
```

Purpose:

- human asks/promises;
- patron influence;
- NPC quest requirements;
- discovered routes/banks/resources;
- dangerous places and death locations;
- named relationship facts;
- "goal-as-orientation" progress.

This file should be compacted/deduped, not an event dump.

### Tier 3: Search Retrieval

Use QMD/BM25-style search over Tier 2 and selected markdown only.

Rules:

- Never index raw trajectory logs in the resident loop.
- Do not return more than 4-8 compact facts into prompt memory.
- Keep the existing protected patron slice.
- Keep `INDEX.md` always-included, but stop relying on humans/agents manually updating it for every fact.

## What To Tell Dev

Plain-English version:

> We already have memory plumbing: residents write events, state, social notes, patron events, timelines, and portraits, and those memories are read back into prompts. The weak part is retrieval quality. Without qmd installed, the controller mostly recalls recent Library entries and index notes, not arbitrary older facts. I tested qmd and mem0 in isolation. QMD/BM25 is a better near-term fit if we compact facts first. mem0 installs, but without its LLM extraction path it is not better, and with LLM extraction it becomes a bigger architectural/cost decision. I recommend we harden our custom memory system now and evaluate mem0 later for human relationship memory and the Storyteller.

Meeting-safe answer:

- Current custom memory: **real, working, but shallow retrieval**.
- QMD: **promising near-term search layer, needs install/integration fix and compact facts**.
- mem0: **promising later, not a quick switch**.
- Best next build: **facts compaction + harder memory benchmark**.

## Next Engineering Tasks

1. **Add `memory-recall-noisy-10m` benchmark.**
   - Seed 4-6 facts.
   - Add large stuck/say noise.
   - Ask delayed natural questions.
   - Score exact recall and wrong-memory hallucinations.

2. **Implement durable fact compaction.**
   - Extract from patron asks/gifts, NPC dialogue, death events, quest clues, discovered locations.
   - Write to compact markdown facts files.
   - Dedupe repeated stuck/say/template noise.

3. **Fix QMD integration behind an adapter.**
   - Detect CLI flavor/version.
   - Support npm QMD command shape or choose one package and document install.
   - Query only compact markdown.
   - Add tests proving fallback still works if qmd is missing.

4. **Run A/B memory test.**
   - Baseline fallback.
   - Compact facts without QMD.
   - Compact facts + QMD.
   - mem0 infer=False local.
   - mem0 infer=True with paid model, if we accept cost.

5. **Defer mem0 production switch.**
   - Keep it in an evaluation branch until it wins on benchmark data.

## Bottom Line

Memory is not fake. Residents do persist and recall some things. But it is not yet the "smart RPG companion memory" we want.

The fastest credible path is not a wholesale memory-engine replacement. It is:

1. compact important facts,
2. search those facts well,
3. prove it with a harder benchmark,
4. optionally add mem0 later for high-value human relationship/story memory.
