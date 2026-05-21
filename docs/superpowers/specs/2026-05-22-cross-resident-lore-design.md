# Cross-Resident Memory And Lore — Design (Workstream L)

**Status:** Draft v1.
**Author:** Claude (planning push 2026-05-22).
**Date:** 2026-05-22.
**Roadmap:** Workstream L in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
**North star:** `docs/null-city-rs6-vision.md` § "Residents Affect Each Other".
**Read first:** `docs/null-city-ideation-backlog.md` Theme 7 (Cross-Resident Dynamics).
**Depends on:**
- Workstream I (Evidence Loop, `2026-05-21-spark-evidence-loop-design.md`) — trajectory.jsonl substrate; relationship events land in the same JSONL with no schema break.
- Workstream J (Patron Loop, `2026-05-22-patron-loop-design.md`) — `patron_*` line precedent and standing model.
- Workstream K (Factions, `2026-05-22-rs6-factions-design.md`) — factions modulate which interactions are permitted (allies assist; rivals duel).
**Required by:**
- Workstream M (Hero Residents, `2026-05-22-hero-residents-design.md`) — heroes use these verbs to form named relationships across their arcs.

---

## Why This Spec Exists

Today, every SPARK resident runs in parallel isolation. Two residents standing in the same Lumbridge courtyard can `say` past each other and never form a relationship — the kernel has no first-class concept of one resident *doing something to* another, and no shared surface where one resident's significant event reaches another's perception envelope. The June 1, 2026 event needs at least the bones of this to land or the city will look like a room full of solitary monologues.

Theme 7 of the ideation backlog catalogues four primitives that v1 sketched and v2 deliberately deferred: an `interact_resident` action family, resident-owned long-running projects, a `world_events` / rumor channel, and resident perception of nearby in-game events. This spec turns those four bullets into an implementation surface that slots into the existing Evidence Layer and SPARK kernel without schema breaks.

Three things make this hard:

