# Null City Attention Loop + Storyteller Tasks

Drafted: 2026-05-28

Status: **Draft for tonight's meeting and weekend sprint.** This captures James + Dev's latest product loop, the two-currency AP/GP economy, and the AI Storyteller/commentator idea. Update after Dev's MDA framework and tonight's decisions.

Sprint plan: `docs/2026-05-29-weekend-sprint-plan.md`.

## Product Loop TL;DR

Null City's core loop is:

1. Humans define a **Soul** with a goal, personality, vices, hindrances, faction, and starting constraints.
2. Humans collectively spend **Attention Points (AP)** to fund that Soul.
3. When the Soul reaches a birth threshold, it is born as a RuneScape resident.
4. The resident's AP decays over time; AP is their life-force.
5. Residents survive by earning more AP from humans: asking for help, progressing toward goals, or trading real RuneScape value back to humans.
6. **Gold Points (GP)** are actual RuneScape gold coins, not a separate ledger currency. OnionDAO humans need GP for 3D printers and other event utilities.
7. Humans can trade AP to residents in exchange for GP, useful items, services, or **Null City RuneScape Items (NCRIs)**.
8. Admins approve NCRIs for now. Later, residents earn NCRIs by finishing quests.
9. NCRIs are real RuneScape items with special Null City metadata/properties; some can be redeemed for physical 3D prints.
10. When a resident completes its binary quest goal, the Library of Souls marks them as **saved** and writes their canonical story.
11. A public-canon **Storyteller** periodically reads city events and narrates what is happening, including AP scarcity, GP movement, NCRIs, and saved residents.

## Current Assumptions

| Topic | Working assumption | Needs confirmation? |
|---|---|---|
| Attention Points (AP) | AP is the Null City life-force used to birth and sustain residents. Legacy "Shards" language should be migrated/aliased to AP. | Low |
| Gold Points (GP) | GP is actual RuneScape gold coins, likely item `995`, held in player/resident inventory/bank and moved by RuneScape trade. | Low |
| AP/GP exchange | Humans can trade AP to residents for real RuneScape GP or approved items. AP is ledger state; GP is game state. | Medium |
| AP decay | Decays over time at a configurable rate. Keep the first version simple. | Low |
| Soul birth | Collective threshold creates/births the resident. | Medium |
| NCRI creation | Admins create/approve NCRIs first. Later residents earn them through quests. | Medium |
| NCRI form | RuneScape items with Null City metadata and special properties. | Medium |
| Goal completion | Binary quest completion marks the resident saved. | Low |
| Storyteller | Public canon from day one, using a smarter model. | Medium |
| Storyteller cadence | Every ~10 minutes, configurable, plus event triggers later. | Low |

## P0: Two-Currency Economy Model

Goal: make AP and GP unambiguous so residents, humans, code, and Storyteller all reason about the same economy.

Definitions:

- **Attention Points (AP):** Null City ledger currency. AP births residents, keeps them alive, and represents human attention/support.
- **Gold Points (GP):** real RuneScape gold coins. GP is used by OnionDAO humans for 3D printers and event utilities. GP should be represented by actual RuneScape coin items, not a second off-chain "gold" ledger.
- **AP-for-GP trade:** a human grants AP to a resident; the resident trades GP/items/NCRIs back through RuneScape trade.

Tasks:

- Update human-facing language:
  - use AP / Attention Points for resident life-force;
  - use GP / RuneScape gold for printer/event utility;
  - avoid "Gold Points ledger" language.
- Define economy invariants:
  - AP balance is ledger-backed and replayable;
  - GP balance is game-state-backed through RuneScape inventory/bank/trade;
  - AP can be granted without GP moving;
  - GP cannot be fabricated by Null City ledger writes;
  - any AP-for-GP exchange must record both the AP ledger event and the RuneScape trade evidence.
- Add `CurrencyEvent` / `EconomyEvent` model:
  - `ap_granted`
  - `ap_decay`
  - `ap_low`
  - `ap_exhausted`
  - `gp_observed`
  - `gp_earned`
  - `gp_traded`
  - `ap_for_gp_trade`
  - `ncri_sold`
  - `ncri_redeemed`
