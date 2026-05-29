# Null City Weekend Sprint Plan — AP/GP Loop + Storyteller

Drafted: 2026-05-29

Status: **Planning draft for the weekend sprint.** This translates Dev's latest gameplay loop, the AP/GP economy, and the locked Storyteller feature into buildable work. Revise after tonight's meeting if Dev's MDA framework changes the shape of the mechanics.

Central tracker:

- Roadmap tasks: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` → **Workstream S**.
- Implementation plan: `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md`.
- This file is the compact human/product brief; agents should update the roadmap task markers as they work.

## Objective

Ship the smallest coherent Null City loop that can survive contact with humans:

1. Humans propose Souls with goals, vices/hindrances, personality, and faction.
2. Humans spend **Attention Points (AP)** to fund birth and sustain residents.
3. Residents lose AP over time and act to earn more AP.
4. **Gold Points (GP)** are actual RuneScape gold coins, used by humans for 3D printers and event utilities.
5. Residents can earn real RuneScape GP and trade GP/items/NCRIs back to humans for AP.
6. Admin-approved NCRIs can be sold, traded, redeemed, and narrated.
7. A smarter-model Storyteller turns evidence from residents, AP, GP, NCRIs, and quests into public canon.

## Guardrails

- AP is a Null City ledger balance. GP is RuneScape game state, likely coin item `995`.
- Do not create a second "Gold Points" ledger.
- Any AP-for-GP exchange needs two linked facts: AP ledger event plus RuneScape trade/inventory evidence.
- Keep UI work paused until Dev's MDA framework explicitly clears it. Prefer CLI, API, persistence, logs, tests, and benchmarks first.
- **No human-facing UI in this repo.** Server work may expose JSON/read-model/control APIs only. Any dashboard, attendee page, wall, Library, inbox, patron, Storyteller feed, HTML/CSS/Svelte/React/JSX/TSX work belongs in `../rs6-nullcity-residents-dashboard`.
- Run `npm run check:no-ui` before finishing any server task that touches HTTP routes, public assets, package scripts, or docs that describe surfaces.
- Use file-backed persistence first unless an existing datastore is already wired.
- Size for **10-30 concurrent residents**, not 400 simultaneous residents.
- Run real resident benchmarks for behavior claims; do not mark a capability complete from unit tests alone.

## P0: Economy Contracts

Define the contracts everyone else can build against.

- `APLedger`: append-only AP balance events for proposals, residents, and humans.
- `EconomyEvent`: AP decay, AP grant, GP observed, GP earned, GP traded, AP-for-GP exchange, NCRI sale, NCRI redemption.
- `SoulProposal`: proposed Soul, funding threshold, status, proposer, goal, vices/hindrances, faction.
- `GoalContract`: binary completion condition and evidence source.
- `NCRI`: admin-approved item metadata bound to a real RuneScape item.
- `StorytellerDispatch`: public narrative plus operator evidence refs.

Done when:

- Contracts are documented and testable.
- AP and GP vocabulary is consistent in docs and prompts.
- Fixtures cover at least one AP decay, one GP earning event, one AP-for-GP trade, one NCRI, and one saved goal.

## P0: AP Life-Force Loop

Residents need AP to live and should understand that fact.

Tasks:

- Implement or finalize AP ledger replay and balance reads.
- Add configurable AP decay with safe minimum tick intervals.
- Add low-AP, zero-AP, and top-up events.
- Teach residents: "AP keeps me alive; I can ask for it; I can earn it by giving humans real value."
- Add benchmark where a low-AP resident asks for support instead of idling.

Evidence needed:

- AP balance changes over time in a replayable ledger.
- Resident fades or pauses at zero AP.
- Resident can receive AP top-up and resume.
- Storyteller can narrate low AP without inventing facts.

## P0: GP As Real RuneScape Gold

GP is not a dashboard number; it is actual in-game gold.

Tasks:

- Identify the canonical RuneScape coin item id and inventory/bank/trade evidence path.
- Add GP observation events from resident state.
- Add starter GP-earning tasks residents can reliably attempt.
- Track GP offered/traded to humans through safe trade evidence.
- Prevent residents from promising GP they do not have.

Evidence needed:

- A resident starts with zero or known GP, performs a starter route, and produces a `gp_earned` event.
- A resident with GP can complete a safe AP-for-GP exchange.
- A resident without GP refuses or redirects rather than hallucinating payment.

## P0: Storyteller MVP

The Storyteller is a locked feature and should become the city's public narrator.

Tasks:

- Build a bounded `CityEventDigest` from resident timelines, AP ledger, GP evidence, NCRIs, quests, and system health.
- Add a dry-run CLI that prints the digest without calling a model.
- Add a model-backed run using a smarter model profile.
- Add verifier rules: no unsupported deaths, births, AP grants, GP trades, NCRIs, or quest completions.
- Persist latest dispatch JSON and public text snapshot.

Evidence needed:

- Fixture digest produces a short public dispatch and operator summary.
- Dispatch correctly distinguishes AP from GP.
- Unsupported claims are rejected or flagged.
- Config supports scheduled runs every ~10 minutes and manual runs for demos.

## P1: Soul Birth + Queue

Humans should collectively choose which Souls get born.

Tasks:

- Add proposal schema and file-backed queue.
- Add AP funding threshold.
- Add admin approve/reject/pause controls.
- Emit `soul_born` when AP threshold is crossed and approved.
- Materialize a resident runtime payload from the proposal.

Evidence needed:

- Two humans fund one proposal, threshold crosses, resident is born.
- Library timeline records birth.
- Resident starts with AP and a binary goal.

## P1: NCRI + Printer Utility

NCRIs connect RuneScape action, human attention, and physical artifacts.

Tasks:

- Add admin NCRI registry.
- Bind NCRI metadata to real RuneScape item ids.
- Add sale/redeem state.
- Record AP earned through NCRI sale.
- Add operator-only printer GP costs until UI is approved.

Evidence needed:

- Admin creates an NCRI definition.
- Resident obtains or is granted the item.
- Human trades AP for the NCRI or related GP/item value.
- Redemption state is recorded and Storyteller can mention it.

## P1: Resident Capability QA

The economy only matters if residents can actually do things.

Focus capabilities:

- Earn GP from a starter route.
- Complete Cook's Assistant or another simple binary quest.
- Fight/flee/survive a low-risk combat encounter.
- Equip or use a basic item.
- Trade safely without loops.
- Remember a useful fact or location.
- Recover from a stuck door/path issue.

Evidence needed:

- Update `docs/resident-capabilities.md` with "can do it" vs "does do it" rows.
- Store benchmark logs with resident id, model profile, endpoint, task, attempts, success, duration, failure cause.
- Use twins/triplets across model profiles where model quality is the open question.

## P2: Human Surfaces After MDA

Do not start these until Dev clears UI direction.

- Soul proposal and AP funding view.
- Human AP and GP summary.
- Printer cost / redemption view.
- NCRI registry and proof view.
- Storyteller public feed.
- Resident detail surface showing goal, AP, GP, NCRIs, model, spark, and recent evidence.

## Weekend Timeline

### Friday Night

- Finalize AP/GP vocabulary and contracts.
- Add Storyteller fixture and dry-run path.
- Add benchmark schema for capability/economy runs.
- Start the standing capability QA sweep from `docs/resident-capabilities.md`; pick weak/unproven rows and prove or fix them with real logs/benchmarks.

### Saturday

- Build AP ledger/decay and resident low-AP behavior.
- Build GP observation and one starter GP-earning benchmark.
- Run model twins on GP earning and one quest workflow.
- Keep one agent on capability QA at all times: natural quest sourcing, door recovery, live trading, normal gear soak, combat survival, memory recall, and GP earning.

### Sunday

- Build AP-for-GP proof path and NCRI registry MVP.
- Run Storyteller on real logs.
- Refresh human docs and capability evidence.
- Prepare a short demo: Soul -> AP birth -> resident earns/trades GP -> Storyteller narrates -> Library saves.

## Friday/Saturday Autonomous Agent Mission Board

This board is the human-readable dispatch layer. The exact packet definitions live in `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md#agent-packet-backlog`.

