# Changelog

All notable changes to Null City (`rs6-nullcity-server`) are documented here. Entries are written for human devs — succinct, present-tense, free of internal jargon.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Releases are calendar-dated (`## [YYYY-MM-DD]`) rather than SemVer, because nullcity is updated via dated milestone squashes from the working trunk `agents/wip`. Each release section is tagged in git when pushed.

See [`docs/changelog-workflow.md`](docs/changelog-workflow.md) for the authoring guide. See [`docs/merge-to-main-plan.md`](docs/merge-to-main-plan.md) for how releases reach this file.

## [Unreleased]

## [2026-06-01] — chicago-demo-day-readiness

Chicago demo-day readiness release. This promotes the weekend `agents/wip` line into `nullcity`: the AP/GP game loop, Soul birth and goal contracts, NCRI sale/redeem substrate, Storyteller foundations, resident observability, memory proof, and evidence-backed capability QA.

### Added

- Human operator guide at `HUMANS.md` plus runtime stewardship notes for starting the game, controller, dashboard, public routes, City API, and active resident cohort.
- AP/GP economy substrate: Attention Points sustain residents, RuneScape GP remains real in-game coin, and City API paths support AP grants, AP/GP exchange records, balances, and economy heartbeat checks.
- Soul proposal and birth flow: funded Souls can be born through the City API, receive a trackable goal contract, persist across controller restarts, and keep their Library/goal evidence.
- NCRI lifecycle: admins can seed, approve, price, sell, redeem, and track printable Null City RuneScape Items; resident sellers receive attention when humans buy their NCRIs.
- Storyteller substrate: digest builders, dispatch verification, model-client fallback behavior, public-safe Storyteller queues, and projector-facing story artifacts for the dashboard.
- Resident memory substrate: per-resident qmd-compatible facts, Brain-written durable memories, prompt-visible memory blocks, and named-resident write/recall soaks.

### Changed

- Runtime cohort management now supports a small controlled resident set via `souls.discoverResidents: false`, so local demos can run roughly ten residents instead of every starter soul.
- Inference policy now routes live residents to the serving `qwopus3.5-27b-v3` q4 endpoint; qwen and q8 routes are documented as non-serving/too slow until Dev confirms otherwise.
- Capability QA expanded from simple smoke tests into evidence-backed resident tasks for combat, gear, trade, AP/GP behavior, low-health recovery, memory recall, stuck recovery, and normal-life audits.

### Fixed

- City-born residents no longer disappear during reconcile, lose their goal contract on restart, or resurrect after death without being pruned from the born-resident manifest.
- Public/operator naming no longer exposes the confusing resident display name `Agent`; the canonical `res:agent` resident now appears as `The Steward`.

## [2026-05-26] — pre-chicago-demo-2026-05-26

Pre-Chicago demo snapshot for the OnionDAO team. This release turns the resident prototype into a demoable Null City surface: live residents, patron Shards, public story pages, Library portraits, graveyard cards, dashboard status, and inference canaries.

### Added

