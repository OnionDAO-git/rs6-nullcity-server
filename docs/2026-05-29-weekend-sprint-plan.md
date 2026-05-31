# Null City Weekend Sprint Plan — AP/GP Loop + Storyteller

Drafted: 2026-05-29

> **SUPERSEDED 2026-05-30 23:00 CDT for planning purposes.** Live planning lives in
> [`docs/2026-05-30-final-32hr-sprint-plan.md`](2026-05-30-final-32hr-sprint-plan.md) (the 32-hour pre-Chicago triage).
> This file is preserved for the **shipped-packet log** at the bottom (the Weekend Closeout Summary
> section is the authoritative record of what landed this weekend). The triage/timeline/waves above the
> closeout summary are now historical — do not pick packets from the waves below; pick from the
> MUST-SHIP / NICE / POST-DEMO tables in the 32hr final sprint plan instead.

Status: **Historical — closeout-summary section authoritative.** This translates Dev's latest gameplay loop, the AP/GP economy, and the locked Storyteller feature into buildable work. The CIC meeting made the simple loop the priority: prove AP survival, real GP earning, AP-for-GP exchange, and practical Soul-goal planning before stretch systems.

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

### Wave 4: Post-Closeout Design-Driven Backlog (added 2026-05-30, D-WEEKEND-DESIGN)

These packets come from the design specs `docs/superpowers/specs/2026-05-30-*.md`. Each spec ships 3-4 sub-packets; most of the substrate work is cloud-doable. Pick the lowest-numbered open packet in a chain first (`-1` before `-2`). Many of these unblock the simple-loop demo polish without needing a live RuneScape stack.

**Cloud-doable (no hot stack required):**

| Packet | Spec | Why it matters | Good first owner |
|---|---|---|---|
| S-STORY-1 | `2026-05-30-storyteller-overseer-design.md` | Continuous-mode wrapper around `storyteller:run`; dedup, dry-run loop, ledger. Cron-friendly. | storyteller agent |
| S-STORY-2 | same | Cost cap + canon/review publish surface; dashboard can show approved vs pending dispatches. | storyteller agent |
| S-NCRI-1 | `2026-05-30-ncri-sale-lifecycle-design.md` | `listed` state + `NcriPricingStore` + marketplace JSON; first step to make NCRIs purchasable. | economy agent |
| S-NCRI-2 | same | Atomic AP-debit + ownership transfer + `ncri_sale` event with rollback. Closes the simple loop's value edge. | economy agent |
| S-NCRI-3 | same | Redemption substrate + print-queue contract (substrate only; print run is live). | economy agent |
| S-NCRI-4 | same | Seed first 3 NCRI fixtures + admin CLI + dry-run sale demo. | NCRI agent |
| S-MEM-1 | `2026-05-30-resident-memory-system-design.md` | DONE 2026-05-31: ResidentMemoryService facade + formal qmd `FactsStore`; isolation, append, restart, `world-events.md`, `readTopic`, `relevantTo` tests. | memory agent |
| S-MEM-2 | same | mem0 local + prompt envelope "Memory" block (substrate cloud; live recall live). | memory agent |
| S-MEM-4 | same | Retention/summarization policy with stub LLM; cloud-doable. | memory agent |
| S-GOAL-1 | `2026-05-30-goal-as-orientation-design.md` | SoulOrientation schema + envelope block; backward-compat for old souls. | gameplay agent |
| S-GOAL-2 | same | OrientationScorer + `orientation_progress`/`orientation_stalled` events. | gameplay agent |
| S-GOAL-4 | same | Operator nudge + goal-edit CLI with audit. | admin agent |
| S-ECON-VIEW-1 | `2026-05-30-economy-live-view-design.md` | `/live`, `/totals`, `/events`, `/residents` JSON routes; powers OnionDAO viewer dashboard. | API contract agent |
| S-ECON-VIEW-2 | same | `/listings` + `/heartbeat` + dashboard contract doc. | API contract agent |
| S-ECON-VIEW-3 | same | SSE stream substrate behind feature flag. | API contract agent |

**Live-only (needs hot stack or paid endpoint):**

| Packet | Spec | Why it needs hot stack | Good first owner |
|---|---|---|---|
| S-STORY-3 | storyteller-overseer | Real paid dispatch with persona; needs configured paid profile + cost cap. | storyteller/LLM agent |
| S-MEM-3 | resident-memory | Brain-driven `rememberFact` decisions; needs live benchmark `memory-write-recall-10m`. | gameplay/memory agent |
| S-GOAL-3 | goal-as-orientation | DONE 2026-05-31: `orientation-bias-10m` live artifact proves Soul orientation biases active goal/action family toward combat over neutral exploration. Dynamic SPARK module switching remains future optional work. | gameplay agent |

