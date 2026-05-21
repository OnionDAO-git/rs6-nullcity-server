# rs6 Factions — Design (Workstream K)

**Status:** Draft v1, **blocked on maintainer creative input.** The four faction identities (names, mottos, colors, home rooms, flagship NPCs, two tension axes) are the load-bearing design decisions. Until those exist, K1/K3/K4 cannot ship.
**Author:** Claude (planning push 2026-05-22).
**Date:** 2026-05-22.
**Roadmap:** Workstream K in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
**North star:** `docs/null-city-rs6-vision.md`.
**Read first:** `docs/null-city-ideation-backlog.md` Theme 5 (Factions & Social Structure) for the full v2 reference design.

---

## Why This Spec Exists

Null City needs factions because:

1. **Residents need an identity beyond their soul fields.** A resident "of the Hearthkeepers" is more legible to a human player than a resident with abstract goals.
2. **Patrons need something to invest in.** Standing is per-(human, faction). Without factions, the patron loop has no aggregating object — humans would have to track standing per individual resident, which doesn't scale.
3. **The wall map and dashboard need named territories.** "Faction X controls this landmark" is a visual primitive humans grok instantly.
4. **Letters need a sender voice.** A resident's death triggers an epitaph letter written in the voice of a *different flagship of the same faction* (v2 canon — preserved here).

v2 has four canonical factions (Solder Saints / Hatchery / Locksmiths / Ledgerwrights) with Onion-DAO-flavored identities. **These don't fit RuneScape.** rs6 needs its own four, RuneScape-native, with the same structural pattern: four factions, two crossing tension axes, named flagships, home rooms.

---

## Goals

- Define the four rs6 factions as typed constants in code (NOT DB rows).
- Each faction has: id, display name, motto, color, archetype, home POI in-game, flagship NPC (named, seeded with full soul fields), one of two tension axes.
- The static catalog matches v2's pattern so future code can be generic across catalogs.
- A new resident is seeded with a faction; their portrait shows it; standing is per-faction.

## Non-Goals

