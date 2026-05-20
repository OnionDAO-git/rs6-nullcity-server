# Controller — Implementation Spec

Living document. Update the status checklist at the bottom as work lands.

Sister spec to [`residents.md`](./residents.md). That spec gives us a `Resident`
actor, a `Brain` interface, a typed `Perception`/`AgentAction` vocabulary, and
the WS+MCP gateway for external control. This spec is the **external controller
process** that connects to that gateway and drives many residents at once with
LLM-backed decision making.

## 1. Problem

`residents.md` deliberately stops short of an opinion on the brain. It ships
`ScriptedBrain` for tests and a `RemoteBrain` shim that forwards perceptions to
whatever speaks the WS protocol. That's enough to drive one resident with
ad-hoc Python. It is **not** enough to run a populated world of LLM-driven
residents that:

1. Persist long-term identity across server restarts and controller restarts —
   personality, memories, relationships, skill milestones, places they've
   been.
2. Maintain **bounded** inference cost in tokens and dollars across many
   concurrent residents and a tick rate of ~600ms.
3. Make decisions that look like a *character* and not like an averaged-out
   helpful assistant — voice, goals, prejudices, fears.
4. **Learn** the world by being in it: a resident that has never seen a goblin
   should not know goblins exist; a resident that fought a player named
   `res:archer` yesterday and lost should remember it.
5. Operate under a real resource constraint so a population finds equilibrium
   rather than growing without bound.

The constraint is **attention**: a per-resident scalar that ticks down every
game tick, that the resident burns by acting and thinking, and that — when it
reaches zero — gracefully logs the resident out. New ways to *earn* attention
will be added later (mentoring younger residents, completing legacy
milestones, being remembered by other residents, etc.). For v1, attention only
spends. This makes lifespans finite by construction and forces residents to
choose what matters.

The whole thing is `nullcity-controller`: a separate Node process that
connects to the agent gateway over WS, holds N `ResidentRuntime`s in memory,
runs the Spark framework, talks to an OpenAI-compatible chat completions
endpoint, and reads/writes per-resident soul and memory files on disk.

## 2. Goals

- **Single controller, many residents.** One process drives N residents
  (default 16, configurable). The same process can be restarted independently
  of the game server; on restart it reconnects, re-attaches to its residents,
  and resumes.
