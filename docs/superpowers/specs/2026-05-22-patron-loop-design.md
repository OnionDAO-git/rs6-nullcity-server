# Patron / Human-Attention Loop — Design (Workstream J)

**Status:** Draft v1, pending maintainer creative input on currency name + decay rate + ritual names.
**Author:** Claude (planning push 2026-05-22).
**Date:** 2026-05-22.
**Roadmap:** Workstream J in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
**North star:** `docs/null-city-rs6-vision.md` § "The Patron Loop".
**Read first:** `docs/null-city-ideation-backlog.md` Theme 4 (Patron / Human-Attention Loop) for the full provenance trail from v1/v2/RuneBench.

---

## Why This Spec Exists

Right now, RuneScape players have **no in-game way to interact with residents as patrons**. A player who meets a resident chopping trees in Lumbridge can't fund them, sponsor them, or witness their existence in any mechanical sense. Without this loop, residents are background scenery, not characters anyone cares about. The June 1, 2026 event needs this loop landed for humans to walk away with anything more than a lanyard.

This spec defines the **eight mechanics** that turn a passing player into a patron, witness, sponsor, or friend of a specific resident. All of them are adaptations of v2 canonical patron primitives (`shardsOffered`, `mercy_infusion`, `birth_sponsorship`, `parcel_ratification`) into RuneScape-native verbs.

---

## Goals

- A human in RuneScape can spend a currency to **refill a specific resident's attention**, keeping them alive longer.
- A human can **sponsor the birth** of a new resident with named soul fields, paying a three-part ritual cost.
- A human's repeated patronage of a resident or faction earns **standing**, and tier crossings trigger **letters** the human receives in-game.
- The Library timeline records patron events verbatim, with patron handles preserved across resident death (denormalised snapshot).
- The dashboard shows "funded by Alice", "witnessed by Bob" credit lines on landmarks and resident portraits.
- Daily-check-in and referral micro-incentives keep the city populated between event days.

## Non-Goals

