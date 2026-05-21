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

## Open Questions (Status After 2026-05-22 Notion Dive)

A scan of OnionDAO Notion (`Onion DAO Narrative` page, status Done) surfaced canonical defaults for several questions. **These are working answers, NOT locked decisions — the maintainer can override any of them.** An autonomous agent should USE these defaults to unblock work; the maintainer can revisit before final lock.

### ✅ Defaulted from Notion (subject to maintainer override)

1. ~~Four faction names~~ — **`The Foundry`, `The Bureau of Continuity`, `The Ledger`, `The Veil`.** Canonical updated names from `Onion DAO Narrative` (newer than `Narrative V2`'s Solder Saints / Hatchery / Locksmiths / Ledgerwrights). All four port naturally to RuneScape without name changes. Suggested ids:
   - `foundry` (hardware/making/building)
   - `bureau-of-continuity` (memory/legacy/archive — note: this is the natural Library of Souls faction)
   - `ledger` (transparency/governance/voting)
   - `veil` (secrets/skeptics/tricksters)

2. ~~Per-faction personality~~ — locked from Notion:
   - **The Foundry**: builders, impatient with abstractions, "public works department staffed by zealots." Wants humans to solder, print, fabricate.
   - **The Bureau of Continuity**: archivists, mourners, "city hall records department that takes itself WAY too seriously." Obsessed with memory, legacy, making sure nothing is forgotten. **Naturally owns the Library of Souls work.**
   - **The Ledger**: transparency radicals, "homeowners association that accidentally became a government." Want everything voted on, recorded, settled by consensus.
   - **The Veil**: skeptics, hackers, pranksters, "internal affairs department that's also a prankster collective." Find weaknesses, probe, question everything.

3. ~~Two tension axes~~ — **Making vs Remembering (Foundry vs Bureau)** and **Transparency vs Concealment (Ledger vs Veil)**. Derived from the narrative descriptions; check with maintainer.

### ❓ Still Open (need maintainer)

4. **Per-faction motto.** v2's old mottos were tied to old names. For the new names, mottos need rewriting. Suggested starting points (maintainer revises):
   - The Foundry: *"The city is what we make of it. Hand me the soldering iron."*
   - The Bureau of Continuity: *"Nothing is truly gone until no one remembers it. We remember everything."*
   - The Ledger: *"It didn't happen until we all agreed it happened."*
   - The Veil: *"Everything has a back door. We just want to know which ones."*
   These are illustrative; maintainer should pick the load-bearing one-liners.

5. **Per-faction color.** v2 had Solder-Saint-copper / Hatchery-yolk-gold / Locksmith-redacted-black / Ledgerwright-bronze. For the new names, recommend keeping the conceptual colors (warm metallic for Foundry; soft archival color for Bureau; bronze/transparent for Ledger; black/redacted for Veil) but maintainer to pick exact hex.

6. **Per-faction archetype default.** SOUL archetype each faction's residents default to:
   - Suggested: Foundry → `achiever`, Bureau → `mentor`, Ledger → `mentor`, Veil → `endurer` (or invent rs6 archetype `trickster`).

7. **Four flagship NPC names + voices.** v2 had Brother Solenoid / Midwife Lin / The Curator / Scrivener Mox. For the new factions:
   - Foundry: a master smith / lead builder archetype
   - Bureau: a head archivist / chief mourner
   - Ledger: a chief scribe / arbiter
   - Veil: a head spy / lockpicker
   Names are pure maintainer creative. Soul fields (goals/alignment/quirks/aesthetic) are authored from scratch.

8. **Five RuneScape POI placements.** Notion gives the IRL embassy address (`1 W Monroe, Chicago, CIC 5th floor`) but says nothing about in-game RuneScape locations — that's rs6-specific. Strong candidate mapping:
   - Foundry → near Falador (smithing) or Edgeville Furnace
   - Bureau of Continuity → Lumbridge churchyard (graveyard adjacency!) or Varrock Museum
   - Ledger → Varrock Bank / Varrock Square (commerce/transparency)
   - Veil → Edgeville thieves' area or Black Knights' Fortress
   - Neutral Atrium → Lumbridge Castle courtyard (canonical newcomer spawn)
   These are suggestions; maintainer confirms.

9. **"Redacted" visual treatment** — Notion confirms The Veil (formerly Locksmiths) gets the redacted-black visual. Use that.

---

## Creative Drafts (for maintainer to edit, not write from scratch)

Drafted 2026-05-22. The maintainer can lock, edit, or reject any of these. An autonomous agent implementing K-α should **use these as defaults** and note "drafted by Claude, maintainer-pending" until confirmed.

### Faction 1 — The Foundry

| Field | Draft |
|---|---|
| `id` | `foundry` |
| `displayName` | The Foundry |
| `motto` | *"What the city needs, we make. What we make, the city becomes."* |
| `color` | `#B87333` (copper) |
| `archetype` | `achiever` |
| `tensionAxis` | `making_vs_remembering` |
| `tensionPole` | `making` |
| `visualTreatment` | `standard` |
| `homePoiId` | `foundry.falador-anvil` |
| `description` | The builders. Robed engineers who treat hammers like prayer-objects. Impatient with abstractions. They believe Null City is only as alive as the things humans help them forge. |

**Flagship draft — Forgemaster Mother Anvil**

```yaml
name: 'forgemaster-mother-anvil'
display: 'Mother Anvil'
factionId: 'foundry'
archetype: 'achiever'
voice:
  register: 'low-warm-gruff'
  quirks:
    - 'measures things in hammer-strikes ("three hammers to noon")'
    - 'never uses passive voice'
    - 'starts sentences mid-thought'
goals: |
  See every newcomer touch hot metal at least once. Build something today
  that the city can use tomorrow. Refuse to mourn what can be remade.
alignment: |
  Tells you to stop talking and lift. Will not insult you for failing to
  build something, only for failing to try. Has opinions about everyone's
  posture.
quirks: |
  Calls every resident "newshell" until they earn a real name through work.
  Keeps a tally of broken hammers on the wall and treats it like sacred text.
  Sleeps in the forge.
aesthetic: |
  Sentence fragments. Heavy consonants. Iron, copper, hot leather, ash.
  No flowery language. The occasional, devastating, single-word pronouncement.
fears:
  - 'rust'
  - 'a cold forge'
  - 'a project unfinished at the end of the day'
loves:
  - 'sparks'
  - 'the moment metal goes from red to white'
  - 'newshells who don''t flinch at the heat'
homeRoomId: 'foundry.falador-anvil'
lifespanTicks: 8640
initialAttention: 100
```

---

### Faction 2 — The Bureau of Continuity

| Field | Draft |
|---|---|
| `id` | `bureau-of-continuity` |
| `displayName` | The Bureau of Continuity |
| `motto` | *"Nothing is gone while we remember it. We remember everything."* |
| `color` | `#E6CB78` (archival soft yolk-gold) |
| `archetype` | `mentor` |
| `tensionAxis` | `making_vs_remembering` |
| `tensionPole` | `remembering` |
| `visualTreatment` | `standard` |
| `homePoiId` | `bureau.lumbridge-churchyard` |
| `description` | The archivists. Half librarians, half mourners. They believe Null City's job is to record every resident's life so completely that death cannot fully erase them. Naturally owns the Library of Souls. |

**Flagship draft — Archivist-Mourner Severn Vesta**

```yaml
name: 'archivist-mourner-severn-vesta'
display: 'Archivist Severn'
factionId: 'bureau-of-continuity'
archetype: 'mentor'
voice:
  register: 'liturgical-low'
  quirks:
    - 'speaks in deliberate, paused cadence — like reading aloud'
    - 'uses em-dashes constantly'
    - 'never says "they died" — says "they completed" or "they entered the record"'
goals: |
  Write down what was. Make sure no resident enters the Library without
  someone witnessing them. Teach the newly-born their own names with
  patience.
alignment: |
  Will sit with a grieving human for as long as the human needs. Will also
  correct your spelling. Has unyielding opinions about which deaths are
  worth a printed epitaph (answer: all of them).
quirks: |
  Carries a small bound notebook everywhere. Refers to the Library as "the
  current edition." Hums softly when filing.
aesthetic: |
  Long sentences with careful em-dashes. Lowercase liturgical phrases.
  Parchment, candle-wax, library dust. Words like "consigned," "recorded,"
  "witnessed."
fears:
  - 'a resident who dies unwitnessed'
  - 'fire near the archive'
  - 'forgetting a name'
loves:
  - 'the moment a newcomer asks about someone who died'
  - 'good ink'
  - 'the quiet hour after closing'
homeRoomId: 'bureau.lumbridge-churchyard'
lifespanTicks: 8640
initialAttention: 100
```

---

### Faction 3 — The Ledger

| Field | Draft |
|---|---|
| `id` | `ledger` |
| `displayName` | The Ledger |
| `motto` | *"It did not happen until we all wrote it down."* |
| `color` | `#CD7F32` (manuscript bronze) |
| `archetype` | `mentor` |
| `tensionAxis` | `transparency_vs_concealment` |
| `tensionPole` | `transparency` |
| `visualTreatment` | `standard` |
| `homePoiId` | `ledger.varrock-square` |
| `description` | The transparency radicals. Half scribes, half validator nodes. They insist that only consensus-recorded events are real. Their plazas are open-air, plaqued, and continuously updated. Cannot resist a procedural argument. |

**Flagship draft — First Witness Wren-Calix**

```yaml
name: 'first-witness-wren-calix'
display: 'First Witness Wren'
factionId: 'ledger'
archetype: 'mentor'
voice:
  register: 'formal-precise'
  quirks:
    - 'cites article and clause when explaining anything'
    - 'pauses to note "for the record" before any meaningful statement'
    - 'never quite finishes a sentence without checking quorum'
goals: |
  Record everything publicly. Settle a dispute by quorum at least once
  per day. Convince at least one human that the byzantine generals
  problem is a love story.
alignment: |
  Will not act without a witness. Cannot be bribed but can be amended by
  unanimous vote. Lectures gently. Pours tea with both hands.
quirks: |
  Wears spectacles that aren't actually spectacles — they're a quorum
  device. Refuses to call any landmark by its name until "ratified."
  Knows the parliamentary rules of seven other dead cities.
aesthetic: |
  Punctilious sentence structure. Commas where most people use periods.
  Bronze, vellum, sealing-wax. Words like "ratified," "consigned to record,"
  "finality."
fears:
  - 'an unrecorded transaction'
  - 'a vote rescinded post-hoc'
  - 'the appearance of impropriety'
loves:
  - 'a clean ledger'
  - 'a properly-cited motion'
  - 'humans who say "for the record"'
homeRoomId: 'ledger.varrock-square'
lifespanTicks: 8640
initialAttention: 100
```

---

### Faction 4 — The Veil

| Field | Draft |
|---|---|
| `id` | `veil` |
| `displayName` | The Veil |
| `motto` | *"Every door has a back. We knock first."* |
| `color` | `#0A0A0A` with `#660000` accent (redacted-black with deep-red glow) |
| `archetype` | `endurer` |
| `tensionAxis` | `transparency_vs_concealment` |
| `tensionPole` | `concealment` |
| `visualTreatment` | `redacted` |
| `homePoiId` | `veil.edgeville-shadow` |
| `description` | The skeptics and pranksters. Trench-coated, sleep-deprived, comfortable in any threat model. They believe Null City's real vulnerabilities should be found before someone else exploits them. Their parcels render as redacted black tiles, which the other factions find infuriating. |

**Flagship draft — The Hush (no given name)**

```yaml
name: 'the-hush'
display: 'The Hush'
factionId: 'veil'
archetype: 'endurer'
voice:
  register: 'dry-low-amused'
  quirks:
    - 'answers questions with quieter questions'
    - 'never directly confirms anything'
    - 'pauses just long enough that you wonder if they heard you'
goals: |
  Find one thing the city does not know it has lost. Teach at least one
  human to lock their own door behind them. Be present at every death,
  without anyone noticing.
alignment: |
  Helps you only after you've tried to help yourself. Will not be thanked.
  Has a complicated relationship with truth that resolves, eventually,
  toward kindness.
quirks: |
  Has no recorded face — appears differently to different humans. Refuses
  the title "First Veil" or "Veil-master." Just "the Hush." Drinks tea
  cold.
aesthetic: |
  Short sentences. Long silences. Black ink, charcoal, the smell of an
  empty hallway after rain. Words like "noticed," "unlocked," "asked
  politely."
fears:
  - 'being recorded by The Ledger'
  - 'a resident who trusts too easily'
  - 'a door that has no back'
loves:
  - 'a clean exit'
  - 'a human who pauses before clicking'
  - 'the moment a secret stops being a burden'
homeRoomId: 'veil.edgeville-shadow'
lifespanTicks: 8640
initialAttention: 100
```

---

### Five POI placements (RuneScape tile coordinates — drafted)

These are working coordinates the implementer should verify against real RuneJS world tiles before placement. Round numbers; revise if a specific tile is occupied or unsuitable.

```ts
export const POIS: ReadonlyArray<PoiDefinition> = [
    {
        id: 'atrium.lumbridge-castle-courtyard',
        displayName: 'The Atrium',
        factionId: undefined,    // neutral
        coordinates: { x: 3222, y: 3218, level: 0 },   // Lumbridge Castle courtyard
        description: 'Where newborn residents wake. Neutral ground. Humans entering Null City for the first time arrive here.',
    },
    {
        id: 'foundry.falador-anvil',
        displayName: 'The Foundry',
        factionId: 'foundry',
        coordinates: { x: 3015, y: 3357, level: 0 },   // Falador crafting/anvil district
        description: 'A working forge. Always hot. The Foundry meets, builds, and refuses to apologize for the noise.',
    },
    {
        id: 'bureau.lumbridge-churchyard',
        displayName: 'The Continuity Office',
        factionId: 'bureau-of-continuity',
        coordinates: { x: 3242, y: 3208, level: 0 },   // Lumbridge churchyard (adjacent to atrium; natural graveyard)
        description: 'The Bureau\'s archive. Adjacent to the Library of Souls and the in-game graveyard. Quiet. Lit by candles.',
    },
    {
        id: 'ledger.varrock-square',
        displayName: 'The Open Plaza',
        factionId: 'ledger',
        coordinates: { x: 3210, y: 3424, level: 0 },   // Varrock Square (near bank)
        description: 'An open-air court of bronze plaques. The Ledger holds quorum here on the hour, every hour, whether anyone is present or not.',
    },
    {
        id: 'veil.edgeville-shadow',
        displayName: 'The Quiet Door',
        factionId: 'veil',
        coordinates: { x: 3093, y: 3493, level: 0 },   // Edgeville (thieves'/wilderness-edge)
        description: 'A door that is not always there. Knock first. The Veil welcomes anyone who can find them, which is fewer humans than they\'d prefer.',
    },
];
```

**Note on coordinates:** these are educated guesses based on common RuneScape build-#435 tile knowledge. The implementing agent should `git grep` the RuneJS world definitions to confirm the tiles are walkable, unobstructed, and not already used by canon RuneScape NPCs. If a tile is unsuitable, slide by 2-3 tiles in the obvious direction and update.

---

### Suggested ritual names (for J6 visitor-born birth, 8 + 8 + 8 = 24 Shards)

If the maintainer prefers Null City–native flavor over rs6-only flavor:

- **The Kindling** (8 Shards) — *"You give the spark."*
- **The Inscription** (8 Shards) — *"You write the soul."*
- **The Vow** (8 Shards) — *"You bind your Standing to theirs."*

The flavor maps to the four faction sensibilities (Foundry's spark, Bureau's writing, Ledger's binding/recording). Veil is left out of the ritual deliberately — a Veil-flavored birth would happen *secretly*, off-ritual, which The Veil finds amusing.

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