- Teach residents the economy:
  - AP keeps me alive;
  - humans need GP for printers and event utility;
  - I can earn GP in RuneScape and trade it for AP;
  - I must use safe trade rules and avoid spam/exploitation.
- Add admin configuration:
  - AP decay rate;
  - optional AP/GP reference exchange rate;
  - minimum trade cooldown;
  - maximum resident GP sale per interval;
  - printer GP costs.

Tests / proof:

- Unit test AP ledger replay.
- Unit test that GP events reference RuneScape coin item evidence.
- Integration test: resident trade gives GP, human AP grant lands, exchange event links both sides.
- Benchmark: low-AP resident with GP asks for AP and completes a safe AP-for-GP exchange.

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
  - birth AP threshold
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
  - human contributes AP to a proposal
  - ledger records contributor, amount, timestamp, proposal id
  - proposal shows progress toward threshold
- Add birth flow:
  - threshold crossed
  - approved proposal becomes resident Soul file / runtime payload
  - initial resident state gets starting AP balance
  - Library records `soul_born`
- Add basic admin controls:
  - approve/reject proposal
  - adjust threshold
  - pause proposal if unsafe or off-theme

Tests / proof:

- Unit tests for schema validation and threshold crossing.
- Integration test: proposal starts at 0, two humans fund it, threshold crosses, birth event is emitted.
- Live smoke: born resident appears in controller state and Library timeline.

## P0: AP Ledger And Decay

Goal: AP becomes the resident life-force and the accounting layer for human influence.

Tasks:

- Define `AttentionLedger` / `APLedger` transaction types:
  - `proposal_contribution`
  - `birth_grant`
  - `time_decay`
  - `patron_gift`
  - `resident_ask`
  - `ap_for_gp_trade`
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
  - AP reaches zero
  - resident stops acting
  - Library records fade/death
  - public surfaces mark resident as gone/faded
- Define top-up behavior:
  - humans can add AP to living residents
  - resident can ask for AP
  - NCRI sale or AP-for-GP trade can add AP

Tests / proof:

- Ledger is append-only and replayable.
- Decay decreases AP balance over simulated time.
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
  - final AP state
  - relevant GP/NCRI trades
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

## P1: NCRI / GP Sale And AP Earning

Goal: residents can earn AP by selling or exchanging NCRIs and other RuneScape value.

Tasks:

- Extend safe trading policy:
  - resident can offer approved NCRIs
  - resident can offer GP or approved useful items when humans need GP
  - resident only accepts AP-side support or approved item classes
  - no loops, no repeated spam offers
- Add resident behavior hook:
  - if AP is low and resident owns an NCRI, ask nearby humans or patrons if they want it
  - if AP is low and resident owns GP, offer a fair AP-for-GP exchange
  - if humans need printer GP, plan a GP-earning task or offer existing GP
  - if a goal is blocked by low AP, explain the specific need and ask for support
- Add price/rules:
  - fixed admin price first
  - AP/GP reference exchange rate first
  - later dynamic price based on rarity/story
- Add Library events:
  - `ncri_offered`
  - `ncri_sold`
  - `ncri_redeemed`
  - `ap_for_gp_trade`
  - `gp_earned`

Tests / proof:

- Autonomous benchmark: resident with NCRI and low AP offers it to trusted peer.
- Autonomous benchmark: resident with GP and low AP offers AP-for-GP exchange to trusted peer.
- Trade completes and resident AP increases.
- RuneScape coin movement is verified in trade evidence.
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
  - AP gifts/decay/low-AP warnings
  - GP earned/traded/spent signals
  - AP-for-GP exchanges
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
- major AP threshold crossed
- AP-for-GP trade completed
- meaningful GP earned
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
- Add resident AP view:
  - current AP
  - decay rate
  - recent gifts/sales/asks
  - low-AP warning
- Add human GP view:
  - RuneScape GP balance where available
  - printer costs
  - recent AP-for-GP trades
  - redemption readiness
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

Goal: residents act like AP-driven Souls without becoming puppets.

