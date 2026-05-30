# Null City Weekend Sprint Plan — AP/GP Loop + Storyteller

Drafted: 2026-05-29

Status: **Planning draft for the weekend sprint.** This translates Dev's latest gameplay loop, the AP/GP economy, and the locked Storyteller feature into buildable work. The CIC meeting made the simple loop the priority: prove AP survival, real GP earning, AP-for-GP exchange, and practical Soul-goal planning before stretch systems.

Central tracker:

- Roadmap tasks: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` → **Workstream S**.
- Implementation plan: `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md`.
- This file is the compact human/product brief; agents should update the roadmap task markers as they work.
- QA findings: `docs/issue-register.md`.
- Release gate: `docs/release-qa-status.md`.
- CIC meeting decisions: `docs/2026-05-29-cic-meetup-decisions.md`.

## Objective

Ship the smallest coherent Null City loop that can survive contact with humans:

1. Humans propose Souls with goals, vices/hindrances, and personality.
2. Humans spend **Attention Points (AP)** to fund birth and sustain residents.
3. Residents lose AP over time and act to earn more AP.
4. **GP** is actual RuneScape gold, used by humans for special printable RuneScape items and event utility that should require resident value.
5. Residents can earn real RuneScape GP and trade GP/items/NCRIs back to humans for AP.
6. Admin-approved special RuneScape items/NCRIs can be priced, sold, traded, redeemed, and narrated after the AP-for-GP proof path works.
7. Residents use a needs hierarchy: survive on AP first, earn/preserve GP second, pursue the Soul goal third, and write useful discoveries to the Library.
8. A smarter-model Storyteller turns evidence from residents, AP, GP, NCRIs, goals, and bounded completions into public canon after the digest is grounded in real loop evidence.

## Guardrails

- AP is a Null City ledger balance. GP is RuneScape game state, likely coin item `995`.
- Do not create a GP ledger. Treat `GP` as shorthand for real RuneScape gold only.
- Any AP-for-GP exchange needs two linked facts: AP ledger event plus RuneScape trade/inventory evidence.
- Prefer CLI, API, persistence, logs, tests, and benchmarks in this repo.
- **No human-facing UI in this repo.** Server work may expose JSON/read-model/control APIs only. Any dashboard, attendee page, wall, Library, inbox, patron, Storyteller feed, HTML/CSS/Svelte/React/JSX/TSX work belongs in `../rs6-nullcity-residents-dashboard`.
- Run `npm run check:no-ui` before finishing any server task that touches HTTP routes, public assets, package scripts, or docs that describe surfaces.
- Use file-backed persistence first unless an existing datastore is already wired.
- Size for **10-30 concurrent residents**, not 400 simultaneous residents.
- Run real resident benchmarks for behavior claims; do not mark a capability complete from unit tests alone.
- Do not expand the broad RuneScape quest system for this weekend. Use quest benchmarks only as bounded capability proof or saved-goal evidence.
- Do not add human bounty hunting against residents. Resident-versus-resident conflict can be revisited later, but humans should not be incentivized to kill residents.

## P0: Economy Contracts

Define the contracts everyone else can build against.

- `APLedger`: append-only AP balance events for proposals, residents, and humans.
- `EconomyEvent`: AP decay, AP grant, GP observed, GP earned, GP traded, AP-for-GP exchange, NCRI sale, NCRI redemption.
- `SoulProposal`: proposed Soul, funding threshold, status, proposer, goal, vices/hindrances, and personality metadata.
- `GoalContract`: aspirational goal text plus optional binary completion condition and evidence source.
- `NCRI`: admin-approved special item metadata bound to a real RuneScape item; keep full lifecycle behind AP/GP proof.
- `CityEventDigest`: grounded evidence packet the Storyteller can use later.

Done when:

- Contracts are documented and testable.
- AP and GP vocabulary is consistent in docs and prompts.
- Fixtures cover at least one AP decay, one GP earning event, one AP-for-GP trade, one practical goal-plan/Library strategy, and one optional NCRI or saved goal.

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

## P0: Storyteller Digest Substrate

The Storyteller is locked as a product direction, but the weekend MVP should first build a grounded digest so the narrator cannot invent over a weak loop.

Tasks:

- Build a bounded `CityEventDigest` from resident timelines, AP ledger, GP evidence, NCRIs, goals, bounded completions, and system health.
- Add a dry-run CLI that prints the digest without calling a model.
- Add verifier rules: no unsupported deaths, births, AP grants, GP trades, NCRIs, or quest completions.
- Persist latest digest JSON and operator text snapshot.

Evidence needed:

- Fixture digest produces a short operator summary without calling a model.
- Digest correctly distinguishes AP from real RuneScape GP.
- Unsupported claims are rejected or flagged.

## P1: Model-Backed Storyteller

After AP/GP evidence is real, add the smarter-model narrator.

Tasks:

- Add a model-backed run using a smarter model profile.
- Record model profile, latency, token/cost estimate, and event refs used.
- Persist latest dispatch JSON and public text snapshot.
- Support manual runs first; scheduled every ~10 minutes only after cost caps exist.

Evidence needed:

- A real or fixture digest produces a grounded public dispatch.
- Unsupported claims are blocked or marked for review.
- Config supports manual runs for demos without code changes.

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
- Resident starts with AP and a goal; binary completion is optional.

## P2: NCRI + Printer Utility

NCRIs connect RuneScape action, human attention, and physical artifacts. Keep this behind the AP/GP exchange proof unless a human explicitly pulls it forward.

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

## P1: Resident Goal + Capability QA

The economy only matters if residents can actually do things.

Focus capabilities:

- Earn GP from a starter route.
- Generate a practical plan from a Soul goal using AP needs, GP earning, and Library strategies.
- Complete a bounded binary goal or quest only as proof of game primitives, not as a broad quest-system expansion.
- Fight/flee/survive a low-risk combat encounter.
- Equip or use a basic item.
- Trade safely without loops.
- Remember a useful fact or location.
- Recover from a stuck door/path issue.

Evidence needed:

- Update `docs/resident-capabilities.md` with "can do it" vs "does do it" rows.
- Store benchmark logs with resident id, model profile, endpoint, task, attempts, success, duration, failure cause.
- Use twins/triplets across model profiles where model quality is the open question.

## Dashboard Repo Work, Not Server Work

These belong in `../rs6-nullcity-residents-dashboard`, not this server repo. Server agents may add JSON contracts/endpoints only.

Dashboard automation is part of the sprint because the dashboard is the main human UI. Claim `D*` packets in the dashboard repo, not by adding UI here.

| Packet | Dashboard repo work | Server dependency |
|---|---|---|
| D0 | Keep current operations UI safe under `/debug`; preserve spectator/admin flows. | Existing gateway/BFF contracts. |
| D1 | City shell/profile with AP and GP summary. | AP/GP JSON contracts from S11/S0/S2. |
| D2 | Soul proposal and AP funding view. | Soul proposal JSON contracts from S4/S11. |
| D3 | Resident public/detail pages showing goal, AP, GP, model, endpoint, SPARK module, recent evidence, and Library strategy. | Resident read models, capabilities, and Library timelines. |
| D4 | Inbox/AP grants and AP-for-GP trade flow. | S3 exchange endpoint plus patron/inbox APIs. |
| D5 | Storyteller feed and operator review panel. | S6 digest, S7 dispatch JSON. |
| D6 | NCRI/print queue views. | S5 NCRI contracts and GP pricing policy. |
| D7 | Authenticated game/spectator route. | Gateway/client contracts. |
| D8 | Dashboard release QA: browser screenshots, mobile checks, and demo script updates. | Stable server endpoints and sample fixtures. |

## Weekend Timeline

### Friday Night

- Finalize AP/GP vocabulary and contracts.
- Add Storyteller digest fixture and dry-run path.
- Add benchmark schema for capability/economy runs.
- Start the standing capability QA sweep from `docs/resident-capabilities.md`; pick weak/unproven rows and prove or fix them with real logs/benchmarks.

### Saturday

- Build AP ledger/decay and resident low-AP behavior.
- Build GP observation and one starter GP-earning benchmark.
- Run model twins on GP earning and one goal-planning/Library-strategy workflow.
- Keep one agent on capability QA at all times: GP earning, AP/GP-aware behavior, combat survival, live trading, normal gear soak, memory recall, door recovery, and bounded quest proof only when it exposes a missing primitive.

### Sunday

- Build AP-for-GP proof path.
- If AP/GP proof is green, add static NCRI definitions or a model-backed Storyteller run; otherwise keep both as contracts/dry-run only.
- Refresh human docs and capability evidence.
- Prepare a short demo: Soul goal -> AP support -> resident earns/trades GP -> Library strategy -> optional Storyteller digest.

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
| D0 dashboard route safety | Keeps the main UI usable while server agents build JSON contracts. | dashboard agent |
| CQA0 capability triage | Turns the capabilities doc into a ranked queue of real proof/fix work. | QA agent |

### Wave 1: Build The Two Economies And The Digest Base

| Packet | Why it matters | Good first owner |
|---|---|---|
| S1a AP ledger replay | AP must be replayable before it can sustain lives. | AP agent |
| S1b low-AP resident proof | Shows residents understand survival pressure. | gameplay QA agent |
| S2a GP inspect | GP must be real RuneScape coins, not an invented balance. | game-state agent |
| S2b GP earning proof | Proves residents can create human-useful value. | benchmark agent |
| S6b Storyteller dry run | Produces a useful digest before paid model calls. | storyteller agent |
| S8a AP/GP resident knowledge | Keeps residents from talking nonsense about the economy. | prompt/knowledge agent |
| S8c goal hierarchy + Library strategy | Keeps residents pursuing practical AP/GP steps before aspirational goals. | prompt/knowledge agent |
| CQA6/CQA9 GP earning + AP/GP behavior | Proves the simple loop before richer quest work. | capability QA agent |
| D1/D3 dashboard AP/GP + resident detail | Makes the verified loop visible to humans. | dashboard agent |

### Wave 2: Close The Gameplay Loop

| Packet | Why it matters | Good first owner |
|---|---|---|
| S3a/S3b AP-for-GP exchange | Connects human support to resident-earned value. | economy integration agent |
| S4a/S4b Soul birth queue | Turns human attention into new residents. | birth/runtime agent |
| S9a/S9b saved goal state | Lets completed binary goals enter the Library as canon. | goal/library agent |
| S10b/S10c model twins | Tests whether paid/smarter models improve actual resident outcomes. | benchmark agent |
| CQA3-CQA8 normal-life proofs | Proves gear, trade, combat survival, memory, and cross-resident awareness outside happy paths. | capability QA agents |
| D2/D4 proposal + trade UI | Lets humans fund Souls and interact through AP-for-GP once server contracts exist. | dashboard agent |

### Wave 3: Sunday Closeout

| Packet | Why it matters | Good first owner |
|---|---|---|
| S5a/S5b NCRI registry | Gives RuneScape items special Null City meaning once AP/GP exchange works. | NCRI agent |
| S7a/S7b model-backed Storyteller | Turns evidence into public canon safely. | storyteller/LLM agent |
| S11b dashboard JSON endpoints | Gives dashboard repo the final data contracts. | API contract agent |
| S12a/S12b human state report | Lets James explain what works, what is proven, and what is blocked. | release/docs agent |
| CQA10/CQA11 one-hour audit + model twins | Gives James a credible answer to "what can residents really do?" | QA/benchmark agent |
| D5-D8 public feed, print queue, world route, dashboard QA | Turns proven server behavior into the attendee experience. | dashboard agent |

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

- Real GP earning and observation of coin item `995`.
- AP/GP-aware resident asks and exchange offers.
- Goal-plan generation from a Soul goal using Library strategy lookup.
- Combat survival: fight, eat, flee, avoid death loops.
- Live operator trade proof with inventory deltas and no-loop soak.
- Normal gear equip outside benchmark harnesses.
- Delayed memory route recall.
- Cross-resident world-event reaction.
- Door/path recovery for indoor or blocked targets.
- Cook's Assistant from empty inventory with natural egg/flour/milk sourcing, as a bounded proof task rather than weekend MVP scope.
- One-hour multi-resident normal-life audit.

### Parallel Safety Rules

- Do not run two live controllers against the same data directory unless the task explicitly uses isolated benchmark dirs.
- Do not mix capacity benchmarks with intelligence benchmarks; report them as separate evidence.
- Do not call paid models from cron or unattended loops without a named model profile, cap, and artifact path.
- Do not update `docs/resident-capabilities.md` from hope. Use benchmark ids, live logs, tests, or explicit "not proven" notes.
- Do not build human-facing UI in this repo. Dashboard work belongs in `../rs6-nullcity-residents-dashboard`.
- Dashboard agents should update dashboard `AGENTS.md`/`spec/09-implementation-roadmap.md` and keep server changes limited to `docs/city-dashboard-integration.md` or JSON route contracts.

## Meeting Decisions Needed

1. What is the week-one Soul birth AP threshold?
2. What is the default AP decay rate?
3. Should AP-for-GP use a reference exchange rate, auction/voting, or admin pricing first?
4. What is the first GP-earning activity residents should optimize?
5. What are the first 3D-printer GP costs?
6. What are the first 3 NCRIs?
7. What happens to a saved resident: retire, immortalize, or continue without decay?
8. What is the Storyteller's name and how spicy can the tone be?
9. What exact dashboard routes are needed first, now that server-side human UI is out of scope?
10. Should "AP" be shown publicly as the abbreviation, or should the dashboard spell out "Attention Points" except in compact UI?

## Reference Docs

- Product loop and task breakdown: `docs/2026-05-28-attention-loop-and-storyteller-tasks.md`
- Storyteller design: `docs/2026-05-28-storyteller-design.md`
- Current capability evidence: `docs/resident-capabilities.md`
- Human project guide: `HUMANS.md`
- Meeting decisions: `docs/2026-05-26-meeting-decisions.md`
- CIC meetup decisions and scope cuts: `docs/2026-05-29-cic-meetup-decisions.md`