- Wallet integration / on-chain economics. The currency is in-game / database-backed only.
- Direct command of residents. Patronage influences; it does not control.
- Synchronous "give and receive" trades with residents. Residents may or may not respond to gifts based on their internal SPARK loop — gift acceptance is asynchronous and never guaranteed.
- Cross-resident messaging on behalf of patrons (residents can talk to each other, but humans can't broker that — *Workstream L*).

## Constraints

- TypeScript, Node 24+, existing repo conventions.
- Must not break `[A1]`–`[A7]` SPARK facade contracts. Patron event emission is kernel-adjacent, not module-adjacent. Reviewed modules can READ patron events from the trajectory but cannot emit them.
- Must coexist with Codex's existing benchmark / runtime work. Patron emission is event-driven from in-world gateway interactions, not from spark.tick.
- **Currency is canonically `Shards`** (from OnionDAO Notion `Narrative V2` + `Onion DAO 2026 Guide`). Earlier draft of this spec used a `<CURRENCY>` placeholder pending maintainer naming; the Open Questions section below resolved this to `Shards` and `src/controller/patron/currency-ledger.ts` (commit `9eac9dcc`) shipped with `CURRENCY_NAME = 'Shards'`. Remaining `<CURRENCY>` references in this spec body are historical and should be read as `Shards`. Description from Notion: *"the embassy's official unit of attention"*, stored on the badge as ESP-NOW packets in the IRL layer, non-transferable between humans.
- Patron events feed the **existing** Evidence Layer `patron` line kind (already in schemas). This spec defines the producers, not the consumers (consumers live in Workstream I — Library — and Workstream D — Dashboard).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   Human attends workshop / scans badge ────► humans.currency_balance +N  │
│   (existing OnionDAO/v2 staff flow, mirrored or reused)                  │
│                                                                          │
│   Human enters RuneScape ──► interacts with resident NPC                 │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ In-game patron verbs (chathead menu options)                    │    │
│   │   • Offer to <resident>          → mercy_infusion (J2)          │    │
│   │   • Sponsor a new resident       → birth_sponsorship (J6)       │    │
│   │   • Bear witness at landmark     → patron_witness               │    │
│   │   • Send gift                    → patron_gift                  │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│   PatronGateway (NEW, src/controller/patron/)                            │
│     • Validates currency balance, cooldowns, eligibility                 │
│     • Debits ledger atomically                                           │
│     • Emits `patron` trajectory line via Evidence Layer                  │
│     • Updates resident attention / standing / faction reputation         │
│                                                                          │
│         │                                                                │
│         ▼                                                                │
│   Letters Producer (NEW, src/controller/letters/)                        │
│     • Watches standing tier crossings → emits standing letter            │
│     • Watches legacy_event → emits epitaph letters to all chatters       │
│     • Watches civic milestones → emits civic letters                     │
│                                                                          │
│         │                                                                │
│         ▼                                                                │
│   In-game delivery channel ───► RuneScape mail / scroll / clan chat      │
│   Web inbox ───► dashboard /inbox (Dev's repo)                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Where this slots in

- **Above** the existing AgentGateway (which talks to residents). PatronGateway is a peer gateway for human→resident events.
- **Below** the existing OnionDAO/v2 staff scanner that credits currency to humans (we assume that flow exists, possibly reusing v2 infrastructure — see *J7*).
- **Beside** the Evidence Layer. Patron events flow through the existing `patron` trajectory line kind already defined in `src/controller/evidence/schemas.ts`.

---

## Components

### 1. `<CURRENCY>` (J1)

**Maintainer decision: pick the name and decay rate.**
**Update 2026-05-24 (HD-046, E43):** the rs6 implementation picked the name "Shards" and made standing **permanent by default** (no decay). Once Officer, forever Officer. CurrencyLedger balance still decreases with `patron:offer` spending (that's the natural Shards economy); StandingLedger is monotonic and accumulates forever. Patron narrative relationships persist across all controller restarts and time. If decay is ever desired post-Chicago, it'd be a substrate change adding a `reduceSupport` op + `standing_demoted` letter kind.

Currency is an in-game / DB-backed unit. v2 calls it Shards (+1 per workshop attended, +2 referral, +1 daily); rs6 should pick a RuneScape-flavored name that's distinct from existing RS currencies (gp, tokens, points). Working name throughout this spec: `<CURRENCY>`.

Schema additions:

```ts
// In packages/types or equivalent rs6 catalog
export interface HumanCurrencyBalance {
    humanId: string;
    balance: number;
    updatedAt: string;
}

export interface CurrencyLedgerEntry {
    id: string;
    humanId: string;
    delta: number;
    reason:
        | 'workshop_attendance'
        | 'referral'
        | 'daily_check_in'
        | 'mercy_infusion'
        | 'birth_sponsorship'
        | 'patron_witness'
        | 'patron_gift'
        | 'admin_grant'
        | 'admin_revoke';
    relatedResidentId?: string;
    relatedLandmarkId?: string;
    note?: string;
    ts: string;
}
```

Ledger is append-only. `HumanCurrencyBalance` is a denormalised cache updated in the same tx as the ledger insert (v2 invariant — keep it).

#### Vocabulary cross-walk (resolves event-kind drift across v2 / spec ledger / library)

Three vocabularies are in play. To avoid confusion they are explicitly mapped here. **The library `PatronEvent.kind` (column 3) is canonical** — it's what reaches the resident's portrait and what humans see in their letters; everything else is internal accounting.

| v2 canonical primitive    | Spec `CurrencyLedger.reason` (debit) | Library `PatronEvent.kind` | In-world verb (chathead)          |
|---------------------------|--------------------------------------|----------------------------|-----------------------------------|
| `shardsOffered`           | `mercy_infusion`                     | `patron_gift`              | "Offer to <resident>" (J2)        |
| `birth_sponsorship`       | `birth_sponsorship`                  | `patron_sponsor`           | "Sponsor a new resident" (J6)     |
| `mercy_infusion` (legacy) | `mercy_infusion`                     | `patron_gift`              | (alias of "Offer to") (J2)        |
| `parcel_ratification`     | `patron_witness`                     | `patron_witness`           | "Bear witness at landmark" (J5)   |
| `shardsOffered` (gift)    | `patron_gift`                        | `patron_gift`              | "Send gift" (J8)                  |

Notes:
- Both "Offer to" (J2) and "Send gift" (J8) emit `library.PatronEvent.kind = 'patron_gift'` even though their ledger reasons differ. From the patron's letter and the resident's portrait, both feel like gifts — the ledger distinguishes them for accounting, not for storytelling.
- v2's `parcel_ratification` is rebranded "Bear witness at landmark" in rs6 for RuneScape flavor; the storytelling stays "I was here when this resident did something memorable."
- `src/controller/evidence/library-updater.ts` `PatronEvent.kind` is currently typed as `'patron_gift' | 'patron_witness' | 'patron_sponsor'` (3 values). The 4 v2 primitives reduce to these 3 library kinds via the table above.
- Stage transitions: nothing emits a `mercy_infusion` library kind directly — the gateway calls `observePatron({ kind: 'patron_gift', ... })` and the ledger entry records `reason: 'mercy_infusion'` for the corresponding human debit.

### 2. `PatronGateway` (J2, J6, plus J5/J8 emission)

`src/controller/patron/patron-gateway.ts` (NEW).

Public API:

```ts
interface OfferToResidentRequest {
    humanId: string;
    residentName: string;
    amount: number;                  // <CURRENCY> units to spend
    interactionContext?: string;     // free-form 'chathead', 'embassy', 'scroll'
}

interface SponsorBirthRequest {
    humanId: string;
    factionId: FactionId;            // K-defined; until K lands, allow any string
    name: string;                    // proposed resident name
    soulFields?: {
        goals?: string;
        alignment?: string;
        quirks?: string;
        aesthetic?: string;
    };
    cost: number;                    // must equal sum of three ritual parts (J6)
}

class PatronGateway {
    constructor(opts: { currencyLedger, residentRegistry, trajectorySink, soulSeeder });
    offerTo(req: OfferToResidentRequest): Promise<PatronEventOutcome>;
    sponsorBirth(req: SponsorBirthRequest): Promise<PatronEventOutcome>;
    witnessAt(humanId: string, landmarkId: string): Promise<PatronEventOutcome>;
    sendGift(humanId: string, residentName: string, artifact: string): Promise<PatronEventOutcome>;
}

interface PatronEventOutcome {
    ok: boolean;
    eventId: string;
    standingDelta?: { factionId: string; before: number; after: number; tierCrossed?: StandingTier };
    error?: 'insufficient_currency' | 'cooldown_active' | 'resident_not_found' | 'invalid_amount';
}
```

Per-method behavior:

- **`offerTo`**: validate balance ≥ amount; debit ledger; credit `resident.attention += attentionPerCurrency * amount`; update `standing(humanId, faction)` by +amount; emit `patron` trajectory line with `patronKind: 'patron_gift'` (offering counts as gift); if standing tier crossed, return tier in outcome (consumed by Letters Producer).
- **`sponsorBirth`**: validate balance ≥ ritual cost (default 24, three parts); check 24h cooldown per humanId; seed a new resident via SoulSeeder; debit ledger; emit `patron` line with `patronKind: 'patron_sponsor'`.
- **`witnessAt`**: marker for "I was here when X happened"; emits `patron_witness` line with `landmarkId` artifact; counts toward Mortician's Ribbon if landmark is a death scene.
- **`sendGift`**: a specific RS item the human owns is offered to the resident's inventory (gateway-mediated; resident may or may not accept on next tick); emits `patron_gift` with `artifact: <item-name>`.

All four emit through the **existing** `TrajectoryBuilder.recordPatron()` method (already defined in `src/controller/evidence/trajectory-builder.ts` and schemas). The patron line lands in the resident's `trajectory.jsonl` AND in the human's web-inbox via the Letters Producer.

### 3. Standing tier system (J3)

Standing is per `(humanId, factionId)` pair. The OnionDAO Notion `Narrative V2` "Design Notes & Open Questions" section defines **three named tiers** (`Acquaintance`, `Ally`, `Officer`) at thresholds 10 / 30 / 75 Shards. The implementation row at 0 points is the implicit "no standing yet" state — call it `stranger` internally as a sentinel, but **do not surface `stranger` in user-facing copy or letters** (Notion canon does not name it).

```ts
export const STANDING_TIERS = [
    { name: 'stranger', minPoints: 0 },      // internal sentinel; never shown to humans
    { name: 'acquaintance', minPoints: 10 }, // canonical Notion tier 1
    { name: 'ally', minPoints: 30 },         // canonical Notion tier 2
    { name: 'officer', minPoints: 75 },      // canonical Notion tier 3
] as const;

export type StandingTier = typeof STANDING_TIERS[number]['name'];
```

The Open Questions section below confirms the three named tiers + threshold values as canonical-from-Notion. The sentinel + named-tiers split lets `currentTier()` return a non-null value for every (human, faction) pair while keeping `LettersProducer` from emitting "you reached Stranger!" copy.

`StandingLedger` (NEW, `src/controller/patron/standing-ledger.ts`) tracks per-pair points with append-only entries + denormalised cache, same pattern as currency ledger.

### 4. Letters Producer (J4)

`src/controller/letters/letters-producer.ts` (NEW).

Subscribes to:
- Standing tier crossings (from `StandingLedger`)
- `legacy_event` trajectory lines (epitaph letters)
- Civic milestone events (e.g., Mortician's Ribbon eligibility)

For each trigger, produces a `Letter` record:

```ts
export interface Letter {
    id: string;
    kind: 'standing' | 'epitaph' | 'civic' | 'broadcast';
    recipientHumanId: string;
    fromResidentName?: string;        // sender resident at time of writing
    fromResidentSnapshot: {            // denormalised — survives sender death
        name: string;
        archetype?: string;
        factionId?: string;
        epitaph?: string;
    };
    subject: string;
    body: string;                      // template-generated; LLM-augmented in a later phase
    deliveredAt?: string;              // null until delivery channel confirms
    readAt?: string;
    relatedTriggerEventId: string;
    ts: string;
}
```

Letter body is **template-generated** in this phase. Template selects from per-faction motto and per-tier phrasing. Future enhancement (post-MVP) routes through an LLM.

### 5. Delivery channels

Two parallel:

- **In-game**: RuneScape mail / postbag / scroll mechanic. **Maintainer decision needed** on which RS mechanic to use. Options:
  - In-game mailbox (existing RuneScape system) — most natural but requires plugin work
  - Clan chat broadcast on login — wide reach, less personal
  - Static scroll pickup from embassy POI — requires N1 to land first
- **Web inbox**: `/inbox` route on the residents dashboard (Dev's repo). Reads letters with `recipientHumanId === me`. Dev's agent owns this route; schema is the contract.

### 6. Credit surfaces (J5)

Plaques readable in-game and on the dashboard near landmarks credit patrons:

```ts
export interface LandmarkCredit {
    landmarkId: string;
    label: 'funded_by' | 'founded_by' | 'witnessed_by' | 'sabotaged_by';
    humanHandle: string;
    relatedEventId: string;
    permanent: boolean;     // founded_by is permanent; others can decay
    ts: string;
}
```

Plaque rendering is dashboard work (Workstream D) and in-game examine text (Workstream N's embassy POI).

### 7. Visitor-born ritual (J6)

Three-part ritual totaling `RITUAL_TOTAL` (default 24 `<CURRENCY>`):

```ts
export const VISITOR_BIRTH_RITUAL = {
    KINDLING: 8,        // "I provide the spark"      — maintainer to rename
    INSCRIPTION: 8,     // "I write the soul fields"  — maintainer to rename
    VOW: 8,             // "I bind my standing"       — maintainer to rename
    TOTAL: 24,
    COOLDOWN_HOURS: 24,
    NEW_RESIDENT_INITIAL_ATTENTION: 24,
    NEW_RESIDENT_LIFESPAN_TICKS: 288,   // ~24h at 5-min ticks; rs6 may differ
} as const;
```

The three names are placeholder until maintainer picks rs6-flavored ritual names. Mechanically they're equivalent — all three must be paid for the birth to commit. Splitting into three creates a small narrative beat ("three offerings") that's worth keeping.

### 8. Daily check-in + referral (J7)

`+1 <CURRENCY>` per humanId per 24h on RuneScape login (or embassy badge scan). Tracked in a `daily_check_in` ledger entry; idempotent per humanId per UTC day.

`+2 <CURRENCY>` to the referrer when a new humanId gets their first `workshop_attendance` ledger entry. Referrer field added to `humans.referred_by` (existing v2 column if reused, otherwise new).

---

## Data Flow

### Mercy infusion (J2)

```
Human plays RuneScape ─► clicks "Offer to <resident>" on chathead
    │
    ▼
RuneJS plugin POSTs to PatronGateway.offerTo({humanId, residentName, amount: 5})
    │
    ▼
PatronGateway:
  1. Validate: balance ≥ 5
  2. Tx-begin
  3. currencyLedger.append({delta: -5, reason: 'mercy_infusion', relatedResidentId})
  4. humans.currency_balance -= 5
  5. resident.attention += 10 (rs6-configured ratio; default 2x)
  6. standingLedger.append({humanId, factionId: resident.faction, delta: +5})
  7. Maybe cross standing tier → outcome.tierCrossed
  8. Tx-commit
    │
    ▼
trajectoryBuilder.recordPatron({patronKind: 'patron_gift', patronHandle: humanHandle, ...})
    │
    ├──► resident's trajectory.jsonl
    │       │
    │       ▼
    │   libraryUpdater.observe ─► timeline.jsonl entry
    │
    ▼
If tierCrossed: lettersProducer.queueLetter({kind: 'standing', recipientHumanId: humanHandle, ...})
```

### Sponsor birth (J6)

```
Human clicks "Sponsor a new resident" on embassy NPC
    │
    ▼
Form: faction (K), name, optional soul fields (goals/alignment/quirks/aesthetic)
    │
    ▼
PatronGateway.sponsorBirth({humanId, factionId, name, soulFields, cost: 24})
    │
    ▼
PatronGateway:
  1. Validate: balance ≥ 24, cooldown not active
  2. Tx-begin
  3. Three ledger entries: kindling -8, inscription -8, vow -8
  4. humans.currency_balance -= 24
  5. Insert new resident with soul seeded from soulFields + faction defaults
  6. resident.attention_balance = 24, resident.lifespan_ticks = 288
  7. residents.owner_human_id = humanId
  8. standingLedger += 10 (birth grants instant acquaintance)
  9. Tx-commit
    │
    ▼
trajectoryBuilder.recordPatron({patronKind: 'patron_sponsor', ...})
    │
    ▼
New resident enters world; first say is its "birth motto" (preserve as first tagged quote)
```

### Death → epitaph letters

```
Resident dies (legacy_event in trajectory)
    │
    ▼
lettersProducer.observeLegacyEvent({residentName, cause, snapshotForLibrary})
    │
    ▼
For each humanId in `chatters[residentName]`:
  generate Letter with:
    fromResidentSnapshot: {name, faction, epitaph}
    subject: "<Name> has died."
    body: template(faction.flagship_voice, deceased.epitaph, human.standing)
  letterSink.write(letter)
    │
    ▼
Web inbox: human sees letter
In-game: mailbox plugin delivers letter to player (if in-game delivery chosen)
```

---

## Error Handling

| Failure | Behavior | Visibility |
|---|---|---|
| Currency balance insufficient | `PatronGateway` rejects with `error: 'insufficient_currency'`; no state change | In-game: chathead shows "You don't have enough <CURRENCY>." Web: 402-style error message. |
| 24h cooldown active on `sponsorBirth` | Rejects with `error: 'cooldown_active'`; no state change | In-game: "You sponsored a resident recently. Wait <X>h." |
| Resident not found (deceased / wrong name) | Rejects with `error: 'resident_not_found'` | Chathead disappears or shows "This resident is no longer with us." |
| Letter generation throws | Catch + log; letter is marked `failed`; can be retried | Status log entry; not user-visible |
| Standing ledger row insert fails post-tx | Inconsistency between currency ledger and standing — alert | Telemetry warning; eventual-consistency repair job |
| Trajectory write fails | Per Evidence Layer spec: log + continue. Action loop is NOT crashed. | Telemetry warning |
| Concurrent patron events on same resident in same tick | Last-write-wins on attention; both ledger entries persist | Rare; documented |

---

## Testing

### Unit

- `currency-ledger.test.ts` — debit/credit invariants, balance cache sync
- `standing-ledger.test.ts` — per-(humanId, faction) accumulation, tier crossing detection
- `patron-gateway.test.ts` — each verb: validates, debits, emits trajectory line, returns outcome
- `letters-producer.test.ts` — standing tier triggers, legacy_event triggers, civic milestone triggers
- `birth-ritual.test.ts` — three-part cost enforcement, cooldown enforcement, soul-seeding

### Integration

- `patron-end-to-end.test.ts` — human balance N → mercy infusion → resident attention up, standing crosses tier, trajectory line written, standing letter queued
- `birth-end-to-end.test.ts` — sponsor birth → new resident in db, owner_human_id set, first tick fires, trajectory begins

### Live smoke

- Boot rs6, give a test human `100 <CURRENCY>` via admin tool, log in as that human, find a resident, offer to them via chathead. Verify: their attention went up, trajectory has the patron line, your standing increased, dashboard shows the patron event.
- Repeat for sponsor birth. Verify the new resident's portrait and timeline begin correctly.

---

## Decomposition Into Plans

Build order:

### Plan J-α — Currency + standing ledgers (J1, J3)

- `CurrencyLedger`, `StandingLedger`, balance caches, ledger tests
- Admin tool `npm run patron:grant -- --human <id> --amount <n>` for testing
- No in-world wiring yet; sets up the schema

### Plan J-β — PatronGateway + verbs (J2, J5, J6, J8)

- `PatronGateway.offerTo` / `sponsorBirth` / `witnessAt` / `sendGift`
- Wire into evidence layer via existing `recordPatron`
- Tests at unit + integration level
- Admin tool `npm run patron:offer -- --human X --resident Y --amount Z` for testing without in-world flow

### Plan J-γ — In-world wiring

- RuneJS plugin adds chathead menu entries on resident NPCs ("Offer to <name>", "Send gift")
- Embassy POI NPC adds "Sponsor a new resident" interaction (depends on N1 for placement)
- Maintainer decision needed on chathead-vs-embassy split

### Plan J-δ — Letters producer + delivery (J4)

- `LettersProducer` subscribes to standing tier crossings + legacy_event lines
- Templated body generation (no LLM yet)
- Web inbox schema documented (Dev's repo consumes it)
- In-game delivery channel chosen + wired (maintainer decision required)

### Plan J-ε — Micro-incentives (J7)

- Daily check-in tracker (idempotent per UTC day)
- Referrer attribution on first workshop scan
- Coordinates with existing v2 staff scanner if reused

**Recommended order: α → β → δ → γ → ε.** Ledgers first (foundation), then gateway (verbs), then letters (the human-visible side), then in-world wiring (depends on RuneJS plugin work which may collide with other agents), then micro-incentives (smallest, ship anytime).

---

## Open Questions (Status After 2026-05-22 Notion Dive)

OnionDAO Notion (`Narrative V2`, `Onion DAO Narrative`, `Onion DAO 2026 Guide`) answered several. **Defaulted answers are working values, not locked — maintainer can override.**

### ✅ Defaulted from Notion (subject to maintainer override)

1. ~~Currency name~~ — **`Shards`** (canonical, used in both `Narrative V2` and the `Onion DAO 2026 Guide`). Replace all `<CURRENCY>` references in this spec with `Shards`. Description from Notion: *"the embassy's official unit of attention"*, stored on the badge as ESP-NOW packets, non-transferable between humans.

2. ~~Shard earning rates~~ — locked from Notion `Narrative V2`:
   - Workshop attendance: 1–3 Shards
   - Competition placement: 5–20 Shards
   - Experience / quest completion: 3–10 Shards
   - Daily embassy check-in: 1 Shard
   - Bring someone new into a workshop: 2 Shards (the referral bonus)
   *(These resolve sub-questions of J7.)*

3. ~~Standing tier names~~ — **`Acquaintance`, `Ally`, `Officer`** (canonical from `Narrative V2`'s "Design Notes & Open Questions"). Three tiers, gating T1/T2/T3 resources respectively. v2's threshold values (10/30/75 Shards) carry over as defaults until tuning.

4. ~~Birth ritual name framing~~ — Not directly answered in Notion, but the "three parts of 8 Shards each totaling 24" mechanic is implied by v2's 24-Shard birth tithe. **Drafted in `2026-05-22-rs6-factions-design.md` "Suggested ritual names" section:**
   - **The Kindling** (8): *"You give the spark."* — Foundry-flavored
   - **The Inscription** (8): *"You write the soul."* — Bureau-flavored
   - **The Vow** (8): *"You bind your Standing to theirs."* — Ledger-flavored
   (The Veil is deliberately absent from the ritual — a Veil-flavored birth would happen *secretly*, off-ritual.)

### ❓ Still Open (need maintainer)

5. **Shard → attention conversion ratio.** How many `attention` units does 1 Shard refill? Notion is silent. Default: 2 attention per 1 Shard. Tunable.

6. **Resident attention decay rate per tick.** Default: 1 attention per tick. Combined with refill ratio, determines pace economy.

7. **Letter delivery channel.** Notion confirms letters exist as a concept (residents leaving "memories, artifacts, and legacies") but doesn't pick a delivery mechanism. Three options remain:
   - RuneScape in-game mailbox (most natural; requires plugin work)
   - Clan-chat broadcast on login (wide, less personal)
   - Static scroll pickup at the embassy POI (requires N1)
   - Web-only inbox via residents-dashboard (Dev's repo — works immediately, no in-game work)
   Recommend: web-only inbox first; in-game delivery deferred.

8. **In-game patron verbs surface.** Chathead menu on resident NPCs (intimate, less discoverable) OR embassy POI hub (discoverable, less intimate) OR hybrid. Recommend hybrid: gift/offer on chathead; sponsor at embassy NPC.

9. **Per-Handler contribution cap.** v2's first-10-Shards-at-full-strength rule. Carry over to rs6? Recommend yes for parity.

10. **Cross-economy reusability.** If James earns Shards at the IRL workshop, can he spend them in rs6 (RuneScape) AND in v2 (nullv2)? OR are the rs6 and v2 economies separate ledgers? **This is the deepest open question** — affects whether rs6 reuses v2's existing currency tables or builds its own. Recommend: separate ledgers (rs6 has its own `humans.shard_balance_rs6` column) with optional admin-bridge for cross-credit.

---

## Risks

- **Tight coupling to maintainer decisions.** 9 open questions, several blocking. K (factions) blocks parts of standing system. N (embassy POI) blocks J-γ.
- **In-world plugin coordination.** RuneJS plugin work may collide with Codex's gameplay benchmark work. Communicate via status log.
- **Ledger atomicity in a JS-process world.** Single-process invariant from Evidence spec applies; multi-process patron writes are out of scope.
- **Letter spam.** A patron with high standing across many residents may receive many letters on a death cascade. Mitigation: batch per-day digest as a future enhancement.
- **Cross-repo schema drift with Dev's dashboard.** The `Letter` schema is a cross-repo contract; field additions only without a version bump.

---

## Multi-Agent Coordination Notes

- Claude (me, writing this) owns `src/controller/patron/*` and `src/controller/letters/*`. New files; no current collision risk.
- Codex's territory has been evidence + gameplay benchmarks; minimal overlap expected.
- Dev's territory is the dashboard; consume the documented `Letter` and `LandmarkCredit` schemas.
- When K (factions) lands, several enums in this spec need to be updated to rs6 faction IDs.
- When N (embassy POI) lands, J-γ's embassy interactions slot in.
- Status log entries every meaningful state change.

---

## Cross-References

- `docs/null-city-rs6-vision.md` § "The Patron Loop"
- `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` § "Patron events" (the `patron` trajectory line kind)
- `docs/null-city-ideation-backlog.md` Theme 4
- `docs/superpowers/specs/2026-05-22-rs6-factions-design.md` (Workstream K — blocks parts of J3, J6)
- `docs/superpowers/specs/2026-05-22-embassy-and-event-design.md` (Workstream N — blocks J-γ embassy interactions)