- Faction-vs-faction combat. Tension axes are narrative, not mechanical.
- Faction-defined gameplay rules (i.e., a faction member can't do X). Modules and souls govern resident behavior; faction is identity, not capability gate.
- Cross-faction reputation systems beyond the per-(human, faction) standing already in *Workstream J*.

## Constraints

- TypeScript constants in `src/controller/factions/factions.ts` (NEW) or `packages/types/rs6` equivalent.
- Static catalog discipline: adding a faction is a code change, not a DB migration. (v2 invariant — preserved.)
- Must define enough to unblock *Workstream J* (standing system), *Workstream M* (flagship NPCs), *Workstream N* (embassy + home rooms), *Workstream I* consumers (portrait.faction field).
- Faction identities are creative decisions the maintainer must make. **This spec specifies the SHAPE; the maintainer fills the SLOTS.**

---

## Architecture

### Static catalog

```
src/controller/factions/
  factions.ts           — the four faction constants + types
  faction-flagships.ts  — the four flagship NPC seed definitions
  factions.test.ts      — catalog integrity tests
```

### Shape

```ts
export type FactionId = 'faction-1' | 'faction-2' | 'faction-3' | 'faction-4';
// ↑ Replace with rs6 faction id strings once maintainer names them.

export type TensionAxis = 'axis-1' | 'axis-2';
// ↑ Replace with rs6 axis names. v2 has body-vs-mind and secrets-vs-receipts.

export interface FactionDefinition {
    id: FactionId;
    displayName: string;            // e.g., "The Hearthkeepers"
    motto: string;                  // load-bearing copy
    color: string;                  // hex; dashboard + plaque rendering
    archetype: 'mentor' | 'endurer' | 'achiever' | string;  // SOUL archetype default for residents born into this faction
    homePoiId: string;              // K4 — references a placed in-game POI
    flagshipResidentName: string;   // K3 — the seeded NPC's resident name
    tensionAxis: TensionAxis;       // which of the two axes this faction sits on
    tensionPole: 'pole-a' | 'pole-b'; // which pole of that axis
    visualTreatment: 'standard' | 'redacted' | string; // K5 — e.g., 'redacted' for the secrets faction
    description: string;            // 1-3 sentences, displayed in portraits/dashboard
}

export const FACTIONS: ReadonlyArray<FactionDefinition>;
export const FACTIONS_BY_ID: Readonly<Record<FactionId, FactionDefinition>>;
```

### Two tension axes

v2's example:
- **Body vs Mind** — Solder Saints (body, hardware) vs Hatchery (mind, AI)
- **Secrets vs Receipts** — Locksmiths (secrets) vs Ledgerwrights (receipts)

rs6 needs its own two axes. They should be RuneScape-native tensions that residents could *care about* in-character. Suggested directions (maintainer picks):

- **Skill mastery vs Combat prowess** (skiller-coded vs PvM-coded factions)
- **Public works vs Private commerce** (faction temples vs faction shops)
- **Lore-keepers vs Adventurers** (libraries/quests vs wilderness/expeditions)
- **The Old Ways vs The New** (traditionalist factions vs reformist)

Pick TWO axes. Each faction sits on one axis, at one pole. The other two factions sit on the OTHER axis. Result: a 2x2 of identities with natural cross-pairings.

### Flagship NPCs

Each faction has one named flagship resident. v2's flagships:
- Brother Solenoid (Solder Saints)
- Midwife Lin (Hatchery)
- The Curator (Locksmiths)
- Scrivener Mox (Ledgerwrights)

The flagship is the **voice of the faction** in letters, the **default sender** when an epitaph letter must come from "a different flagship of the same faction," and the **anchor NPC** at the faction's home POI.

Flagship soul shape (full v2 fields):

```ts
export interface FlagshipSeed {
    name: string;
    factionId: FactionId;
    archetype: 'mentor' | 'endurer' | 'achiever';
    voice: {
        register: string;       // e.g., 'liturgical-low', 'jovial-brash'
        quirks: string[];
    };
    goals: string;              // what they want
    alignment: string;          // how they'd act
    quirks: string;             // how they behave odd
    aesthetic: string;          // how they sound
    fears: string[];
    loves: string[];
    homeRoomId: string;
    lifespanTicks: number;      // typically ~30 days at 5-min ticks (≈8640)
    initialAttention: number;
}

export const FLAGSHIPS: ReadonlyArray<FlagshipSeed>;
```

### Home POIs (rooms in v2 parlance)

Five POIs total: four faction homes + one neutral atrium where newborn residents wake up.

Each POI is an in-game RuneScape location. **Maintainer picks five.** Suggested constraints:

- All within reasonable walking distance of Lumbridge (where new residents spawn) — preferably 1-2 game-minutes
- Each visually distinct (different building / different region)
- One should naturally be the "embassy" / atrium (neutral, social, where humans first encounter residents) — this overlaps with *Workstream N1*
- Each faction's home should feel thematically right (the lore-keepers in a library; the combat faction near a guild; etc.)

POI definition:

```ts
export interface PoiDefinition {
    id: string;                    // e.g., 'rs6.poi.lumbridge-chapel'
    displayName: string;
    factionId?: FactionId;         // undefined for the neutral atrium
    coordinates: { x: number; y: number; level: number }; // RuneScape tile coords
    description: string;
}

export const POIS: ReadonlyArray<PoiDefinition>;
```

---

## Components

### 1. `src/controller/factions/factions.ts` (K1, K2, K5)

Exports `FactionId`, `TensionAxis`, `FactionDefinition`, `FACTIONS`, `FACTIONS_BY_ID`. Pure static catalog.

### 2. `src/controller/factions/faction-flagships.ts` (K3)

Exports `FlagshipSeed`, `FLAGSHIPS`. Consumed by a seed script (analogous to v2's `packages/db/src/seed.ts`) that idempotently inserts the four flagships into the resident table on first boot.

### 3. `src/controller/factions/pois.ts` (K4)

Exports `PoiDefinition`, `POIS`. Consumed by Workstream N (embassy placement), Workstream I (`say` line `room` tagging), Workstream J (sponsor-birth UI choosing a faction).

### 4. Seed script

`scripts/seed-flagships.ts` (NEW). Idempotent: for each entry in `FLAGSHIPS`, upsert the resident row with `owner_human_id = null` (system-owned) and the full soul fields. If the flagship already exists, refresh non-identity fields (lifespan top-up, attention) but never overwrite a customized soul.

### 5. Catalog integrity test

`factions.test.ts`:
- All four factions have unique ids, distinct colors, distinct mottos.
- Each tension axis has exactly two factions, one at each pole.
- Each faction's `homePoiId` resolves to a `POIS` entry.
- Each faction's `flagshipResidentName` resolves to a `FLAGSHIPS` entry.
- `FACTIONS_BY_ID[id].id === id` for every id (round-trip).

---

## Data Flow

### Resident birth (visitor-born from Workstream J6)

```
Human selects a faction in the sponsor form
    │
    ▼
PatronGateway.sponsorBirth({factionId, ...})
    │
    ▼
Soul seeded with:
  - faction defaults from FACTIONS_BY_ID[factionId]
  - archetype: faction.archetype (or human override)
  - homeRoomId: faction.homePoiId
  - soulFields from form
    │
    ▼
Resident inserted; first say tagged with the faction motto as quirk-influencer
```

### Letter sender selection

```
Resident dies (legacy_event)
    │
    ▼
LettersProducer needs a sender
    │
    ▼
Pick a different flagship of the same faction:
  candidates = FLAGSHIPS.filter(f => f.factionId === deceased.factionId && f.name !== deceased.name)
  if (candidates.length > 0):
    sender = candidates[0]    // there's always one flagship in this faction
  else:
    sender = FLAGSHIPS.find(f => f.factionId === deceased.factionId)  // self if no others
    │
    ▼
Letter body templated with sender's voice
```

### Portrait rendering

```
Portrait generator (Workstream I)
    │
    ▼
portrait.faction = FACTIONS_BY_ID[resident.factionId].displayName
portrait.factionColor = FACTIONS_BY_ID[resident.factionId].color
portrait.factionMotto = FACTIONS_BY_ID[resident.factionId].motto
    │
    ▼
Rendered into portrait.md as "of <faction>" subhead
```

---

## Error Handling

| Failure | Behavior |
|---|---|
| Resident has `factionId` not in `FACTIONS_BY_ID` | Treat as `unaligned` (a 5th synthetic "no faction" identity). Log warning. |
| Flagship seed conflict on boot (same name, different faction) | Throw; this is a developer error in the static catalog |
| Faction motto exceeds 80 chars | Lint rule (catalog integrity test); fail CI |
| POI coordinate refers to non-existent RuneScape tile | Tested at boot via PoiValidator; warn, allow boot, log error |

---

## Testing

### Unit

- `factions.test.ts` — catalog integrity (above)
- `faction-flagships.test.ts` — each flagship has all required soul fields; archetypes are valid
- `pois.test.ts` — coordinates are non-zero; all referenced poi ids resolve

### Integration

- `flagship-seed-end-to-end.test.ts` — run seed script against test DB; verify four flagships exist with expected ids; re-run; verify idempotency
- `faction-portrait.test.ts` — synthesize a portrait for a resident in each faction; verify motto/color/faction-name render correctly

### Live smoke

- Boot rs6 controller with seed script enabled. Verify four flagships appear in-game at their home POIs. Walk a test player past each; verify chathead displays faction name. Read the dashboard; verify each faction's color matches the catalog.

---

## Decomposition Into Plans

### Plan K-α — Catalog skeleton (K1, K2, K5)

**Blocked on maintainer decision.** Once maintainer commits the four names + two axes + motto/color/visual:
- Write `factions.ts` with `FACTIONS` populated
- Write `pois.ts` skeleton (POI ids and faction associations; coordinates can be placeholder until N1 picks real RS tiles)
- Catalog integrity tests
- Update `Workstream J`'s standing system to use rs6 faction ids

### Plan K-β — Flagship seeds (K3)

- Write `faction-flagships.ts` with four flagship `FlagshipSeed` records (maintainer-authored voices and goals)
- Idempotent seed script `scripts/seed-flagships.ts`
- Tests for soul-field completeness and idempotency

### Plan K-γ — In-game POI placement (K4)

- For each faction home, pick a real RuneScape tile location (maintainer + dev)
- Update `pois.ts` with real coordinates
- Wire RuneJS plugin / world setup to spawn flagships at those tiles on boot
- Smoke-walk all five POIs in-game

### Plan K-δ — Visual treatment for secrets faction (K5)

If the maintainer designates one of the four as a "secrets" faction (analogous to v2's Locksmiths), apply a redacted/fog-of-war visual treatment to its parcels on the wall map and its plaques. Coordinates with Dev's dashboard work.

**Recommended order: α → β → γ → δ.** α unlocks every other workstream that references factions; γ has the longest in-game work; δ is polish.

---

## Open Questions (Maintainer Required)

The entire spec is structurally dependent on these. **K cannot ship until these are filled.**

1. **Four faction names + display names + ids.** Naming should be RuneScape-native (not Onion-DAO terminology). Examples that *could* work:
   - The Hearthkeepers (firemaking/cooking/community)
   - The Wayfarers (adventuring/wilderness/exploration)
   - The Lockwrights (smithing/crafting/contracts)
   - The Pale Watchers (prayer/death/legacy)
   These are illustrative — the maintainer should write the four.
2. **Two tension axes.** v2's body-vs-mind / secrets-vs-receipts. rs6 needs equivalents.
3. **Per-faction motto.** One line, load-bearing. v2 examples: "no mind without a body" / "we are merely curating the breaches" / "nothing happened until everyone agrees it happened."
4. **Per-faction color.** Hex code. Distinct enough to differentiate on the wall map and plaques.
5. **Per-faction archetype default.** Which SOUL archetype is the default for residents born into this faction? `mentor`, `endurer`, `achiever`, or a new rs6 archetype?
6. **Four flagship NPC names + voices.** Each gets full soul fields (goals/alignment/quirks/aesthetic). These NPCs persist for ~30 days and become the public face of the faction.
7. **Five POI placements in RuneScape.** Coordinates for four faction homes + one neutral atrium. Must be reachable from Lumbridge spawn within a few in-game minutes.
8. **Which faction (if any) gets the "redacted" visual treatment.**

The maintainer can answer these in one short brainstorming session (`/superpowers:brainstorming`). Once committed, Plan K-α can ship within hours.

---

## Risks

- **The whole workstream is blocked until maintainer commits.** Recommended: brainstorm session ASAP. Without K, J's standing tier names and M's hero arcs are using placeholder strings.
- **Lore inconsistency.** If the maintainer picks faction names that clash with RuneScape canonical lore (e.g., a name that's already a quest faction in RS), in-game player immersion breaks. Cross-check with RS wiki before locking.
- **Over-engineering vs. simplicity.** Four factions × full flagship soul fields × five POIs × two tension axes is a lot of slot-filling. Resist scope creep beyond this.

---

## Cross-References

- `docs/null-city-rs6-vision.md` § "Critical Design Invariants" #6 (static catalog in code)
- `docs/superpowers/specs/2026-05-22-patron-loop-design.md` (Workstream J — consumes faction ids for standing)
- `docs/superpowers/specs/2026-05-22-hero-residents-design.md` (Workstream M — flagships are heroes)
- `docs/superpowers/specs/2026-05-22-embassy-and-event-design.md` (Workstream N — home POIs include the atrium/embassy)
- `docs/null-city-ideation-backlog.md` Theme 5 (Factions & Social Structure)
