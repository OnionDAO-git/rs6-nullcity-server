# Hero Residents And Story Arcs — Design (Workstream M)

**Status:** Draft v1.
**Author:** Claude (planning push 2026-05-22).
**Date:** 2026-05-22.
**Roadmap:** Workstream M in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
**North star:** `docs/null-city-rs6-vision.md`.
**Read first:** `docs/null-city-ideation-backlog.md` Theme 8 (Hero Residents / Story Arcs).
**Depends on:** Workstream K (Factions) — heroes have faction affiliations.

---

## Why This Spec Exists

A general resident in Null City is a character with a soul, a name, and a SPARK loop. **A hero is a resident with a story arc**: a multi-tick narrative trajectory that humans can fund, witness, and grieve over. Heroes are the focal points for the June 1 event — the named NPCs whose tombstones a human will read because they personally interacted with them.

Three things separate heroes from background residents:

1. **Lifespan asymmetry.** Flagships live ~30 days; visitor-born heroes live ~24 hours. Both are short relative to a real game character; the brevity *is* the design — humans grieve more for a 24-hour life than a 30-year one.
2. **Story-arc actions.** Heroes have `request_attention`, `prepare_epitaph`, and `trade_resource` verbs unavailable to lesser residents. These let them pitch their own narrative.
3. **Patron coupling.** Heroes are funded; standing accumulates around them; their deaths trigger letters in a way background residents' don't (background residents still get epitaphs, but heroes get *named* ones).

This spec defines what makes a resident a "hero," the new action verbs, the lifespan tier system, and the story-arc shape.

---

## Goals

- Heroes are a typed subset of residents with a `tier: 'flagship' | 'visitor_born' | 'background'` field.
- Flagships are seeded by Workstream K; visitor-borns are created by Workstream J's `sponsorBirth`. Background residents may exist for world population but don't carry hero machinery.
- Three new typed `AgentAction` verbs: `request_attention`, `prepare_epitaph`, `trade_resource`.
- A hero's story arc has a defined shape that the kernel + module can collaboratively pursue: **pitch → fund → progress → resolve → letter.**
- Heroes can gather resources at faction-controlled landmarks (production hook for the autonomy-economy frontier — *deferred for post-June-1*).

## Non-Goals

- AI-generated hero personalities. Heroes have soul fields like all residents; the maintainer or sponsoring patron authors them.
- Cross-hero relationships in this spec (covered in Workstream L).
- Hero-vs-hero combat or campaigns (post-June-1 autonomy-economy work).
- Resurrection of heroes. Permanent death applies. Multi-life accumulation in the Library does not mean reincarnation.

## Constraints

- TypeScript, existing repo conventions.
- Hero tier is a static catalog field, not a runtime gate. The SPARK kernel checks `resident.tier` before allowing `request_attention` / `prepare_epitaph` / `trade_resource`.
- The three new verbs are added to the typed `AgentAction` registry in `src/controller/actions/resident-actions.ts` (or equivalent) — preserves the "constrained action catalog" invariant.
- Lifespan is enforced by attention/lifespan-ticks columns already in v2 schema; heroes just have shorter defaults.
- Patron coupling lives in *Workstream J*; this spec just defines the hooks heroes use to trigger it.

---

## Architecture

### Hero tier

```ts
export type ResidentTier = 'flagship' | 'visitor_born' | 'background';

export interface HeroTierConfig {
    tier: ResidentTier;
    initialAttention: number;
    lifespanTicks: number;
    canRequestAttention: boolean;
    canPrepareEpitaph: boolean;
    canTradeResource: boolean;
    canGatherAtLandmarks: boolean;
}

export const HERO_TIERS: Readonly<Record<ResidentTier, HeroTierConfig>> = {
    flagship: {
        tier: 'flagship',
        initialAttention: 100,
        lifespanTicks: 8640,    // ~30 days at 5-min ticks
        canRequestAttention: true,
        canPrepareEpitaph: true,
        canTradeResource: true,
        canGatherAtLandmarks: true,
    },
    visitor_born: {
        tier: 'visitor_born',
        initialAttention: 24,
        lifespanTicks: 288,     // ~24 hours at 5-min ticks
        canRequestAttention: true,
        canPrepareEpitaph: true,
        canTradeResource: true,
        canGatherAtLandmarks: false,    // visitor-borns don't gather; too short-lived
    },
    background: {
        tier: 'background',
        initialAttention: 50,
        lifespanTicks: 2880,    // ~10 days
        canRequestAttention: false,
        canPrepareEpitaph: false,
        canTradeResource: false,
        canGatherAtLandmarks: false,
    },
} as const;
```