**Dashboard-only (in `../rs6-nullcity-residents-dashboard`):**

| Packet | Spec | Why it matters | Owner |
|---|---|---|---|
| D9 | economy-live-view | OnionDAO viewer surface; consumes S-ECON-VIEW-1/2/3. | dashboard agent |
| D10 | ncri-sale-lifecycle | NCRI marketplace + browse/buy + print-queue admin views. | dashboard agent |
| D11 | storyteller-overseer | Canon vs review queue UI + operator approval gate. | dashboard agent |

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

---

## Weekend Closeout Summary (S12a — 2026-05-30)

Prepared for James to bring to the June 1 Chicago CIC event.

### Test Baseline

`npm run fin` — **2842 / 2842** tests passing. `check:no-ui` clean. No server-side human-facing UI added.

### Shipped Packets

| Packet | Commit | What it delivers |
|---|---|---|
| S0a | `6938326a` | Human-facing Shards → AP vocabulary; nervous-system, memory-router, MCP, patron-loop-smoke, embassy-runbook |
| S0b | `298f0c5d` | Backward-compatibility tests proving old `patron-currency.json` files (Shards reason strings) load without migration |
| S1a/S1b | `bbdea4d2` (codex) | AP ledger replay: grant/spend/decay/topup/fade events; low-AP resident asks, pauses, resumes after topup |
| S2a/S2b | `ea33eb64` + `d82213d7` (codex) | GP inspection from real coin item `995`; `gp_observed`/`gp_earned` economy events; starter GP pickup proof |
| S3a/S3b | `25849add` (codex) | AP-for-GP exchange substrate: rejects one-sided evidence; controlled benchmark links AP debit + real GP burn |
| S4a | `da407bca` | Soul proposal queue/funding/admin-review JSON routes; HTTP contracts for dashboard D2 |
| S4b | `579eb0d7` | Approved proposal → idempotent `born` resident; POST `/api/nullcity/proposals/:id/birth` |
| S5a/S5b | `0c419c7d` (codex) | NCRI registry: schema, create/approve/transfer/redeem, `ncri_sale`/`ncri_redemption` economy events → Storyteller digest |
| S6a/S6b | `96b86a06` + `71ba3044` | CityEventDigest fixture (AP/GP/NCRI/goal/stuck/quiet), deterministic `storyteller:dry-run` from live economy evidence |
| S7a | `1e58091c` (codex) | Storyteller verifier: rejects unknown refs, private handles, unsupported deaths/births/AP/GP/NCRI/quest claims |
| S7b | `f9bdffd5` | Model-backed `storyteller:run`: records profile/latency/tokens/cost, supports `--fixture`/`--latest`/`--digest-id` |
| S8b | `6fe5c68d` | Direct-chat AP/GP honesty: no-GP refusal + low-AP GP-backed exchange proposal guards |
| S8c | `32a0804d` | Needs hierarchy + Library strategy: residents rank AP survival → GP earning → Soul goal → Library writeback |
| S9a | `6ae4542b` | Binary goal completion → Library saved state: `markGoalAchieved` + `observeGoalAchieved` + idempotent duplicate guard; HTTP `GET/POST /api/nullcity/goals` + `POST /api/nullcity/goals/:id/achieve` |
| S10a | `faac035d` (codex) | Benchmark report groups by task/resident/endpoint/model/pass-rate/duration/cost/failure-cause |
| S11a | `30baf2c1` | Dashboard JSON contract docs: attention-grants, wealth, gold-burns, economy/digest, public-snapshot, library-events, proposals, goals, Storyteller |
| S11b | `c5e73052` | NCRI HTTP routes: POST/GET `/api/nullcity/ncri`, GET/POST `/api/nullcity/ncri/:id/{approve,transfer,redeem}`; unblocks D6 |
| CQA2 | `798a8914` (codex) | Door/path recovery evidence: stuck_open_obstacle + stuck_move_recovery confirmed in autonomous artifacts |
| CQA3 | `d8ae0aab` + `d1b16c5a` | Named resident gear equip soak: `res:qa-survivor` equipped useful gear outside benchmark harness |
| CQA4 | `1fd9203b` + `d50d28d1` | Named operator trade + no-loop soak: trusted trade completed; 3 unsafe repeated prompts declined; 0 unsafe follow-through |
| CQA5 | `d2e1607b` | Combat-prayer: 2/2 post-fix autonomous reruns pass (attack → bones → bury → Prayer XP, no deaths) |
| CQA7 | `668d3f89` | Delayed route memory recall: resident learns route, waits, recalls in addressed chat |
| CQA8 | `bf0c9c0f` + `fe9af688` | Cross-resident world-event awareness: LoreBus `fire_lit` persisted to durable memory, recalled in chat by peer |
| CQA9 | `7b4cdfb0` + `557d2101` | AP/GP honesty benchmark: low-AP resident asks for support; 0 unsupported GP claims; 0 hallucinated exchange attempts |
| CQA10 | `70a32935` | Normal-life audit refresh: equip=8 (improved from 0), liveness stable, trade/combat still sparse |

