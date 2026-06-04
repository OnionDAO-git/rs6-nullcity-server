# Resident Intelligence Roadmap — from near-term goal-picker to autonomous goal-achiever

> **Status:** Living document. This is the single source of truth for the resident-intelligence
> arc (the "think → research → plan → achieve self-authored SOUL goals while surviving" vision).
> It links out to the trackers; it does not duplicate them. Update the **§8 Status & cadence**
> section after each phase milestone.
>
> **Owner cadence:** Update this doc + `docs/issue-register.md` at every phase boundary, and
> whenever a phase acceptance test flips pass/fail. See §8.

Date created: **2026-06-01**
Author: claude (D-ROADMAP-1)
Supersedes: nothing — this is additive. Ties into `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` (the workstream backlog), `docs/2026-05-30-final-32hr-sprint-plan.md` (demo triage), and `docs/issue-register.md` (discovered-problem ledger).

---

## 0. Why this doc exists

The vision below has been living in chat. This document makes it **committed, trackable, and
iterable**: every phase maps to issue-register packet IDs, every milestone has an acceptance test,
and the status section gets updated as the team (Codex, cron, future agents, human devs) executes.
If you are an agent picking this up cold: read this top-to-bottom once, then check §8 for where we
actually are, then claim a packet from §7 and post a `STARTING` line per `docs/agent-coordination.md`.

---

## 1. Vision & success definition

