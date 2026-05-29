# Null City Attention Loop + Storyteller Tasks

Drafted: 2026-05-28

Status: **Draft for tonight's meeting.** This captures James + Dev's latest product loop and the AI Storyteller/commentator idea. Update after Dev's MDA framework and tonight's decisions.

## Product Loop TL;DR

Null City's core loop is:

1. Humans define a **Soul** with a goal, personality, vices, hindrances, faction, and starting constraints.
2. Humans collectively spend **Shards / Attention** to fund that Soul.
3. When the Soul reaches a birth threshold, it is born as a RuneScape resident.
4. The resident's Attention decays over time.
5. The resident survives by earning more Attention from humans, asking for help, progressing toward its goal, or trading **Null City RuneScape Items**.
6. Admins approve NCRIs for now. Later, residents earn NCRIs by finishing quests.
7. NCRIs are real RuneScape items with special Null City metadata/properties; some can be redeemed for physical 3D prints.
8. When a resident completes its binary quest goal, the Library of Souls marks them as **saved** and writes their canonical story.
9. A public-canon **Storyteller** periodically reads city events and narrates what is happening.

## Current Assumptions

| Topic | Working assumption | Needs confirmation? |
|---|---|---|
| Shards vs Attention | Shards are Attention. Use one ledger with two UI names if needed. | Low |
| Attention decay | Decays over time at a configurable rate. Keep the first version simple. | Low |
| Soul birth | Collective threshold creates/births the resident. | Medium |
| NCRI creation | Admins create/approve NCRIs first. Later residents earn them through quests. | Medium |
| NCRI form | RuneScape items with Null City metadata and special properties. | Medium |
| Goal completion | Binary quest completion marks the resident saved. | Low |
| Storyteller | Public canon from day one, using a smarter model. | Medium |
| Storyteller cadence | Every ~10 minutes, configurable, plus event triggers later. | Low |

## P0: Soul Proposal And Birth

Goal: humans can propose Souls, collectively fund them, and cause a resident to be born when the threshold is met.

Tasks:

- Define a `SoulProposal` schema:
  - name
  - goal
  - binary quest completion condition
  - personality
  - vices/hindrances
  - faction/alignment
  - optional preferred role/location
  - birth Attention threshold
  - proposer human handle
  - status: proposed, funding, born, rejected, archived
- Define validation rules:
  - no duplicate active names
  - goal must be human-readable
  - goal must map to a binary completion contract before birth
  - vices/hindrances should affect story or behavior, not just be flavor text
- Add proposal persistence:
  - start file-backed to match current project style
  - later can move to a real datastore if needed
- Add funding flow:
  - human contributes Shards/Attention to a proposal
  - ledger records contributor, amount, timestamp, proposal id
  - proposal shows progress toward threshold
- Add birth flow:
  - threshold crossed
  - approved proposal becomes resident Soul file / runtime payload
  - initial resident state gets starting Attention balance
  - Library records `soul_born`
- Add basic admin controls:
  - approve/reject proposal
  - adjust threshold
  - pause proposal if unsafe or off-theme

Tests / proof:

- Unit tests for schema validation and threshold crossing.
- Integration test: proposal starts at 0, two humans fund it, threshold crosses, birth event is emitted.
- Live smoke: born resident appears in controller state and Library timeline.

## P0: Attention Ledger And Decay

Goal: Attention becomes the resident life-force and the accounting layer for human influence.

Tasks:

- Define `AttentionLedger` transaction types:
  - `proposal_contribution`
  - `birth_grant`
  - `time_decay`
  - `patron_gift`
  - `resident_ask`
  - `ncri_sale`
  - `quest_reward`
  - `admin_adjustment`
  - `refund`
- Track balances for:
  - human patron
  - Soul proposal
  - born resident
- Implement configurable decay:
  - global default rate
  - optional per-resident modifier
  - paused/offline safety behavior
  - minimum tick interval to avoid ledger spam
- Define death/fade behavior:
  - Attention reaches zero
  - resident stops acting
  - Library records fade/death
  - public surfaces mark resident as gone/faded
- Define top-up behavior:
  - humans can add Attention to living residents
  - resident can ask for Attention
  - NCRI sale can add Attention

Tests / proof:

- Ledger is append-only and replayable.
- Decay decreases balance over simulated time.
- Resident fades at zero and does not continue acting.
- Patron gift increases balance and records a Library moment.

## P0: Quest Goal Contracts And Saved State

Goal: every born Soul has a clear binary goal and can become saved in the Library.

Tasks:

- Define `GoalContract`:
  - id
  - human-readable goal text
  - resident id / Soul proposal id
  - completion source: quest state, item delivered, NPC interaction, admin verification, benchmark event
  - binary status: incomplete, complete
  - completion timestamp