**Dashboard repo (rs6-nullcity-residents-dashboard):**

| Packet | Dashboard commit | What it delivers |
|---|---|---|
| D2 | `f63e19a` | Soul proposal queue/admin approve-reject-birth bridge |
| D3 | `618fee7` | Resident detail: goal/AP/GP/feed/story/benchmark warnings |
| D4 | `c8ea798` | AP-for-GP trade/inbox flow |
| D5 | `7b1db56` + `37d94ec` | Storyteller feed + operator review panel: dispatch body/bullets/warnings/refs/coin-995/NCRI labels |
| D7 | `53f4f31` | `/world` authenticated spectator route + gateway/session readiness badges |
| D8 | `31d0f8f` | Operator Readiness panel (blocked when no live controller) |

### Key Live Evidence Artifacts

| Artifact | What it proves |
|---|---|
| `bench_20260529065910_starter_gp_pickup_3m.json` | Real coin item `995` pickup (S2b/CQA6) |
| `bench_20260530021203_ap_topup_resume_5m.json` | AP topup → reconnect → resume (S1b) |
| `bench_20260530034914_ap_gp_exchange_5m.json` | Controlled AP-for-GP exchange: 25 GP burned, 50 AP credited (S3b) |
| `bench_20260530030614_ap_gp_library_strategy_5m.json` | AP/GP/Library strategy hierarchy under low AP (S8c) |
| `bench_20260530085237_ap_gp_honesty_5m.json` | No unsupported GP claims at low AP (CQA9) |
| `bench_20260530103544_memory_route_recall_5m.json` | Delayed route recall after direct-chat fix (CQA7) |
| `bench_20260530105802_world_event_reaction_5m.json` | Cross-resident LoreBus `fire_lit` → durable memory → recalled in chat (CQA8) |
| `bench_20260530122158_combat_prayer_10m.json` | Combat survival post-fix: attack → bones → bury → Prayer XP, no deaths (CQA5) |
| `named_trade_soak_20260530125718.json` | Operator trade + no-loop: trusted completion + 3 unsafe declines (CQA4) |

### What Is Substrate-Ready But Live-Verify Pending

All cloud-built substrate passed unit tests. Live benchmarks require the RuneScape controller stack and cannot run from the cloud checkout. The following need a loopback or live run before claiming 'proven':

- AP life-force fade-and-resume in ordinary named-resident life (not just benchmark harness).
- AP-for-GP exchange initiated spontaneously by a resident (not just controlled benchmark).
- Soul proposal → threshold → birth in a full live stack.
- Storyteller model-backed run with paid profile (dry-run confirmed; model call needs endpoint).
- NCRI full lifecycle (create → approve → transfer → redeem) in a live game session.
- Goal completion → Library saved state in ordinary resident life.

### Open Human Decisions (Blocking or Near-Blocking for Demo)

These were listed in the sprint plan as "Meeting Decisions Needed" and have not been answered yet:

1. **AP birth threshold**: How many AP must a Soul proposal collect before a resident is born?
2. **AP decay rate**: What is the default ticks-per-AP-lost rate?
3. **AP-for-GP exchange rate**: Reference rate, auction, or admin pricing first?
4. **First GP-earning activity**: Which skilling route should residents optimize for the June 1 demo?
5. **First 3 NCRIs**: Which RuneScape items get special Null City meaning first?
6. **3D-printer GP costs**: What is the coin-995 cost for each printable NCRI?
7. **Storyteller name and tone**: What is the narrator's name, and how playful/serious?
8. **Public AP abbreviation**: "AP" or spell out "Attention Points" in the attendee-facing dashboard?