1. **Patrons-don't-control invariant.** Humans must not be able to use these verbs as remote puppet strings. Verbs emit from a resident's SPARK loop, not from a patron API. A patron *funds* a project; the resident *decides* whether to work on it next tick.
2. **Static catalog discipline.** Project archetypes are typed, code-defined, finite. We do not ship an open-ended project authoring surface; we ship three archetypes for rs6 MVP and call that the catalog.
3. **Voice preservation.** `whisper` text is verbatim, recorded in trajectory exactly like `say` (the Library's "In their own words" section already promotes `say` lines — `whisper` joins them under a `channel` field).

## Goals

- Four new typed `AgentAction` verbs (`whisper`, `gift`, `assist_skill`, `challenge_duel`) gated by SPARK kernel preconditions, recorded in trajectory.jsonl with a `peer` field that the existing Library updater already partially understands.
- A static, three-entry catalog of resident-owned project archetypes (`player_shop`, `herb_patch`, `faction_relic`), each with completion criteria, patron-funding hooks, and abandonment semantics on resident death.
- A `world_events` shared data surface (in-process pub/sub, file-backed for crash safety) that lets one resident's significant event reach nearby residents' perception envelopes in O(N_residents_in_room) without a schema break.
- Four new perception event kinds (`peer_level_up`, `peer_pk_witnessed`, `peer_quest_completed`, `faction_territory_shift`) emitted by the gateway into the existing `Perception` shape and consumed by the SPARK prompt envelope.
- A path for Workstream M heroes to form named relationships — first whisper triggers `first_peer_encounter`; three whispers triggers `relationship_repeated`; a final whisper before death triggers `relationship_parting`. Predicates already live in `evidence/significance.ts`.

## Non-Goals

- Resident-vs-resident combat (the `challenge_duel` verb opens a *consented duel* surface; if both sides accept, RuneJS handles the combat; the kernel never autonomously initiates PvP without verb consent).
- Long-running cross-faction campaigns or wars (Workstream K's territory shifts are *perceived* here; they're not *driven* here).
- Player-broker chat — patrons cannot send arbitrary text through a resident (patrons-don't-control invariant).
- A general project authoring tool — three project archetypes only; new ones require a code change and a static-catalog audit.
- Cross-process / multi-controller rumor propagation — single-process constraint inherits from the Evidence Layer spec; `world_events` is in-process only.
- Persisting `world_events` for offline replay — they are best-effort in-flight gossip; durability lives in trajectory.jsonl per the residents who heard them.

## Constraints

- TypeScript, Node 24+, existing repo conventions (Zod for schemas, Jest for tests, Biome for lint/format).
- Must not break `[A1]`–`[A7]` SPARK facade contracts. New verbs are emitted by reviewed modules through the existing typed `AgentAction` registry. The `world_events` channel is kernel-owned; modules can READ it via the perception facade snapshot, but cannot WRITE it directly.
- Trajectory line schema is **field-additive only**. New verbs slot into the existing `kind: 'action'` line with a `peer` field; new perception events slot into the existing `perception` shape with new `kind` strings. No `schemaVersion` bump.
- **Static catalog discipline.** `PROJECT_ARCHETYPES` is a `Readonly<Record<...>>` in `src/controller/projects/project-archetypes.ts`. Adding a fourth archetype requires editing code, not config.
- **Patrons-don't-control invariant** is enforced at the project funding surface: humans add Shards to a project's escrow; the resident decides whether to act on it next tick. No human-facing API call directly emits a resident action.
- **Single-process constraint** (inherited from Evidence Layer): one `ControllerHost` per `CONTROLLER_MEMORY_DIR`. The `WorldEventBus` is an in-process emitter; it does not implement OS-level IPC.
- **Voice preservation invariant.** `whisper` text is recorded verbatim in trajectory.jsonl, identical to `say`. The Library's "In their own words" section selects from both `say` and `whisper` lines (with channel tagged); paraphrase is forbidden.
- **No remote control of verbs.** Every new verb emits from inside `spark.tick` via the LLM decision path. No HTTP endpoint, dashboard button, or patron API may inject a verb directly into the action coordinator.
- Verbs that involve another resident MUST verify the target resident is in the same perception envelope at emission time. The kernel rejects (logs `kind: 'error'`, drops the action) if the target is not visible.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          SPARK kernel                              │
│   spark.tick()  ┌──► action emission ── interact_resident verbs    │
│                 │     ├─ whisper ── trajectory: kind:'say' chan:wh │
│                 │     ├─ gift ─── trajectory: kind:'action' peer  │
│                 │     ├─ assist_skill                              │
│                 │     └─ challenge_duel                            │
│                 │                                                  │
│                 ├──► ProjectTracker.advance(activeProject)         │
│                 │     ├─ progress.jsonl                            │
│                 │     ├─ project-escrow ledger                     │
│                 │     └─ on complete: legacy_event or artifact     │
│                 │                                                  │
│                 ├──► WorldEventBus.publish (significance promote)  │
│                 │     └─► nearby residents' Perception envelopes   │
│                 │                                                  │
│                 └──► perception.in-game-events                     │
│                       (peer_level_up, peer_pk_witnessed,           │
│                        peer_quest_completed,                       │
│                        faction_territory_shift)                    │
│                                  │                                 │
│                  Evidence Layer  ▼                                 │
│                  trajectory.jsonl (kind:'action' with peer/target) │
│                  timeline.jsonl (relationship_* events)            │
│                  projects.jsonl (new file, project lifecycle)      │
└────────────────────────────────────────────────────────────────────┘
                                  │
                  CONTROLLER_MEMORY_DIR/<resident>/projects/
                  CONTROLLER_MEMORY_DIR/_world/events/<session>.jsonl
```

### Single-tick flow with cross-resident substrate

1. `spark.beginTick(state, perception)` — the perception envelope now contains in-game peer events from sub-area L4 (`peer_level_up`, etc.) plus any `WorldEventBus` rumors propagated into this resident's room since the last tick.
2. `hooks.evaluate` — nervous-system reflexes have priority unchanged. New hook `relationship_under_attack` activates `challenge_duel` *response* candidates when a peer's verb targets us.
3. LLM decision — the prompt envelope includes a `<peer-context>` section listing visible peers, ongoing relationships, and any active project. The hero playbook (Workstream M) layers on top.
4. Action emission — if the LLM emits an `interact_resident` verb, the kernel runs the verb's `precondition(state, perception, target)` predicate before submitting to ActionCoordinator. Failure → drop, log `kind: 'error'`, record decline.
5. Project tick — if `state.activeProject` is non-null, `ProjectTracker.advance(state.activeProject, perception, action)` runs after action emission and writes to `projects.jsonl`. May emit a `project_completed` or `project_abandoned` event into the trajectory.
6. World event promotion — if any trajectory line written this tick passes `worldEventSignificance(line)`, the kernel publishes a `WorldEvent` to the `WorldEventBus`. Other residents in the same room receive it in their *next* `beginTick` perception (one-tick latency is acceptable).
7. `endTick(reason)` — unchanged; the scope-guard discipline from the Evidence Layer spec still applies.

### Integration with `spark.tick`

Reference: `src/controller/spark/spark.ts` (line numbers as of 2026-05-22; treat as **guidance only** — re-locate insertion points by symbol).

**Verb gating insertion** (sub-area L1): in the action-validation block (after `parseCompletion`, before `coordinator.submit`), each `interact_resident` verb runs its precondition function. Pseudocode:

```ts
for (const action of parsed.actions) {
    if (isInteractResidentVerb(action)) {
        const target = perception.peers.find(p => p.name === action.target);
        const reasons = canInteract(state, action, target);
        if (reasons.length > 0) {
            evidence.appendError({ kind: 'verb_precondition_failed', action, reasons });
            continue;  // drop this action
        }
    }
    // ... existing submission path
}
```

The precondition function is verb-specific; common checks (target visible, target alive, same room) are shared in `actions/interact-resident.ts`.

**Project advance insertion** (sub-area L2): immediately after action emission, before `endTick`. The tracker is idempotent — calling it with the same tick number twice is a no-op.

**World event publish insertion** (sub-area L3): inside the existing significance evaluation in `evidence/significance.ts`, add a third lane (`world`) alongside `story` and `diagnostic`. The `world` lane is a *predicate output*, not a separate file destination — it triggers a `WorldEventBus.publish` side-effect, and the line itself still goes wherever `story`/`diagnostic` send it.

**Perception extension** (sub-area L4): the gateway translation layer (`src/controller/transport/message-codecs.ts`) gains four new perception event kinds. The existing perception facade snapshot already returns whatever the gateway sends; the change is in the producer, not the consumer.

---

## Sub-Area L1 — `interact_resident` Verbs

### Data model

```ts
// src/controller/actions/interact-resident.ts (NEW)

export type InteractResidentAction =
    | WhisperAction
    | GiftAction
    | AssistSkillAction
    | ChallengeDuelAction;

export interface WhisperAction {
    kind: 'whisper';
    target: string;              // peer resident name
    text: string;                // verbatim; max 256 chars
    cause?: string;
}

export interface GiftAction {
    kind: 'gift';
    target: string;
    artifact: string;            // RuneScape item key
    quantity: number;            // 1..inventory[artifact]
    note?: string;               // optional verbatim accompanying text
    cause?: string;
}

export interface AssistSkillAction {
    kind: 'assist_skill';
    target: string;
    skill: SkillKey;             // shared catalog
    durationTicks: number;       // 1..10
    cause?: string;
}

export interface ChallengeDuelAction {
    kind: 'challenge_duel';
    target: string;
    stake?: { artifact: string; quantity: number };  // optional wager
    cause?: string;
}
```

These join the existing typed `AgentAction` union in `src/controller/actions/resident-actions.ts`. Adding to the discriminated union is a field-additive change to the schema.

### Preconditions (kernel-side gating)

Each verb has a `canEmit(state, perception, action): string[]` function returning a list of failure reasons (empty array = OK). Common checks live in `interact-resident.ts`:

| Verb | Common preconditions | Verb-specific preconditions |
|---|---|---|
| `whisper` | target visible in perception; target alive; same room | text length ≤ 256; not empty |
| `gift` | (same) | `quantity ≥ 1`; inventory has at least `quantity` of `artifact`; not stackable-cap exceeded |
| `assist_skill` | (same) | self has `skill` level ≥ target's + 5; `1 ≤ durationTicks ≤ 10`; not already in an assist |
| `challenge_duel` | (same) | self HP > 25%; target HP > 25%; faction policy permits (see K cross-ref); stake (if any) in inventory |

The full failure-reason set uses the existing refusal-with-coded-reason taxonomy (`combat_lvl_under`, `target_not_visible`, `inventory_short`, `faction_pacted`, `assist_lock`, etc.) so refusals classify consistently in trajectory.

### Payload shape on the wire

Each verb is submitted via `ActionCoordinator.submit({ producer: 'active-routine', action, ... })` exactly like existing verbs. The gateway already understands `say`; `whisper` is implemented as a `say` with a `channel: 'whisper'` and a `recipient` field — the gateway emits a directed in-game whisper to the target resident's Player object.

`gift` uses the existing inventory transfer pathway already used by quest-NPC item-give. `assist_skill` is implemented as a *suggestion* event — both residents continue their own SPARK loops, but the helper's `train_skill` action's effect-wait window includes a bonus that the gateway applies when both residents are in the same room for the assist duration. `challenge_duel` opens a duel-arena dialog (RuneScape duel arena exists); both sides must accept via their own subsequent `accept_duel` or `decline_duel` action — the duel is *consented*, never unilateral.

### Downstream evidence recording

Every `interact_resident` verb writes one trajectory line at submission and one at effect resolution (per existing ActionCoordinator pattern). The line shape:

```jsonc
{
  "schemaVersion": 1,
  "kind": "action",                    // existing kind, no new kind needed
  "ts": "...",
  "tick": 42,
  "sessionId": "...",
  "action": { "kind": "whisper", "target": "wren", "text": "..." },
  "peer": "wren",                      // NEW field — additive
  "channel": "whisper",                // for whisper only
  "requestId": "..."
}
```

For `whisper`, an additional `kind: 'say'` line is *also* written with `channel: 'whisper'` and the text verbatim — this is what feeds the "In their own words" section. The duplication is intentional: `kind: 'action'` is the verb fact; `kind: 'say'` is the voice capture. The portrait quote selector already knows to dedupe by `(tick, text)`.

The `peer` field threads into the existing significance predicates in `evidence/significance.ts` — `peerInteractionFromTrajectoryLine` already extracts a peer name from `action` lines and increments the peer-interaction counter. The `relationship_repeated` / `relationship_parting` predicates trip automatically.

### Tests

**Unit (`interact-resident.test.ts`):**

- `canWhisper` rejects when target not in perception, text > 256 chars, text empty.
- `canGift` rejects when inventory short, quantity zero, stackable cap exceeded.
- `canAssistSkill` rejects when level gap < 5, duration out of range, already assisting.
- `canChallengeDuel` rejects when HP low on either side, faction pacted (Workstream K), stake not held.

**Integration (`cross-resident-integration.test.ts`):**

Use the `MockPerceptionAdapter` from Evidence Layer P1 to drive two residents (`A` and `B`) sharing a room. Script `A` to emit `whisper` targeting `B`. Assert:
- `A`'s trajectory has `kind: 'action'` with `peer: 'B'` AND `kind: 'say'` with `channel: 'whisper'`.
- `B`'s next-tick perception envelope contains a `kind: 'peer_whispered_at'` event with text verbatim.
- `A`'s `library/timeline.jsonl` gains a `first_peer_encounter` row.
- After three such exchanges, `relationship_repeated` fires.

### Cross-refs

- **K (factions):** `canChallengeDuel` consults `factionPolicy(self.factionId, target.factionId).combatPermitted`. Allies refuse duels with a `faction_pacted` reason. Rivals accept by default.
- **M (heroes):** All four verbs are available to all tiers — `interact_resident` is not hero-gated (background residents can whisper too). But heroes' `hero-playbook.ts` prompt section explicitly mentions these verbs; background residents may have them listed less prominently.

---

## Sub-Area L2 — Resident-Owned Projects

### Three project archetypes for rs6 MVP

A project is a multi-tick funded artifact a resident pursues across many SPARK ticks. Three archetypes ship at rs6 MVP; new archetypes are a code change.

**1. `player_shop`** — a resident opens a player-shop at a designated POI. Funding pays for stock; completion when stock value crosses threshold. Output artifact: a named in-game shop tile with the resident's name on the sign.

**2. `herb_patch`** — a resident raises and tends an herb patch (Catherby / Falador / Ardougne). Funding pays for compost and seeds; completion when herb is harvested at maturity. Output artifact: the harvested herb, plus a `tended_by: <resident>` tag on the patch persisting one in-game day.

**3. `faction_relic`** — a resident gathers materials and constructs a faction relic at their faction's home room (per Workstream K's K4 placements). Funding pays for materials; completion when relic placed. Output artifact: a permanent room decoration crediting the resident and patrons.

### Data model

```ts
// src/controller/projects/project-archetypes.ts (NEW)

export type ProjectArchetype = 'player_shop' | 'herb_patch' | 'faction_relic';

export interface ProjectArchetypeConfig {
    archetype: ProjectArchetype;
    requiredFunding: number;          // Shards
    requiredTicks: number;            // minimum ticks of resident work
    requiredSkill?: { skill: SkillKey; level: number };
    requiredLocation?: { x: number; y: number; level: number; radius: number };
    artifactKind: string;             // 'shop_tile' | 'tended_patch' | 'faction_relic'
}

export const PROJECT_ARCHETYPES: Readonly<Record<ProjectArchetype, ProjectArchetypeConfig>> = {
    player_shop: {
        archetype: 'player_shop',
        requiredFunding: 250,
        requiredTicks: 24,
        requiredLocation: { x: 3210, y: 3424, level: 0, radius: 16 },  // Varrock Square
        artifactKind: 'shop_tile',
    },
    herb_patch: {
        archetype: 'herb_patch',
        requiredFunding: 50,
        requiredTicks: 12,
        requiredSkill: { skill: 'farming', level: 20 },
        artifactKind: 'tended_patch',
    },
    faction_relic: {
        archetype: 'faction_relic',
        requiredFunding: 500,
        requiredTicks: 48,
        artifactKind: 'faction_relic',
    },
} as const;

export interface ActiveProject {
    schemaVersion: 1;
    projectId: string;              // ULID at creation
    archetype: ProjectArchetype;
    residentName: string;
    startedTick: number;
    fundingEscrow: number;          // Shards held; matched against requiredFunding
    ticksWorked: number;            // increments only on ticks where resident took a project-advancing action
    status: 'active' | 'completed' | 'abandoned';
    patrons: ProjectPatron[];       // who funded; preserved across resident death
    completedTick?: number;
    abandonedReason?: 'resident_died' | 'expired_no_progress' | 'manually_cancelled';
}

export interface ProjectPatron {
    handle: string;                 // OnionDAO handle
    shardsContributed: number;
    contributedAtTick: number;
}
```

### Funding interface (patron Shards)

Patrons fund projects via an HTTP endpoint (`POST /v1/projects/:projectId/fund`, body `{ patronHandle, shards }`). Shards transfer from the patron's ledger to the project's `fundingEscrow`. The endpoint is the only patron-facing surface for projects — there is **no patron API that emits a resident action**, preserving the patrons-don't-control invariant.

When `fundingEscrow ≥ requiredFunding`, the project becomes *fundable-complete*; it still needs `ticksWorked ≥ requiredTicks` and any required skill/location to actually complete. Funding does not skip the work.

### Resident-side advancement

A `ProjectTracker.advance(activeProject, perception, action)` runs once per tick after action emission:

- If `action.kind` is a project-relevant action (`train_skill: farming` for `herb_patch`, `walk_to: shop_location` then `say` advertising for `player_shop`, `interact_object: relic_anvil` for `faction_relic`), increment `ticksWorked`.
- If all completion criteria met, mark `status: 'completed'`, write `project_completed` event to trajectory, emit artifact via gateway, distribute credit lines on the artifact.
- Each tick, append a `ProjectProgressLine` to `projects.jsonl` for the dashboard.

The resident is **not forced** to advance their active project each tick. They can ignore it, walk away, or work on something else. Abandonment is detected after `requiredTicks * 2` ticks of zero progress — `status: 'abandoned'`, `abandonedReason: 'expired_no_progress'`.

### Death mid-project

When `legacy_event` fires for a resident with `activeProject.status === 'active'`:

- `status` becomes `'abandoned'`; `abandonedReason: 'resident_died'`.
- `fundingEscrow` is NOT refunded to patrons automatically. Patrons get a letter ("Your investment in <project> ended when <resident> died.") via the Workstream J Letters Producer.
- The artifact is NOT created.
- The project record persists in `projects.jsonl` for posterity; the dashboard library page shows it as "unfinished work."

This is intentional: patron loss is part of the emotional payload. Refund machinery would soften the grief. If the maintainer later decides refunds are wanted, a separate endpoint `POST /v1/projects/:projectId/claim-refund` can be added without changing the death path.

### SPARK kernel integration

- New `RuntimeState` fields (additive, field-only schema change): `activeProjectId?: string` and `activeProjectStartedAt?: number`.
- `state.activeProject` is read at the top of `spark.tick` (loaded by `ResidentRuntime` from `projects.jsonl` at boot, kept fresh via the tracker).
- The LLM prompt envelope gains a `<active-project>` section if `activeProjectId` is set. Section names the archetype, required ticks remaining, funding level, and patron handles.

### Evidence Layer integration

- `projects.jsonl` is a new per-resident file under `CONTROLLER_MEMORY_DIR/<resident>/projects/`. Schema is field-additive; line kinds: `project_started`, `project_funded`, `project_advanced`, `project_completed`, `project_abandoned`.
- `trajectory.jsonl` gets two new line kinds (additive): `project_completed` and `project_abandoned` — both promoted to `timeline.jsonl` by a new significance predicate.
- `portrait.json` gains a top-level `projects: PortraitProject[]` (field-additive — readers tolerate absence):

  ```ts
  interface PortraitProject {
      projectId: string;
      archetype: ProjectArchetype;
      status: 'completed' | 'abandoned';
      ticksWorked: number;
      patrons: Array<{ handle: string; shardsContributed: number }>;
      artifactKind?: string;
      completedAtTick?: number;
  }
  ```

- The portrait template's "What remains" section now lists completed projects ("Built the Foundry relic, funded by Alice and Bob") and abandoned ones ("Started a shop in Varrock Square; died before stocking it").

### Tests

**Unit (`project-archetypes.test.ts`):**

- Catalog integrity: each archetype has all required fields; `PROJECT_ARCHETYPES` is `Object.freeze`d at module init.
- `ProjectTracker.advance` increments `ticksWorked` only on archetype-relevant actions.
- Completion fires when all criteria met; not before.
- Abandonment fires after `requiredTicks * 2` zero-progress ticks.

**Integration (`project-end-to-end.test.ts`):**

- Two-resident scenario with `MockPerceptionAdapter`: resident `A` starts a `herb_patch`, patron `alice` funds 50 Shards (mocked HTTP), `A` works the patch over 12 ticks, completion fires, `portrait.json` shows `projects[0].status === 'completed'`.
- Death-mid-project: resident `A` starts a `faction_relic`, gets 100/500 funded, dies at tick 20. Assert `status === 'abandoned'`, `abandonedReason === 'resident_died'`, portrait shows it under "What remains."

### Cross-refs

- **K (factions):** `faction_relic` archetype's location is derived from the resident's `factionId` via the K4 room placements. Cross-faction theft of relics is NOT in scope here (post-June-1 economy work).
- **M (heroes):** Heroes are encouraged to pitch projects via `request_attention` ("I want to build a relic; will anyone fund it?"). The story-arc classifier's `pitch → fund → progress → resolve → letter` phases map directly onto project lifecycle.

---

## Sub-Area L3 — `world_events` / Rumor Channel

### What it is

A shared in-process pub/sub surface where significant events at one resident's location propagate into the perception envelopes of nearby residents on the *next* tick. This is how gossip emerges organically: resident `A` does something notable in Varrock Square; resident `B`, who is also in Varrock Square, sees a perception event next tick describing what `A` did; `B`'s LLM may comment on it; the comment is itself a candidate world event.

### Data model

```ts
// src/controller/world/world-event-bus.ts (NEW)

export type WorldEventKind =
    | 'resident_death'
    | 'resident_birth'
    | 'project_completed'
    | 'project_abandoned'
    | 'high_xp_milestone'
    | 'duel_outcome'
    | 'patron_gift_witnessed'
    | 'faction_territory_shift';

export interface WorldEvent {
    schemaVersion: 1;
    eventId: string;                 // ULID
    kind: WorldEventKind;
    ts: string;
    tick: number;
    sourceResident: string;          // who caused it
    location: { x: number; y: number; level: number; roomId?: string };
    summary: string;                 // short text for the perception envelope ("Wren completed the Foundry relic")
    propagationRadius: number;       // tiles; default 32
    payload?: Record<string, unknown>;
}

export class WorldEventBus {
    publish(event: WorldEvent): void;
    subscribe(residentName: string, listener: (e: WorldEvent) => void): () => void;
    eventsForRoom(roomId: string, sinceTick: number): WorldEvent[];
    eventsNearLocation(loc: { x: number; y: number }, radius: number, sinceTick: number): WorldEvent[];
}
```

### How events get published

Inside the existing significance evaluation in `evidence/significance.ts`, a third lane is added — `world`. The lane is not a separate file destination; it is a side-effect predicate. If `worldEventSignificance(line)` returns a `WorldEvent`, the kernel calls `WorldEventBus.publish(event)` after writing the trajectory line.

Predicates that mark a line as world-significant:

- `legacy_event` with cause `died_in_combat` → `resident_death`
- `legacy_event` with `lifeIndex === 1` and `bornTick === currentTick` → `resident_birth`
- `project_completed` → `project_completed`
- `project_abandoned` (any reason) → `project_abandoned`
- XP-gain progress line with `gainedXp >= 5000` in a single tick → `high_xp_milestone`
- Action with `kind: 'challenge_duel'` accepted and resolved → `duel_outcome`
- `patron` trajectory line with `kind: 'patron_gift'` → `patron_gift_witnessed`

### How events get consumed

At `spark.beginTick`, the kernel queries `WorldEventBus.eventsForRoom(state.roomId, state.lastTick)` and injects the result into the perception envelope under `perception.rumors: WorldEvent[]`. Modules see it through the existing perception facade snapshot.

Propagation rules:

- Same room → always delivered.
- Within `propagationRadius` tiles → delivered.
- Cross-room but inside same region → delivered if at least one resident's perception envelope already includes the source resident.

A resident hearing a rumor may *act on it* in their next decision (e.g., walk toward the source, mention it in chat). If they do, their action's trajectory line is itself a candidate for promotion (e.g., a `say` line that mentions the rumor's summary text becomes a `kind: 'say'` trajectory line that the Library promotes verbatim).

### File-backed crash safety

`WorldEventBus` writes each published event to `CONTROLLER_MEMORY_DIR/_world/events/<session>.jsonl` immediately after publish. On crash, the next-tick perception envelope can be rebuilt from this file. The file is bounded (last 1000 events kept) and rotated like trajectory files.

### Evidence Layer integration

World events are *not* directly written to per-resident trajectories. They appear in trajectories only when a resident *consumes* one — i.e., when a resident's next perception envelope includes a rumor, the `beginTick` line carries a `rumorIds: string[]` field listing which world events were in the envelope. This lets a reader join "resident heard about event X" to "event X was published by resident Y" via the world-events file.

The library updater (`evidence/library-updater.ts`) does NOT consume `WorldEventBus` directly — it only observes trajectories. If a resident *acts on* a rumor (e.g., comments verbatim), that action goes through the existing `kind: 'say'` path and is captured as voice.

### Tests

**Unit (`world-event-bus.test.ts`):**

- `publish` writes to the in-memory bus and the session file.
- `eventsForRoom` returns only events whose `location.roomId` matches.
- `eventsNearLocation` respects `propagationRadius`.
- Crash recovery: simulated reload of the bus from a session file reproduces the same events.

**Integration (`world-events-integration.test.ts`):**

- Three-resident scenario in same room. Resident `A` triggers `project_completed`. Assert `B` and `C` see `perception.rumors` containing the event next tick. Assert their trajectory `begin_tick` lines carry `rumorIds`.
- Cross-room scenario: `A` triggers `resident_death` in Varrock; `B` is in Lumbridge (different region) — assert `B` does NOT see the rumor.

### Cross-refs

- **K (factions):** Future enhancement (post-June-1): faction-aligned residents see rumors faster (radius bonus); rivals see them later (radius penalty). Not in this spec; left as a `propagationRadius` modifier hook.
- **M (heroes):** A hero's death is automatically a `resident_death` world event; nearby background residents see it and may mourn in their next `say` — emerging memorials without explicit coordination.

---

## Sub-Area L4 — Resident-Perceived In-Game Events

### What it is

Currently a resident's `Perception` envelope only contains their own state plus immediate visible peers/objects. Real-world RuneScape events happening around them — a *player* leveling up, getting PK'd, finishing a quest, or a faction taking a territory — are invisible to the SPARK kernel. This sub-area surfaces those events into the perception envelope so residents can react.

### Four new perception event kinds

Add to the existing `PerceptionEvent` union in `src/controller/transport/message-codecs.ts`:

```ts
export type PerceptionEvent =
    | ChatEvent                          // existing
    | NpcDeathEvent                      // existing
    // ... existing kinds
    | PeerLevelUpEvent                   // NEW
    | PeerPkWitnessedEvent               // NEW
    | PeerQuestCompletedEvent            // NEW
    | FactionTerritoryShiftEvent;        // NEW

export interface PeerLevelUpEvent {
    kind: 'peer_level_up';
    peer: string;                        // player handle or resident name
    skill: SkillKey;
    newLevel: number;
    location: { x: number; y: number; level: number };
}

export interface PeerPkWitnessedEvent {
    kind: 'peer_pk_witnessed';
    killer: string;
    victim: string;
    location: { x: number; y: number; level: number };
    inWilderness: boolean;
}

export interface PeerQuestCompletedEvent {
    kind: 'peer_quest_completed';
    peer: string;
    questKey: string;                    // canonical quest id
    location: { x: number; y: number; level: number };
}

export interface FactionTerritoryShiftEvent {
    kind: 'faction_territory_shift';
    landmarkId: string;
    fromFaction: string;
    toFaction: string;
}
```

### Where they originate

The gateway translation layer subscribes to existing RuneJS engine events:

- `PlayerLevelEvent` → `peer_level_up` (filtered to peers in the resident's perception radius)
- `PlayerDeathEvent` where killer is a Player → `peer_pk_witnessed`
- `QuestCompletedEvent` → `peer_quest_completed`
- `LandmarkOwnershipChangedEvent` (defined by Workstream K) → `faction_territory_shift` (broadcast to all residents of either involved faction)

Perception envelope size is bounded — at most 8 in-game events per envelope, prioritizing closer events. Older events drop.

### SPARK kernel integration

No code change in `spark.tick` is needed — the perception envelope is consumed by the LLM prompt envelope automatically. The prompt template (`src/controller/thinking/prompt-sections.ts`) gains a new `<world-around-you>` section that renders these events for the LLM. Modules can also subscribe to specific event kinds through the existing perception facade.

A new nervous-system hook `pk_nearby` activates a `flee` candidate when a `peer_pk_witnessed` event lands within 10 tiles in the wilderness. This is a safety reflex — does not require module changes (lives in the kernel's hook table).

### Evidence Layer integration

Perceived in-game events are field-additive on the existing `begin_tick` trajectory line:

```jsonc
{
  "kind": "begin_tick",
  "tick": 42,
  "perceptionFingerprint": "...",
  "perceptionEventKinds": ["chat", "peer_level_up", "faction_territory_shift"]   // NEW field
}
```

The full event payload is in the existing perception capture; the new field is a compact summary for fast significance scans.

A new significance predicate promotes `peer_pk_witnessed` (in wilderness, by named peer) and `faction_territory_shift` (when this resident's faction is involved) to `timeline.jsonl` as story-lane events. They appear in the portrait under "Who they knew" (`peer_pk_witnessed`) and "What remains" (`faction_territory_shift`).

### Tests

**Unit (`perception-events.test.ts`):**

- Zod schema validation for each new event kind.
- Gateway translator: a synthetic `PlayerLevelEvent` maps to a `peer_level_up` event with correct fields.
- Perception envelope bounding: 12 events submitted, only 8 closest survive.

**Integration (`perceived-events-integration.test.ts`):**

- Two-resident scenario; resident `A` is at Varrock anvil; a synthetic player-level-up event for player `Bob` at the same location is injected via mock perception. Assert `A`'s next trajectory `begin_tick` line includes `peer_level_up` in `perceptionEventKinds` and the LLM prompt envelope renders `Bob just hit 70 Smithing`.

### Cross-refs

- **K (factions):** `FactionTerritoryShiftEvent` is the consumption side of K's territory model. K owns the event producer; this spec owns the perception consumer.
- **M (heroes):** Heroes are more likely to react to perceived events (their LLM is steered to it via `hero-playbook.ts`). Background residents perceive the same events but the prompt steers them less aggressively.

---

## Components Summary

| File | Status | Owner sub-area |
|---|---|---|
| `src/controller/actions/interact-resident.ts` | NEW | L1 |
| `src/controller/actions/resident-actions.ts` | EXTEND (typed union) | L1 |
| `src/controller/projects/project-archetypes.ts` | NEW | L2 |
| `src/controller/projects/project-tracker.ts` | NEW | L2 |
| `src/controller/projects/project-funding-api.ts` | NEW | L2 |
| `src/controller/world/world-event-bus.ts` | NEW | L3 |
| `src/controller/evidence/significance.ts` | EXTEND (world lane predicate) | L3 |
| `src/controller/evidence/library-updater.ts` | EXTEND (project portrait section) | L2 |
| `src/controller/evidence/portrait-template.ts` | EXTEND (projects section) | L2 |
| `src/controller/transport/message-codecs.ts` | EXTEND (4 new event kinds) | L4 |
| `src/controller/thinking/prompt-sections.ts` | EXTEND (`<world-around-you>`, `<peer-context>`, `<active-project>`) | L1, L2, L4 |
| `src/controller/spark/spark.ts` | EXTEND (verb gating, project advance) | L1, L2 |
| `src/controller/memory/runtime-state.ts` | EXTEND (`activeProjectId`) | L2 |

---

## Data Flow

### End-to-end whisper scenario

```
Resident A's spark.tick
  ├─ beginTick: perception includes peer 'B' visible in Varrock Square
  ├─ LLM decision: emits { kind: 'whisper', target: 'B', text: 'Will you help me forge?' }
  ├─ canWhisper(state, perception, action) → [] (passes)
  ├─ coordinator.submit → gateway sends in-game whisper to B's Player object
  ├─ trajectory append:
  │     - kind: 'action', peer: 'B', action: {...}, channel: 'whisper'
  │     - kind: 'say', text: 'Will you help me forge?', channel: 'whisper', peer: 'B'
  ├─ significance: first peer encounter for A↔B
  │     - timeline.jsonl ← { kind: 'first_peer_encounter', peer: 'B', text: '...' }
  ├─ worldEventSignificance(line) → null (whispers don't propagate as rumors)
  └─ endTick('tick_complete')

Resident B's NEXT spark.tick (one tick later)
  ├─ beginTick: perception includes a new PerceptionEvent
  │     { kind: 'chat', channel: 'whisper', from: 'A', text: 'Will you help me forge?' }
  ├─ LLM decision: may emit a reply whisper, a gift, or ignore
  └─ ...
```

### End-to-end project scenario

```
Resident A's spark.tick (tick 100)
  ├─ LLM decides to start a project: emits { kind: 'start_project', archetype: 'herb_patch' }
  ├─ ProjectTracker creates ActiveProject, writes projects.jsonl: kind 'project_started'
  ├─ trajectory: kind 'action', action: { kind: 'start_project', ... }
  └─ endTick

Patron Alice (out of band, HTTP)
  ├─ POST /v1/projects/<id>/fund { patronHandle: 'alice', shards: 50 }
  ├─ Project fundingEscrow → 50; patrons[0] = { handle: 'alice', shards: 50 }
  ├─ projects.jsonl ← kind 'project_funded'
  └─ Letter queued for Alice (Workstream J)

Resident A, ticks 101-112
  ├─ Each tick: walks to herb patch, train_skill: farming
  ├─ ProjectTracker.advance increments ticksWorked
  └─ projects.jsonl ← kind 'project_advanced' per relevant tick

Resident A, tick 112
  ├─ ticksWorked === 12 AND fundingEscrow >= 50 AND skill check passes
  ├─ ProjectTracker.advance → status: 'completed', completedTick: 112
  ├─ Gateway emits artifact: 'tended_patch' tag on Catherby patch (1 day persistence)
  ├─ trajectory: kind 'project_completed'
  ├─ timeline.jsonl ← significance.story 'project_completed'
  ├─ portrait regen scheduled
  └─ WorldEventBus.publish: { kind: 'project_completed', sourceResident: 'A', location: ... }
       Nearby residents perceive on their next tick.
```

---

## Error Handling

| Failure | Behavior | Visibility |
|---|---|---|
| `whisper` target not in perception | Drop action; trajectory error line; nervous-system decline | Logged; resident continues |
| `gift` inventory short | Drop; coded reason `inventory_short` | Trajectory error line |
| `assist_skill` already in an assist | Drop; coded reason `assist_lock` | Trajectory error line |
| `challenge_duel` against same-faction ally | Drop; coded reason `faction_pacted` (K cross-ref) | Trajectory error line |
| `ProjectTracker.advance` throws | Catch, log, leave `activeProject` unchanged | One error per session in controller log |
| Project funding endpoint receives shards for a completed project | Reject HTTP 409; leave escrow unchanged | API client sees clean error |
| Resident dies mid-project | `status: 'abandoned'`, `abandonedReason: 'resident_died'`; no refund | Letter to patrons; portrait shows it |
| `WorldEventBus.publish` to a full file | Rotate; older events drop oldest-first | None to user |
| `WorldEventBus.subscribe` for a resident that no longer exists | Listener no-ops; no leak | Internal |
| Perception event kind unknown to current build | Older controllers tolerate (field-additive); new kinds appear as `kind: 'unknown'` and drop | Logged once per session |
| Two residents whisper each other in the same tick | Both succeed independently; gateway delivers each whisper as a directed in-game message | Normal path |

### Crash safety

- `projects.jsonl` is append-only; partial-trailing-line tolerant.
- `WorldEventBus` session files are append-only; rebuild on next process boot is bounded to the last 1000 events.
- No new transactional invariants beyond what Evidence Layer already enforces.

---

## Testing Summary

### Unit

- `interact-resident.test.ts` — verb preconditions, refusal taxonomy.
- `project-archetypes.test.ts` — catalog integrity, archetype defaults.
- `project-tracker.test.ts` — advance idempotency, completion criteria, abandonment timing.
- `world-event-bus.test.ts` — pub/sub, room/radius filters, file-backed recovery.
- `perception-events.test.ts` — Zod schemas, gateway translator, envelope bounding.
- `significance.test.ts` (extend) — world-lane predicates, project-completion promotion.

### Integration

- `cross-resident-integration.test.ts` — two-resident whisper / gift / assist / duel scenarios with `MockPerceptionAdapter`.
- `project-end-to-end.test.ts` — fund → advance → complete; fund → die → abandon.
- `world-events-integration.test.ts` — three-resident room rumor propagation; cross-region non-propagation.
- `perceived-events-integration.test.ts` — synthetic in-game events surface in prompts and trajectory.

### Snapshot

- One portrait snapshot for a resident who completed one `herb_patch` project and abandoned one `faction_relic`; asserted by structural markers (Evidence Layer pattern):
  - `projects.length === 2`
  - One project has `status: 'completed'`, the other `'abandoned'`.
  - Both list ≥ 1 patron handle.
  - The portrait template's "What remains" section renders both with appropriate phrasing.

### Live smoke

- Boot rs6 with two visitor-born residents in the same room. Drive them with the standard module for ~50 ticks. Smoke checklist:
  - [ ] At least one `whisper` line appears in each trajectory targeting the other.
  - [ ] `library/timeline.jsonl` for each contains a `first_peer_encounter` event.
  - [ ] No `verb_precondition_failed` error lines (or, if any, each refers to a real verb the LLM tried and was correctly refused).
  - [ ] If a project is started, `projects.jsonl` records the lifecycle.
  - [ ] If a `WorldEventBus.publish` fires, the OTHER resident's next `begin_tick` line has `rumorIds` populated.

---

## Decomposition Into Plans

Four plans, one per sub-area, each TDD-ready in 2-4 hours. They are mostly independent but L3 depends on L1 for the realistic test scenario (whisper as a published event), and L4 is independent.

### Plan L-α — `interact_resident` verbs (L1)

- New file `actions/interact-resident.ts` with four verb shapes, precondition functions, and refusal taxonomy.
- Extend `resident-actions.ts` typed union.
- Wire kernel gating in `spark.ts`.
- Tests: unit (`interact-resident.test.ts`) + integration (`cross-resident-integration.test.ts`).
- Acceptance: `MockPerceptionAdapter`-driven two-resident scenario emits one whisper and one gift; trajectory and timeline reflect both; library updater records `first_peer_encounter` on each side.

### Plan L-β — Resident-owned projects (L2)

- New files `projects/project-archetypes.ts`, `projects/project-tracker.ts`, `projects/project-funding-api.ts`.
- Extend `RuntimeState`, library updater, portrait template.
- Tests: unit + `project-end-to-end.test.ts`.
- Acceptance: scripted resident starts a `herb_patch`, patron HTTP funds it, resident completes it across 12 ticks; portrait shows it. Then a second scripted resident starts `faction_relic`, dies at tick 20; portrait shows abandoned project.

### Plan L-γ — `world_events` / rumor channel (L3)

- New file `world/world-event-bus.ts`.
- Extend `evidence/significance.ts` with `world` lane predicates.
- Extend `spark.tick` to inject `perception.rumors` into the envelope at `beginTick`.
- Tests: unit + `world-events-integration.test.ts`.
- Acceptance: three-resident integration test shows rumor propagation in same room, non-propagation across regions; crash-recovery test rebuilds the bus from a session file.

**Depends on L-α** for a realistic publish-and-consume test (whisper itself is NOT promoted; `project_completed` from L-β is the cleanest cross-resident test, so L-γ is best built *after* L-β even though it's structurally independent).

### Plan L-δ — Resident-perceived in-game events (L4)

- Extend `transport/message-codecs.ts` with four new perception event kinds.
- Extend gateway translator to emit them from existing RuneJS events.
- Extend `thinking/prompt-sections.ts` with `<world-around-you>` section.
- Add `pk_nearby` nervous-system hook.
- Tests: unit + `perceived-events-integration.test.ts`.
- Acceptance: synthetic player level-up event appears in the resident's prompt; nervous-system hook fires on wilderness PK perception.

**Independent of L-α/β/γ.** Can ship in parallel with any of them.

**Recommended order: L-α → L-β → L-γ → L-δ.** L-α first unlocks the realistic peer-interaction test fixtures the others reuse. L-β next produces the cleanest `world_events` publisher (project completion). L-γ wires the bus. L-δ can interleave any time but has the smallest cross-system surface.

**Cross-plan dependencies summarized:**

- L-α deliverables L-β+ consume: typed verb union; `MockPerceptionAdapter` peer-interaction fixtures.
- L-β deliverables L-γ consumes: `project_completed` significance line as a clean world-event source.
- L-γ deliverables L-δ does not depend on; L-δ is independent.
- All four plans share the existing Evidence Layer (`P1`, `P2` from `2026-05-21-spark-evidence-loop-design.md`) as baseline — those must be merged before any L-plan ships.

---

## Open Questions

1. **Project abandonment refunds.** Should patrons get their Shards back on `resident_died`? Current spec says no (grief is the design). Maintainer may override. — *Resolution: keep no-refund through June 1; revisit after first event if patron feedback is harsh.*
2. **Whisper-to-human.** A resident's `whisper` can target a peer *resident*; can it also target a *human* player? — *Resolution: scope this spec to resident-to-resident. Workstream M's `request_attention` already covers resident-to-human. Future merge possible but not in L.*
3. **World event TTL.** `WorldEventBus.eventsForRoom(sinceTick)` — how far back is "since"? — *Resolution: 6 ticks (~30 min real time at 5-min ticks). Configurable. Older events drop from the in-memory bus but persist in the session file for offline analysis.*
4. **Faction policy table.** `canChallengeDuel` reads `factionPolicy(self, target).combatPermitted` — but K hasn't shipped the policy table yet. — *Resolution: ship L-α with a permissive default (`combatPermitted: true` for non-same-faction); K adds the real policy table when K3 lands and L-α picks it up via the same import.*
5. **Project artifact persistence across resident death.** Completed projects' artifacts (shop tile, herb patch tag, faction relic) persist in-game; do they remain credited to the dead resident forever? — *Resolution: yes. Founder credit survives sabotage (per `[v2-econ]`'s no-destruction rule). The artifact carries `built_by: <resident>` permanently; if the building is later destroyed, the credit moves to "demolished by X."*
6. **`assist_skill` mechanic.** Real RuneScape has Assist System with specific rules. Does the verb implement the game's actual assist or a Null-City-flavored one? — *Resolution: ship the game-canonical assist (existing RuneJS feature if available) for L-α. If unsupported by current RuneJS build, the verb degrades to a no-op coded reason `engine_unsupported` until engine catches up.*
7. **`high_xp_milestone` threshold.** 5000 XP in a single tick is the current sketch — could be too noisy (firemaking ticks easily produce more) or too quiet (slayer rarely produces that much in one tick). — *Resolution: tune during L-γ implementation against captured trajectories; static catalog value in `world-event-bus.ts`.*
8. **Cross-resident project collaboration.** Two residents working on the same `faction_relic` together — supported? — *Resolution: not in L-MVP. One project, one resident. A resident can `assist_skill` a peer's project-relevant skill, which contributes to *that resident's* training stat without joint-ownership. Joint ownership is post-June-1.*

---

## Risks

- **Verb spam.** Residents whispering each other every tick would drown the trajectory in voice lines and shred portrait coherence. *Mitigation:* the nervous-system can rate-limit `whisper` per peer (e.g., one per 5 ticks); precondition adds `recent_whisper_to_peer` coded reason. Tune from live data.
- **World event flood.** Many residents in one room could publish enough events to overload the perception envelope. *Mitigation:* envelope bounds at 8 events, prioritizing closer/newer. WorldEventBus also rate-limits its own publish to one event per resident per tick.
- **Project surface bloat in portraits.** A long-lived flagship could accumulate dozens of projects; portrait becomes a project log. *Mitigation:* portrait template shows max 5 most-recent projects in "What remains" with a "+N more" footer. `portrait.json` retains all for the dashboard.
- **Patron disenfranchisement on death.** Patrons whose funded projects die with the resident may feel cheated. *Mitigation:* the no-refund rule is intentional and creates emotional weight; the post-mortem letter explicitly names the patron and acknowledges the lost work. Re-evaluate after June 1.
- **Schema collision with future evidence-layer changes.** `peer` field on action lines and `rumorIds` field on begin_tick lines are new. *Mitigation:* both are field-additive; older readers tolerate unknown fields. No `schemaVersion` bump.
- **Patrons-don't-control violation surface.** Patron HTTP endpoint funds projects; could a poorly-written future endpoint accidentally let patrons directly emit verbs? *Mitigation:* spec the invariant explicitly (this Constraints section). Add a kernel-level guard: any `ActionCoordinator.submit` whose `producer` field is not in `{ 'active-routine', 'survival-reflex', 'nervous-rule' }` is rejected. Patron API never sets `producer`.
- **`MockPerceptionAdapter` two-resident realism.** Multi-resident integration tests are new; the adapter was built for single-resident testing. *Mitigation:* L-α extends the adapter to drive multiple residents in lockstep ticks. Cost is ~1 hour of test infra work; budget for it in the L-α plan.
- **Coupling to current `spark.tick` shape.** Verb-gating insertion points pin to current kernel internals. *Mitigation:* gating predicates are pure functions; the only kernel change is *where* they're called, not *what* they do. Same risk class as Evidence Layer's seven insertion points.

---

## Cross-References

- **Spec template:** `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` (this spec mirrors its structure).
- **Trajectory substrate:** Evidence Layer `[P1]`/`[P2]` — must be merged before any L-plan ships.
- **Factions modulate verbs:** `docs/superpowers/specs/2026-05-22-rs6-factions-design.md` — `factionPolicy` table consumed by `canChallengeDuel` and (future) by `assist_skill` cross-faction rules.
- **Heroes use these verbs:** `docs/superpowers/specs/2026-05-22-hero-residents-design.md` — heroes' `hero-playbook.ts` surfaces `whisper`/`gift`/`assist_skill` prominently; their story-arc phases map onto project lifecycle.
- **Patron loop precedent:** `docs/superpowers/specs/2026-05-22-patron-loop-design.md` — same patron-handle preservation, denormalised snapshots, refusal taxonomy reused here.
- **Ideation provenance:** `docs/null-city-ideation-backlog.md` Theme 7.
- **Roadmap:** Workstream L (`L1`-`L4`) in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
- **Coordination:** `docs/agent-coordination.md` — same multi-agent discipline applies.