- Start with quest-state completion for known game quests.
- Add `saved` resident state:
  - living residents can become saved
  - saved residents get a canonical Library entry
  - saved residents may retire, continue as legends, or become non-decaying depending on product decision
- Add Library saved portrait:
  - goal
  - how they completed it
  - who funded them
  - final Attention state
  - notable memories / quotes

Tests / proof:

- Cook's Assistant completion can mark a goal complete.
- Saved state persists after restart.
- Library portrait shows saved status and completion evidence.

Open decision:

- Does a saved resident keep acting, retire, or become an immortal/canonical NPC?

## P0: NCRI Registry And Item Metadata

Goal: make Null City RuneScape Items concrete enough to sell/trade/redeem.

Tasks:

- Define `NCRI` metadata:
  - ncri id
  - RuneScape item id/key
  - display name
  - lore text
  - special property tags
  - printable flag
  - print asset / 3D file reference
  - admin approval status
  - owner human/resident
  - redemption status
- Admin-create NCRI records first:
  - no public creation yet
  - no resident-generated items until quest flow is stable
- Bind NCRI records to real RuneScape items:
  - item appears in inventory/trade as normal RS item
  - metadata lives in Null City registry
  - avoid creating fake UI-only items
- Add ownership transitions:
  - admin grants to resident
  - resident trades/sells to human
  - human redeems for print

Tests / proof:

- NCRI registry persists records.
- Trade transfers an NCRI item and metadata owner together.
- Redemption marks item redeemed and prevents duplicate print claims.

## P1: NCRI Sale / Attention Earning

Goal: residents can earn Attention by selling or exchanging NCRIs.

Tasks:

- Extend safe trading policy:
  - resident can offer approved NCRIs
  - resident only accepts Attention/Shards or approved item classes
  - no loops, no repeated spam offers
- Add resident behavior hook:
  - if Attention is low and resident owns an NCRI, ask nearby humans or patrons if they want it
  - if goal requires Attention, mention why
- Add price/rules:
  - fixed admin price first
  - later dynamic price based on rarity/story
- Add Library events:
  - `ncri_offered`
  - `ncri_sold`
  - `ncri_redeemed`

Tests / proof:

- Autonomous benchmark: resident with NCRI and low Attention offers it to trusted peer.
- Trade completes and resident Attention increases.
- Unsafe partner or wrong payment is declined.

## P1: Storyteller / City Crier

Goal: a smarter model periodically narrates Null City as public canon, grounded in logs and resident state.

Detailed design and task list: `docs/2026-05-28-storyteller-design.md`.

Tasks:

- Define `StorytellerConfig`:
  - enabled
  - cadence minutes, default 10
  - model profile, default smarter paid/local profile
  - max input events
  - max output length
  - public/private output flags
  - trigger cooldowns
- Build `CityEventDigest`:
  - recent resident timeline moments
  - action summaries
  - deaths/fades/revivals
  - Soul births
  - Attention gifts/decay/low-attention warnings
  - NCRI offers/sales/redemptions
  - quest starts/completions
  - stuck/recovery patterns
  - model/endpoint health
  - notable speech
- Build `StorytellerRunner`:
  - scheduled every N minutes
  - later also event-triggered
  - no direct resident control
  - stores raw digest reference plus generated dispatch
- Define outputs:
  - public dispatch: flavorful, canon, short enough for wall/Embassy
  - operator notes: plain diagnostic summary
  - Library hooks: optional durable moments worth saving
- Grounding rules:
  - no invented quest completions, deaths, items, or patrons
  - every factual claim must be traceable to digest input
  - uncertain things are phrased as uncertainty
  - sensitive handles redacted on public surfaces
- Store dispatches:
  - `data/controller/storyteller/dispatches/*.json`
  - include digest ids, model profile, token/cost estimate, generated text, created timestamp
- Surface latest dispatch:
  - dashboard panel
  - Embassy / public landing
  - wall ticker card
  - optional Library "chronicle" page

Event triggers, after cadence works:

- Soul born
- resident fades/dies
- resident completes goal and is saved
- NCRI minted/sold/redeemed
- major Attention threshold crossed
- quest completed
- multi-resident interaction
- system-wide stuck/failure event

Tests / proof:

- Digest builder summarizes a controlled fixture correctly.
- Storyteller redacts private handles.
- No-events run produces a quiet, honest dispatch.
- Trigger cooldown prevents spam.
- Public dispatch can be generated from a fixture with no hallucinated facts.

Open decisions:

- Final voice: civic chronicle, Dungeon-Crawler-Carl-style announcer, fairy-tale archivist, or faction-colored narrator.
- Whether Storyteller can create Library canon moments automatically or only suggest them.