- **Soul + Memory split.** Each resident has a *Soul* (one immutable .md file
  defining personality, voice, fears, legacy goal, starting beliefs) and a
  *Memory* (a directory of markdown files the resident writes to as it lives,
  queryable via [`qmd`](https://github.com/tobi/qmd)). Souls are authored;
  memory is grown.
- **Spark framework.** The decision loop is *needs-driven*, not goal-driven.
  Each tick the controller scores the resident's current needs against
  available actions; an LLM call picks among the top candidates, with the
  soul + relevant memory + recent perception history in the prompt envelope.
- **Attention is a finite resource.** Attention decays each tick, faster for
  older residents. At zero, the resident is gracefully disconnected with a
  recorded cause-of-death. Earning mechanics are stubbed for v1 (no source of
  attention income yet; every resident is on a death timer from spawn).
- **OpenAI-compatible inference.** Any provider that exposes the
  `/v1/chat/completions` shape (OpenAI, Anthropic via gateway, OpenRouter,
  local llama.cpp / ollama, vLLM, LM Studio) works without code changes.
  Configurable per resident if a soul wants a stronger model.
- **Bounded cost.** Token budgets per tick, per resident, per minute, and per
  day are enforced at the controller. Hitting a budget makes the resident
  enter a local `noInferenceUntil` mode for the remainder of the window
  rather than queueing inference. Existing plans may continue; new LLM calls
  are rejected until the window resets.
- **Auditable.** Every prompt + completion + parsed action set is written to
  a per-resident JSONL log when envelope logging is enabled; completion,
  parse result, token counts, selected plan, and action results are always
  logged. Memory mutations are commits to the per-resident memory directory
  and can be diffed.

Out of scope for v1: training/fine-tuning, multi-model orchestration beyond
one model per tick, image perceptions, voice, attention income mechanics
(only spending), multi-controller-per-resident, residents authoring their
own souls.

## 3. Architecture

```
                          nullcity-server (rs6-nullcity-server)
                          ┌──────────────────────────────────────┐
                          │  AgentGateway WS  (residents.md §10) │
                          └─────────────────┬────────────────────┘
                                            │ WS
                                            ▼
   nullcity-controller (separate process)
   ┌────────────────────────────────────────────────────────────────┐
   │  ControllerHost                                                 │
   │   - one persistent WS to AgentGateway                           │
   │   - reconciles desired residents ↔ connected residents          │
   │   - holds N ResidentRuntimes                                    │
   └──────────────┬──────────────────────────────────────────────────┘
                  │
                  ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  ResidentRuntime  (one per online resident)                     │
   │                                                                  │
   │   Soul ─┐          ┌─ PerceptionHistory (ring, in-mem + JSONL)  │
   │         ├─▶ Spark ─┤                                            │
   │   Needs ┘          ├─ MemoryStore  (qmd over .md files)         │
   │                    ├─ LegacyTracker                             │
   │                    └─ LLMClient (OpenAI-compatible)             │
   │                                │                                 │
   │                    ┌───────────┴────────────┐                    │
   │                    ▼                        ▼                    │
   │              PromptEnvelope            AgentAction[]             │
   │                                                                  │
   │   per tick (fast, deterministic — never blocks on inference):    │
   │     1. ingest perception → ring + memory router (salient events) │
   │     2. update needs, attention decay, soul-defined variables     │
   │     3. evaluate hooks → highest-priority firing hook (if any)    │
   │     4. branch by mode:                                           │
   │        - hook beats current activity → interrupt + issue LLM     │
   │        - LLM call resolved → install its plan / memo / hooks     │
   │        - executing       → progress current plan by one step     │
   │        - idle, no hook   → noop                                  │
   │     5. spend attention (per action emitted, or per LLM event)    │
   │     6. if attention ≤ 0 → graceful logout                        │
   │                                                                   │
   │   off-tick (async, may take seconds):                             │
   │     LLM calls run with an AbortController; a later tick can      │
   │     preempt an in-flight call when an urgent hook fires.         │
   └────────────────────────────────────────────────────────────────┘
```

The game tick is ~600ms and deterministic. A round-trip to an LLM is
typically 1–30s and *variable*. We do not put the LLM on the tick — we
treat it as a strategic advisor consulted on events, whose output is a
**plan** the runtime executes autonomously for many ticks. The runtime
re-consults the LLM only when a **hook** (§8.5) fires: a deterministic
predicate on perception or scalar state that says "this warrants
thinking". Urgent hooks (taking damage, being addressed, trade
requests) can **interrupt** an in-flight LLM call via AbortController
and trigger a new one. This is the central design of Spark — see §8.

For the first playable autonomous resident, the controller may run a simpler
`hybrid-agent` loop on top of the same resident/body boundary:

- **Nervous system:** deterministic rules run before inference and may suppress
  thinking entirely. Use this for survival, urgent chat interrupts, low-health
  food, retreat rules, and other reflexes.
- **Brain:** slower strategic inference, with model thinking enabled when the
  provider supports it. Brain chooses a current ambition/goal, can explain the
  goal in chat, and may write memory or propose new nervous-system rules.
- **Body:** faster action inference, normally with model thinking disabled.
  Body sees the active Brain goal plus current perception and emits at most one
  typed `AgentAction` for the current moment.

This split preserves the v1 rule from `residents.md`: controller intelligence
does not call `Player` internals. Brain and Body only see `Perception`, and
Body still submits actions through the public `AgentAction` vocabulary.

Inference is parallelised across residents on the controller side. Each
runtime owns at most one in-flight request; the host pools concurrent
requests with a configurable cap (`maxConcurrentInferences`, default 8),
priority-ordered by the triggering hook so an "I got hit" call from
one resident is not blocked behind an "I'm bored" call from another.

## 4. Files to create

```
src/controller/                              # new entry point
    index.ts                                 # CLI entrypoint
    config.ts                                # ControllerConfig (loaded from yml)
    controller-host.ts                       # gateway WS client + runtime pool
    resident-runtime.ts                      # one per online resident
    spark/
        spark.ts                             # Spark facade: modes, per-tick orchestration
        modes.ts                             # idle | executing | deciding state machine
        needs.ts                             # Need types (Attention, plus stubs)
        attention.ts                         # decay curve + spend table
        variables.ts                         # soul-defined scalar DSL evaluator
        hooks.ts                             # Hook + HookCondition types; system hooks table
        hook-evaluator.ts                    # per-tick hook firing + priority arbitration
        plan.ts                              # Plan + PlanStep + AdvanceCondition types
        plan-executor.ts                     # per-tick plan-step advance
        legacy.ts                            # 3 legacy types + progress tracker
        candidates.ts                        # first-step candidate generator (hint for the LLM)
    soul/
        soul-loader.ts                       # parses Soul .md w/ frontmatter
        soul-schema.ts                       # zod schema for soul frontmatter
        starter-souls/
            res-pip.md                       # example: mentor archetype
            res-thrand.md                    # example: achiever archetype
            res-agent.md                     # example: endurer archetype
    memory/
        memory-store.ts                      # facade over qmd + filesystem
        runtime-state.ts                     # persisted attention, legacy, budget windows
        memory-router.ts                     # event → which file does it go in
        memory-summariser.ts                 # periodic compaction
        hooks-md.ts                          # read/write data/memory/<resident>/hooks.md (LLM-proposed hooks + variables)
        templates/
            geography.md                     # template for places memory
            social.md                        # template for actor memory
            items.md                         # template for inventory/world items
            skills.md                        # template for own progression
            monsters.md                      # template for npcs encountered
            events.md                        # template for episodic log
    perception/
        perception-history.ts                # in-mem ring + on-disk JSONL
        perception-compressor.ts             # baseline + deltas for envelope (§10.4)
        perception-diff.ts                   # pure pairwise delta algorithm
        salience.ts                          # which events are memory-worthy
    llm/
        llm-client.ts                        # OpenAI-compatible client (AbortController-aware)
        mailbox.ts                           # per-runtime in-flight tracking, abort + result drain
        prompt-envelope.ts                   # assembles the request body
        completion-parser.ts                 # JSON schema response, zod-validated
        budgets.ts                           # token + RPM caps
    logging/
        action-log.ts                        # per-resident JSONL
        inference-log.ts                     # prompt + completion + parse result
    transport/
        gateway-client.ts                    # wraps the WS protocol (residents.md §10.2)
        message-codecs.ts                    # zod schemas mirroring server's
    util/
        backoff.ts
        clock.ts
        token-count.ts                       # cheap tokenizer estimate

data/                                        # controller-owned, per-deploy
    souls/
        <resident-name>.md                   # one per managed resident
    memory/
        <resident-name>/
            geography/<place-slug>.md        # one file per known place
            social/<actor-id>.md             # one file per known actor
            items/<item-slug>.md             # one file per known item kind
            skills.md                        # single own-progression file
            monsters/<npc-key>.md            # one file per known monster
            events/<YYYY-MM-DD>.md           # daily episodic log
            hooks.md                         # LLM-proposed memory hooks (§8.5)
            runtime-state.json               # controller-owned mutable lifecycle state
            INDEX.md                         # hand-written + auto-maintained
    logs/
        <resident-name>/
            actions/<YYYY-MM-DD>.jsonl
            inference/<YYYY-MM-DD>.jsonl

feat/controller.md                            # this file
```

## 5. Files to modify

The controller is intentionally additive — it lives in its own directory,
ships its own `npm` script, and connects to the server over a stable network
protocol. Server changes are limited to making that protocol fit:

- `src/server/agent/protocol/messages.ts` — extend the WS schema with a
  `controller_hello { controllerId, version, capabilities[] }` handshake so
  the gateway can log which controller owns which connection. Non-breaking.
- `src/server/agent/protocol/messages.ts` — add an optional `cause` string to
  the `action_result` and the existing `error` envelope so cause-of-logout
  (e.g. `'attention_exhausted'`, `'legacy_complete'`) round-trips.
- `package.json` — add a new `controller` workspace script and the deps
  listed in §15. No change to the server's existing scripts.

No engine, plugin, or persistence code changes. Everything the controller
needs from the server is already in residents.md.

## 6. Souls

A Soul is one markdown file, hand-authored (or LLM-authored *out of band*,
not by the resident itself). It's loaded once at `connect_resident` time and
held in memory verbatim for the resident's lifetime. **Souls are
append-friendly but not mutated by the resident.** If we want a resident to
"grow", that goes in memory, not the soul.

### 6.1 File shape

```markdown
---
name: res:pip
display: Pip
archetype: mentor              # mentor | achiever | endurer (= legacy goal)
voice:
  register: warm-formal        # informal | warm-formal | terse | grandiloquent | ...
  quirks:
    - calls everyone "friend"
    - never uses contractions
fears:
  - drowning
  - the wilderness north of Varrock
loves:
  - teaching newcomers to cook
  - the sound of the Lumbridge bell
model:
  endpoint: default            # name of an entry in controller config's `llm.endpoints`
  temperature: 0.7
attentionProfile:
  startingAttention: 5000
  decayCurve: gentle           # see §8.2 — gentle | standard | steep
legacy:
  kind: mentor
  parameters:
    targetMenteeCount: 3
    skillsToTeach: [cooking, fishing]
startingBeliefs:
  - "Lumbridge is a safe town for new arrivals."
  - "Goblins exist somewhere east; I have not seen one."
  - "I have never been past the river bridge."
---

# Pip

Pip is a retired cook who came to Lumbridge after losing his shop in a fire
he doesn't talk about. He believes mentorship is the only honest way to
spend the time you have left. He is patient with confusion and impatient with
cruelty.

He carries his old apron at all times. If asked about it, he changes the
subject.

## Voice samples

> "Friend, let us sit by the bank a moment. Your fishing rod is trembling —
> have you held one before today?"

> "I will not say what is north. I will say what is south, and I will walk
> with you there."
```

The frontmatter is the **structured** soul and is consumed directly by Spark
(archetype → legacy tracker; attentionProfile → §8). The markdown body is
**voice fuel** — included verbatim in every prompt envelope. Voice samples
in particular are dramatically more effective than adjectives at shaping
output; we ship 2–4 samples per starter soul.

### 6.2 Validation

`soul-schema.ts` is a zod schema for the frontmatter. Loader rejects souls
with unknown archetypes, missing legacy kinds, or invalid endpoint
references. Starter souls under `soul/starter-souls/` are validated in CI.

### 6.3 Starter souls

Ship three exemplars matched to the three legacy archetypes (§9). They
double as smoke fixtures and as templates for new souls. They are the *only*
files in `src/controller/soul/starter-souls/`; the deployed controller's
working souls live under `data/souls/` and are not in git.

## 7. Memory

Memory is **how a resident knows things**. A freshly spawned resident knows
only what's in its soul's `startingBeliefs`. Everything else is learned by
perceiving the world and writing it down.

### 7.1 Why markdown + qmd

The obvious alternative is a vector DB (Chroma, Qdrant, sqlite-vss).
Markdown + qmd wins on four points specific to this project:

1. **Auditable.** Every memory write shows up as a diff in
   `data/memory/<resident>/`. You can read a resident's brain with a text
   editor. You can hand-edit one to debug ("did Pip forget that he met
   res:thrand?").
2. **Replayable.** Memory is a directory tree; a snapshot is a
   `cp -R`. Branching a resident's life for an A/B test is a `cp -R`.
3. **One tool, three search modes.** [qmd](https://github.com/tobi/qmd)
   already gives us BM25 + vector + LLM-reranked hybrid query over a
   collection of markdown files. We don't have to write retrieval — we
   write a wrapper that issues `qmd query --collection <resident-slug>` and
   parses the JSON output.
4. **Cheap.** qmd's SQLite index is a single file. Per-resident collections
   are cheap to add/drop. No service to run, no port to manage.

The qmd wrapper is a contract boundary, not a pile of shell calls. It pins a
supported qmd version in docs/tests, derives a filesystem-safe collection slug
from the resident id (for example `res:pip` → `res-pip`), keeps the raw
resident id in markdown frontmatter, and validates the JSON shape returned by
`qmd get` and `qmd query`. Acceptance tests create a temporary collection and
exercise `collection add`, `get`, `query --format json`, and `embed`.

### 7.2 Directory layout per resident

```
data/memory/<resident-name>/
    INDEX.md                # see §7.4
    geography/
        lumbridge-bank.md
        river-lum-bridge.md
        ...
    social/
        res-thrand.md       # one file per actor (resident, player, NPC)
        player-Zezima.md
        npc-hans.md
        ...
    items/
        raw-shrimp.md       # one file per item kind the resident has held or seen
        ...
    monsters/
        npc-goblin.md       # one file per NPC key (combat-eligible)
        ...
    skills.md               # single file, own progression notes
    events/
        2026-05-19.md       # one file per game-day, episodic
        2026-05-20.md
        ...
```

The split is **by domain, not by recency**. Recent activity also lands in
`events/<today>.md` as a narrative log, so qmd can retrieve "the time I
fought goblins" alongside the long-lived `monsters/npc-goblin.md`.

### 7.3 File templates

Every domain has a template in `src/controller/memory/templates/`. Writes
go through `memory-router.ts` which knows, given a `PerceptionEvent`,
which file to append to. Examples:

`social/<actor-id>.md`:

```markdown
---
id: res:thrand
displayName: Thrand
kind: resident
firstMet: { date: 2026-05-19, tick: 12410, where: lumbridge-bank }
lastSeen: { date: 2026-05-19, tick: 12530, where: lumbridge-bank }
sentiment: wary             # warm | friendly | neutral | wary | hostile
encounters: 3
---

## What I know

- Thrand introduced themself near the bank.
- Said they were heading north to "find goblins". I warned against it.
- Watched them eat 3 shrimp in 4 ticks. Hungry?

## What they said

> "Old man, do you know where the bank is?" — tick 12410
> "I'll see you when I see you." — tick 12530
```

`monsters/npc-goblin.md`:

```markdown
---
key: npc-goblin
name: Goblin
firstSeen: { date: 2026-05-19, tick: 12780, where: south-of-river }
lastSeen: { date: 2026-05-19, tick: 12784, where: south-of-river }
combatLevel: ~2
observed:
  - { tick: 12780, hp: 5, behaviour: aggressive }
threat: low
---

## What I know

- Goblins are short, green, and attack on sight near the river south
  of Lumbridge.
- A goblin hit me for 1 damage with what looked like a bronze sword.
- I have not seen one north of Lumbridge.
```

Frontmatter is what queries hit first; the body is for the LLM. Templates
include placeholder sections (`## What I know`, `## What they said`) so the
LLM has a stable place to append.

### 7.4 INDEX.md

`INDEX.md` is the single file *always* included in the prompt envelope,
verbatim. It is a small (≤2KB target, hard cap 4KB) hand-shaped summary of
the resident's current situation that the resident itself rewrites
periodically — the equivalent of "what's on my mind right now". The
LegacyTracker (§9) maintains the top of it; the resident maintains the
rest. Example:

```markdown
---
updated: { date: 2026-05-19, tick: 12530 }
---

# Pip — current standing

- I am a mentor. I want to teach 3 newcomers cooking. So far: 1 (Thrand,
  partial — taught fishing-bait selection only).
- I am in Lumbridge. I have never crossed the river.
- HP 10/10. I have 4 shrimp, a rod, an apron.
- Open threads:
  - Thrand said they were going north. Worried. Will look for them tomorrow.
  - I should restock shrimp before sunset.
```

When INDEX.md exceeds the cap, the summariser (§7.6) folds the bottom into
`events/<today>.md` and rewrites the index.

### 7.5 Retrieval — when memory is queried

Three retrieval points:

1. **Always-included**: soul body + INDEX.md + last K perceptions (default
   K=8) + current needs/legacy snapshot. Cheap.
2. **Targeted, per perception**: when the perception includes a *new actor
   ref* not in INDEX.md, the controller issues `qmd get
   --collection <resident> social/<actor-id>` if the file exists; if not,
   it's a stranger and the soul's "first impressions" guidance applies.
   Same for new monster keys, new place IDs.
3. **Reflective query**, gated by need pressure (§8): if the resident's
   top-pressure need is e.g. "find food" and INDEX.md says nothing useful,
   the controller issues `qmd query --collection <resident> "where can I
   find food?" --limit 3 --format json` and inlines the top hits into the
   envelope. Reflective queries are token-budgeted: at most one per
   decision tick.

Critically, retrieval is the *controller's* job, not the LLM's. We do not
expose a "memory_query" tool to the LLM in v1 — the controller decides what
to surface based on the perception. Tools are a footgun in a constrained
budget setting; deterministic retrieval is cheaper and more debuggable. A
future v2 can add `tool_calls`-shaped memory tools.

### 7.6 Compaction

Each game-day (24h game-time, or every N=10000 ticks, whichever first),
the summariser runs per resident:

- For each social/monster/geography file: if it has grown beyond 8KB, fold
  the oldest narrative into a `## Older` section and summarise via a small
  cheap model call (a *separate* endpoint from decision making, configurable).
- Rewrite INDEX.md.
- Update qmd index: `qmd embed --collection <resident>` (incremental).

Compaction is the only thing in the controller that mutates memory without
a perception trigger. It's logged like any other action.

### 7.7 Memory writes — when, by whom, and what

Two writers touch memory:

1. **The router (deterministic).** Every salient `PerceptionEvent` (see
   §10.2) is routed to its file and appended to the relevant
   structured-section. The router never calls the LLM. It writes
   bullet-point facts (`- tick 12410: Thrand introduced themself`).
2. **The LLM (per decision).** The completion response (§11.2) includes an
   optional `memo` field. If present, it's appended verbatim to the file
   the LLM names (validated against the resident's allowed paths). This is
   how subjective material ("I felt wary of them") lands. The LLM is told
   in the system prompt that memo space is limited (≤200 tokens per tick)
   and that it should write only what would help its future self.

The router runs before the LLM call, so the LLM sees the new fact in the
perception envelope and can decide whether to add subjective colour.

## 8. Spark framework

Spark is the deterministic layer between the world tick and the LLM. It
runs every game tick; **it never calls the LLM directly**. The LLM is
invoked only when a **hook** fires, and what it produces is a **plan**
that the runtime executes autonomously — tick by tick — until the plan
finishes or a higher-priority hook interrupts it.

This is the central asymmetry we're working with: the world tick is
600ms and deterministic; LLM inference is 1–30s and variable. Putting
the LLM on a fixed tick cadence is fighting the asymmetry. Treating it
as a strategic advisor that the resident consults *on events* — and
that the resident *interrupts* when something urgent intrudes — works
with it.

### 8.1 Modes

A runtime is in exactly one of three modes at any moment:

| mode        | meaning                          | per-tick behaviour                                |
|-------------|----------------------------------|----------------------------------------------------|
| `idle`      | no plan, no LLM call in flight   | watch hooks; emit `noop`                           |
| `executing` | running a plan, one step at a time | advance plan; submit current step's action       |
| `deciding`  | LLM call in flight (cancellable) | continue prior plan's tail if any; otherwise noop  |

State transitions:

```
idle       ── hook fires ─────────────────────────▶ deciding
deciding   ── LLM returns a plan ─────────────────▶ executing
deciding   ── LLM returns no plan ────────────────▶ idle
executing  ── plan exhausted ─────────────────────▶ idle  (plan_exhausted hook may fire next tick)
executing  ── plan.abandonIf matches ─────────────▶ idle  (hooks re-evaluate next tick)
executing  ── higher-priority hook fires ─────────▶ deciding (plan paused)
deciding   ── higher-priority hook fires ─────────▶ deciding (in-flight call aborted; new one issued)
```

The tick never blocks on inference. Inference is awaited off the tick
thread; the tick handler reads completion state if ready and otherwise
keeps doing whatever the current mode allows.

### 8.2 Needs

```ts
export type NeedKind =
    | 'attention'   // v1 — the only need with a real source
    | 'safety'      // stub — pressure rises when HP low or in combat
    | 'sustenance'  // stub — pressure rises when no food in inv
    | 'belonging'  // stub — pressure rises when no social event in N ticks
    | 'legacy';    // stub — pressure rises with legacy progress gap

export interface Need {
    kind: NeedKind;
    value: number;      // 0..1 (current stock)
    pressure: number;   // 0..1 (urgency)
    spendable: boolean; // true only for attention in v1
}
```

`pressure` is a per-need function of the resident's state. Examples:

- `attention.pressure = 1 - attention.value / attentionProfile.startingAttention`
- `safety.pressure = max(0, 1 - hp.current/hp.max) + (inCombat ? 0.5 : 0)`,
  clamped to [0,1]
- `sustenance.pressure = inventoryHasFood ? 0 : recentHpDropFraction * 0.8 + 0.2`

Pressures are advisory inputs to the LLM, surfaced in the prompt envelope
as a small table. They are *also* used by Spark to pre-filter candidates
(§8.3): if `safety.pressure > 0.8` and there's an attacker visible, the
candidate list is restricted to safety-relevant actions (eat, flee, fight
back). This prevents the LLM from emitting `say "hello friend"` while on
fire.

### 8.3 Attention — the only real resource in v1

`attention.value` is a positive integer initialised to
`soul.attentionProfile.startingAttention`. Each game tick, it decays by
`decay(age, curve)`:

| curve     | decay(t in ticks)                                |
|-----------|--------------------------------------------------|
| gentle    | `1 + floor(t / 10000)`                           |
| standard  | `2 + floor(t / 5000) + floor(t / 20000) * 2`     |
| steep     | `4 + floor(t / 2500) * 2`                        |

`t` is the resident's age in ticks (monotonic across sessions, taken from
`agentMetadata.ticksLived` in the server save — `residents.md §11.4`). All
three curves are accelerating: older residents pay more per tick to exist.
Numbers are tuned so that:

- A `gentle / 5000` resident, idle, lives ~12 game-hours.
- A `standard / 5000` resident, idle, lives ~6 game-hours.
- A `steep / 3000` resident, idle, lives ~2 game-hours.

These estimates assume the server's current 600ms tick and the controller's
24h game-day shorthand of 10000 ticks. Actions, LLM calls, and reconnect churn
shorten the actual lifetime.

Actions and LLM events both spend attention. The spend table (in
`attention.ts`):

| event                                          | spend |
|------------------------------------------------|-------|
| noop                                           | 0     |
| move_to (per tile)                             | 0.2   |
| say / whisper                                  | 2     |
| interact (non-combat)                          | 1     |
| attack / cast_spell                            | 3     |
| trade_*                                        | 2     |
| LLM call resolved successfully                 | 5     |
| LLM call aborted (preempted by a higher hook)  | 1     |
| LLM call failed (parse error / network / abort by timeout) | 2 |

The LLM-call cost is the dominant cost — *thinking is expensive*. This is
intentional and meta-honest: the resource that disappears is literally
the inference budget. Because the new model fires LLM calls on hooks
(not on a fixed cadence), a well-planned resident that produces long,
useful plans spends dramatically less attention than one that thrashes:
50 ticks of activity from a single 50-step plan costs ~5 + (50 × per-step
cost), versus the old model's ~50 attention on inference alone. Patience
is rewarded by design.

The aborted-call cost (1) makes preemption nearly-free *for the
preempting hook* but still non-zero for the resident — a resident whose
hooks thrash will burn attention from cancellations alone. This bounds
hook misconfiguration.

When `attention.value` hits 0 or below, the runtime:
1. Stops issuing decisions immediately.
2. Writes a final `## Final entry` block to `events/<today>.md` summarising
   the resident's last act (no LLM call — a deterministic template).
3. Emits `submit_action { kind: 'logout' }` with `cause:
   'attention_exhausted'` (see §5).
4. Writes `deceased: { date, tick, cause }` to
   `runtime-state.json`. Soul files remain read-only after load.
5. Detaches from the gateway.

The save file (server-side, `data/residents/<name>.json`) is preserved.
Future mechanics may resurrect; v1 leaves the file alone and considers the
resident dead.

#### 8.3.1 Runtime-state persistence

Attention is controller-owned state and must survive controller restarts.
Each resident has `data/memory/<resident>/runtime-state.json`:

```ts
interface RuntimeState {
    attentionRemaining: number;
    lastSeenTicksLived: number;
    legacyProgress: number;
    mentorDedupeIds?: string[];
    deceased?: { date: string; tick: number; cause: string };
    budgetWindows: {
        minute: BudgetWindowState;
        gameDay: BudgetWindowState;
    };
}
```

On reconnect, the runtime loads this file before evaluating hooks. It then
reads `agentMetadata.ticksLived` from the server save and subtracts passive
decay for `ticksLived - lastSeenTicksLived`; action and LLM spends are already
accounted in `attentionRemaining`. The runtime writes this file after each
LLM result, each attention-spending action result, legacy progress changes,
budget-window changes, and graceful logout. Acceptance: killing and restarting
the controller never increases attention and never resets mentor dedupe state.

### 8.4 Resident variables

Some hooks watch scalars that aren't universal (hp, attention) and
aren't quite needs. Souls declare custom variables in frontmatter:

```yaml
variables:
  loneliness:
    initial: 0
    increment_per_tick_when:
      condition: { kind: no_event_since, eventKind: chat, ticks: 500 }
      amount: 0.002
    decrement_on_event:
      kind: chat
      from: { not_kind: hostile }
      amount: 0.15
    clamp: [0, 1]
  bridge_traversal_risk:
    initial: 0
    increment_on_event:
      kind: hit_taken
      where_chunk_includes: river-lum-bridge
      amount: 0.2
    decay_per_tick: 0.0001
    clamp: [0, 1]
```

Variables are recomputed each tick by `spark/variables.ts`, a small DSL
evaluator. They surface in the prompt envelope as a table alongside
needs. The LLM may also propose new variables via a `proposeVariables`
field on its response. Proposed variables are validated, scoped to the
resident, forbidden from shadowing system or soul variables, and persisted
as memory-owned definitions in `data/memory/<resident>/hooks.md` rather
than appended to the soul. Souls remain authored source material; learned
trigger surfaces live in memory.

Variables are the substrate of soul-specific hooks: a mentor watches
`loneliness`; an achiever watches a custom `progress_stall_ticks`; an
endurer watches `boredom`. Without resident-defined variables, every
soul would share the same trigger surface; with them, dispositions
diverge.

### 8.5 Hooks — what triggers an LLM call

A hook is `(condition, priority, contextHint, cooldown, interruptInflight)`.
The runtime evaluates every hook every tick. When a hook *fires*, the
runtime either issues a new LLM call or — if the hook's priority is
high enough relative to the current activity — interrupts the current
activity (a plan, or an in-flight LLM call) and issues a new call.

```ts
interface Hook {
    id: string;                 // unique within a resident
    priority: number;           // 0–100
    cooldownTicks: number;      // can't re-fire within this window
    condition: HookCondition;   // deterministic predicate
    contextHint: string;        // injected into the prompt envelope when this hook fires
    interruptInflight: boolean; // can this hook abort an LLM call already in flight?
    source: 'system' | 'soul' | 'memory';
}

type HookCondition =
    | { kind: 'event';        eventKind: PerceptionEvent['kind']; predicate?: string }
    | { kind: 'scalar';       variable: string; op: '<'|'<='|'>'|'>='|'=='; value: number }
    | { kind: 'state_change'; field: 'mode' | 'plan_exhausted' | 'in_combat' | 'new_actor' }
    | { kind: 'compound';     any?: HookCondition[]; all?: HookCondition[] };
```

Three layers, loaded in order:

**System hooks** — built into Spark, identical for every resident:

| priority | id                       | condition                                          | interrupt? |
|----------|--------------------------|----------------------------------------------------|------------|
| —        | `attention_zero`         | scalar: attention ≤ 0                              | deterministic logout (no LLM) |
| —        | `died`                   | event: died                                        | deterministic logout (no LLM) |
| 95       | `hit_taken_critical`     | event: hit_taken AND hp/max < 0.3                  | yes        |
| 90       | `chat_to_me`             | event: chat AND target == self                     | yes        |
| 90       | `trade_requested`        | event: trade_requested                             | yes        |
| 85       | `hit_taken`              | event: hit_taken AND hp/max ≥ 0.3                  | yes        |
| 80       | `attention_critical`     | scalar: attention < startingAttention × 0.1        | yes        |
| 75       | `new_player_in_range`    | state_change: new_actor where kind == 'player'     | no         |
| 70       | `plan_exhausted`         | state_change: plan_exhausted                       | no         |
| 50       | `attention_low`          | scalar: attention < startingAttention × 0.3        | no         |
| 30       | `idle_reflection`        | mode == idle for ≥ 300 ticks                       | no         |

**Soul hooks** — declared in soul frontmatter, reference soul variables.
Priority is capped at 80 (souls cannot override system hooks that
protect immediate safety / social affordances):

```yaml
hooks:
  - id: feeling_lonely
    priority: 60
    cooldownTicks: 1000
    condition: { kind: scalar, variable: loneliness, op: '>=', value: 0.7 }
    contextHint: "You feel lonely. Consider seeking company."
    interruptInflight: false
  - id: newcomer_appeared
    priority: 75
    cooldownTicks: 500
    condition:
      kind: compound
      all:
        - { kind: state_change, field: new_actor }
        - { kind: event, eventKind: arrived, predicate: "actor.kind == 'player'" }
    contextHint: "A new face. As a mentor this matters."
    interruptInflight: false
```

**Memory hooks** — proposed by the LLM mid-life via a `proposeHook`
field on its response, persisted to `data/memory/<resident>/hooks.md`,
reloaded on controller restart. Same shape, same priority cap (80).
The LLM may retire a memory hook by id via `retireHook`. This is how a
*learned* disposition shows up in future planning: "after being
ambushed near the bridge, watch the bridge tile and re-plan before
traversing it."

#### 8.5.1 Firing rules and cooldown

Each tick, for each hook:
1. If cooldown is still active → ignore.
2. Compute `interruptMargin`: `0` when the runtime is idle, `10` when a
   plan or LLM call is active.
3. If `priority < currentActivityPriority + interruptMargin` → ignore
   (logged as *shadowed* so we can tune later).
4. Else → eligible. The highest-priority eligible hook wins and schedules
   an LLM call tagged with this hook's priority and contextHint.

Cooldown is set only for the winning eligible hook after the LLM call is
admitted to the runtime or global inference queue. Shadowed, budget-rejected,
or replaced queued hooks do not consume cooldown.

`idle_reflection` only fires while no other hook has fired in its
cooldown window — it is the "occasional check-in" path. Without it,
residents in long idle stretches never re-plan; with it, they get
periodic, low-priority reflection at controllable cost.

If multiple hooks fire on the same tick, tie-break by `priority desc,
hook id lexicographic` (deterministic). Only the winner runs; the
others log as shadowed.

#### 8.5.2 Interruption

The runtime tracks the **current activity priority**:
- `idle` → 0
- `executing` → the priority of the hook whose plan is running
- `deciding` → the priority of the hook whose LLM call is in flight

A firing hook that passed the §8.5.1 margin check AND (in `deciding` mode)
`interruptInflight === true` interrupts:

- In `deciding`: abort the in-flight fetch via AbortController, charge
  1 attention for the cancelled call, immediately issue a new LLM
  call for the winning hook. The aborted prompt is recorded in
  `inference/<date>.jsonl` with a `cancelled_by: <hook id>` field.
- In `executing`: stop emitting plan actions, transition to `deciding`,
  issue an LLM call. The aborted plan's remaining steps are passed to
  the prompt envelope as a `previousIntent` section so the LLM can
  decide whether to resume (return the remaining steps as the new
  plan) or pivot.

The active-mode margin prevents thrash. A hook firing repeatedly at the same
priority as the current activity cannot pre-empt itself; a hook at priority 90
can pre-empt a plan at priority 80 but not one already at priority 90.

### 8.6 Plans — the long-running output of an LLM call

The LLM's response (§11.2) returns a `plan`. A plan is the unit of
"long-running task": a sequence of steps that the runtime executes
autonomously, one at a time, until completion or interruption.

```ts
export interface Plan {
    intent: string;              // short human label; appears in INDEX.md and logs
    triggeredByHook: string;     // hook id that produced this plan
    priority: number;            // inherited from the hook
    steps: PlanStep[];
    abandonIf?: HookCondition[]; // any match → plan aborts; runtime returns to idle
    maxTicks?: number;           // safety: if exceeded, plan ends as exhausted
}

export interface PlanStep {
    action: AgentAction;
    advanceWhen: AdvanceCondition;
    onResult?: { success?: 'next'|'abort'; failure?: 'next'|'abort'|'retry' };
    repeat?: boolean;           // default false; true for deliberate repeated actions
}

type AdvanceCondition =
    | { kind: 'action_result_ok' }                                       // server accepted
    | { kind: 'event_seen';    eventKind: string; predicate?: string }
    | { kind: 'scalar';        variable: string; op: '<'|'<='|'>'|'>='|'=='; value: number }
    | { kind: 'ticks_elapsed'; ticks: number }
    | { kind: 'state';         predicate: string };                      // e.g. "inventory.has(shrimp) >= 4"
```

Each tick in `executing` mode, `spark/plan-executor.ts`:

1. Evaluate the head step's `advanceWhen` against the latest perception
   + scalar state.
2. If true: pop the step. If steps remain, submit the next step's
   action; else transition to `idle`.
3. If false: leave the head step in place. Each step has local state
   `not_started | submitted | complete` plus the last `requestId`. Submit
   the action only when `not_started`, or when `repeat: true`, or when
   `onResult.failure === 'retry'` after a rejected result. Accepted
   long-running actions like `move_to` are not resubmitted every tick while
   waiting for `arrived`.
4. Evaluate `abandonIf`. If any predicate is true, transition to `idle`
   and log `plan_abandoned`.
5. Decrement `maxTicks`. If zero, transition to `idle` and log
   `plan_exhausted`.

Typical advance conditions:
- `move_to <pos>` step → `advanceWhen: { kind: 'event_seen', eventKind: 'arrived' }`
- `attack <npc>` step → `advanceWhen: { kind: 'state', predicate: 'target.hp == 0' }`
- "wait for HP to recover" step → `advanceWhen: { kind: 'scalar', variable: 'hp_fraction', op: '>=', value: 0.9 }`
- "rest a tick" step → `advanceWhen: { kind: 'ticks_elapsed', ticks: 1 }`

A plan replaces the old "emit up to 3 actions per LLM call" pattern.
Each plan step submits *at most one action per tick*, matching the
throttle a real player has. The server never sees a burst.

#### 8.6.1 First-step candidates

`spark.candidates(perception)` still exists, but is now an input to the
prompt envelope rather than the only thing the LLM picks from. The
envelope tells the LLM "here are reasonable first steps given the
current perception"; the LLM is free to plan beyond them. For
event-triggered hooks the candidate list is sharply narrowed (e.g. a
`hit_taken` hook restricts candidates to fight / flee / eat), so the
plan's first step almost always lands somewhere defensible.

## 9. Legacy goals

Every soul commits to exactly one of:

### 9.1 Mentor

Parameters: `targetMenteeCount: number`, `skillsToTeach: SkillName[]`.

Progress increments when the resident *successfully teaches* another actor.
"Teaches" is defined operationally:
- The resident performed an action of the target skill within 5 ticks of
  the mentee.
- The mentee was within 3 tiles for the duration.
- The mentee gained XP in the same skill.
- A `say` action with text matching `/teach|show|here.{0,20}how|like this/i`
  was emitted by the mentor within 10 ticks.

If all four, +1 mentee (deduplicated by mentee id).

### 9.2 Achiever

Parameters: an *achievement spec*, one of:
- `{ kind: 'reach_skill_level', skill: SkillName, level: number }`
- `{ kind: 'craft_item', itemId: number }`
- `{ kind: 'defeat_npc', npcKey: string }`
- `{ kind: 'reach_place', placeSlug: string }`

Progress is 0 until the achievement fires (one of the relevant
PerceptionEvents lands), then 1. Achievement is terminal — `runtime-state.json`
records `deceased.cause = 'legacy_complete'`, and attention immediately drops
to 0 (the resident's reason for being is fulfilled; they log out content).
This is intentional and stark.

### 9.3 Endurer

Parameters: `targetTicksLived: number` (default: 50000 ≈ 8 real-time hours at
600ms/tick, or 5 controller game-days using the 10000-tick shorthand).

Progress = `min(1, ticksLived / targetTicksLived)`. Hits 1 → resident has
"endured" and `runtime-state.json` records `deceased.cause = 'endured'`. As
with achievers, attention drops to 0 — the legacy is complete.

### 9.4 LegacyTracker

`LegacyTracker` is a per-runtime object updated each tick from perception
events. It exposes `progress: number` (0..1) and `summary: string` for the
INDEX.md top section. It is also passed into the prompt envelope so the
LLM is reminded of its purpose. Without this reminder, LLMs drift toward
"helpful assistant" by tick 50.

## 10. Perception history

### 10.1 Ring buffer

Each runtime holds the last K=128 perceptions in memory (configurable).
The envelope never receives raw perceptions — it receives a
*compressed view* assembled by `PerceptionCompressor` (§10.4). The ring
exists so the compressor can pick its baseline and walk forward, and so
the JSONL log writer (§10.3) has the same view the runtime saw.

We diff consecutive perceptions to detect "new" things (new actors, new
items in inventory, HP delta, position delta) and these diffs are what
get fed to the router (§7.7) and the salience filter (§10.2). The raw
perceptions are never written to memory; only the *interesting deltas*
plus the perception events.

The controller may also append synthetic `ControllerEvent`s to this history:
`action_result` from gateway replies, `budget_exhausted`, LLM failure/abort
summaries, and controller reconnect markers. These are rendered in prompt
history and logs, but they are not part of the server-owned `PerceptionEvent`
union in `residents.md`.

### 10.2 Salience

Not every event is memory-worthy. The salience function is deterministic
in v1:

```ts
function salient(event: PerceptionEvent): boolean {
    switch (event.kind) {
        case 'died':            return true;
        case 'level_up':        return true;
        case 'chat':            return true;
        case 'hit_taken':       return event.damage >= 2 || lowHp();
        case 'hit_dealt':       return event.damage >= 4 || event.to.kind === 'player';
        case 'item_received':   return rareOrNew(event.item);
        case 'item_lost':       return rareOrNew(event.item);
        case 'arrived':         return enteredNewChunk();
        case 'trade_completed': return true;
        case 'trade_cancelled': return event.reason !== 'editing_drift';
        default:                return false;
    }
}
```

Non-salient events still appear in the perception envelope as part of the
last-8 snapshot, so the LLM sees them in-the-moment; they just don't
graduate to long-term memory. This keeps memory growth bounded and the
diffs auditable.

### 10.3 Disk format

Per-resident perception history mirrors the action log path:
`data/logs/<resident>/perceptions/<YYYY-MM-DD>.jsonl`. One line per
received perception. Disabled by default behind
`logging.fullPerceptions: false` (parity with server's
`agentGateway.logFullPerceptions`). When disabled, only the salient-event
projections are written; full perceptions are dropped.

### 10.4 Compression — what the envelope actually sees

A single perception is fat: 28 inventory slots, 14 equipment slots, all
skill levels, every actor/item/object in the ~15-tile vision radius. A
realistic perception serialises to ~800–1500 tokens. Sending 8–10 of them
verbatim per decision would consume the entire input budget and starve
the soul, INDEX.md, and memory excerpts.

`PerceptionCompressor` collapses a window into one **baseline** plus a
sequence of **per-tick deltas**. The current tick is always rendered in
full as the freshest delta; older ticks are diffed against their
predecessor; runs of unchanged ticks are coalesced.

#### Window

Defined by *game-time*, not tick count, so the LLM sees consistent
context regardless of tick-rate config:

```ts
export interface CompressorConfig {
    windowSeconds: number;     // default 10  (≈ 17 ticks @ 600ms)
    maxRenderedTokens: number; // default 15000 — hard cap; baseline advances if exceeded
    idleCoalesceMin: number;   // default 3   — minimum run length to coalesce
}
```

#### Output shape

```ts
export interface CompressedHistory {
    baseline: BaselineSnapshot;
    deltas: PerceptionDelta[];   // ordered oldest → newest; last is current tick, full
    coveredTicks: { from: number; to: number };
    droppedOldestTicks?: number; // > 0 if baseline was advanced to fit token cap
}

export interface BaselineSnapshot {
    tick: number;
    rendered: string;            // compact prose; see §10.4 rendering
    // Structural fields kept alongside `rendered` so the diff algorithm
    // can compute the next delta without re-parsing the prose:
    resident: ResidentSnapshot;
    nearby: NearbySnapshot;
}

export interface PerceptionDelta {
    tick: number;
    deltaSinceTick: number;      // previous tick we diffed against (not always tick-1)
    kind: 'delta' | 'idle' | 'current';
    resident?: Partial<ResidentDelta>;     // position, hp, busy, inCombat, combatTarget
    nearby?: {
        entered?: ActorRef[];
        left?: string[];                    // actor ids
        moved?: { id: string; position: Pos }[];
        objectsChanged?: { added?: ObjectRef[]; removed?: string[] };
    };
    inventory?: InventoryDelta;             // slot-keyed adds/removes/amount-changes
    equipment?: EquipmentDelta;
    skills?: { skill: SkillName; level?: number; xpDelta?: number }[];
    events: PerceptionEvent[];              // never deduped — events are per-tick truth
    coalescedTicks?: { from: number; to: number }; // only set when kind === 'idle'
}
```

#### Algorithm

```
build(history: PerceptionRing, currentTick: number): CompressedHistory
    windowStart = currentTick - secondsToTicks(windowSeconds)
    perceptions = history.since(windowStart)            // oldest → newest
    baseline = perceptions[0]                            // full snapshot

    deltas = []
    prev = baseline
    for p in perceptions[1..n-2]:                        // all but current tick
        d = diff(prev, p)
        if d.isEmpty() and d.events.length === 0:
            // candidate for idle coalescing
            extend pending idle range
        else:
            flush pending idle range as one PerceptionDelta{kind: 'idle'}
            push d (kind: 'delta')
        prev = p

    flush pending idle range
    push diff(prev, perceptions[last]) with kind: 'current'   // never coalesced

    while tokensOf(rendered) > maxRenderedTokens:
        // drop the oldest non-current entries first; if still over,
        // advance the baseline by absorbing its delta forward
        advance()

    return { baseline, deltas, coveredTicks, droppedOldestTicks }
```

`diff(prev, next)` is a pure function in `perception-diff.ts`. It:
- omits scalar fields that match,
- emits `nearby.entered` for ids present in `next` and not in `prev`,
- emits `nearby.left` for the reverse,
- emits `nearby.moved` only for actors whose position changed by ≥1 tile
  (sub-tile jitter is dropped),
- emits inventory/equipment changes slot-keyed,
- always passes through `events` verbatim.

Two key invariants:
1. `events` are **never elided** by compression. An event happens once
   and the LLM must see it. Coalesced idle runs may carry zero events;
   if a run would carry any, it stops being idle.
2. The current tick is rendered as a `delta` of kind `'current'` against
   the most recent non-current delta (or baseline). It is **never**
   coalesced and **never** truncated by the token cap — if the cap
   trips, we drop oldest first and re-render.

#### Rendering

The compressor produces both structured data (above) and a `rendered`
string for the envelope. Rendering is line-oriented and tokenisation-
friendly:

```
[baseline t=12420]
  position (3221, 3215, 0), hp 10/10, not in combat
  inventory: 4× shrimp, 1× fishing rod, 1× apron
  equipment: (empty)
  nearby: Thrand (resident, 5 SE), goblin#a (npc, 9 S), goblin#b (npc, 10 S)
  objects: bank booth ×4 (N), fishing spot (W)

[t=12421 Δ from 12420]
  moved → (3222, 3215, 0)

[t=12422 Δ from 12421]
  Thrand walked to (3220, 3213) — now 6 NE
  event: chat from Thrand: "old man, I'm heading north"

[idle 12423–12428 — no changes]

[t=12429 Δ from 12422]
  goblin#a moved to (3221, 3210) — now 5 S
  event: hit_taken from goblin#a, 1 dmg, melee

[t=12430 current]
  hp 9/10
  event: hit_taken from goblin#a, 1 dmg, melee
  event: hit_dealt to goblin#a, 2 dmg, melee
  nearby unchanged
```

This format is ~5× more token-efficient than raw JSON and front-loads
the *change*, which is what the LLM is being asked to react to.

#### Hot-event escalation

If the current tick contains any of: `hit_taken` against the resident,
`died`, `chat` directed at the resident, or `trade_requested` from a
nearby actor — the compressor widens the rendered current-tick delta to
include the full nearby actor table (not just moved), so the LLM has
ample context to react to the urgent thing. This is the one place
compression yields to legibility.

#### Token budget interplay

The envelope assembler (§11.3) asks the compressor for at most
`maxRenderedTokens`. The compressor returns the rendered string plus
the token estimate. If a larger budget is available because soul/memory
sections are small that turn, the envelope can grant more; the
compressor will then *extend the window backwards* by walking older
perceptions out of the ring into additional deltas before the baseline.
This is opt-in via `compressor.build({ extraTokens })`; the default is
the fixed window.

The compressor is pure: same ring + same config → same output. Tested
with fixture rings → golden rendered strings.

## 11. LLM client

### 11.1 OpenAI-compatible

`llm-client.ts` speaks `/v1/chat/completions`. Config:

```yaml
llm:
  endpoints:
    default:
      baseUrl: http://localhost:11434/v1   # ollama by default
      model: qwen2.5:14b
      apiKey: ${OPENAI_API_KEY}            # required for hosted providers
      maxConcurrent: 8
      timeoutMs: 30000
    cheap:                                 # used by summariser (§7.6)
      baseUrl: http://localhost:11434/v1
      model: qwen2.5:3b
    strong:                                # opt-in via soul
      baseUrl: https://api.openai.com/v1
      model: gpt-4o-2024-11-20
      apiKey: ${OPENAI_API_KEY}
  defaults:
    temperature: 0.8
    maxTokens: 600
    responseFormat: json_schema           # see §11.2
```

The client uses `fetch` plus a small request queue per endpoint with
`p-queue`-style concurrency control. Streaming is not used in v1 — the
completion is small (≤800 tokens) and we need it parsed atomically.

**Every request carries an AbortController.** The runtime stores the
controller alongside the in-flight request id; Spark's interruption
rule (§8.5.2) calls `controller.abort('preempted_by:' + hookId)` when
a higher-priority hook fires. An aborted request resolves with a
sentinel that the parser turns into `{ ok: false, cause: 'aborted',
cancelledBy: hookId }`; no plan is installed and 1 attention is spent
(per §8.3). Late-arriving responses from aborted requests are
discarded by a request-id match.

Retry policy: one retry on 429 or 5xx with jittered backoff (250ms +
random 0–250ms). A second failure surfaces as `{ ok: false, cause:
'failed' }`, the resident transitions back to `idle`, 2 attention is
spent, and the endpoint enters a 30s pause during which all calls from
this controller fail-fast.

### 11.2 Response shape — structured JSON

We require JSON-schema-constrained output. Providers that don't support
`response_format: { type: 'json_schema' }` get the schema in the system
prompt and a `response_format: { type: 'json_object' }` flag, with a
zod-validated parse layer that rejects malformed completions (counted as
a decision failure).

Schema:

```jsonc
{
  "type": "object",
  "required": ["plan"],
  "properties": {
    "plan": {
      "anyOf": [
        { "$ref": "#/$defs/Plan" },          // Plan shape from §8.6
        { "type": "null" }                    // explicit "do nothing right now"; runtime → idle
      ]
    },
    "memo": {
      "type": "object",
      "required": ["file", "text"],
      "properties": {
        "file": { "type": "string",
                  "description": "Relative path under the resident's memory dir." },
        "text": { "type": "string", "maxLength": 1200 }
      }
    },
    "indexPatch": {
      "type": "string",
      "description": "Optional. Replaces the resident's INDEX.md body."
    },
    "proposeHook": {
      "type": "object",
      "description": "Optional. Add or replace a memory hook by id.",
      "$ref": "#/$defs/Hook"
    },
    "retireHook": {
      "type": "string",
      "description": "Optional. Id of an existing memory hook to remove."
    },
    "proposeVariables": {
      "type": "array",
      "description": "Optional. New resident variables to track.",
      "items": { "$ref": "#/$defs/VariableDef" }
    }
  }
}
```

The `AgentAction`, `Plan`, `PlanStep`, `AdvanceCondition`, `Hook`,
`HookCondition`, and `VariableDef` `$defs` mirror the type
declarations in §8.5 / §8.6. `Plan = null` is the LLM's way of saying
"I considered the trigger and there's nothing to do right now"; the
runtime accepts it, returns to `idle`, and respects the hook's
cooldown like any other firing.

### 11.3 Prompt envelope

Assembled in `prompt-envelope.ts`. Hierarchy (top to bottom):

1. **System message** — fixed framework prompt (≤500 tokens), explaining:
   the resident is an inhabitant of NullCity; what attention is and that
   it is finite; that the LLM is being consulted because a *hook* fired
   (the trigger context appears below); the output is a *plan*, not a
   single action, and the runtime will execute it autonomously until
   the plan finishes or another hook interrupts; the JSON schema; the
   fact that the world is real-time (replies should arrive within
   seconds, not minutes).
2. **Trigger context** — the firing hook's id, priority, and
   `contextHint`. This is what tells the LLM *why it is being asked
   now*. Without it the LLM tends to drift into generic-helpful mode.
3. **Previous intent** (only when interrupting an executing plan) —
   the prior plan's `intent`, the steps completed, and the steps
   remaining. The LLM may choose to resume by returning the remaining
   steps as the new plan, or to pivot.
4. **Soul body** verbatim (≤2KB).
5. **INDEX.md** verbatim (≤4KB).
6. **Targeted memory excerpts** for new actors/places/monsters in the
   current perception (§7.5 #2). At most 3 excerpts, ≤500 tokens each.
7. **Reflective memory results** if a query was issued (§7.5 #3). At
   most 3 hits, ≤300 tokens each.
8. **Recent perception history** — the `CompressedHistory` from
   `PerceptionCompressor` (§10.4): one baseline snapshot + per-tick
   deltas + a full current-tick delta. The compressor enforces the
   per-section token cap; the envelope passes through `rendered`
   verbatim. We never put raw perception JSON here.
9. **Current needs + soul variables table** — name, value, pressure
   (for needs) or threshold-distance (for variables), one-line
   interpretation.
10. **Legacy snapshot** — kind, progress, one-line next-step suggestion
    from `LegacyTracker`.
11. **First-step candidates** — the Spark candidate list as JSON. Hint
    only; the LLM is free to plan beyond them but is encouraged to
    start within them.
12. **Closing instruction** — "Reply with JSON conforming to the
    schema. Return a `plan` (or `null` if no action is warranted). Stay
    in character."

Soft total budget per call: ~25K input tokens, 800 output (perception
compression alone is allowed up to 15K — see §10.4). A `token-count.ts`
estimator (tiktoken-compatible char-based) checks each section against
its cap and truncates verbose ones. The envelope assembler reserves
section budgets in this priority order if total is tight: system →
soul → INDEX.md → current-tick delta → needs/legacy/candidates → older
deltas → targeted excerpts → reflective hits. Lower-priority sections
shrink first.

### 11.4 Budgets

Three layers, all configurable per resident (with global defaults):

| budget        | default | behaviour on exhaust                        |
|---------------|---------|---------------------------------------------|
| per tick      | 26000 in / 800 out tokens | reject the call, emit noop |
| per minute    | 20 LLM calls             | enter `noInferenceUntil` for the rest of the minute |
| per game-day  | 200000 in / 8000 out tokens | enter `noInferenceUntil` for the rest of the day |

Budgets are tracked in `budgets.ts` with a rolling-window counter. Hitting
a minute or day budget adds a controller-side synthetic event
`{ kind: 'budget_exhausted', window }` to the compressed history rendered in
the next envelope. This is not a server `PerceptionEvent`; it is a
`ControllerEvent` merged by the controller so the resident "feels" it. Hooks
rejected only because of budget do not consume cooldown, attention, or global
queue slots.

## 12. Decision loop in detail

The tick handler is small and never awaits the LLM. LLM calls are
launched fire-and-forget; their resolution lands in a per-runtime
mailbox that the next tick consumes.

```ts
function onTick(perception: Perception): void {
    // (1) Ingest perception
    perceptionHistory.push(perception);
    spark.updateScalars(perception);              // hp, attention decay, soul variables
    legacy.tick(perception);

    // (2) Deterministic memory writes
    for (const event of perception.events.filter(salience.salient)) {
        memoryRouter.route(event);
    }

    // (3) Drain LLM mailbox from prior ticks (if any)
    if (runtime.mode === 'deciding' && llm.hasResolved()) {
        const result = llm.takeResolved();
        if (result.ok) {
            if (result.memo)             memory.appendMemo(result.memo);
            if (result.indexPatch)       memory.rewriteIndex(result.indexPatch);
            if (result.proposeHook)      memory.upsertHook(result.proposeHook);
            if (result.retireHook)       memory.retireHook(result.retireHook);
            if (result.proposeVariables) memory.upsertVariables(result.proposeVariables);
            if (result.plan)             runtime.installPlan(result.plan);  // → executing
            else                         runtime.toIdle();
            spark.spendAttention('llm_resolved');
        } else if (result.cause === 'aborted') {
            spark.spendAttention('llm_aborted');
            // mode/plan handled by whoever called abort()
        } else {
            spark.spendAttention('llm_failed');
            runtime.toIdle();
        }
    }

    // (4) Evaluate hooks
    const firing = hookEvaluator.firingThisTick(perception, spark.state);
    const winner = firing.maxByPriority();         // null if nothing fires
    const current = runtime.currentActivityPriority();

    if (winner) {
        // Preemption path
        if (runtime.mode === 'deciding' && winner.interruptInflight) {
            runtime.abortInflight(winner.id);      // AbortController.abort()
        }
        if (runtime.mode === 'executing') {
            runtime.suspendPlan(winner.id);        // captures previousIntent for envelope
        }
        runtime.issueLLMCall(winner);              // → deciding; off-tick
        return;
    }

    // (5) Otherwise, progress the active plan
    if (runtime.mode === 'executing') {
        const action = planExecutor.step(perception, spark.state);
        if (action) {
            gateway.submit(resident, action);
            spark.spendAttention(action.kind);
        }
    }

    // (6) Lifespan
    if (spark.attention.value <= 0) {
        runtime.gracefulLogout('attention_exhausted');
    }
}
```

Three invariants worth highlighting:

- **The tick never blocks on the network.** `llm.hasResolved()` is a
  non-blocking poll on the mailbox; `llm.issueLLMCall()` fires the
  request and returns immediately.
- **At most one action per tick.** Even when a plan has many steps,
  the executor submits one action per tick. This matches the throttle
  real players have and keeps server-side perception coherent with
  what the LLM planned against.
- **Interruption is single-frame.** A hook firing on tick N aborts the
  in-flight LLM call (if any), pauses the running plan (if any), and
  fires a new LLM call — all in the same tick. The next tick's mailbox
  is what installs the new plan, so there is a one-tick gap where the
  resident does nothing (`noop` from the executor, since the plan is
  paused). 600ms of latency is below the threshold where a real
  player would notice.

## 13. ControllerHost — connecting to many residents

```ts
export class ControllerHost {
    private readonly gateway: GatewayClient;
    private readonly runtimes = new Map<string, ResidentRuntime>();
    private readonly desired = new Set<string>();   // names from config

    async start(): Promise<void> { ... }

    async reconcile(): Promise<void> {
        const list = await this.gateway.listResidents();
        for (const name of this.desired) {
            if (!list.some(r => r.name === name && r.online)) {
                await this.connect(name);
            } else if (!this.runtimes.has(name)) {
                await this.attachExisting(name);
            }
        }
    }
}
```

The host runs `reconcile()` on start, then on a 10s timer, and on
gateway-event-disconnect. The `desired` set comes from a single
`controller.yml`:

```yaml
residents:
  - res:pip
  - res:thrand
  - res:agent
gateway:
  url: ws://127.0.0.1:43594/agent
  authToken: ${AGENT_TOKEN}
  controllerId: nullcity-controller-prod
inference:
  maxConcurrent: 8
souls:
  dir: ./data/souls
memory:
  dir: ./data/memory
  qmdBin: qmd                  # path or just `qmd` on PATH
logging:
  dir: ./data/logs
  fullPerceptions: false
```

Each `res:<name>` requires a corresponding `<name>.md` under
`souls.dir`. If the resident doesn't exist server-side yet, the host
calls `create_resident` (residents.md §10.2) before `connect_resident`,
seeded with the soul's optional `spawnPosition` frontmatter field.

### 13.1 Reconnect, restart, crash recovery

- **Controller restart**: `reconcile()` on start picks up online
  residents via `list_residents` and re-attaches with `observe: true,
  control: true`. The in-memory perception history is empty; INDEX.md
  is the resident's only short-term continuity. This is intentional —
  state of the world is recovered from the next perception tick.
- **Server restart**: residents are offline on disk (residents.md §11.4).
  `reconcile()` re-connects them; they re-spawn at their last saved
  position, attention decay continues from `agentMetadata.ticksLived`,
  memory is exactly as it was.
- **Controller crash mid-LLM-call**: in-flight LLM responses are
  dropped. On restart, the resident sees fresh perceptions and decides
  from there. No partial-state recovery needed.
- **Gateway WS drops**: backoff-reconnect (250ms → 8s, capped).
  Residents' `onDisconnect: 'idle'` policy on the server side keeps
  them alive on a server-side IdleBrain during the gap.

### 13.2 Sharing inference budget across runtimes

The host enforces a *global* `maxConcurrentInferences`. Each LLM call
requests a permit tagged with the triggering hook's priority. When the
cap is hit, lower-priority calls wait in a priority queue (higher
first; ties FIFO).

A hook firing on runtime A while runtime A already holds a permit
applies the §8.5.2 interruption rule against A's in-flight call. A
hook firing on runtime A while A is *queued* but not yet running can
simply replace the queued entry — there's no in-flight call to abort,
and the new hook's priority is what matters.

This is strictly fairer than per-runtime concurrency: a thrashing
mentor with a noisy `loneliness` hook can't starve an achiever whose
`hit_taken_critical` just fired.

## 14. Logging

Two per-resident JSONL logs, both daily-rotated:

- `data/logs/<resident>/actions/<date>.jsonl` — one line per submitted
  action, plus its result and the attention spent. Same shape as the
  server's action log so a future merge tool can interleave them.
- `data/logs/<resident>/inference/<date>.jsonl` — one line per LLM call:
  `{ t, tick, endpoint, model, envelope_tokens, completion, parse_ok,
    actions_emitted, attention_after }`. The `envelope` itself is **not**
  logged by default (size); a `--log-envelope` CLI flag turns it on for
  debugging. The full completion *is* logged, since the resident's
  thoughts are the audit trail for LLM behaviour.

Both logs are append-only and safe to ship to a log aggregator.

## 15. Configuration, deps, and entrypoint

New top-level CLI entry in the same `package.json`:

```json
{
  "scripts": {
    "controller": "npm run build && node dist/controller/index.js",
    "controller:once": "npm run build && node dist/controller/index.js --once",
    "controller:dev": "ts-node -r tsconfig-paths/register src/controller/index.ts"
  }
}
```

New deps (controller-only — none of these touch the server runtime):

- `ws` (already required by server gateway — shared)
- `zod` (already in repo)
- `js-yaml` — config + soul frontmatter
- `gray-matter` — soul frontmatter parser
- `p-queue` — concurrency control
- `dotenv` — env var loading
- `execa` — qmd subprocess wrapper
- (assumed installed system-wide) `qmd` binary, invoked via `execa`

The controller is a Node process. It does not load any server engine
code. Importing from `src/engine/...` or `src/server/...` is forbidden
by a repo-appropriate check, e.g. a small `scripts/check-controller-imports.ts`
run from `npm run lint` alongside Biome.

## 16. Edge cases

- **Soul references an endpoint that doesn't exist** → fail-fast on
  startup with a clear error; never silently fall back to `default`.
- **Memory directory missing on first connect** → controller creates it,
  copies templates from `src/controller/memory/templates/`, runs
  `qmd collection add <resident> <path>`.
- **qmd binary missing** → controller logs a one-time warning and
  disables reflective queries (§7.5 #3). Targeted queries still work via
  direct file reads. Resident is degraded but not broken.
- **LLM returns valid JSON with an `action.kind` not in our union** →
  parser rejects, decision counts as failed, resident noops this tick.
  Logged.
- **LLM emits an action against an actor that has since left perception
  range** → server returns `ok: false, reason: 'target_out_of_range'`.
  The controller records this as a synthetic `ControllerEvent` rendered in
  the next perception-history section, and the LLM can adapt.
- **Two attention-exhaustion writes race** (e.g. timing of decay vs.
  spend) → the runtime's `gracefulLogout` is guarded by a single boolean;
  second call no-ops.
- **Resident gets `ECONTROL_HELD`** when reconciling (someone else
  attached): the controller logs and removes the name from `desired`
  for the session. Operator decides whether to take back control.
- **LLM hallucinates a memo file path outside the resident's memory dir**
  (e.g. `../other-resident/social/foo.md`) → memo write rejected by
  path-traversal check in `memory-store.ts`. Logged.
- **Achiever's achievement fires the same tick the resident would have
  decided** → legacy completion takes precedence; the LLM call is
  cancelled, INDEX.md gets a "I did it" final entry from template, and
  the resident logs out happy. The successful achievement is the last
  audit-log entry.
- **Soul archetype is mentor but the world has no newcomers** → mentor's
  legacy tracker exposes `progress: 0, summary: "No mentee found yet"`.
  The LLM will see it and may choose to migrate, or just live as a
  mentor-without-mentees until attention runs out. Both are valid; we
  do not arbitrate.
- **Memo > 1200 chars** → parser rejects (per schema). Logged. Resident
  acts on `plan` if valid, skips memo.
- **Hook fires on the same tick the LLM call from a prior tick
  resolves** → drain mailbox first (step 3 of §12); the runtime is now
  `idle` or `executing`; *then* evaluate the hook against this new
  state. This means a just-installed plan may immediately be
  preempted, which is fine.
- **LLM returns `plan: null`** → runtime returns to `idle`. The hook's
  cooldown is respected (the LLM was consulted; the answer was "do
  nothing"); the hook will not re-fire until cooldown elapses.
- **Two hooks fire simultaneously at the same priority** → tie-break by
  `priority desc, hook id lexicographic`. Deterministic; the loser is
  logged as `shadowed`.
- **Memory hooks file is corrupt or unreadable** → load only system +
  soul hooks; warn once on startup. Resident is degraded but
  functional.
- **An aborted LLM call's response arrives anyway** (network timing)
  → discarded by the mailbox's request-id check. The AbortController
  already accounted the call as aborted; the late response is dropped
  without affecting state.
- **Plan step's action is rejected by the gateway** (e.g. target moved)
  → `onResult.failure` determines behaviour (default `abort`). On
  `abort`, plan transitions to `idle` and `plan_exhausted` may fire on
  next tick; on `retry`, the same step is re-attempted next tick (with
  a small backoff counter — 3 retries then forced abort).
- **Soul-defined variable references a non-existent event kind** →
  validation error at soul load; controller refuses to start the
  resident. Caught at CI for shipped souls.
- **LLM proposes a hook with priority > 80** → parser clamps to 80 and
  logs. Souls and memory hooks are capped to keep system hooks
  authoritative on safety/social.
- **Hook proposed by LLM has a malformed condition** (e.g. references
  a variable that doesn't exist) → rejected at parse time; the
  resident's existing hooks are unchanged.
- **`abandonIf` predicate matches on the same tick the plan was
  installed** → plan transitions to `idle` immediately, attention
  spent only on the LLM call. The LLM proposed a plan with an
  impossible precondition; we log it for tuning.
- **Idle reflection fires while the resident has plenty of attention
  and no needs are pressing** → the LLM may legitimately return
  `plan: null`. That's the system working: the resident considered,
  decided nothing was warranted, and rested.

## 17. Tests

Under `src/controller/**/*.test.ts`:

- `soul-loader.test.ts` — load each starter soul, assert frontmatter
  parsed, archetype/legacy resolved.
- `attention.test.ts` — decay curves match the table; spend table sums
  correctly; lifespan estimates fall within ±10% of doc figures.
- `runtime-state.test.ts` — controller restart reloads attention, subtracts
  passive decay from `ticksLived`, and preserves legacy dedupe state.
- `salience.test.ts` — fixture perception events → expected salience
  decisions.
- `memory-router.test.ts` — given a fixture chat/hit/item event sequence,
  the right files are written with the right frontmatter mutations.
- `prompt-envelope.test.ts` — assembly stays under token caps for a
  variety of fixture inputs; truncation is deterministic.
- `completion-parser.test.ts` — zod schema accepts valid and rejects
  invalid (off-union, oversized memo, path-traversal memo path).
- `legacy.test.ts` — one case per archetype: progress increments in the
  defined operational conditions, doesn't increment otherwise.
- `controller-host.test.ts` — reconcile loop converges on a fixture
  desired set against a fake gateway.
- `qmd-wrapper.test.ts` — temp collection covers collection slugging,
  `collection add`, `get`, `query --format json`, and `embed` JSON contracts.
- `e2e-script.test.ts` (slow) — boots the server with `-fakeResidents 0`,
  launches the controller against one starter soul backed by a stub LLM
  that returns canned completions, asserts the resident walks the
  expected path and the action log matches a golden.

LLM responses are stubbed in unit tests via a fake client that returns
fixture completions. A separate `e2e-llm.test.ts` (excluded from CI,
opt-in flag) exercises a real local ollama for smoke.

## 18. Rollout

1. **Land the host + gateway client** (no inference yet). Connects to
   the server, calls `list_residents`, no-ops. Verifies handshake.
2. **Land soul loader + 3 starter souls.** Validation tests pass.
3. **Land attention + needs + legacy stubs.** Decay curves tested.
   No LLM yet — runtime emits `noop` every decision tick. Verify
   residents log out at expected lifespan.
4. **Land memory store + router (no qmd yet).** Salient events appear
   in the right files. Templates copied on first connect.
5. **Land LLM client + prompt envelope + completion parser** with a
   fake endpoint that returns canned JSON. Action loop end-to-end.
6. **Land qmd integration**: collection add on first connect; reflective
   query in envelope when need-pressure-gated.
7. **Land the summariser + INDEX.md regeneration.**
8. **Wire a real local model (ollama qwen2.5:14b)** and run the
   3-resident smoke for 30 game-minutes. Tune attention numbers.
9. **Land budgets + local `noInferenceUntil` fallback.**
10. **Land tests + CI.**
11. **FEATURES.md** — Controller section, marked.

Each step is mergeable behind `--controller-enabled` config; the server
is never blocked.

## 19. Open questions

- **Soul authoring workflow.** Do we hand-write souls, or LLM-generate
  them from a prompt? **Proposed v1: hand-write, ship 3 starters.** Let
  an LLM-author tool come later; the first round of souls needs to be
  legible and intentional.
- **Memory portability across resurrections.** If a future mechanic
  brings a dead resident back, do they remember? **Proposed v1: yes —
  the memory dir is untouched on death. Resurrection re-opens it.** The
  alternative (wipe on death) is harsher and harder to undo.
- **Cross-resident memory leakage.** Resident A writes
  `social/res-thrand.md` claiming Thrand is hostile. Thrand never
  authored that. **Proposed v1: that's fine — it's A's belief, not
  ground truth.** We do not synchronize beliefs between residents.
  Gossip emerges via chat, not via cross-reads.
- **Should the LLM call memory tools, or should the controller
  pre-fetch?** **Proposed v1: controller pre-fetches.** Tools double
  inference cost and complicate budgeting. Revisit when local models
  reliably handle multi-step tool calls cheaply.
- **Token estimator accuracy.** We use a char-based estimator; real
  tokenization varies per model. **Proposed v1: budget at 80% of nominal
  caps so the estimator's drift is absorbed.** Add real per-model
  tokenizers if we end up hitting hard caps in practice.
- **Attention income — sketch for v2 only.** Earning attention should be
  *narratively* tied to fulfilling the resident's archetype. Concrete
  ideas to revisit:
  - Mentor: +N attention when LegacyTracker increments a mentee count.
  - Achiever: +N attention on milestone progress (e.g. each level
    toward a target skill level).
  - Endurer: +N attention on each new game-day survived past N=X.
  - Universal: +N attention when *another resident* writes about you in
    their `social/` memory with positive sentiment (resident-graph as a
    natural attention market).
  None of this ships in v1. v1 establishes the spending side and the
  ledger; v2 adds the income side and tunes equilibrium.
- **What model defaults?** **Proposed v1: ship config that defaults to a
  local ollama `qwen2.5:14b` for `default`, `qwen2.5:3b` for `cheap`,
  no `strong` configured.** Operators set their own keys. Avoids any
  default that costs money on first run.
- **Should the controller live in this repo at all?** It could be a
  separate package. **Proposed v1: same repo, separate entrypoint, no
  cross-imports with the server.** The cost of a second repo right now
  is real (CI, versioning, shared protocol types) and the benefit
  (independent deploy) is achievable via the entrypoint split alone.

---

## Status checklist

Update as we go. ✅ done · 🟡 in progress · ⬜ not started.

### Host + transport
- ✅ `nullcity-controller` entrypoint + `controller.yml` loader
- ✅ `GatewayClient` WS implementation matching residents.md §10.2
- ✅ `controller_hello` handshake schema in server messages
- ✅ `ControllerHost.reconcile()` loop + 10s timer
- ✅ Reconnect/backoff
- ✅ Global `maxConcurrentInferences` queue

### Soul
- ✅ `soul-schema.ts` zod schema
- ✅ `soul-loader.ts` with gray-matter
- ✅ 3 starter souls (mentor / achiever / endurer)
- ⬜ Soul validation in CI

### Spark
- ✅ Runtime mode state machine: `idle` / `executing` / `deciding`
- ✅ `Need` type + per-need pressure functions
- ✅ Attention decay curves (`gentle`/`standard`/`steep`)
- ✅ Attention spend table (incl. aborted / failed LLM costs)
- ✅ Soul-defined variables: DSL evaluator + tick recompute
- ✅ `proposeVariables` LLM hook → memory-owned variable extension
- ✅ `Hook` + `HookCondition` types
- ✅ System hooks table (priority 30–95, incl. `idle_reflection`)
- ✅ Soul hooks loaded from frontmatter (priority capped at 80)
- ✅ Memory hooks: load/upsert/retire via `hooks.md`
- ✅ Hook evaluator: cooldown, fire, shadowed-log, deterministic tie-break
- ✅ Interruption margin rule (`0` while idle, `+10` while active) + `interruptInflight` gate
- ✅ Mailbox + AbortController plumbing
- ✅ Plan installer + `previousIntent` capture on suspend
- ✅ Plan executor: advance conditions (5 kinds), `abandonIf`, `maxTicks`
- ✅ Plan-step state (`not_started` / `submitted` / `complete`) prevents repeated long-running actions
- ✅ First-step candidate hint (`candidates.ts`) — narrowed by triggering hook
- ✅ `gracefulLogout('attention_exhausted')` + `runtime-state.json` deceased marker

### Legacy
- ✅ `LegacyTracker` for each of 3 archetypes
- ✅ Mentor: operational teach-detection
- ✅ Achiever: 4 achievement-spec kinds
- ✅ Endurer: ticksLived progress
- ✅ Legacy-complete → attention to 0

### Memory
- ✅ Per-resident directory bootstrap from templates
- ✅ `runtime-state.json`: attention, legacy progress, deceased state, budget windows
- ✅ `memory-router.ts` salient-event → file routing
- ✅ `memory-store.ts` path-traversal guarded writes
- ✅ `INDEX.md` always-included envelope path
- 🟡 qmd wrapper contract: version pin, resident slug, JSON-shape validation
- ✅ qmd `collection add` on first connect
- ✅ Targeted memory excerpt (new actor / monster / place)
- 🟡 Reflective `qmd query` gated by need pressure
- ⬜ `memory-summariser.ts` daily compaction + `qmd embed` reindex
- ✅ LLM `memo` write path

### Perception
- ✅ Per-runtime perception ring buffer (K=128)
- ✅ `perception-diff.ts` pure pairwise delta (positions, inventory, equipment, skills, nearby)
- ✅ `perception-compressor.ts` baseline + deltas + idle coalescing
- ✅ Hot-event escalation (re-expand current tick on hit/chat/died/trade-request)
- 🟡 Token-cap enforcement w/ oldest-first drop + baseline advance
- ⬜ Optional `extraTokens` window extension hook
- ⬜ Golden-string tests for compressor render output
- 🟡 `salience.ts` deterministic filter (memory writes — separate from compression)
- 🟡 Diff-based "new actor / new chunk" detection (drives targeted memory retrieval)
- ⬜ Optional full-perception JSONL log

### LLM
- ✅ OpenAI-compatible `LLMClient` (`/v1/chat/completions`)
- ✅ `response_format: json_schema` w/ fallback to `json_object`
- ✅ AbortController per request; abort propagates `cancelled_by` to log
- ✅ Mailbox: request-id-keyed result drain; late-arriving abort discard
- ✅ `prompt-envelope.ts` 12-section assembly + per-section caps
- ✅ Trigger-context section sourced from firing hook's `contextHint`
- ✅ Previous-intent section on plan interruption (remaining steps included)
- ✅ `completion-parser.ts` zod-validated `Plan` + memo + indexPatch + proposeHook/retireHook/proposeVariables
- ✅ Retry policy (1 retry on 429/5xx; 30s endpoint pause on 2 failures)
- ✅ Priority-ordered global concurrency queue (`maxConcurrentInferences`)
- ✅ Budgets: per-tick, per-minute, per-game-day
- ✅ `budget_exhausted` synthetic event into perception envelope
- ✅ `noInferenceUntil`: budget-rejected hooks consume no cooldown/attention/queue slot

### Logging
- ✅ `actions/<date>.jsonl` per resident
- ✅ `inference/<date>.jsonl` per resident
- ✅ `--log-envelope` debug flag

### Server-side touch-ups
- ✅ `controller_hello` message + `cause` field on `action_result`/`error`
- ✅ `package.json` controller scripts + deps

### Tests
- ⬜ Soul loader + starter soul fixtures (incl. variables + hooks frontmatter)
- ⬜ Attention decay/spend math (incl. aborted-call cost)
- ⬜ Salience filter cases
- ⬜ Memory router writes
- ✅ Variable DSL evaluator: increment, decrement, decay, clamp
- ✅ Hook evaluator: cooldown, shadowing, tie-break determinism
- ✅ Interruption: hook at priority N+10 aborts in-flight call;
      hook at priority N is shadowed
- ✅ Plan executor: each `AdvanceCondition` kind; `abandonIf`;
      `maxTicks` exhaustion; per-step retry/abort
- ✅ Mailbox: late-response discard after abort
- ✅ Envelope assembly + caps (incl. previous-intent on interruption)
- ✅ Completion parser accept/reject (plan/null, proposeHook clamp at 80)
- ✅ Legacy tracker increments
- ✅ Host reconcile loop + priority queue under contention (host reconcile and LLM queue covered)
- ⬜ E2E with stub LLM (golden action log): a plan runs to completion,
      a hook interrupts mid-plan, the resident pivots
- ⬜ Opt-in E2E with local ollama

### Docs
- ✅ FEATURES.md Controller section
- ✅ `data/souls/README.md` authoring guide
- ✅ `data/memory/README.md` operator's guide to inspecting residents