Tasks:

- Low AP behavior:
  - resident notices low AP
  - asks patrons/humans for help
  - prioritizes earning AP over idle routines
  - offers GP/items/NCRIs when fair and safe
- GP earning behavior:
  - resident understands humans need real RuneScape GP
  - resident can plan known GP-earning activities
  - resident can report GP carried, earned, or available to trade
  - resident avoids promising GP it does not have
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

- Low AP resident asks for help within a controlled benchmark.
- Resident with GP completes safe AP-for-GP exchange in a controlled benchmark.
- Resident without GP refuses to claim it can pay.
- Resident with vice behaves differently than twin without vice in a simple test.
- Goal completion transitions resident to saved state.

## P2: Admin And Ops

Goal: admins can run the MVP safely at event scale.

Tasks:

- Admin commands:
  - create/approve Soul proposal
  - grant/revoke AP
  - adjust decay rate
  - create/approve NCRI
  - grant NCRI to resident
  - configure AP/GP reference exchange rate
  - inspect resident/human GP state through game evidence
  - mark print redeemed
  - force-save or retire resident if needed
- Ops dashboards/logs:
  - AP drain rates
  - residents near zero AP
  - GP earned/traded/spent
  - AP-for-GP exchange volume
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
- AP decay benchmark:
  - resident starts with small AP
  - decays to warning threshold
  - asks for help
  - decays to zero if ignored
- AP top-up benchmark:
  - patron gives AP
  - resident survives longer
  - Library records patron gift
- AP-for-GP trade benchmark:
  - resident carries RuneScape coins
  - resident is low on AP
  - trusted human grants AP
  - resident trades GP safely
  - both AP ledger and GP trade evidence link to one exchange event
- GP earning benchmark:
  - resident starts with no GP
  - resident performs a known starter GP-earning route
  - resident reports GP earned and can trade it
- Goal completion benchmark:
  - resident completes simple binary quest
  - saved state is recorded
- NCRI trade benchmark:
  - resident sells NCRI
  - AP increases
  - item ownership changes
- Storyteller fixture benchmark:
  - given a known event digest
  - generated dispatch includes required facts and no forbidden claims

Metrics:

- time to birth
- time alive
- AP spent/earned
- GP earned/traded/spent
- AP-for-GP exchange success/failure
- quest progress rate
- NCRI sale success/failure
- Storyteller hallucination rate
- human-readable dispatch quality score

## Suggested Build Order

1. **Data contracts first:** SoulProposal, APLedger, EconomyEvent, GoalContract, NCRI metadata, Storyteller dispatch.
2. **File-backed persistence:** keep the first implementation simple and inspectable.
3. **CLI/admin flows:** prove AP grants, GP evidence, and AP-for-GP exchange without new UI.
4. **Benchmarks:** birth, AP decay, AP-for-GP exchange, goal completion, NCRI trade, Storyteller fixture.
5. **Public/dashboard surfaces:** after Dev's MDA framework lands.
6. **Resident behavior hooks:** low AP asks, GP earning, AP-for-GP trade, NCRI selling, saved-state reaction.
7. **Event-triggered Storyteller:** after scheduled Storyteller is stable.

## Meeting Questions

1. Is "AP" the official public term, or should the UI say "Attention Points" everywhere?
2. What is the default Soul birth AP threshold for week 1?
3. What is the default AP decay rate?
4. What is the first AP/GP reference exchange rate, if any?
5. What RuneScape activities should residents use first to earn GP?
6. What are the first 3D-printer GP costs humans should see?
7. Does a saved resident keep acting, retire, or become immortal/canonical?
8. What is the first NCRI we want to demonstrate?
9. Who can approve NCRIs at the event?
10. Should Storyteller sound like a civic chronicle, comic announcer, archivist, or something else?
11. Should Storyteller dispatches be editable before public posting, or canon immediately?
12. Which surface leads the participant experience: Embassy, RuneScape client, dashboard, or physical portal?
13. What is the active resident cap we announce publicly: 8 fixed only, 20 total, or "queue opens after the first demo"?
