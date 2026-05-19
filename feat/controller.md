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
  fall back to a deterministic IdleBrain for the remainder of the window
  rather than queueing inference.
- **Auditable.** Every prompt + completion + parsed action set is written to
  a per-resident JSONL log. Memory mutations are commits to the per-resident
  memory directory and can be diffed.

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
   │   per tick:                                                      │
   │     1. ingest perception (push to history, append events to mem) │
   │     2. update needs (decay attention, recompute pressure)        │
   │     3. if it's a decision tick:                                  │
   │           a. Spark.candidates(perception, needs, legacy)         │
   │           b. assemble PromptEnvelope (soul + qmd queries + hist) │
   │           c. LLM.completions(envelope) → {actions, memo}         │
   │           d. enqueue actions to gateway                          │
   │           e. write memo to memory if salient                     │
   │           f. update legacy progress                              │
   │     4. spend attention per action emitted                        │
   │     5. if attention ≤ 0: submit_action {kind:'logout'} + reason  │
   └────────────────────────────────────────────────────────────────┘
```

The game tick is ~600ms. A round-trip to a cloud LLM is typically 800–4000ms.
Decisions therefore run on a **multi-tick cadence** (default: one decision
every 5 ticks ≈ 3s) and use the previous-tick fallback rule from
`residents.md §9`: while inference is in flight, the resident continues
executing the *previous* decision's residual actions; if a tick passes with
no decision ready, `noop` is queued.

Inference is parallelised across residents on the controller side. Each
runtime owns at most one in-flight request; the host pools concurrent
requests with a configurable cap (`maxConcurrentInferences`, default 8).

## 4. Files to create

```
src/controller/                              # new entry point
    index.ts                                 # CLI entrypoint
    config.ts                                # ControllerConfig (loaded from yml)
    controller-host.ts                       # gateway WS client + runtime pool
    resident-runtime.ts                      # one per online resident
    spark/
        spark.ts                             # Spark framework: needs, scoring
        needs.ts                             # Need types (Attention, plus stubs)
        attention.ts                         # decay curve + spend table
        legacy.ts                            # 3 legacy types + progress tracker
        candidates.ts                        # action candidate generator
    soul/
        soul-loader.ts                       # parses Soul .md w/ frontmatter
        soul-schema.ts                       # zod schema for soul frontmatter
        starter-souls/
            res-pip.md                       # example: mentor archetype
            res-thrand.md                    # example: achiever archetype
            res-mossy.md                     # example: endurer archetype
    memory/
        memory-store.ts                      # facade over qmd + filesystem
        memory-router.ts                     # event → which file does it go in
        memory-summariser.ts                 # periodic compaction
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
        llm-client.ts                        # OpenAI-compatible client
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
   write a wrapper that issues `qmd query --collection <resident-id>` and
   parses the JSON output.
4. **Cheap.** qmd's SQLite index is a single file. Per-resident collections
   are cheap to add/drop. No service to run, no port to manage.

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

Spark is the small piece of code that decides, on each decision tick,
*what kind of choice this is*. It does not pick the action; the LLM does.
Spark assembles the candidate set, the need pressure, and the legacy
progress, and hands them to the prompt envelope.

### 8.1 Needs

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

### 8.2 Attention — the only real resource in v1

`attention.value` is a positive integer initialised to
`soul.attentionProfile.startingAttention`. Each game tick, it decays by
`decay(age, curve)`:

| curve     | decay(t in ticks)                                |
|-----------|--------------------------------------------------|
| gentle    | `1 + floor(t / 10000)`                           |
| standard  | `1 + floor(t / 5000) + floor(t / 20000) * 2`     |
| steep     | `2 + floor(t / 2500) * 2`                        |

`t` is the resident's age in ticks (monotonic across sessions, taken from
`agentMetadata.ticksLived` in the server save — `residents.md §11.4`). All
three curves are accelerating: older residents pay more per tick to exist.
Numbers are tuned so that:

- A `gentle / 5000` resident, idle, lives ~14 game-hours.
- A `standard / 5000` resident, idle, lives ~6 game-hours.
- A `steep / 3000` resident, idle, lives ~2 game-hours.

Actions also spend attention. The spend table (in `attention.ts`):

| action kind            | spend |
|------------------------|-------|
| noop                   | 0     |
| move_to (per tile)     | 0.2   |
| say / whisper          | 2     |
| interact (non-combat)  | 1     |
| attack / cast_spell    | 3     |
| trade_*                | 2     |
| any decision-tick LLM call (whether or not actions emitted) | 5 |