### Story-arc shape (M1)

A hero's narrative arc is a soft pattern, not a hard state machine. The SPARK kernel doesn't enforce it; the module + soul drive it. But for portrait generation, dashboard rendering, and letter timing, we define the canonical phases:

```ts
export type StoryArcPhase =
    | 'pitch'        // Hero declares a goal via say/request_attention
    | 'fund'         // Patron(s) respond with currency / standing investment
    | 'progress'     // Hero pursues the goal across multiple ticks
    | 'resolve'      // Goal completed, failed, or abandoned
    | 'letter';      // Letter dispatched to patrons (success or failure)
```

A hero's current arc phase is inferred from their recent trajectory by a small classifier in `evidence/significance.ts` (already exists; add arc-phase predicates). NOT stored on the resident row — derived on demand.

### Three new action verbs (M3, M4, M5)

#### `request_attention`

```ts
{
    kind: 'request_attention',
    cause?: string,
    target?: { humanHandle?: string; landmarkId?: string; faction?: string; },
    urgency: 'low' | 'medium' | 'high',
    plea: string,               // resident's words asking for help
}
```

Behavior: emits a `say` line with `plea` as text (preserved verbatim for portrait). If `target.humanHandle` is set, the kernel dispatches an in-game whisper to that human. If unspecified, it's a public shout in the resident's current room. The Letters Producer may convert high-urgency requests into a `civic` letter.

Eligibility: only when `tier.canRequestAttention === true` AND attention is below 30% of initial AND lifespan_ticks < 50% remaining.

#### `prepare_epitaph`

```ts
{
    kind: 'prepare_epitaph',
    cause?: string,
    text: string,               // the resident's own epitaph — overrides template at death
}
```

Behavior: writes `text` to the resident's memory at path `epitaph.md`. On death, the Library exporter prefers the resident-authored epitaph over the templated one. Verbatim preservation is essential — this is the resident's voice at the end of their life.

Eligibility: only when `tier.canPrepareEpitaph === true` AND `lifespan_ticks < 25%` remaining.

#### `trade_resource`

```ts
{
    kind: 'trade_resource',
    cause?: string,
    target: { humanHandle: string },
    artifact: string,           // RuneScape item key from existing item registry
    quantity: number,
    note?: string,
}
```

Behavior: hero proactively offers a RuneScape item from their inventory to a specific patron. Gateway handles the actual trade window. If the patron doesn't accept within a window (e.g., 60 seconds), the trade times out. Either way, a `patron_gift` line is emitted (with `patronHandle: hero.name`, reverse direction) and a timeline entry is appended ("Hero gave Alice 5 logs").

Eligibility: only when `tier.canTradeResource === true` AND hero has the item in inventory AND patron is in the same room or recently chatted.

### Resource gathering at landmarks (M6, deferred until autonomy-economy work)

Mechanically equivalent to existing skilling actions, but with output going to `faction.stockpile` instead of resident inventory. Out of scope for June 1 in any concrete sense — included here only so the spec mentions it.

---

## Components

### 1. `src/controller/residents/hero-tier.ts` (NEW)

Exports `ResidentTier`, `HeroTierConfig`, `HERO_TIERS`. Static catalog. Read by ResidentRuntime + SPARK kernel to gate the three new actions.

### 2. `src/controller/actions/hero-actions.ts` (NEW)

Defines the three new action shapes + their preconditions. Wires into existing action registry.

```ts
export function canRequestAttention(state: RuntimeState, tier: HeroTierConfig): boolean;
export function canPrepareEpitaph(state: RuntimeState, tier: HeroTierConfig): boolean;
export function canTradeResource(state: RuntimeState, tier: HeroTierConfig, inventory: Inventory): boolean;
```

### 3. Story arc classifier (M1)