### How To Claim Work

1. Pick one packet from the next available wave.
2. Check `docs/agent-status.md` for active file locks.
3. Flip the parent roadmap task to `[>]` if no one else has it.
4. Append `STARTING` with packet id, lane, and exact files.
5. Finish, prove, commit, push, and append `HANDOFF`.

### Wave 0: Unblock The Whole Sprint

| Packet | Why it matters | Good first owner |
|---|---|---|
| S0a AP/GP copy scan | Prevents Shards/AP/GP vocabulary drift before code spreads. | docs/ledger agent |
| S10a benchmark report shape | Makes every later behavior claim comparable. | benchmark agent |
| S6a Storyteller digest fixture | Gives the Storyteller lane a model-free, deterministic base. | storyteller agent |
| S11a dashboard contract sketch | Lets dashboard agents prepare without server UI work. | contracts agent |
| CQA0 capability triage | Turns the capabilities doc into a ranked queue of real proof/fix work. | QA agent |

### Wave 1: Build The Two Economies And The Narrator Base

| Packet | Why it matters | Good first owner |
|---|---|---|
| S1a AP ledger replay | AP must be replayable before it can sustain lives. | AP agent |
| S1b low-AP resident proof | Shows residents understand survival pressure. | gameplay QA agent |
| S2a GP inspect | GP must be real RuneScape coins, not an invented balance. | game-state agent |
| S2b GP earning proof | Proves residents can create human-useful value. | benchmark agent |
| S6b Storyteller dry run | Produces a useful digest before paid model calls. | storyteller agent |
| S8a AP/GP resident knowledge | Keeps residents from talking nonsense about the economy. | prompt/knowledge agent |
| CQA1/CQA2 quest sourcing + door recovery | Attacks the biggest gaps in real adventuring. | capability QA agent |