The LLM-call cost is the dominant cost — *thinking is expensive*. This is
intentional and meta-honest: the resource that disappears is literally the
inference budget. A resident on `steep` decay who LLM-decides every 5 ticks
spends ~60 attention/game-minute on thinking alone.

When `attention.value` hits 0 or below, the runtime:
1. Stops issuing decisions immediately.
2. Writes a final `## Final entry` block to `events/<today>.md` summarising
   the resident's last act (no LLM call — a deterministic template).
3. Emits `submit_action { kind: 'logout' }` with `cause:
   'attention_exhausted'` (see §5).
4. Marks the resident's soul file with a `deceased: { date, tick, cause }`
   key in frontmatter (the only soul mutation we allow, written once).
5. Detaches from the gateway.

The save file (server-side, `data/residents/<name>.json`) is preserved.
Future mechanics may resurrect; v1 leaves the file alone and considers the
resident dead.

### 8.3 Candidate generation

`spark.candidates(perception, needs, legacy)` returns a small set of
*action shapes* (at most 8) the LLM is asked to choose among:

1. Start from `perception.availableActions` (residents.md §8.3) — the
   server already tells us what's legal.
2. Filter by top need: if a need has pressure > 0.7, only actions
   plausibly relevant to that need are kept (table-driven mapping in
   `candidates.ts`).
3. Score by a cheap heuristic (distance, need-relevance, legacy-relevance)
   and keep top 8.
4. Always include `noop` and `say` as fallback shapes so the LLM never
   feels forced into a wrong move.

The set is passed to the LLM as a JSON list in the user message. The LLM
is **not** required to choose from it (residents.md §8.3) but is strongly
encouraged in the system prompt to. Off-list actions are still applied if
valid; the gateway returns `ok: false` otherwise.

### 8.4 Decision cadence

Spark also decides *when to think*. By default the runtime invokes the LLM
every 5 ticks. It thinks earlier (next tick) if:

- An event of kind `'hit_taken'`, `'died'`, or `'chat'` arrives with the
  resident as target.
- A previously-unseen actor enters perception range.
- Legacy progress changed.

It thinks later (skip the scheduled tick, save attention) if:

- All needs have pressure < 0.2 and no new perception events since last
  decision.
- The resident is currently executing a multi-tick action that hasn't
  finished (e.g. walking a path of length > 1 that the LLM emitted).

A `forceDecide()` API exists for tests.

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
PerceptionEvents lands), then 1. Achievement is terminal — soul's
`legacy.complete` is set in the soul's deceased line on completion, and
attention immediately drops to 0 (the resident's reason for being is
fulfilled; they log out content). This is intentional and stark.

### 9.3 Endurer

Parameters: `targetTicksLived: number` (default: 50000 ≈ 8 game-hours).

Progress = `min(1, ticksLived / targetTicksLived)`. Hits 1 → resident has
"endured" and the soul gets the deceased line with `cause: 'endured'`. As
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
    maxRenderedTokens: number; // default 1500 — hard cap; baseline advances if exceeded
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
completion is small (≤600 tokens) and we need it parsed atomically.