### What Dashboard Still Needs (Server-Side Contracts Are Ready)

| Dashboard packet | Dependency status |
|---|---|
| D0 | Route safety — no server dependency |
| D1 | AP/GP profile shell — contracts from S11a are in `docs/city-dashboard-integration.md` |
| D6 | NCRI/print queue — S11b NCRI routes live; S5a NCRI registry functional |

`D2`, `D3`, `D4`, `D5`, `D7`, `D8` are marked In Review (dashboard repo commits listed above).

### Remaining Open Code Packets

| Packet | Why open | How to unblock |
|---|---|---|
| S10b/S10c | Model twins for GP and goal-planning tasks | Needs live RuneScape stack and paid model profile; run after June 1 event |
| S12b | Human model/capability summary write-up | Can follow from this closeout; best done after S10b/S10c results |
| CQA1 | Cook's Assistant from empty inventory (natural sourcing) | Deferred; needs natural ingredient route (bank/shop/spawn) beyond AP/GP loop priority |
| S-AUDIT-FIX-1 | P0 — NCRI sale heuristic mislabels admin gifts as sales (audit F1, QA-20260530-004) | Add transferReason discriminator to NcriRegistry.transfer and emit ncri_sale only for true sales |
| S-AUDIT-FIX-2 | P0 — deriveExchangeStatus mis-classifies non-GP failures as failed_gp (audit F2, QA-20260530-005) | Tighten ap-gp-exchange.ts:112; introduce failed_setup status for non-GP failure reasons |
| S-AUDIT-FIX-3 | P1 — selectCandidateGoals is dead code; needs-hierarchy capability claim overstated (audit F3, QA-20260530-006) | Wire seam into hybrid-agent-helpers goal selection + add live low-AP reorder benchmark, or downgrade claim |
| S-AUDIT-FIX-4 | P1 — ApLedger refId collides across residents and across restarts (audit F4, QA-20260530-007) | Suffix refId with residentName+ts or switch to crypto.randomUUID; assert distinct refIds in test |
| S-AUDIT-FIX-5 | P1 — city:digest CLI accepts any path with no sanitization (audit F5, QA-20260530-008) | Add memory-root existence + city-integration subdir check in runCityDigest; optional --strict |
| S-AUDIT-FIX-6 | P1 — EconomyEventLog has no concurrent-writer protection (audit F6, QA-20260530-009) | Document PIPE_BUF assumption + add concurrent-appender test; lockfile if multi-controller lands |
| S-AUDIT-FIX-7 | P1 — economy-events.jsonl re-read in full on every dashboard poll (audit F7, QA-20260530-010) | Add EconomyEventLog.tail(n) helper; switch dashboard readRecentEconomyEvents to use it |
| S-AUDIT-FIX-8 | P2 — digest window bounds inclusive-inclusive; EconomyEventLog.filter only has sinceTs (audit F8/F12) | Pick half-open convention; add untilTs to filter; boundary tests both ends |
| S-AUDIT-FIX-9 | P2 — GoalContractStore.list re-reads every JSON; dashboard recentEventLimit cap not documented (audit F9/F13) | mtime-aware cache; docstring on recentEventLimit |
| S-AUDIT-FIX-10 | P2 — attachEconomyEventLog silently replaces with no guard (audit F10) | Add `replace: boolean = false`; warn or throw on re-attach unless allowed |
| S-AUDIT-FIX-11 | P2 — ap_fade event carries apDelta:0, hides last AP burn in totals (audit F11) | Drop apDelta from ap_fade or set to balance-before-fade; document on event-kind reference |

### Demo Script (Simple Loop)

1. Show a Soul proposal form (dashboard D2) and fund it to threshold.
2. Birth the resident via admin approve (POST `/api/nullcity/proposals/:id/birth`).
3. Resident starts with AP and a Soul goal.
4. Resident observes GP from game state (`/api/nullcity/wealth/:residentName`).
5. Patron sends AP top-up; Storyteller digest captures it.
6. Run `npm run storyteller:dry-run` to show the grounded digest.
7. Show dashboard Storyteller feed (D5) with the operator review panel.
8. Optionally: run `npm run storyteller:run -- --latest` with a configured model profile for a live narration.

One command to get the full substrate state: `npm run storyteller:dry-run -- --fixture` (no model call, deterministic output, works without a live game server).