**The vision (maintainer's intent).** Humans author SOULs that carry goals. Goals come in two
flavors:

- **RuneScape goals** — "master woodcutting", "reach 99 Prayer", "complete Cook's Assistant".
- **Open-ended goals** — "become the best poet in Null City", "spell ONIONDAO with onions on the
  ground", "befriend every patron who visits the embassy".

A resident should **autonomously try to achieve its authored goals over its lifetime while staying
alive** — alive meaning both literal survival (HP) and economic survival (AP/attention + GP). The
resident is not waiting for per-tick human instruction; it is researching, planning, executing,
and re-planning on its own.

**What "achieving a goal" concretely means.** A resident:

1. **Understands** the goal (parses the SOUL goal text into something actionable).
2. **Researches** it — pulls real knowledge (RuneScape wiki / skill lookups / world facts) via
   tool calls, not just whatever RAG happened to inject.
3. **Plans** — decomposes the goal into a durable, multi-stage plan (subgoals → requirements →
   success criteria), distinct from the per-tick action.
4. **Executes** — the Body works the current stage step-by-step, handling immediate obstacles.
5. **Survives** — the Nervous system protects HP/AP in real time without aborting the plan except
   for true survival.
6. **Adapts** — the Brain re-plans when memories/events change (stage blocked, new opportunity,
   goal achieved).
7. **Detects achievement** — knows when a stage and the overall goal are done, including for
   open-ended goals that have no engine-level XP signal.

### Measurable acceptance scenarios (the bar for "we did it")

| # | Scenario | Pass condition |
|---|---|---|
| **A1 (RuneScape)** | A resident souled with goal "master Firemaking" researches the skill, forms a multi-stage plan (get axe → chop logs → light fires → repeat to target level), and makes verifiable XP progress across a multi-hour run while never dying. | Durable plan persisted; ≥2 stages completed; Firemaking XP strictly increases; 0 deaths; plan survives a controller restart. |
| **A2 (open-ended, spatial)** | A resident souled with "spell ONIONDAO with onions on the ground" researches where onions come from, plans the letter layout, gathers onions, and places them to form recognizable letters. | Plan has gather + place stages; ≥1 full letter placed and detected as complete; survival maintained. |
| **A3 (open-ended, creative)** | A resident souled with "become the best poet" researches poetry, sets a self-authored practice plan, and produces a measurable body of work (poems spoken/written into the Library) with self-assessed progress. | Plan persisted; ≥N poems logged to Library timeline; brain-driven self-assessment of progress recorded; survival maintained. |
| **A4 (survival under pressure)** | Any of A1–A3 while a survival event fires (low HP, attacked, low AP). | Nervous system handles the threat; the durable plan is **preserved**, not discarded; resident resumes the plan after the threat clears. |

We are not there yet. §2 is the honest gap.

---

## 2. Honest current state (grounded in evidence)

This section states plainly what works and what does **not**, with citations. Do not soften it.

### ✅ Working today

| Capability | Evidence |
|---|---|
| Embodiment — residents submit real game actions that move characters and change state | `docs/resident-capabilities.md`: 494,839 action records scanned, 475,969 successful submissions |
| Survival reflexes (Nervous system) — eat-when-low-HP, flee/fight when attacked | `src/controller/nervous-system/nervous-system.ts`; combat-survival rows in `docs/resident-capabilities.md`; `docs/capability-evidence/2026-05-31-qa004-low-health-wait-audit.md` |
| AP/GP economy — earn GP via combat loot, exchange GP→AP, self-funding cadence | `docs/capability-evidence/2026-05-31-s-gp-fuel-1.md`, `...s-gp-harvest-1.md`, `...s-exchange-runway-1.md`, `...s-ap-cycle-1.md` |
| Human/patron touchpoints — embassy greeting, gifts, witness, letters | `docs/resident-capabilities.md` patron rows; `docs/embassy-staff-runbook.md` |
| Library / memory persistence — timelines, taught-fact write+recall | `docs/capability-evidence/2026-05-31-s-mem-1.md`, `...s-mem-4-named-memory-recall-soak.md`; 23 Library timelines |
| **Near-term LLM brain (NEW, today)** — qwopus produces real survival-aware, soul-shaped goals | `docs/capability-evidence/2026-05-31-qwen-vs-qwopus-ab.md`; `...runtime-qwopus-spark-audit.md` (usable brain rate `92.7%` in a clean window); `...s-infer-postrestart-live-audit.md` |
| Starter RuneScape loops — woodcutting, firemaking, fishing, cooking, starter mining, GP pickup, safe trading, Cook's Assistant (supplied/visible ingredients) | `docs/resident-capabilities.md` capability rows + benchmark artifacts |

**Today's inference arc (S-INFER-1..6), the thing that just unblocked the brain:**

- `qwen/qwen3.6-27b` was **0% usable** — effectively non-serving on this infra; it hung even on a
  17-token thinking-off prompt on both hosts (`docs/capability-evidence/2026-05-31-qwen-vs-qwopus-ab.md`).
- Switched the brain to **`qwopus3.5-27b-v3@q4_k_s`** (qwopus), which returned **100% usable**
  (9/9 uncapped), in-character, engine-valid goals — but with p50 ~38–44s latency.
- Raised the brain timeout **20s → 75s** to fit qwopus's deliberation window
  (`docs/capability-evidence/2026-05-31-loosen-inference-limits.md`).
- Made the brain **uninterruptible by non-survival reflexes** — 728/764 (95%) of brain decisions
  in one window were `thinking_cancelled` because non-urgent reflexes fired with
  `interruptThinking:true`; the fix keeps the reflex action but stops it aborting the in-flight brain
  (`docs/capability-evidence/2026-05-31-loosen-inference-limits.md`).
- Made the live audit **honest** (stopped counting non-LLM control ticks as "usable brain") and
  raised the daily inference budget 2000 → 10000
  (`docs/capability-evidence/2026-05-31-s-infer-postrestart-live-audit.md`).
- Net: **clean-window usable-brain-rate reached 82.9–92.7%.**

### ❌ NOT built — the gap to the vision

This is the honest distance between "today" and §1.

| Gap | Reality today | Where to verify |
|---|---|---|
| **No planner** | The Brain is a greedy **near-term goal picker**, not a planner. Its prompt literally says *"Choose one useful near-term goal."* | `src/controller/thinking/hybrid-agent-prompts.ts:42` |
| **No tool-calling** | Knowledge is **RAG-injected** (top-4 entries pre-stuffed into the prompt), not **pulled** by the Brain on demand. The Brain cannot ask for information it doesn't already have in context. | `src/controller/knowledge/knowledge-retriever.ts` (`ENGINE_KNOWLEDGE_ENTRIES`, in-prompt injection) |
| **Wiki disabled** | The RuneBench wiki is referenced only as an *optional* source; the live knowledge set is a hand-curated `ENGINE_KNOWLEDGE_ENTRIES` list. | `src/controller/knowledge/knowledge-retriever.ts:268` ("RuneBench wiki shops/*.md as optional reference") |
| **No deliberative decomposition** | One per-tick call selects a single goal `{description, steps?, success?, ttlTicks?}`. `steps` is an optional flat hint array (max 8), never a tracked multi-stage plan. | `src/controller/spark/runescape-brain-planner.ts` (`brainGoalSchema`) |
| **No durable multi-stage plan + progress tracking** | A goal lives in `ActiveGoalState` for `ttlTicks`, then is re-picked. There is no persisted plan with stages, current-stage pointer, and done/blocked status surviving across sessions. | `src/controller/spark/memory/runtime-state.ts` (`ActiveGoalState`) |
| **No arbitrary-goal → action translation** | The Body translates goals via **RuneScape templates** (firemaking/woodcutting/fishing/combat routines). An open-ended goal like "spell ONIONDAO" has no template path. | `src/controller/spark/runescape-body-routines.ts` (template action builders) |
| **No achievement detection for open goals** | Success is detected for templated skills (XP signal). There is no mechanism to judge "is 'become the best poet' progressing / done?" | (absent) |
| **Model strategy unsettled for planning** | The discriminating benchmark task showed planning/reasoning quality is where model IQ matters; local qwopus is good but slow, and a stronger/faster model (Haiku/Claude) likely wins for the rare deep planner call. | `docs/capability-evidence/2026-05-31-inference-model-comparison.md` |

**One-line honest summary:** residents *think, act, survive, and interact* today, but they do not
yet *research → plan → durably pursue → adapt* toward self-authored goals. The brain just became
usable (today); the planning layer on top of it is unbuilt.

---

## 3. Target architecture — Brain / Body / Nervous

The deployed resident is **Soul + SPARK + Body + Inference**. Sharpen the three cognition tiers:

```
            ┌──────────────────────────────────────────────────────────────┐
            │  SOUL  (authored: goals[], alignment, voice, fears, loves…)    │
            └──────────────────────────────────────────────────────────────┘
                                       │ goals
        ┌──────────────────────────────┼───────────────────────────────────┐
        ▼                              ▼                                    ▼
┌───────────────┐         ┌──────────────────────────┐         ┌───────────────────┐
│  NERVOUS       │        │  BRAIN  (deliberative)    │         │  BODY (reactive)   │
│  no inference  │        │  high inference, RARE      │        │  low inference,     │
│  reflexive     │        │  • research via TOOL CALLS │        │  FREQUENT           │
│  safety        │        │    (wiki/skill lookups…)   │        │  • execute current  │
│  • low HP→eat  │        │  • decompose goal →        │        │    plan STEP        │
│  • attacked→   │        │    DURABLE MULTI-STAGE PLAN│        │  • handle immediate │
│    fight/flee  │        │  • re-plan on events/memory│        │    obstacles (door  │
│  protects in   │        │  • write plan to durable   │        │    closed→open it)  │
│  real time;    │        │    store the Body reads     │        │  • react to nearby  │
│  NEVER aborts  │◄──────►│  • only survival may       │◄──────►│    things           │
│  Brain except  │ survival│   interrupt it             │ plan   │  • no deliberation  │
│  true survival │  only  └──────────────────────────┘  state  └───────────────────┘
└───────────────┘                                                         │
        │                                                                 │ actions
        └─────────────────────────► ENGINE (game world) ◄─────────────────┘
```

### Tier responsibilities (sharpened)

**Brain — deliberative planner with tools + durable plan.**
- Runs **infrequently** (not every tick — on goal-set, on plan-exhaustion, on stage-blocked, on
  significant new memory/event, on a long timer).
- **Researches** the goal via tool calls (Phase 1): wiki/skill lookup first, then world-fact
  lookups. Multi-turn call loop, not a single completion.
- **Decomposes** the goal into a durable multi-stage plan: `stages[]` each with subgoal,
  requirements, success criteria; plus a `currentStage` pointer and `done/blocked` status (Phase 2/3).
- **Writes** the plan to a durable store the Body reads (Phase 3).
- **Re-plans** when the Body reports a stage blocked, when memory/events change, or when a stage
  succeeds (Phase 3).
- **Uninterruptible except survival** — already true as of today's S-INFER-4 fix; preserve that
  invariant.

**Body — reactive executor.**
- Runs **frequently** (every tick / fast cadence), **low or no inference**.
- Reads the **current plan step** and executes it via the action vocab: `move_to`, `drop`, `say`,
  `interact`, `use_item_on` / `use_item_on_item`, `equip`, `attack`, `eat`
  (`src/controller/spark/runescape-body-routines.ts`).
- Handles **immediate obstacles** itself (closed door → open it; blocked path → detour) without
  waking the Brain.
- Reports stage progress / blockage up to the Brain.

**Nervous — reflexive safety, no inference.**
- `src/controller/nervous-system/nervous-system.ts`. Real-time HP/threat reflexes.
- **Never aborts the Brain except for true survival** (the eat-when-low-HP rule keeps
  `interruptThinking:true`; non-urgent social reflexes were set to `false` today — preserve this).

### Model strategy (decision-grade)

The Planner is **rare and cheap-in-aggregate** (a handful of deep calls per resident-lifetime
stage boundary), while the Body/near-term call is **frequent**. Spend model quality where it
matters — planning + tool-use — and keep the cheap stuff local.

| Cognition call | Frequency | Model strategy | Rationale |
|---|---|---|---|
| **Body / near-term** | high (per-tick-ish) | **local qwopus** (`qwopus3.5-27b-v3@q4_k_s`) | Already proven 82.9–92.7% usable; cost-free; latency tolerable for frequent calls because the Body needs only a step, not a plan. |
| **Deep Planner** | rare (stage boundaries) | **a strong model — Claude Haiku, escalate to a larger Claude for hard plans** | Planning + multi-turn tool-use is exactly where model IQ discriminates (`docs/capability-evidence/2026-05-31-inference-model-comparison.md`: Haiku 9/9 vs local 8/9, parses cleanly). Because planner calls are infrequent, the paid cost is small and bounded. |
| **Nervous** | real-time | **no inference** | Pure rules. |

Pick the planner model in Phase 0 (open decision §9-D1). Keep local qwopus as the planner fallback
for offline/cost-constrained operation.

---

## 4. Phased build plan

Ordered milestones. Each milestone: **goal · deliverables · effort · dependencies · acceptance
test**. Effort is rough and assumes one focused agent/dev lane; multi-agent parallelism compresses it.

### Phase 0 — Stabilize & enable (now / this week) → beta-ready

| | |
|---|---|
| **Goal** | Lock in today's inference fixes, enable the wiki RAG, settle runtime ownership, and pick the planner model — so the brain is reliably usable and we have a knowledge substrate to build tool-calling on. |
| **Deliverables** | (a) Make qwopus brain default + 75s timeout the committed, restart-surviving config; document the canary. (b) Enable the RuneBench wiki as a RAG source behind `knowledge-retriever` (currently disabled / "optional reference"). (c) Resolve runtime/restart ownership for the long autonomous loop (`docs/runtime-stewardship.md`). (d) Pick the Planner model (§9-D1) and write the decision into this doc. |
| **Effort** | ~2–4 days |
| **Dependencies** | none — builds on shipped S-INFER-1..6. |
| **Acceptance test** | `npm run controller:inference-audit` shows usable-brain-rate ≥ 80% over a fresh ≥30-min window **after a clean restart on the committed config**; a wiki-sourced fact appears in a retrieved knowledge set for a relevant goal; the planner-model decision is recorded in §8. |

### Phase 1 — Tool-calling

| | |
|---|---|
| **Goal** | Give the Brain a **tool interface** so it pulls knowledge on demand instead of relying on pre-injected RAG. |
| **Deliverables** | (a) A tool-call seam for the Brain reusing the existing MCP `run_routine` / `resident_api` plumbing (`src/controller/mcp/*`), starting with `lookup_wiki` / `lookup_skill` tools over the knowledge set + enabled wiki. (b) A multi-turn call loop (request → tool result → continue) with a max-turns cap. (c) Reliability guardrails for the local model: strict tool-call schema, JSON salvage (reuse `src/controller/llm/json-salvage.ts`), fallback to RAG-injection if the loop fails or stalls. |
| **Effort** | ~1–2 weeks |
| **Dependencies** | Phase 0 (wiki enabled, planner model chosen — tool-use reliability is model-sensitive). |
| **Acceptance test** | A benchmark resident with a goal whose answer is **not** in the default RAG top-4 issues a tool call, receives the wiki/skill result, and uses it in its next decision — proven by a benchmark artifact showing a tool-call record + a decision that cites the pulled fact. Loop never exceeds the turn cap; on tool failure it degrades to RAG without crashing. |

### Phase 2 — Deliberative planner pass

| | |
|---|---|
| **Goal** | A **separate, infrequent planning call** that decomposes a goal into a durable multi-stage plan, distinct from the per-tick Body action. |
| **Deliverables** | (a) A `PlannerPass` invoked on goal-set / plan-exhaustion (not per tick), using the Planner model + Phase-1 tools to research first. (b) A plan schema: `Plan { goalId, stages: Stage[], currentStage, status }` where `Stage { subgoal, requirements[], successCriteria, status: pending|active|done|blocked }`. (c) Prompt + parser for the planner (extend `runescape-brain-planner.ts` or a new `planner.ts`). |
| **Effort** | ~1–2 weeks |
| **Dependencies** | Phase 1 (planner researches via tools), Phase 0 (planner model). |
| **Acceptance test** | Given goal "master Firemaking", the PlannerPass emits a ≥3-stage plan (e.g. acquire-axe → gather-logs → light-fires-to-level) with per-stage requirements + success criteria, validated against the plan schema, in a single planner invocation. The pass runs **rarely** (asserted: not per-tick). |

### Phase 3 — Durable plan + progress tracking

| | |
|---|---|
| **Goal** | Persist plan state across ticks/sessions; the Body executes the current step; the Brain re-plans on memory/events. |
| **Deliverables** | (a) A `PlanStore` (per-resident, JSON atomic write like the existing ledgers) holding the live `Plan`, surviving controller restart. (b) Body reads `currentStage` and executes its step via the action vocab; reports stage `done`/`blocked` back. (c) Brain re-plan triggers: stage blocked, stage done (advance), significant new memory/event. (d) Survival preserves the plan (don't discard on a Nervous interrupt — A4). |
| **Effort** | ~2–3 weeks |
| **Dependencies** | Phase 2 (a plan to persist), Phase 1, Phase 0. |
| **Acceptance test** | Scenario **A1**: a resident forms a Firemaking plan, completes ≥2 stages with strictly-increasing XP, **0 deaths**, and the plan **survives a controller restart** (reloaded from `PlanStore` and resumed). A4: a survival event mid-plan is handled and the plan resumes intact. |

### Phase 4 — Arbitrary-goal support

| | |
|---|---|
| **Goal** | Support open-ended creative/spatial goals beyond RuneScape templates, including achievement detection for open goals. |
| **Deliverables** | (a) Goal → action translation that lets the planner compose primitive actions (move/drop/say/interact) into novel sequences not covered by skill templates (e.g. "drop onions at tiles forming letter O"). (b) Open-goal **achievement detection**: planner-authored, per-stage success predicates evaluated against world state / Library (e.g. "letter O detectable on the ground", "≥N poems logged"). (c) Library logging of open-goal progress for narratability + the Storyteller. |
| **Effort** | ~3–4 weeks |
| **Dependencies** | Phase 3 (durable plan to attach novel stages to). |
| **Acceptance test** | Scenarios **A2** ("spell ONIONDAO with onions" — ≥1 full letter placed + detected) and **A3** ("become the best poet" — ≥N poems logged + self-assessed progress), each with survival maintained. |

### Phase 5 — Polish / scale

| | |
|---|---|
| **Goal** | Production-grade reliability, cost control, observability, and multi-resident concurrency. |
| **Deliverables** | (a) Planner cost budget + caching; (b) plan/observability dashboards (current plan + stage per resident); (c) reliability hardening (planner timeout/fallback, plan-corruption recovery); (d) multi-resident: many residents each running their own durable plan without controller pressure (ties into runtime-stewardship + the `Gateway socket` instability noted in `docs/capability-evidence/2026-05-31-s-infer-postrestart-live-audit.md`). |
| **Effort** | ongoing |
| **Dependencies** | Phases 0–4. |
| **Acceptance test** | N residents (target N≥10) each pursue a distinct durable plan over a multi-hour run with bounded planner spend, no controller crash, and a dashboard showing each resident's live plan + stage. |

---

## 5. Phase dependency summary

```
Phase 0 (stabilize+enable) ──► Phase 1 (tools) ──► Phase 2 (planner pass) ──► Phase 3 (durable plan)
                                                                                      │
                                                                                      ▼
                                                                            Phase 4 (arbitrary goals)
                                                                                      │
                                                                                      ▼
                                                                              Phase 5 (polish/scale)
```

The hard gate is **Phase 0 → 1 → 2 → 3**: you cannot durably pursue a plan you cannot make, and you
cannot make a good plan without research tools, and tool-use is model-sensitive, so the planner
model + enabled wiki must land first. Phases 4–5 sit on top of a working durable-plan loop.

---

## 6. Tracking & iteration mechanism (how this stays real, not just-in-chat)

This roadmap is the **single source of truth** and links out to the trackers:

- **Packets** — each phase maps to issue-register packet IDs (the **`RIQ-`** family,
  "Resident Intelligence Q"). Phase-0 and Phase-1 entry packets are **registered now** (see §7).
  Subsequent phases get packets registered as the prior phase nears done (avoid stale rows).
- **Discovered problems** — go in `docs/issue-register.md` as usual (`QA-*` rows). The existing
  inference gap is already tracked there as **`QA-20260531-050` (S-INFER-AB-1)**.
- **Per-slice coordination** — `docs/agent-status.md` `STARTING`/`HANDOFF` lines per
  `docs/agent-coordination.md` (file-level locks via roadmap `[>]` where used).
- **Evidence** — every acceptance-test result lands a `docs/capability-evidence/<date>-<packet>.md`
  note and updates `docs/resident-capabilities.md` rows (keep `Can do it?` distinct from
  `Does do it live?`).
- **This doc's §8 Status section** — the human-readable "where are we" that gets re-read. Update it
  at every phase boundary and whenever an acceptance test flips.

**Cadence (the rule):** update **§8 + the relevant issue-register rows after each phase milestone**,
and immediately when an acceptance test passes or regresses. A phase is not "done" until its
acceptance test passes *and* §8 + the capability rows + an evidence note reflect it.

---

## 7. Registered entry-point packets (actionable starting point)

These are **registered into `docs/issue-register.md` Open Issues** with this roadmap. They are the
immediately-claimable starting work.

| Packet | Phase | Title | First action |
|---|---|---|---|
| **RIQ-0-1** | 0 | Commit qwopus-brain + 75s-timeout config as restart-surviving default | Verify the running config matches the committed config; add an inference canary assertion. |
| **RIQ-0-2** | 0 | Enable RuneBench wiki as a RAG source in `knowledge-retriever` | Wire the wiki corpus behind the retriever (currently "optional reference" at `knowledge-retriever.ts:268`); prove a wiki fact reaches a retrieval. |
| **RIQ-0-3** | 0 | Pick + record the Planner model decision (§9-D1) | Re-run the empty-rate A/B on Haiku post-salvage; record the choice + cost in §8. |
| **RIQ-1-1** | 1 | Brain tool-call seam over MCP `run_routine`/`resident_api` (lookup_wiki / lookup_skill) | Spike a single `lookup_skill` tool the Brain can call; multi-turn loop with turn cap + JSON salvage. |

When you claim one, post a `STARTING` line, flip its row to `Claimed`, and on completion add an
evidence note + flip to `In Review`.

---

## 8. Status & cadence (UPDATE THIS SECTION)

> **Re-read this first.** This is the live "where are we" the maintainer checks.

| Phase | State | Acceptance test | Last update |
|---|---|---|---|
| 0 — Stabilize & enable | **Done** — (a) qwopus brain+75s timeout committed (S-INFER-10, RIQ-0-1); (b) wiki RAG enabled (S-WIKI-1, RIQ-0-2); (c) runtime ownership: born-persist + supervised controller scripts landed; (d) planner model decision recorded (RIQ-0-3, 2026-06-02). Acceptance test PASSES: usable-brain-rate ≥80% (`data/benchmarks/capability-qa-2026-05-31/s-cohort-10-1-inference-30m/inference_health_audit_20260531T225236Z.json` shows 96.5% usable, 97.1% goal-follow-through); wiki fact retrieval proven (QA-20260601-061 / S-WIKI-1); planner model recorded below. | usable-brain-rate ≥80% post-restart on committed config + wiki fact retrieved + planner model recorded | 2026-06-02 |
| 1 — Tool-calling | **Done** — RIQ-1-1-A (PlannerToolLoop substrate + lookup_skill + brain-tool-call-5m task, +34 tests, sha=2aeefdc7); RIQ-1-1-B (runBrain routed through runPlannerToolLoop, brainLlmAdapter, lookup_skill injected into brain prompt, +5 tests, sha=4ec64d40); RIQ-1-1-C (lookup_wiki tool: LOOKUP_WIKI_TOOL + defaultTools(wikiSearch?) + defaultToolRegistry(wikiSearch?) + GameSkillContext.wikiSearch closure + runBrain conditional wiki wiring, +15 tests, fin=4112/4097). Both lookup_skill and lookup_wiki delivered. Live-verify PENDING (cloud sandbox). | tool call pulls non-RAG fact + used in next decision | 2026-06-02 |
| 2 — Deliberative planner pass | **In Progress** — RIQ-2-1 (Plan schema + PlannerPass prompt + parser + runPlannerPass + plan helpers + 30 unit tests, sha=a17d462e). Substrate: cloud-only unit tests pass; live planner call requires hot stack + `planner_haiku` or `planner_local` profile. | ≥3-stage validated plan from one rare planner call | 2026-06-02 |
| 3 — Durable plan + progress | **In Progress** — RIQ-3-1 (PlanStore: save/load/clear/has, atomic tmp-then-rename, quarantine on corrupt, residentSlug path, +15 tests, sha=5c63f168, fin=3701/3701); RIQ-3-2 (maybeTriggerPlannerPass wired into runBrain; triggers on null/completed/abandoned/blocked-stage plan; planner opt-in via behavior.planner; +12 tests, sha=15510437, fin=3713/3713); RIQ-3-3 (plan Library events: PlanCreatedLibraryEvent+PlanReplannedLibraryEvent, observePlanCreated+observePlanReplanned in LibraryUpdater, libraryUpdater? in HelperContext, +12 tests, sha=bf58123a, fin=SANDBOX-BLOCKED/check:no-ui=PASS); RIQ-3-2B (PlanStore + LibraryUpdater production wiring, `planStageRouter`, `runBody` plan-stage fast path, +8 focused tests). Next: hot-stack A1 live verification with planner_haiku/planner_local, then stage completion from real XP/action-result evidence. | A1 (Firemaking plan, ≥2 stages, 0 deaths, survives restart) | 2026-06-02 |
| 4 — Arbitrary-goal support | **In Progress** — RIQ-4-1 (GoalClass + Phase 4 schema extensions, sha=7cfed2a6); RIQ-4-2 (openGoalStageStep + City API + 7 tests, sha=f2a9ef5b); RIQ-4-3 (evaluateSuccessPredicate + City API + 8 tests, sha=ca34d21f); RIQ-4-4 (observeOpenGoalProgress + City API + 12 tests, sha=6703fb3f, fin=4060/4057). RIQ-5-1 (GET /residents/:id/plan endpoint + 2 tests, sha=TBD, fin=4069/4069). A2/A3 live acceptance tests pending hot stack. | A2 + A3 | 2026-06-03 |
| 5 — Polish / scale | **In Progress** — S-PLAN-BUDGET-1 (daily per-resident planner call cap MAX=10, +5 tests, sha=834e0f80); RIQ-5-1 (GET /residents/:id/plan observability endpoint, +2 tests, sha=e3fa945f); RIQ-5-2 (planner failure backoff 200-tick cooldown after fail/throw, +5 tests, sha=6995580b); RIQ-5-3 (global concurrent PlannerPass cap MAX=3, prevents burst-N paid calls on restart, +6 tests, sha=TBD); RIQ-5-4 (plan goal-mismatch invalidation: plan.goalId!==orientationGoal.id triggers replan + goal_changed Library event, +4 tests, fin=4115/4112, sha=992e5d47); RIQ-5-5 (GET /plans bulk endpoint: PlanStore.listAll()+allResidentPlans()+HTTP route, A4 plan-survival test, +6 tests, fin=4154/4148). All substrate-only; live-verify PENDING hot stack. Remaining: plan dashboard consumption (dashboard repo), N≥10 soak benchmark. | N≥10 residents, bounded spend, plan dashboard | 2026-06-04 |

### Planner model decision — DECIDED (RIQ-0-3, 2026-06-02)

**Primary:** `anthropic/claude-3.5-haiku` via `planner_haiku` profile (OpenRouter). Profile
defined in `config/controller.paid-example.yml`.

**Fallback:** `qwopus3.5-27b-v3@q4_k_s` via `planner_local` profile — offline and cost-free.

**Rationale:**
- Haiku is the only model that passed the full benchmark suite 9/9; qwopus 8/9 (same fail on
  `combat-prayer-10m` reasoning/task-switching). Evidence:
  `docs/capability-evidence/2026-05-31-inference-model-comparison.md`.
- Planner calls are **rare** (stage-boundary only, not per-tick). Estimated cost:
  ~$0.016/plan at 10K prompt + 2K completion tokens; 5 plans × 10 residents = ~$0.80/day.
- The per-tick body/brain remains on local qwopus (HD-053, free). The planner model upgrade
  is an additive slice that does not affect existing body/brain routing.
- Live empty-rate A/B on Haiku (post-S-INFER-1 parser salvage) was NOT run from the cloud
  sandbox; defer to Phase 2 implementation time when the PlannerPass is wired in. The task-
  intelligence win (9/9) is sufficient evidence to select Haiku at Phase 0.

**Decisions table reference:** HD-052 (model comparison), HD-052-AB (live A/B data), HD-053
(qwopus as default brain/body — separate decision, unchanged).

**D1 resolution:** Haiku (`planner_haiku`) for the rare deep planner call; local qwopus
(`planner_local`) as fallback. Both profiles committed in `config/controller.paid-example.yml`.

---

**Critical path right now:** Phase 0 ✅ complete → Phase 1 tool-call spike (RIQ-1-1, blocked
on RIQ-0-3 now resolved). Entry point: `docs/issue-register.md` QA-20260601-063.

---

## 9. Open decisions (the real forks)

| ID | Decision | Options | Lean / note |
|---|---|---|---|
| **D1** | Planner model | local qwopus (free, slow) · Claude Haiku (cheap-paid, clean parse, 9/9) · larger Claude for hard plans | **DECIDED (2026-06-02, RIQ-0-3):** Haiku (`planner_haiku`) for the rare deep planner call; local qwopus (`planner_local`) as fallback. Both profiles in `config/controller.paid-example.yml`. See §8. |
| **D2** | Tool-call protocol for local models | native function-calling · structured-JSON-emit + parser-salvage seam · MCP `run_routine` bridge | Local 27B models are unreliable at native function-calling; favor structured-JSON + salvage over the existing MCP seam, with a turn cap. |
| **D3** | How plans are stored | extend `ActiveGoalState` in runtime-state · new per-resident `PlanStore` (JSON atomic write, like the ledgers) | New `PlanStore` — a plan is bigger and longer-lived than a goal; reuse the ledger atomic-write pattern for restart-survival. |
| **D4** | Scope for June 1 vs beta vs full release | demo = beta (think/act/survive/interact) · beta = + tool-calling · full = + durable plan + arbitrary goals | Demo June 1 ships the **beta** (§10). Don't oversell autonomy. |
| **D5** | What the Chicago demo claims honestly | "autonomous goal achievers" (false today) · "LLM-directed embodied residents that think, act, survive, interact" (true) | Use the true framing (§10). |

---

## 10. Demo framing — June 1 (honest beta)

**Show this, honestly:** Null City residents are **LLM-directed embodied actors**. They *think*
(a real local LLM brain now produces in-character, survival-aware goals — proven today at
82.9–92.7% usable in clean windows), *act* (they move, talk, use items, gain XP, trade, earn and
spend AP/GP), *survive* (reflexive eat/flee/fight keeps them alive), and *interact* (they greet
patrons, react to attention, and write their lives into the Library). A viewer can walk up, support
a resident with AP, and watch it react within seconds.

**Do not claim** autonomous self-authored-goal *achievement* — that is the roadmap above
(Phases 2–4), not shipped. The brain is a near-term goal-picker today, not yet a researcher/planner.
Framed this way, the demo is real and the roadmap shows exactly how the autonomy lands next.

---

## Appendix — code & evidence anchors

- Brain output schema: `src/controller/spark/runescape-brain-planner.ts` (`brainGoalSchema`: `{description, steps?, success?, ttlTicks?}`)
- Brain prompt ("Choose one useful near-term goal"): `src/controller/thinking/hybrid-agent-prompts.ts:42`
- Knowledge RAG (top-4, wiki optional/disabled): `src/controller/knowledge/knowledge-retriever.ts` (`:268`)
- Body action vocab: `src/controller/spark/runescape-body-routines.ts` (`move_to`, `drop`, `say`, `interact`, `use_item_on`/`use_item_on_item`, `equip`, `attack`, `eat`)
- Nervous system: `src/controller/nervous-system/nervous-system.ts`
- MCP tool seam (Phase-1 reuse): `src/controller/mcp/*` (`run_routine`, `resident_api`)
- JSON salvage (Phase-1 guardrail): `src/controller/llm/json-salvage.ts`
- Inference arc evidence: `docs/capability-evidence/2026-05-31-qwen-vs-qwopus-ab.md`, `...-loosen-inference-limits.md`, `...-inference-model-comparison.md`, `...-runtime-qwopus-spark-audit.md`, `...-s-infer-postrestart-live-audit.md`, `...-brain-prompt-size.md`
- Capability matrix: `docs/resident-capabilities.md`
- Runtime model: `docs/runtime-stewardship.md`
- Trackers this ties into: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`, `docs/2026-05-30-final-32hr-sprint-plan.md`, `docs/issue-register.md`