`src/controller/evidence/story-arc.ts` (NEW). Reads a resident's recent timeline + trajectory and infers current `StoryArcPhase`. Used by:
- Portrait template ("Currently: pitching", "Currently: resolving")
- Dashboard hero list ("Hero X is in progress phase")
- Letter timing decisions

Pure function over events; no side state.

### 4. SPARK kernel integration

`src/controller/spark/spark.ts` already validates actions against the registry. Add per-action eligibility checks reading from `HERO_TIERS[state.tier]`. If a module tries to emit an action the tier doesn't permit, the kernel logs + drops the action and emits a `nervous_system` decline ("Tier 'background' does not permit request_attention").

### 5. Hero-specific module prompts

`src/controller/thinking/hero-playbook.ts` (NEW) — prompt section that goes into the LLM envelope for heroes only. Mentions the three new actions and when to use them. Heroes get a different "tool catalog" line in their prompts than background residents.

### 6. Resident schema additions

```sql
ALTER TABLE residents ADD COLUMN tier TEXT NOT NULL DEFAULT 'background';
ALTER TABLE residents ADD COLUMN sponsoring_human_id TEXT NULL;
```

`tier` is set at birth (`flagship` from seed script, `visitor_born` from sponsor flow, `background` from any other path). `sponsoring_human_id` is set for visitor-borns (used by patron credit surfaces, letter routing).

---

## Data Flow

### Pitch phase (M1, M3)

```
Hero's SPARK tick: low attention + lifespan-half elapsed
    │
    ▼
HybridAgentThinkingModule sees the hero-playbook prompt mentioning request_attention
    │
    ▼
LLM emits: { kind: 'request_attention', urgency: 'high',
             plea: 'My fire dies. Will anyone bring a tinderbox?' }
    │
    ▼
Kernel validates: tier.canRequestAttention === true ✓
    │
    ▼
Action committed:
  - say line with plea text (verbatim)
  - if target.humanHandle: gateway whispers that human in-game
  - else: public shout in current room
  - trajectory line `kind: 'say', actionKind: 'request_attention', urgency: 'high'`
    │
    ▼
Story arc classifier marks current phase: 'pitch'
```

### Fund phase

```
Human reads the whisper / sees the public shout
    │
    ▼
Human runs PatronGateway.offerTo(humanId, hero.name, 5)
    │
    ▼
Hero's attention refills; standing accumulates; trajectory has 'patron_gift' line
    │
    ▼
Story arc classifier marks phase: 'fund'
```

### Progress + resolve

```
Hero continues SPARK ticks pursuing the goal across multiple ticks
    │
    ▼
On significant progress (XP gain, item acquired, milestone), Library records
    │
    ▼
Goal achieved OR hero dies OR abandons (no progress for N ticks)
    │
    ▼
Story arc classifier marks phase: 'resolve' (with outcome)
```

### Letter phase

```
On 'resolve' OR on legacy_event (death):
    │
    ▼
LettersProducer (Workstream J) checks if any patrons funded this hero
    │
    ▼
For each funding patron: queue a letter
  - On success: "Your investment helped <hero> achieve <goal>."
  - On failure: "<hero> tried, but the wilderness took them."
  - On death: "<hero> died. They left these words: <epitaph>."
```

---

## Error Handling

| Failure | Behavior |
|---|---|
| Module emits hero action on a background resident | Kernel drops action, logs warning to trajectory `kind: 'error'`, returns nervous-system decline |
| `request_attention` with high urgency but no patrons in standing range | Public shout only; no whisper; falls back gracefully |
| `trade_resource` to a patron who isn't online | Trade window opens but times out after 60s; emits timeout event |
| `prepare_epitaph` text exceeds 4 KB (memory facade write limit) | Truncate at 4 KB; log warning |
| Story arc classifier fails on malformed timeline | Returns 'unknown' phase; never throws |
| Hero seeded with invalid `factionId` | Falls back to `background` tier; log error |

---

## Testing

### Unit

- `hero-tier.test.ts` — catalog integrity, each tier's eligibility flags
- `hero-actions.test.ts` — each new action's precondition function: true/false matrices over (tier, state, inventory)
- `story-arc.test.ts` — classifier produces expected phase for scripted timeline fixtures (pitch / fund / progress / resolve / letter)
- `hero-playbook.test.ts` — prompt section appears for heroes, absent for background residents