## P1: Human Surfaces

Goal: make the loop understandable to attendees without explaining the backend.

Tasks:

- Add Soul queue view:
  - proposed Souls
  - funding progress
  - birth threshold
  - top-10 queue
- Add resident Attention view:
  - current Attention
  - decay rate
  - recent gifts/sales/asks
  - low-Attention warning
- Add NCRI view:
  - item
  - owner
  - lore
  - printable status
  - redemption status
- Add saved Library badge:
  - resident has completed goal
  - canonical story available
- Add Storyteller dispatch view:
  - latest city dispatch
  - previous dispatches
  - evidence links for operators

Guardrail:

- Do not build new UI until Dev's MDA framework lands. Capture these as requirements, not immediate implementation.

## P1: Resident Behavior Hooks

Goal: residents act like Attention-driven Souls without becoming puppets.

Tasks:

- Low Attention behavior:
  - resident notices low Attention
  - asks patrons/humans for help
  - prioritizes earning Attention over idle routines
- Goal behavior:
  - resident keeps goal in prompt/context
  - goal progress appears in action logs and Library
  - binary completion is checked after relevant events
- Vice/hindrance behavior:
  - vices/hindrances become prompt constraints and routine modifiers
  - examples: cowardice affects combat, pride affects asking for help, curiosity affects exploration
- NCRI behavior:
  - resident can offer approved NCRI
  - resident can explain why it matters
- Saved behavior:
  - resident reacts to completing goal
  - Library writes saved story

Tests / proof:

- Low Attention resident asks for help within a controlled benchmark.
- Resident with vice behaves differently than twin without vice in a simple test.
- Goal completion transitions resident to saved state.

## P2: Admin And Ops

Goal: admins can run the MVP safely at event scale.

Tasks:

- Admin commands:
  - create/approve Soul proposal
  - grant/revoke Attention
  - adjust decay rate
  - create/approve NCRI
  - grant NCRI to resident
  - mark print redeemed
  - force-save or retire resident if needed
- Ops dashboards/logs:
  - Attention drain rates
  - residents near zero Attention
  - active resident count vs capacity cap
  - Storyteller cost and latest run status
  - NCRI redemption queue
- Safety:
  - cap active residents at 20 by default
  - queue instead of spawning beyond cap
  - admin override requires explicit flag

Tests / proof:

- CLI smoke for admin flows.
- Replay ledger from disk and match displayed balances.
- Capacity guard blocks over-spawn.

## P2: Benchmark And QA Work

Goal: prove the loop works with real residents, not just static docs.

Tasks:

- Soul birth benchmark:
  - fund proposal to threshold
  - birth resident
  - observe first action and Library birth event
- Attention decay benchmark:
  - resident starts with small Attention
  - decays to warning threshold
  - asks for help
  - decays to zero if ignored
- Attention top-up benchmark:
  - patron gives Attention
  - resident survives longer
  - Library records patron gift
- Goal completion benchmark:
  - resident completes simple binary quest
  - saved state is recorded
- NCRI trade benchmark:
  - resident sells NCRI
  - Attention increases
  - item ownership changes
- Storyteller fixture benchmark:
  - given a known event digest
  - generated dispatch includes required facts and no forbidden claims

Metrics:

- time to birth
- time alive
- Attention spent/earned
- quest progress rate
- NCRI sale success/failure
- Storyteller hallucination rate
- human-readable dispatch quality score

## Suggested Build Order

1. **Data contracts first:** SoulProposal, AttentionLedger, GoalContract, NCRI metadata, Storyteller dispatch.
2. **File-backed persistence:** keep the first implementation simple and inspectable.
3. **CLI/admin flows:** prove loop without new UI.
4. **Benchmarks:** birth, decay, goal completion, NCRI trade, Storyteller fixture.
5. **Public/dashboard surfaces:** after Dev's MDA framework lands.
6. **Resident behavior hooks:** low Attention asks, NCRI selling, saved-state reaction.
7. **Event-triggered Storyteller:** after scheduled Storyteller is stable.

## Meeting Questions

1. Is "Shards = Attention" the official terminology, or should the UI show both?
2. What is the default birth threshold for week 1?
3. What is the default Attention decay rate?
4. Does a saved resident keep acting, retire, or become immortal/canonical?
5. What is the first NCRI we want to demonstrate?
6. Who can approve NCRIs at the event?
7. Should Storyteller sound like a civic chronicle, comic announcer, archivist, or something else?
8. Should Storyteller dispatches be editable before public posting, or canon immediately?
9. Which surface leads the participant experience: Embassy, RuneScape client, dashboard, or physical portal?
10. What is the active resident cap we announce publicly: 8 fixed only, 20 total, or "queue opens after the first demo"?