### Wave 2: Close The Gameplay Loop

| Packet | Why it matters | Good first owner |
|---|---|---|
| S3a/S3b AP-for-GP exchange | Connects human support to resident-earned value. | economy integration agent |
| S4a/S4b Soul birth queue | Turns human attention into new residents. | birth/runtime agent |
| S5a/S5b NCRI registry | Gives RuneScape items special Null City meaning. | NCRI agent |
| S9a/S9b saved quest state | Lets completed goals enter the Library as canon. | quest/library agent |
| S10b/S10c model twins | Tests whether paid/smarter models improve actual resident outcomes. | benchmark agent |
| CQA3-CQA8 normal-life proofs | Proves gear, trade, combat survival, memory, and cross-resident awareness outside happy paths. | capability QA agents |

### Wave 3: Sunday Closeout

| Packet | Why it matters | Good first owner |
|---|---|---|
| S7a/S7b model-backed Storyteller | Turns evidence into public canon safely. | storyteller/LLM agent |
| S11b dashboard JSON endpoints | Gives dashboard repo the final data contracts. | API contract agent |
| S12a/S12b human state report | Lets James explain what works, what is proven, and what is blocked. | release/docs agent |
| CQA10/CQA11 one-hour audit + model twins | Gives James a credible answer to "what can residents really do?" | QA/benchmark agent |

### Standing Capability QA Lane

One autonomous agent should continuously work from `docs/resident-capabilities.md`.

Loop:

1. Pick the highest-value row that is unproven, partial, low-confidence, or benchmark-only.
2. Search existing logs/artifacts before writing code.
3. If proof is missing, add or run a benchmark with a disposable resident.
4. If the resident cannot do it, fix the root cause instead of just documenting failure.
5. Update `docs/resident-capabilities.md` with `can do it` vs `does do it live` evidence.
6. Commit and push the benchmark/fix/doc update.

Top capability probes:

- Cook's Assistant from empty inventory with natural egg/flour/milk sourcing.
- Door/path recovery for indoor quest targets.
- Live operator trade proof with inventory deltas and no-loop soak.
- Normal gear equip outside benchmark harnesses.
- Combat survival: fight, eat, flee, avoid death loops.
- Real GP earning and observation of coin item `995`.
- Delayed memory route recall.
- Cross-resident world-event reaction.
- AP/GP-aware resident asks and exchange offers.
- One-hour multi-resident normal-life audit.

### Parallel Safety Rules

- Do not run two live controllers against the same data directory unless the task explicitly uses isolated benchmark dirs.
- Do not mix capacity benchmarks with intelligence benchmarks; report them as separate evidence.
- Do not call paid models from cron or unattended loops without a named model profile, cap, and artifact path.
- Do not update `docs/resident-capabilities.md` from hope. Use benchmark ids, live logs, tests, or explicit "not proven" notes.
- Do not build human-facing UI in this repo. Dashboard work belongs in `../rs6-nullcity-residents-dashboard`.

## Meeting Decisions Needed

1. Is "AP" the public term, or should public UI always spell out "Attention Points"?
2. What is the week-one Soul birth AP threshold?
3. What is the default AP decay rate?
4. Should AP-for-GP use a reference exchange rate, auction/voting, or admin pricing first?
5. What is the first GP-earning activity residents should optimize?
6. What are the first 3D-printer GP costs?
7. What are the first 3 NCRIs?
8. What happens to a saved resident: retire, immortalize, or continue without decay?
9. What is the Storyteller's name and how spicy can the tone be?
10. Which surfaces are allowed before the MDA framework lands?

## Reference Docs

- Product loop and task breakdown: `docs/2026-05-28-attention-loop-and-storyteller-tasks.md`
- Storyteller design: `docs/2026-05-28-storyteller-design.md`
- Current capability evidence: `docs/resident-capabilities.md`
- Human project guide: `HUMANS.md`
- Meeting decisions: `docs/2026-05-26-meeting-decisions.md`
