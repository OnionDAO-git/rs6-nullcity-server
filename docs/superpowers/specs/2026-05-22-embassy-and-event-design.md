# Embassy And Physical Event — Design (Workstream N)

**Status:** Draft v1. Several open questions need maintainer + Dev decisions.
**Author:** Claude (planning push 2026-05-22).
**Date:** 2026-05-22.
**Roadmap:** Workstream N in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
**North star:** `docs/null-city-rs6-vision.md` § "Done When" (June 1 event criteria).
**Read first:** `docs/null-city-ideation-backlog.md` Theme 9 (Physical Event Hooks).
**Depends on:** K (Factions — atrium and home POIs), J (Patron Loop — embassy interactions), I (Library — what's printed on the wall).

---

## Why This Spec Exists

The June 1, 2026 event in Chicago is the deadline. The "embassy" is the IRL space where humans show up; the "in-game embassy POI" is the digital reflection; the "wall map" is the projector display showing real-time city activity; the "graveyard" is where dead residents are remembered both in-game and IRL.

These surfaces are what humans walk away remembering. Without them, the rest of the work has no demo.

This spec defines the five surfaces and how they connect, plus the operational flow during the event itself.

---

## Goals

- A human at the embassy can find an in-game POI representing the embassy and interact with embassy NPCs to view residents, sponsor births, redeem achievements.
- The wall display shows a live RuneScape world snapshot + ticker of births/deaths/achievements.
- An in-game graveyard zone exists where players can examine tombstones for dead residents.
- An IRL graveyard wall at the embassy shows printed epitaphs from recent deaths.
- The Mortician's Ribbon civic achievement bestows on humans who witness N resident deaths.
- The staff workflow (badge scan, currency credit, claim_code lookup, lanyard print) works during event-day operations.

## Non-Goals

- Wallet / blockchain integration for achievement redemption.
- Real-time spectator video streaming.
- Multi-room audio installations.
- Custom hardware beyond the badge readers (reuse v2's existing badge integration).

## Constraints

- Most physical infrastructure (staff scanner, print queue, claim codes) **may be reused from v2** rather than rebuilt in rs6. Maintainer decision N6 picks. This spec assumes reuse where possible.
- Coordinates with Dev's dashboard for the in-browser surfaces.
- All in-game placement decisions need to be playable RuneScape locations — coordinates must reference real RuneJS tiles.
- Lanyard print is a physical-world ops constraint; print queue throughput at peak event hours determines minimum redemption latency.
- The IRL graveyard wall is a passive display; updates happen at a configurable cadence (default: hourly during event, daily otherwise).

---

## Architecture

### Five surfaces

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   1. IRL Embassy (Chicago physical space)                                │
│        ├── front desk (staff badge scanner, claim_code lookup)           │
│        ├── wall display (projected wall map + ticker — surface #2)       │
│        ├── graveyard wall (printed epitaphs — surface #5)                │
│        └── print desk (lanyard tokens)                                   │
│                                                                          │
│   2. Wall Display (projector or large monitor at embassy)                │
│        ├── RuneScape world snapshot (faction territory map)              │
│        ├── ticker: births, deaths, achievements, patron events           │
│        └── leaderboard: faction parcel counts                            │
│                                                                          │
│   3. In-game Embassy POI (RuneScape location)                            │
│        ├── reception NPC (lists residents, offers sponsor flow)          │
│        ├── plaque board (credit surfaces — funded_by, founded_by, etc.) │
│        ├── faction kiosks (per-faction info, standing display)           │
│        └── adjacent: in-game graveyard zone (surface #4)                 │
│                                                                          │
│   4. In-game Graveyard Zone                                              │
│        ├── tombstone-per-deceased-resident                               │
│        ├── examine text: name, faction, epitaph, cause, ticks lived     │
│        └── periodically refreshed from Library data                      │
│                                                                          │
│   5. IRL Graveyard Wall (printed display)                                │
│        ├── per-resident printed epitaph card                             │
│        ├── refreshed hourly during event, daily otherwise                │
│        └── physically pinned / posted at the embassy                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data flow into the surfaces

```
SPARK kernel ─► Evidence Layer ─► Library ─► portrait.json + timeline.jsonl
                     │
                     ├──► Wall ticker (surface #2): subscribes to legacy_events, patron_*, civic_achievement
                     ├──► In-game graveyard refresh: reads completed Library entries, places tombstones
                     ├──► IRL graveyard wall print job: reads completed Library entries, formats for print
                     └──► Mortician's Ribbon: counts legacy_event witnesses per human

Patron Gateway (J) ─► Standing ledger ─► Wall leaderboard (faction parcel counts)
Staff scanner ─► humans.currency_balance, workshop_attendance, referrals
Lanyard print queue ─► claim_codes ─► physical lanyard token
```

---

## Components

### 1. In-game Embassy POI (N1)

**Maintainer decision needed: pick a RuneScape location.**

Constraints:
- Reachable from Lumbridge spawn within a few in-game minutes.
- Has space for the reception NPC + faction kiosks + plaque board + graveyard adjacency.
- Visually distinct (humans walking in should recognize it as the embassy).

Candidates worth considering (maintainer picks):
- **Lumbridge churchyard** — natural graveyard adjacency, central location, has a building
- **Varrock Museum** — feels civic, has display cases for plaques
- **Falador Centre / White Knights' Castle** — formal, faction-coded
- **Edgeville bank area** — bustling, social, but no clear building
- **A new structure placed via RuneJS plugin** — most flexible, requires plugin work

Components at the POI:
- **Reception NPC** (named, persistent). Interactions:
  - "Who lives here?" → list of currently-alive residents with brief descriptions
  - "Sponsor a new resident" → opens *Workstream J6* sponsor flow
  - "Show my standings" → per-faction standing tiers for the player
  - "Read the wall" → in-game examine showing recent civic events
- **Plaque board** — display object with examine text listing recent credit surfaces (J5)
- **Faction kiosks** — four objects, one per faction (K). Examine shows: motto, flagship name, current parcel count, top patrons

`src/controller/embassy/embassy.ts` (NEW) — exports the POI definition and reception NPC seed.

### 2. Wall Display (N2)

**Decision: rs6 gets its own wall view OR feeds events into v2's existing wall.**

If rs6 gets its own view (recommended for clean coupling):
- New route in Dev's dashboard repo: `/wall/rs6` (or similar)
- Reads from rs6 controller via HTTP endpoint exposing latest events
- Renders: RuneScape world map (zoomed to relevant zones), faction parcel coloring, ticker at bottom
- Refresh cadence: events poll every 5 seconds; map snapshot every 30 seconds

If feeding into v2's wall:
- rs6 events get a "source: rs6" tag
- v2's existing wall.ts consumes them alongside v2 events
- Less work but mixes the two worlds visually

**Recommendation: separate wall view for rs6.** Coupling v2 and rs6 visuals is more confusing than helpful for event attendees.

Wall endpoint contract (from rs6 controller):

```ts
GET /v1/wall/snapshot
Response:
{
    timestamp: string,
    factionTerritory: { factionId: string; parcelCount: number; color: string; }[],
    recentEvents: WallTickerEntry[],   // last 50, newest first
    livingResidents: number,
    deadResidentsToday: number,
}

interface WallTickerEntry {
    kind: 'birth' | 'death' | 'achievement' | 'patron' | 'standing_crossing';
    ts: string;
    residentName?: string;
    factionId?: string;
    humanHandle?: string;
    detail: string;             // template-rendered display text
    accentColor?: string;
}
```

### 3. In-game Graveyard Zone (N3)

**Maintainer decision: pick a location.** Candidates:
- Lumbridge churchyard (most thematic, already exists)
- A new zone placed via RuneJS plugin near the embassy POI
- A side area of Varrock or Falador

Mechanics:
- Each deceased resident gets a tombstone object in the zone
- Tombstone examine text: `<name>, <faction>. <epitaph>. Lived <N> ticks. Died of <cause>.`
- Periodic refresh job (every 5 minutes?) reads recent legacy_events from the Library and places new tombstones
- Old tombstones (residents dead > 60 days) decay or move to an "archive" sub-zone

`src/controller/embassy/graveyard.ts` (NEW) — exports tombstone placement logic, refresh worker.

### 4. IRL Graveyard Wall (N4)

Physical wall at the embassy with printed epitaph cards.

Format per card:
- Name (large, serif)
- Faction motto (small, italic)
- Epitaph (verbatim from Library)
- Tick count + cause of death (footer)
- Optional: a 6-char claim code so a visitor can scan to view the full portrait

Print job pipeline:
1. New legacy_event lands in Library → entry added to "epitaph_print_queue" table
2. Periodic worker (configurable, default hourly during event) fetches queue, formats each card, sends to print
3. Staff posts printed cards on the wall
4. After N days, old cards are archived (off the wall, in a binder)

Reuses v2's print queue infrastructure if available (decision N6).

`src/controller/embassy/epitaph-print.ts` (NEW) — exports the queue manager + card formatter.

### 5. Mortician's Ribbon Civic Achievement (N5)

**Threshold N = 1** (canonical from OnionDAO Notion `Narrative V2` — see Open Questions resolution below). The earlier "N = 3 for first edition" draft is superseded; one witnessed death is enough. rs6 may tune up later if the first-edition rate feels too easy.

A civic achievement bestowed by the Embassy NPC on humans who witness a resident death. "Witnessing" means: the human had at least one chat interaction (any direction) with the resident during the resident's life.

```ts
export const MORTICIANS_RIBBON = {
    id: 'morticians_ribbon',
    name: "Mortician's Ribbon",
    description: "Witnessed the death of {N} resident(s).",
    triggerCount: 1,                     // canonical Notion value; was 3 in earlier draft
    kind: 'civic',                       // not buyable; bestowed
    inGameRepresentation: 'cape',        // RuneScape cape with custom color
    inGameColor: '#660000',              // somber red
    irlRepresentation: 'lanyard_card',
};
```

Detection logic:
- Per human, count distinct deceased-resident-ids where the human had chat interactions with the resident
- When count reaches triggerCount, emit `civic_achievement` event → civic letter to human → in-game cape unlock at next embassy visit

`src/controller/embassy/morticians-ribbon.ts` (NEW) — counter + trigger.

### 6. Staff Operations (event-day)

Out of scope for autonomous-dev work (it's an ops-flow doc, not code). Should exist as `docs/embassy-staff-runbook.md` covering:
- How to scan a badge to credit currency
- How to run the print queue at the print desk
- How to handle a stuck claim code
- How to respond if the wall display goes down
- How to deal with someone asking about their dead resident

Maintainer + ops team writes this; spec just notes it should exist.

---

## Components Summary

| File | Purpose |
|---|---|
| `src/controller/embassy/embassy.ts` | Embassy POI + reception NPC seed |
| `src/controller/embassy/graveyard.ts` | In-game tombstone placement + refresh |
| `src/controller/embassy/epitaph-print.ts` | IRL print queue manager + card formatter |
| `src/controller/embassy/morticians-ribbon.ts` | Civic achievement trigger |
| `src/controller/embassy/wall-snapshot.ts` | HTTP endpoint exposing wall data |
| `src/controller/embassy/embassy.test.ts` | Reception NPC interactions, plaque rendering |
| `src/controller/embassy/graveyard.test.ts` | Tombstone placement idempotency |
| `src/controller/embassy/epitaph-print.test.ts` | Queue ordering, card formatting |
| `src/controller/embassy/morticians-ribbon.test.ts` | Counter accuracy, threshold trigger |
| `docs/embassy-staff-runbook.md` | Event-day ops procedures |

---

## Data Flow

### A human attends the workshop

```
Human shows up at embassy
    │
    ▼
Staff scans badge → POST /v1/workshops/scan
    │
    ▼
humans.currency_balance += 5 (workshop attendance)
    │
    ▼
First-attendance check: if first, emit civic event 'first_shard' → in-game cape unlock queued
    │
    ▼
Human logs into RuneScape
    │
    ▼
Walks to embassy POI; reception NPC says "Welcome <handle>."
    │
    ▼
Human chooses "Sponsor a new resident" → Workstream J6 flow
```

### A resident dies during the event

```
Resident's spark.tick → legacy_event with cause
    │
    ▼
Library finalizes the resident's portrait
    │
    ▼
Three parallel actions:
  1. Letter sent to each human who chatted with this resident (Workstream J4)
  2. Tombstone placed in in-game graveyard (next refresh cycle)
  3. Epitaph card queued for IRL printing
    │
    ▼
Wall ticker shows: "💀 <ResidentName> has died. <epitaph excerpt>."
    │
    ▼
For each chatter: Mortician's Ribbon counter +1; check threshold
```

### Mortician's Ribbon bestowed

```
Mortician's Ribbon counter for Alice reaches 3
    │
    ▼
civic_achievement event emitted for Alice
    │
    ▼
Civic letter dispatched: "Alice, the Embassy recognizes your witness..."
In-game: next time Alice visits embassy, reception NPC grants her the cape
IRL: staff hands Alice a Mortician's Ribbon lanyard card with claim_code
```

---

## Error Handling

| Failure | Behavior |
|---|---|
| Wall display HTTP endpoint times out | Dashboard shows cached snapshot; "live" indicator turns yellow |
| In-game graveyard refresh worker fails | Log error; retry next cycle; tombstones eventually appear |
| IRL print queue stalls | Old cards stay up; new deaths queue but don't display; staff sees alert |
| Mortician's Ribbon counter races (resident dies twice from data corruption?) | Use distinct-deceased-id dedup; counter is monotonic per (human, resident) pair |
| Staff badge scan fails | Manual claim code lookup; staff can enter humanHandle directly |
| Embassy reception NPC crashes / unresponsive | Other interactions degrade gracefully; sponsor flow falls back to web UI |
| Wall snapshot endpoint returns inconsistent state (mid-tick read) | Snapshot is read-committed; accept eventual consistency over latency |

---

## Testing

### Unit

- `embassy.test.ts` — reception NPC chat flows; plaque rendering from credit surfaces
- `graveyard.test.ts` — tombstone placement, examine text formatting, idempotent refresh
- `epitaph-print.test.ts` — queue FIFO, card formatter output matches snapshot
- `morticians-ribbon.test.ts` — counter accumulates per human, threshold triggers exactly once
- `wall-snapshot.test.ts` — endpoint shape matches contract, includes all event kinds

### Integration

- `embassy-end-to-end.test.ts` — boot rs6 with seeded flagships; reception NPC lists them; sponsor a new resident via NPC; verify they appear
- `event-day-simulation.test.ts` — fast-forward several resident deaths; verify each produces (a) letter, (b) tombstone, (c) print queue entry; verify ribbon triggers correctly at threshold

### Live smoke

- Run the embassy on a test world. Walk a player to it. Verify reception NPC interactions. Sponsor a test resident. Walk to graveyard; verify recent tombstones. Trigger a deliberate resident death; verify wall ticker shows it within 30 seconds.

### Event-day dress rehearsal

- 24-48h before the actual event: full dress rehearsal with staff + test attendees. Run through every workflow (badge scan, sponsor, graveyard read, achievement claim). Document anything that breaks in `docs/embassy-staff-runbook.md`.

---

## Decomposition Into Plans

### Plan N-α — Embassy POI placement + reception NPC (N1)

- Pick the in-game location (maintainer decision)
- Place the POI structure via RuneJS plugin
- Seed the reception NPC with full soul fields
- Interaction handlers for "who lives here", "show standings", "read the wall"
- Sponsor flow integration deferred until J6 lands

### Plan N-β — In-game graveyard (N3)

- Pick the graveyard zone location (likely adjacent to embassy POI)
- Refresh worker that reads Library legacy events and places tombstones
- Tombstone examine text formatter
- Tests + smoke walk

### Plan N-γ — Wall display (N2)

- HTTP `GET /v1/wall/snapshot` endpoint exposing structured city state
- Coordinate with Dev: define + ship `WallTickerEntry` shape (cross-repo contract)
- Dev's repo implements the in-browser rendering
- Test fixtures for various event types

### Plan N-δ — IRL graveyard + print queue (N4)

- `epitaph-print.ts` queue manager
- Card formatter (text → printable layout)
- Worker that drains queue on configurable cadence
- Decision N6: reuse v2 print pipeline OR build rs6's own
- Test fixtures for card rendering

### Plan N-ε — Mortician's Ribbon (N5)

- Counter + threshold trigger
- Civic letter integration (depends on J4 letters producer)
- In-game cape grant on next embassy visit
- IRL lanyard card via print queue

### Plan N-ζ — Staff runbook + dress rehearsal

- Write `docs/embassy-staff-runbook.md`
- Coordinate with operational team for event-day
- Schedule dress rehearsal
- Document anything that breaks; fix or flag

**Recommended order: α → β → ε → γ → δ → ζ.** α + β are in-game (testable without ops); ε is small and high-payoff; γ + δ require coordination with Dev / print infra; ζ is the last operational layer.

---

## Open Questions (Status After 2026-05-22 Notion Dive)

### ✅ Defaulted from Notion (subject to maintainer override)

1. ~~Mortician's Ribbon threshold~~ — **N = 1.** Canonical from `Narrative V2`'s civic achievement list: *"The Mortician's Ribbon — Witness an AI resident's death — You were there at the end. Their memory got a little of you in it."* Singular wording suggests one death witnessed is enough. (rs6 can tune up to 3+ later if it feels too easy; for first edition use 1 per resident.)

2. ~~IRL embassy location~~ — **Chicago Innovation Center (CIC), 1 W Monroe, 5th floor.** Confirmed in `Onion DAO 2026 Guide`. This is the physical embassy host venue.

3. ~~Wall display content~~ — locked from `Narrative V2`:
   - Parcels colored by faction (Foundry copper, Bureau yolk-gold, Ledger bronze, Veil redacted-black — adapted from old v2 colors)
   - Leaderboard of faction territory by week
   - Ticker of recently-ratified parcels with witnessing badge handle
   - Resident births/deaths scrolling at the bottom
   This is what the wall renders; the in-rs6 wall view follows the same shape.

4. ~~Civic achievement list~~ — locked from `Narrative V2`:
   - **The First Shard** (first embassy check-in)
   - **The Mortician's Ribbon** (witness a resident's death)
   - **The Founder's Stake** (earn one tier-3 resource from any faction)
   All three are bestowed by the embassy, not bought. rs6's `Workstream N5` covers Mortician's; First Shard and Founder's Stake are easy follow-ons.

### ❓ Still Open (need maintainer + Dev)

5. **N1: In-game embassy POI location.** Lumbridge churchyard, Varrock Museum, Falador Centre, Edgeville bank, or new RuneJS-placed structure? Strong candidate: Lumbridge Castle courtyard (canonical RuneScape newcomer spawn) — fits Bureau-of-Continuity-adjacent graveyard at the church.

6. **N2: Separate rs6 wall view, or merge into v2's wall?** Recommend separate (cleaner coupling). Notion confirms the wall content shape; the rendering channel can be rs6-specific.

7. **N3: In-game graveyard zone location.** Recommend Lumbridge churchyard (canonical RS graveyard, adjacent to suggested embassy POI). Maintainer + RuneJS plugin lead confirms.

8. **N4: Print queue infrastructure.** Notion's print-shop description (`Narrative V2`: ~600 prints estimated for ~150 attendees × 3-5 achievements) implies the v2 print pipeline is real and operational. Recommend rs6 reuses v2's print queue + claim_code workflow rather than building its own. **This question needs explicit yes/no from maintainer to lock.**

9. **N5: In-game cape color/style for Mortician's Ribbon.** Need an unused RuneScape color or custom recolor via plugin. Notion suggests "somber red"; final hex pending.

10. **Event-day staffing.** Who runs the print desk? Who handles edge cases at front desk? Out of scope for code; needs an ops document.

11. **Wall display hardware.** Projector or monitor? Resolution? Dimensions? Affects layout decisions. Dev's repo handles rendering; hardware is operational concern.

12. **Graveyard tombstone decay.** How long do tombstones stay in-game before archive? Recommend 60 days first edition.

---

## Risks

- **N1 is the biggest blocker.** Without a placed embassy POI, neither the in-game player flow nor the graveyard adjacency exists. Maintainer should pick the location early so plugin work can start in parallel.
- **Print queue is operational, not just code.** A jammed printer at the event is a failure mode the code can't fix. Need backup plan.
- **Cross-repo timing with Dev.** Wall view requires Dev's repo to ship the consumer. Lock the schema early; ship the producer to a fixture endpoint Dev can mock against.
- **Live smoke discovers RS plugin issues late.** Place the embassy POI weeks before the event; walk it daily as a sanity check.
- **Mortician's Ribbon over/under-issuance.** Threshold tuning matters. If N is too low, every attendee gets one and it loses meaning. If too high, almost nobody. Start at 3 and observe.

---

## Cross-References

- `docs/null-city-rs6-vision.md` § "Done When" (June 1 event criteria)
- `docs/superpowers/specs/2026-05-22-patron-loop-design.md` (Workstream J — sponsor flow + letters)
- `docs/superpowers/specs/2026-05-22-rs6-factions-design.md` (Workstream K — embassy hosts the four factions)
- `docs/superpowers/specs/2026-05-22-hero-residents-design.md` (Workstream M — visitor-born heroes get tombstones)
- `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` (Workstream I — Library is the data source)
- `docs/null-city-ideation-backlog.md` Theme 9 (Physical Event Hooks)