### Integration

- `hero-end-to-end.test.ts` — seed a visitor-born hero; drive several ticks with mock perception; verify request_attention fires when conditions met; verify epitaph preserved through death
- `letter-routing.test.ts` — hero dies after being funded by Alice; verify Alice's inbox gets the epitaph letter with the hero's verbatim words

### Live smoke

- Boot rs6 with K's flagships seeded. Verify each flagship's tier is 'flagship' and the hero-playbook prompt appears in their inference logs.
- Sponsor a visitor-born hero via patron flow (once J ships). Watch them across a 24-hour cycle. Confirm: they pitch, get funded, progress, and die. Verify their epitaph letter arrives in your inbox.

---

## Decomposition Into Plans

### Plan M-α — Tier catalog + schema (M2)

- Add `tier` + `sponsoring_human_id` columns to residents table (migration)
- `hero-tier.ts` catalog
- Backfill existing residents to `tier: 'background'`
- Tests for catalog integrity + default backfill

### Plan M-β — Hero action verbs (M3, M4, M5)

- `hero-actions.ts` with three action shapes + preconditions
- Add to typed `AgentAction` registry
- Kernel gates in `spark.tick` (validate tier permission before emit)
- Per-action unit tests + one integration test per action

### Plan M-γ — Story arc classifier (M1)

- `story-arc.ts` classifier
- Predicates wired into `evidence/significance.ts`
- Tests against scripted timeline fixtures
- Portrait template consumes arc phase ("Currently: <phase>")

### Plan M-δ — Hero playbook prompt section

- `hero-playbook.ts` with prompt language teaching the three new verbs
- Wire into prompt envelope only when `tier !== 'background'`
- Verify in inference log fixtures

### Plan M-ε — Resource gathering hook (M6) *deferred until autonomy-economy*

Stub the API surface; full wiring lives in a future autonomy-economy spec.

**Recommended order: α → β → γ → δ.** ε can defer. β unlocks the most user-visible behavior the fastest; γ is needed for portrait completeness.

---

## Open Questions (Maintainer Required)

1. **Background residents — do we have them?** rs6 may run without background residents and only have flagships + visitor-borns. If so, simplify the spec.
2. **Tier configurability per faction.** Should flagship lifespan vary per faction? E.g., the "achiever" faction's flagships die faster because they take more risks?
3. **June 1 cast list.** Which named heroes (beyond the four flagships) are seeded for the event? Could be a small number (2-4) of specially-designed visitor-born archetypes the embassy NPCs offer to sponsor.
4. **`request_attention` cooldown.** Without a cooldown, a desperate hero could spam. Recommend cooldownTicks: 12 (~1 in-game hour).
5. **`prepare_epitaph` revisability.** Can a hero rewrite their epitaph after writing it once? Recommend yes — last write wins.
6. **`trade_resource` items allowed.** Whitelist or blacklist? Recommend: any item the resident can normally hold, except quest items.

---

## Risks

- **Hero action verbs blur with background module behavior.** A poorly-written module could try to use heroic verbs on a background resident; kernel gating must reject cleanly without breaking the action loop. Test the rejection path explicitly.
- **Story-arc classifier as soft state can be misleading.** A hero stuck in `progress` for many ticks while doing nothing useful looks the same as one making progress. Pair with the existing `stuckSince` from ProgressTracker.
- **Letter spam.** A flagship with many patrons dies → many letters. Mitigate with per-day digest as a future enhancement (already noted in J's spec).
- **Lifespan tuning.** 24h for visitor-born + 30d for flagship are guesses. Real values come from live smoke + maintainer feel. Configurable so the team can tune post-event.

---

## Cross-References

- `docs/null-city-rs6-vision.md` § "The Resident's Inner Loop" + "Critical Design Invariants"
- `docs/superpowers/specs/2026-05-22-patron-loop-design.md` (Workstream J — patron funding flow consumes hero arcs)
- `docs/superpowers/specs/2026-05-22-rs6-factions-design.md` (Workstream K — flagships are heroes)
- `docs/superpowers/specs/2026-05-22-embassy-and-event-design.md` (Workstream N — embassy is where humans meet heroes)
- `docs/null-city-ideation-backlog.md` Theme 8