Retry policy: one retry on 429 or 5xx with jittered backoff (250ms +
random 0–250ms). A second failure surfaces as a `decision_failed`
perception-event-like entry in the runtime's log and the resident
executes `noop` for that tick. No third retry — a remote endpoint that
fails twice consecutively is treated as flaky and the resident pauses
decisions for 30s.

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
  "required": ["actions"],
  "properties": {
    "actions": {
      "type": "array",
      "maxItems": 3,
      "items": { "$ref": "#/$defs/AgentAction" }
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
    }
  }
}
```

The `AgentAction` `$defs` mirrors the union in `residents.md §8.1`.

### 11.3 Prompt envelope

Assembled in `prompt-envelope.ts`. Hierarchy (top to bottom):

1. **System message** — fixed framework prompt (≤500 tokens), explaining:
   the resident is an inhabitant of NullCity, what attention is and that it
   is finite, that they should choose actions from the candidate list when
   reasonable, the output JSON schema, and the fact that the world is
   real-time (replies should arrive within seconds, not minutes).
2. **Soul body** verbatim (≤2KB).
3. **INDEX.md** verbatim (≤4KB).
4. **Targeted memory excerpts** for new actors/places/monsters in the
   current perception (§7.5 #2). At most 3 excerpts, ≤500 tokens each.
5. **Reflective memory results** if a query was issued (§7.5 #3). At most
   3 hits, ≤300 tokens each.
6. **Recent perception history** — the `CompressedHistory` from
   `PerceptionCompressor` (§10.4): one baseline snapshot + per-tick
   deltas + a full current-tick delta. The compressor enforces the
   per-section token cap; the envelope passes through `rendered`
   verbatim. We never put raw perception JSON here.
7. **Current needs table** — name, value, pressure, one-line interpretation.
8. **Legacy snapshot** — kind, progress, one-line next-step suggestion from
   `LegacyTracker`.
9. **Action candidates** — the Spark candidate list as JSON.
10. **Closing instruction** — "Reply with JSON conforming to the schema.
    At most 3 actions. Be brief in `memo`. Stay in character."

Soft total budget per call: ~6K input tokens, 600 output. A
`token-count.ts` estimator (tiktoken-compatible char-based) checks each
section against its cap and truncates verbose ones.

### 11.4 Budgets

Three layers, all configurable per resident (with global defaults):

| budget        | default | behaviour on exhaust                        |
|---------------|---------|---------------------------------------------|
| per tick      | 6500 in / 700 out tokens | reject the call, emit noop  |
| per minute    | 20 LLM calls            | switch to IdleBrain for the rest of the minute |
| per game-day  | 40000 in / 6000 out tokens | switch to IdleBrain for the rest of the day |

Budgets are tracked in `budgets.ts` with a rolling-window counter. Hitting
a minute or day budget is a salient event in the resident's perception
history (kind `'budget_exhausted'`, surfaced in the next envelope) so the
resident "feels" it — which gives Spark/LLM a chance to do less expensive
things.

## 12. Decision loop in detail

Pseudocode for one tick on one runtime:

```ts
async function onTick(perception: Perception) {
    perceptionHistory.push(perception);
    const events = perception.events;

    // (1) Deterministic memory writes
    for (const event of events.filter(salient)) {
        memoryRouter.route(event);   // appends to the right file
    }

    // (2) Update needs
    spark.tick(perception);          // decays attention, recomputes pressures

    // (3) Update legacy tracker
    legacy.tick(perception);

    // (4) Decide whether to call the LLM
    if (!spark.shouldDecideNow()) {
        return executePendingActions();   // may emit a queued action
    }

    // (5) Build candidates
    const candidates = spark.candidates(perception);

    // (6) Build envelope
    const envelope = await promptEnvelope.build({
        soul, indexMd, perception, history: perceptionHistory.last(8),
        needs: spark.needs, legacy, candidates,
        memoryExcerpts: await memory.relevantTo(perception),
    });

    // (7) Inference
    const result = await llm.complete(envelope, { soul, budgets });
    if (!result.ok) {
        spark.spendAttention('decision_failed');
        return executePendingActions(); // noop on failure
    }

    // (8) Apply
    for (const action of result.actions) {
        gateway.submit(resident, action);
        spark.spendAttention(action.kind);
    }
    if (result.memo) memory.appendMemo(result.memo);
    if (result.indexPatch) memory.rewriteIndex(result.indexPatch);

    spark.spendAttention('llm_call');

    // (9) Lifespan check
    if (spark.attention.value <= 0) {
        await runtime.gracefulLogout('attention_exhausted');
    }
}
```

`executePendingActions()` exists because a single LLM call can emit a
list of up to 3 actions; only the first is submitted immediately, the
rest are queued and submitted on subsequent ticks (one per tick), unless
a new decision pre-empts them. This keeps the server-side perception
state coherent with what the LLM saw.

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
  - res:mossy
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

The host enforces a *global* `maxConcurrentInferences`. A runtime that
wants to decide queues a permit; if the queue would exceed cap, the
runtime defers to next tick (and re-tries `shouldDecideNow`). This is
strictly fairer than per-runtime concurrency because long-lived
high-attention residents otherwise crowd out fresh ones with tight
budgets.

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
    "controller": "tsx src/controller/index.ts",
    "controller:once": "tsx src/controller/index.ts --once"
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
- (assumed installed system-wide) `qmd` binary, invoked via `execa`

The controller is a Node process. It does not load any server engine
code. Importing from `src/engine/...` or `src/server/...` is forbidden
by a lint rule (`@nrwl/no-restricted-imports` or hand-rolled).

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
  The next perception envelope includes this as an `action_result` and
  the LLM can adapt.
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
  acts on `actions` if valid, skips memo.

## 17. Tests

Under `src/controller/**/*.test.ts`:

- `soul-loader.test.ts` — load each starter soul, assert frontmatter
  parsed, archetype/legacy resolved.
- `attention.test.ts` — decay curves match the table; spend table sums
  correctly; lifespan estimates fall within ±10% of doc figures.
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
9. **Land budgets + IdleBrain fallback.**
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
- ⬜ `nullcity-controller` entrypoint + `controller.yml` loader
- ⬜ `GatewayClient` WS implementation matching residents.md §10.2
- ⬜ `controller_hello` handshake schema in server messages
- ⬜ `ControllerHost.reconcile()` loop + 10s timer
- ⬜ Reconnect/backoff
- ⬜ Global `maxConcurrentInferences` queue

### Soul
- ⬜ `soul-schema.ts` zod schema
- ⬜ `soul-loader.ts` with gray-matter
- ⬜ 3 starter souls (mentor / achiever / endurer)
- ⬜ Soul validation in CI

### Spark
- ⬜ `Need` type + per-need pressure functions
- ⬜ Attention decay curves (`gentle`/`standard`/`steep`)
- ⬜ Attention spend table
- ⬜ `spark.candidates()` filter + score
- ⬜ `spark.shouldDecideNow()` cadence rule
- ⬜ `gracefulLogout('attention_exhausted')` + soul `deceased` mutation

### Legacy
- ⬜ `LegacyTracker` for each of 3 archetypes
- ⬜ Mentor: operational teach-detection
- ⬜ Achiever: 4 achievement-spec kinds
- ⬜ Endurer: ticksLived progress
- ⬜ Legacy-complete → attention to 0

### Memory
- ⬜ Per-resident directory bootstrap from templates
- ⬜ `memory-router.ts` salient-event → file routing
- ⬜ `memory-store.ts` path-traversal guarded writes
- ⬜ `INDEX.md` always-included envelope path
- ⬜ qmd `collection add` on first connect
- ⬜ Targeted memory excerpt (new actor / monster / place)
- ⬜ Reflective `qmd query` gated by need pressure
- ⬜ `memory-summariser.ts` daily compaction + `qmd embed` reindex
- ⬜ LLM `memo` write path

### Perception
- ⬜ Per-runtime perception ring buffer (K=128)
- ⬜ `perception-diff.ts` pure pairwise delta (positions, inventory, equipment, skills, nearby)
- ⬜ `perception-compressor.ts` baseline + deltas + idle coalescing
- ⬜ Hot-event escalation (re-expand current tick on hit/chat/died/trade-request)
- ⬜ Token-cap enforcement w/ oldest-first drop + baseline advance
- ⬜ Optional `extraTokens` window extension hook
- ⬜ Golden-string tests for compressor render output
- ⬜ `salience.ts` deterministic filter (memory writes — separate from compression)
- ⬜ Diff-based "new actor / new chunk" detection (drives targeted memory retrieval)
- ⬜ Optional full-perception JSONL log

### LLM
- ⬜ OpenAI-compatible `LLMClient` (`/v1/chat/completions`)
- ⬜ `response_format: json_schema` w/ fallback to `json_object`
- ⬜ `prompt-envelope.ts` 10-section assembly + per-section caps
- ⬜ `completion-parser.ts` zod-validated AgentAction[] + memo + indexPatch
- ⬜ Retry policy (1 retry, 30s endpoint pause on 2 failures)
- ⬜ Budgets: per-tick, per-minute, per-game-day
- ⬜ `budget_exhausted` synthetic event into perception envelope

### Logging
- ⬜ `actions/<date>.jsonl` per resident
- ⬜ `inference/<date>.jsonl` per resident
- ⬜ `--log-envelope` debug flag

### Server-side touch-ups
- ⬜ `controller_hello` message + `cause` field on `action_result`/`error`
- ⬜ `package.json` controller scripts + deps

### Tests
- ⬜ Soul loader + starter soul fixtures
- ⬜ Attention decay/spend math
- ⬜ Salience filter cases
- ⬜ Memory router writes
- ⬜ Envelope assembly + caps
- ⬜ Completion parser accept/reject
- ⬜ Legacy tracker increments
- ⬜ Host reconcile loop
- ⬜ E2E with stub LLM (golden action log)
- ⬜ Opt-in E2E with local ollama

### Docs
- ⬜ FEATURES.md Controller section
- ⬜ `data/souls/README.md` authoring guide
- ⬜ `data/memory/README.md` operator's guide to inspecting residents