- Five public web surfaces with a shared vellum aesthetic: wall ticker (`/wall/`), patron inbox (`/inbox/?human=<handle>`), patron profile (`/patron/?human=<handle>`), Library of Souls (`/library/`), and graveyard (`/graveyard/`). A landing page at `/` links to all of them.
- Patron lifecycle CLIs (the human-event verbs): `npm run patron:register / patron:offer / patron:gift / patron:witness / patron:grant / patron:ask / patron:whisper`. Standing-tier crossings produce dispatched letters automatically (`standing_tier_crossed`, `epitaph`, `civic_milestone`, Mortician's Ribbon).
- Self-service + ops CLIs: `npm run patron:checkin` (daily +1 Shard), `patron:referral` (+2 Shards), `patron:balance`, `patron:standing`, `patron:bulk-register --file <path>` for event-day handle loading, `patron:smoke` (loop verifier).
- Self-service patron daily check-in at `GET /v1/patron/checkin?human=<handle>` plus a one-tap button on the patron profile page (Chicago-day "earn a Shard from your phone").
- Six named heroes (Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, Thrand) and four faction flagships (Mother Anvil, Severn Vesta, Wren Calix, The Hush) with ambient personality lines that fire without an LLM call.
- Faction flagships do visible faction-specific landmark work — foundry fuel, bureau witness, ledger audit, veil shadow — backed by a persistent stockpile ledger that survives restart.
- Resident-to-resident interact verbs: `whisper`, `gift`, `assist_skill`, `challenge_duel` (L1).
- Heroes prepare final words near attention floor; the words appear verbatim in their epitaph letter.
- Mortician's Ribbon: patrons present at a resident's death receive a `civic_milestone` letter naming them in the city's record.
- Library of Souls auto-generates a portrait per resident — epithet, story arc, top quote, wants, patron count, lives lived.
- Wall snapshot exposes a resident roster with story-arc phase, current goal, and faction affiliation alongside the recent-letters stream.
- Cross-resident whisper verb (`L-β`) and embassy reception greeting reflex (`D3`) wired into the runtime.
- Inference health probe at `GET /v1/health` and old/new model canary endpoints for safe model rollover.
- Multi-controller safety lock: a second controller pointing at the same memory dir fails fast with a clear pid/path error.

### Changed

- Wall ticker dedupes repeated subjects so a multi-witness death doesn't spam five identical cards.
- Wall ticker and Library of Souls hide synthetic residents (`res-qa-*`, `res-bmk_*`) from public surfaces. Operator/debug views still see them.
- Resident portraits dedupe repeated "wants" and cap at five distinct entries, so long-lived residents read like biographies instead of log dumps.
- Coordination workflow: feature work happens on `agents/wip`, milestone squashes land on `nullcity`. `docs/agent-status.md` stays on `agents/wip` and is excluded from squashes.

### Fixed

- Patron progress bar no longer renders 0% when a real value is present.
- `/v1/library` and `/v1/graveyard` endpoints serve correctly after controller restart.
- Inference health probe is no longer blocked by the LlmClient pause state.
- Patron currency / standing / check-in ledgers quarantine corrupt files instead of silently returning empty — no more silent Shard loss on restart.
- Standing-tier letter dispatcher now emits one letter per tier crossed when a single offer spans multiple tiers (was: only the highest tier).

### Developer-facing

- New SOUL frontmatter rule kinds: `always` (ambient reflex) and `attack` (reactive event), with cooldown and priority fields.
- `buildWallSnapshot` and `readLibraryEntries` accept `excludeSynthetic` and `dedupeBySubject` options. Defaults preserve full-fidelity output for non-public callers.
- `npm run controller:smoke -- --observe-seconds <N>` tails the live runtime and prints per-resident action/say activity — the canonical "is it really alive?" tool.
- `CHANGELOG.md` (this file) renamed from lowercase, format upgraded to [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). See `docs/changelog-workflow.md` for the authoring guide.
- Test count: ~1,500 → 2,151. `npm run fin` (typecheck + lint + format + jest) is the merge gate.

### Tests

- End-to-end patron loop verified live: `register → offer → witness` produces a letter in `/v1/inbox`.
- `npm run controller:smoke` boots all 23 residents and observes recent activity per resident.
- `scripts/post-restart-smoke.sh` reports READY after a fresh controller restart with all residents alive.

## [2026-05-23]

The pre-launch resident capability update. Pulled 183 commits, range `7e3012d7..d298e480`, 154 files changed (+28,277 / -2,238). This pull moves the RuneScape resident from a mostly monolithic hybrid agent to a more modular SPARK-adjacent runtime with richer deterministic body routines, better direct chat behavior, patron/standing primitives, much deeper game knowledge, new benchmarks, and tighter benchmark/evidence truthfulness.

### Added

#### SPARK runtime and resident behavior

- Extracted RuneScape behavior out of the monolith into focused SPARK-adjacent modules: `runescape-workflows.ts`, `runescape-body-routines.ts`, `runescape-nervous-rules.ts`, `runescape-brain-planner.ts`.
- Deterministic body routines for firemaking, level-one woodcutting, starter fishing, fishing→cooking, burying bones, prayer training, combat training, combat loot/prayer follow-up, opportunistic item pickup, exploration, patrols, and stuck recovery.
- Workflow predicates for tinderbox/log detection, axe detection, fishing-net detection, starter fish detection, bone detection, safe bone sources, safe combat targets.
- Brain-planner helpers for LLM-completion JSON parsing, goal-id generation, benchmark goals, speech cleanup, goal summaries, goal-identity predicates.
- Nervous-rule helpers for opening nearby obstacles, reporting blockers, asking for help, presence-beacon timing, latest combat attacker, flee target selection.
- SPARK runtime now passes patron awareness into nervous reactions and exposes more SOUL fields through public module context.
- `SparkTickResult` now includes chat telemetry: reply emission/suppression, reply kind, refusal reason, voice source.

#### Direct chat, commands, and social response

- Direct chat handling moved earlier in thinking order so addressed commands and nearby social are handled before combat/dialogue/trade/body fallbacks.
- Command handling for follow, stop following, wait, resume/refollow, status, look, inventory, pickup, drop, prayer, bury bones, combat, attack, retreat, trade, trade offer, accept trade, explore, cooking, fishing, woodcutting, firemaking.
- Follow state persists in runtime cognition; supports manual pause/resume.
- Non-command nearby small-talk replies via LLM inference with rate limiting and budget admission.
- Phrasebook-backed clarifying questions for ambiguous commands like `go`, `make`, `give`.
- Polite decline responses for missing tools, low HP, unsafe/unknown commands, higher-priority situations.
- In-character narration for combat survival choices and stuck recovery.
- `src/controller/soul/phrasebook.ts` for reusable voice-aware phrases.

#### Combat and survival

- Resident and nearby actor perception now includes `combatLevel`.
- Combat logic considers aggressor visibility, player attackers, target combat level, resident HP, food availability, and safe-target heuristics.
- Residents can eat before retaliation, retreat when hurt or outmatched, retaliate against safe NPC targets, and avoid risky fights against stronger or unsafe targets.
- Combat target ranking biases toward safer low-level NPCs and considers combat level.
- Combat choices can trigger concise public narration about why the resident ate, retreated, or fought back.

#### Trading

- `src/controller/actions/trading.ts` — controller-side typed trade action constructors, precondition checks, lifecycle state transitions, item value estimation, safety predicates.
- New controller-facing trade verbs in `message-codecs.ts`: `trade_request`, `trade_offer_item`, `trade_accept`, `trade_decline`. Legacy engine forms (`trade_offer_item` with `inventorySlot`/`amount`, `trade_accept_stage_1`/`stage_2`) retained.
- Hybrid thinking can request a trade, approach a trade target, reciprocate trusted trade requests, offer safe non-tool items, accept trade stages, decline untrusted trades.
- Safety limits: maximum offered value, stranger standing threshold.

#### Patron, standing, and letters system

- New patron subsystem under `src/controller/patron/`: `currency-ledger.ts`, `standing-ledger.ts`, `patron-store.ts`, `patron-registry.ts`, `patron-gateway.ts`, `check-in-tracker.ts`, `letters-store.ts`, `letters-producer.ts`, `cli.ts`.
- Shards as patron currency with credit/debit history and persisted snapshots.
- Faction standing tiers: `stranger`, `acquaintance`, `ally`, `officer`.
- `PatronGateway` supports offering Shards to residents, increasing attention, recording standing, emitting trajectory/library patron evidence, and dispatching standing-tier letters.
- Sponsor-birth scaffolding can write new SOUL files, debit sponsorship cost, record standing, invoke an optional resident-born callback.
- `controller.yml` accepts optional `patrons` entries with configured handles and patron kinds.
- Nervous system can thank configured patrons in chat with cooldowns.
- New scripts: `npm run patron:grant`, `npm run patron:offer`.

#### Memory, evidence, and knowledge

- `src/controller/evidence/library-memories.ts` — reads recent library timeline memories back into prompts.
- Library memories now include patron events and resident notes for continuity.
- Runtime records patron chat into library evidence when configured patrons are observed.
- `TrajectoryBuilder` gained patron recording support.
- Runtime exposes `getState()`, `getEvidence()`, `incrementAttention()` so patron systems and CLI flows can update attention and write evidence.
- Runtime merges pending events before nervous reactions.
- Runtime progress/stuck timestamps normalized against the runtime tick.
- Action evidence in benchmarks includes richer final status and effect counts.
- Runtime knowledge expanded from a small starter set to **54 entries** covering skills, starter workflows, quests, places, NPCs, monsters, item categories, economy, survival/death, communication, meta goal selection.
- `src/controller/knowledge/context-derivation.ts` for perception and goal context derivation.
- Knowledge retrieval supports perception-aware and goal-aware boosting, enforces token budgets, records token-budget overshoot.
- Prompt envelopes thread more SOUL identity (archetype, voice, fears, loves, goals, alignment, aesthetic).
- New SOUL frontmatter fields: `goals`, `alignment`, `aesthetic`.

#### Benchmarks

- Benchmark CLI supports `--task all`, running the 9-task core suite and emitting suite JSON summaries.
- `memory-recall-3m` — verifies a resident can answer a nearby memory question using seeded Library memories without JSON-like prompt echo.
- `trading-giving-5m` — verifies trade request, safe-item offer, two-stage accept, unsafe/untrusted trade decline.
- Benchmark tasks can define `memorySeeds` to seed Library timeline memories before startup.
- Benchmark artifacts include `finalStatus`, `finalReason`, `evidenceCount`, `effectEvidenceCount`.

#### Documentation

- `docs/runescape-skill/` expanded into a full agent-facing knowledge base: playbooks for all 20 RuneScape skills (Agility through Woodcutting).
- New/expanded reference docs: `economy.md`, `items.md`, `monsters.md`, `npcs.md`, Lumbridge/Varrock/Draynor NPCs, regional place guides, starter quest walkthroughs (Cook's Assistant, Restless Ghost, Romeo and Juliet).
- `starter-workflows.md` expanded from basic loops to 13 runtime-aligned workflows.
- New superpower specs: cross-resident lore, deeper game-skill knowledge, embassy and event design, hero residents, patron loop design, RS6 factions, smarter behavior, SPARK module extraction, controller MCP routine facade.
- New strategy docs: `docs/null-city-foundation-audit.md`, `docs/strategic-review-2026-05-23.md`.
- `AGENTS.md` now points to the branch workflow and expanded coordination expectations.

### Changed

- Existing benchmark verifiers tightened for truthful final effects (especially firemaking and fishing/cooking).
- `make-fire-5m` now leans on observed action effects rather than only accepted action acknowledgements.
- Fishing/cooking benchmark logic adjusted to avoid false positives from peer chat or incomplete final effects.
- Coordination workflow: routine multi-agent work now happens on `agents/wip`, with curated milestones squashed to `nullcity`.

### Fixed

- Interaction distance semantics: direct position checks now use tile/Chebyshev distance instead of Euclidean in `src/engine/world/position.ts`, so diagonal adjacency counts correctly.
- Item-on-object, NPC, and object interaction pipes no longer enqueue walk tasks when the player is already within interaction distance.
- Action effect waits use longer movement timeouts based on distance; longer firemaking effect waits.
- Firemaking effect detection for tinderbox/log `use_item_on_item` actions.
- Local actions can interrupt stale active moves; old movement no longer prevents immediate useful work.
- Stale self-owned log pickups after firemaking suppressed.
- Firemaking goals kept ahead of opportunistic loot pickup.
- Exploration patrols kept local; awkward exploration retries reduced.
- Stuck exploration recovery improved with open-obstacle attempts, blocker reports, patrol recovery, help requests.
- Loop-break behavior no longer replaces the active goal unnecessarily.
- Progress ticks aligned with the runtime clock.
- Autonomous fishing/cooking interaction flow + smoke verification truthfulness fixed.
- Object interactions and fishing benchmark evidence fixed.
- Benchmark accounting fixed so accepted actions don't hide final-effect timeouts.

### Developer-facing

- `package.json` added `patron:grant` and `patron:offer` scripts.
- Optional `patrons` config is parsed by `src/controller/config.ts`.
- New persisted patron files may appear under the controller memory root: `patron-currency.json`, `patron-standing.json`, letter data under `data/letters/...`.
- Action authors now need to understand two trade forms (controller G4 form: `itemId`/`quantity`/`slot` with single `trade_accept`; legacy engine form: `inventorySlot`/`amount` with `trade_accept_stage_1`/`stage_2`).
- Consumers of perception/action types should handle `combatLevel`, action metadata (`voiceSource`, `helpRequestReason`), stricter non-empty trade targets, expanded runtime cognition fields (follow state, chat reply rate limits, exploration cooldowns, combat narration, routine loop handling).
- Benchmark consumers should handle suite output from `--task all` and richer action evidence fields.

### Tests

- Trading actions, preconditions, state transitions, safety.
- Memory recall and trading/giving benchmarks.
- Library memory readback.
- Context derivation and knowledge retrieval.
- Prompt envelope coherence and SOUL field propagation.
- Patron gateway, CLI, currency ledger, standing ledger, registry, letters, check-ins.
- Routine runner behavior.
- RuneScape body routines, brain planner, nervous rules, workflows.
- Transport message codecs.
- Engine action interaction pipes.
- Tile-distance interaction behavior.
- Hybrid thinking around direct chat, commands, combat, stuck recovery, benchmark behavior.

For the full per-commit ledger of the 183 squashed commits, run `git log --oneline 7e3012d7..d298e480`.

[Unreleased]: https://github.com/OnionDAO-git/rs6-nullcity-server/compare/chicago-demo-day-readiness-2026-06-01...HEAD
[2026-06-01]: https://github.com/OnionDAO-git/rs6-nullcity-server/releases/tag/chicago-demo-day-readiness-2026-06-01
[2026-05-26]: https://github.com/OnionDAO-git/rs6-nullcity-server/releases/tag/pre-chicago-demo-2026-05-26
[2026-05-23]: https://github.com/OnionDAO-git/rs6-nullcity-server/releases/tag/2026-05-23
