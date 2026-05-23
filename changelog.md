# Changelog

## Pulled on 2026-05-23

Pulled branch: `nullcity`

Range pulled:

- Before: `7e3012d7fb4bf5c39808e3bf38a3cc8527bcc5c9` (`Merge origin/nullcity into resident discovery work`)
- After: `d298e480` (`docs(milestone): complete Q5 command vocabulary and synchronize roadmap tasks`)
- Commits pulled: 183
- Diff size: 154 files changed, 28,277 insertions, 2,238 deletions

High-level theme: this pull is a large pre-launch resident capability update. It expands the RuneScape resident from a mostly monolithic hybrid agent into a more modular SPARK-adjacent runtime with richer deterministic body routines, better direct chat behavior, patron/standing primitives, much deeper game knowledge, new benchmarks, and tighter benchmark/evidence truthfulness.

## Features

### SPARK runtime and resident behavior

- Extracted RuneScape-specific behavior out of the hybrid monolith into focused SPARK-adjacent modules:
  - `src/controller/spark/runescape-workflows.ts`
  - `src/controller/spark/runescape-body-routines.ts`
  - `src/controller/spark/runescape-nervous-rules.ts`
  - `src/controller/spark/runescape-brain-planner.ts`
- Added deterministic body routines for firemaking, level-one woodcutting, starter fishing, fishing-to-cooking, burying bones, prayer training, combat training, combat loot/prayer follow-up, opportunistic item pickup, exploration, patrols, and stuck recovery.
- Added workflow predicates for common inventory and world checks, including tinderbox/log detection, axe detection, fishing net detection, starter fish detection, bone detection, safe bone sources, and safe combat targets.
- Added brain-planner helpers for parsing LLM completion JSON, goal-id generation, benchmark-specific goals, speech cleanup, goal summaries, and goal identity predicates.
- Added nervous-rule helpers for opening nearby obstacles, reporting blockers, asking for help when stuck, presence beacon timing, identifying latest combat attackers, and selecting flee targets.
- SPARK runtime facets now pass patron awareness into nervous reactions and expose additional SOUL fields through public module context.
- `SparkTickResult` now includes chat telemetry for reply emission/suppression, reply kind, refusal reason, and voice source.

### Direct chat, commands, and social response

- Direct chat handling was expanded and moved earlier in the thinking order, so addressed commands and nearby social interactions are handled before combat/dialogue/trade/body fallbacks when appropriate.
- Added or improved command handling for follow, stop following, wait, resume/refollow, status, look, inventory, pickup, drop, prayer, bury bones, combat, attack, retreat, trade, trade offer, accept trade, explore, cooking, fishing, woodcutting, and firemaking.
- Follow state now persists in runtime cognition and supports manual pause/resume behavior.
- Added non-command nearby small-talk replies using LLM inference, with rate limiting and budget admission.
- Added phrasebook-backed clarifying questions for ambiguous commands like `go`, `make`, and `give`.
- Added polite decline responses for missing tools, low HP, unsafe or unknown commands, and higher-priority situations.
- Added in-character narration for combat survival choices and stuck recovery.
- Added `src/controller/soul/phrasebook.ts` for reusable voice-aware phrases.

### Combat and survival

- Resident and nearby actor perception now includes `combatLevel`.
- Combat logic now considers aggressor visibility, player attackers, target combat level, resident HP, food availability, and safe target heuristics.
- Residents can eat before retaliation, retreat when hurt or outmatched, retaliate against safe NPC targets, and avoid risky fights against stronger or unsafe targets.
- Combat target ranking now biases toward safer low-level NPCs and considers combat level.
- Combat choices can trigger concise public narration about why the resident ate, retreated, or fought back.

### Trading

- Added `src/controller/actions/trading.ts` with controller-side typed trade action constructors, precondition checks, trade lifecycle state transitions, item value estimation, and safety predicates.
- Added controller-facing trade verbs to `src/controller/transport/message-codecs.ts`:
  - `trade_request`
  - `trade_offer_item`
  - `trade_accept`
  - `trade_decline`
- Kept compatibility with legacy engine trade forms:
  - `trade_offer_item` with `inventorySlot`/`amount`
  - `trade_accept_stage_1`
  - `trade_accept_stage_2`
- Hybrid thinking can now request a trade, approach a trade target, reciprocate trusted trade requests, offer safe non-tool items, accept trade stages, and decline untrusted trades.
- Added safety limits such as maximum offered value and stranger standing thresholds.

### Patron, standing, and letters system

- Added a new patron subsystem under `src/controller/patron/`, including:
  - `currency-ledger.ts`
  - `standing-ledger.ts`
  - `patron-store.ts`
  - `patron-registry.ts`
  - `patron-gateway.ts`
  - `check-in-tracker.ts`
  - `letters-store.ts`
  - `letters-producer.ts`
  - `cli.ts`
- Added Shards as the patron currency ledger, with credit/debit history and persisted snapshots.
- Added faction standing tiers: `stranger`, `acquaintance`, `ally`, and `officer`.
- Added `PatronGateway` support for offering Shards to residents, increasing attention, recording standing, emitting trajectory/library patron evidence, and dispatching standing-tier letters.
- Added sponsor-birth scaffolding that can write new SOUL files, debit sponsorship cost, record standing, and invoke an optional resident-born callback.
- `ControllerHost` now owns patron store/gateway state and persists patron currency/standing on shutdown.
- `controller.yml` can now contain optional `patrons` entries with configured handles and patron kinds.
- The nervous system can thank configured patrons in chat, with cooldowns.
- Added package scripts:
  - `npm run patron:grant`
  - `npm run patron:offer`

### Memory and evidence

- Added `src/controller/evidence/library-memories.ts` to read recent library timeline memories back into prompts.
- Library memories can now include patron events and resident notes, improving continuity for future brain/body prompts.
- Runtime now records patron chat into library evidence when configured patrons are observed.
- `TrajectoryBuilder` gained patron recording support.
- Runtime exposes `getState()`, `getEvidence()`, and `incrementAttention()` so patron systems and CLI flows can update resident attention and write evidence.
- Runtime now merges pending events before nervous reactions, giving nervous rules better access to recent chat/event context.
- Runtime progress/stuck timestamps are normalized against the runtime tick.
- Action evidence now includes richer final status and effect counts in benchmark artifacts.

### Knowledge and prompts

- Runtime knowledge in `src/controller/knowledge/knowledge-retriever.ts` expanded from a small starter set to 54 entries covering:
  - skills
  - starter workflows
  - quests
  - places
  - NPCs
  - monsters
  - item categories
  - economy
  - survival and death recovery
  - communication
  - meta goal selection and early progression
- Added `src/controller/knowledge/context-derivation.ts` for perception and goal context derivation.
- Knowledge retrieval now supports perception-aware and goal-aware boosting.
- Knowledge retrieval now enforces token budgets and records token-budget overshoot behavior.
- `game-skill-context.ts` now derives perception/goal context before retrieval.
- Prompt envelopes now thread more SOUL identity into prompts:
  - archetype
  - voice
  - fears
  - loves
  - goals
  - alignment
  - aesthetic
- Hybrid brain/body prompts now include recent memories and more explicit continuity guidance.
- `src/controller/soul/soul-schema.ts` added new frontmatter fields:
  - `goals`
  - `alignment`
  - `aesthetic`

### Benchmarks

- Benchmark CLI now supports `--task all`, running the 9-task core suite and emitting suite JSON summaries.
- Added `memory-recall-3m`, verifying that a resident can answer a nearby memory question using seeded Library memories without JSON-like prompt echo.
- Added `trading-giving-5m`, verifying trade request, safe item offer, two-stage accept, and unsafe/untrusted trade decline behavior.
- Benchmark tasks can now define `memorySeeds`, allowing autonomous runs to seed Library timeline memories before startup.
- Benchmark artifacts now include:
  - `finalStatus`
  - `finalReason`
  - `evidenceCount`
  - `effectEvidenceCount`
- Existing benchmark verifiers were tightened for truthful final effects, especially firemaking and fishing/cooking.
- `make-fire-5m` now leans on observed action effects rather than only accepted action acknowledgements.
- Fishing/cooking benchmark logic was adjusted to avoid false positives from peer chat or incomplete final effects.

### RuneScape skill documentation

- Greatly expanded `docs/runescape-skill/` into an agent-facing knowledge base.
- Added skill playbooks for:
  - Agility
  - Combat
  - Construction
  - Cooking
  - Crafting
  - Farming
  - Firemaking
  - Fishing
  - Fletching
  - Herblore
  - Magic
  - Mining
  - Prayer
  - Ranged
  - Runecrafting
  - Slayer
  - Smithing
  - Thieving
  - Trading
  - Woodcutting
- Added or expanded docs for:
  - `economy.md`
  - `items.md`
  - `monsters.md`
  - `npcs.md`
  - Lumbridge NPCs
  - Varrock NPCs
  - Draynor/Wizards' Tower NPCs
  - regional place guides
  - starter quest walkthroughs
- Added starter quest guides for:
  - Cook's Assistant
  - The Restless Ghost
  - Romeo and Juliet
- Expanded `starter-workflows.md` from basic loops to 13 runtime-aligned workflows, including firemaking, woodcutting, shrimp, cooking, bones, combat-prayer, trading, magic, ranged, smithing, eating, fleeing, and follow/report.

### Strategic and process documentation

- Added major superpower specs for:
  - cross-resident lore
  - deeper game-skill knowledge
  - embassy and event design
  - hero residents
  - patron loop design
  - RS6 factions
  - smarter behavior
  - SPARK module extraction
  - controller MCP routine facade
- Added `docs/null-city-foundation-audit.md`.
- Added `docs/strategic-review-2026-05-23.md`.
- Updated roadmap status in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
- Updated coordination docs for branch workflow, short status-log discipline, recurring strategic reviews, and agent handoffs.
- `AGENTS.md` now points to the branch workflow and expanded coordination expectations.

## Bug fixes and reliability improvements

- Fixed interaction distance semantics by changing direct position checks from Euclidean distance to tile/Chebyshev distance in `src/engine/world/position.ts`, which should make diagonal adjacency count correctly.
- Prevented item-on-object, NPC, and object interaction pipes from enqueueing walk tasks when the player is already within interaction distance.
- Improved action effect waits with longer movement timeouts based on distance and longer firemaking effect waits.
- Added firemaking effect detection for tinderbox/log `use_item_on_item` actions.
- Let local actions interrupt stale active moves, reducing cases where old movement prevented immediate useful work.
- Reduced stale self-owned log pickups after firemaking.
- Kept firemaking goals ahead of opportunistic loot pickup.
- Kept exploration patrols local and reduced awkward exploration retries.
- Improved stuck exploration recovery with open-obstacle attempts, blocker reports, patrol recovery, and help requests.
- Added loop-break behavior without replacing the active goal unnecessarily.
- Aligned progress ticks with the runtime clock.
- Fixed autonomous fishing/cooking interaction flow and smoke verification truthfulness.
- Fixed object interactions and fishing benchmark evidence.
- Improved benchmark accounting so accepted actions do not hide final effect timeouts.

## Developer-facing changes

- `package.json` added `patron:grant` and `patron:offer` scripts.
- Optional `patrons` config is now parsed by `src/controller/config.ts`.
- New persisted patron files may appear under the controller memory root:
  - `patron-currency.json`
  - `patron-standing.json`
  - letter data under `data/letters/...`
- Action authors now need to understand two trade forms:
  - Controller G4 form: `itemId`/`quantity`/`slot`, plus single `trade_accept`
  - Legacy engine form: `inventorySlot`/`amount`, plus `trade_accept_stage_1` and `trade_accept_stage_2`
- Consumers of perception/action types should handle:
  - `combatLevel`
  - action metadata such as `voiceSource` and `helpRequestReason`
  - stricter non-empty trade targets
  - expanded runtime cognition fields for follow state, chat reply rate limits, exploration cooldowns, combat narration, and routine loop handling
- Benchmark consumers should handle suite output from `--task all` and richer action evidence fields.
- Coordination workflow changed materially: routine multi-agent work is now expected to happen on `agents/wip`, with curated milestones merged to `nullcity`.

## Test coverage added or expanded

- Added tests for trading actions, preconditions, state transitions, and safety.
- Added tests for memory recall benchmark behavior.
- Added tests for trading/giving benchmark behavior.
- Added tests for library memory readback.
- Added tests for context derivation and knowledge retrieval.
- Added tests for prompt envelope coherence and SOUL field propagation.
- Added tests for patron gateway, CLI, currency ledger, standing ledger, registry, letters, and check-ins.
- Added tests for routine runner behavior.
- Added tests for RuneScape body routines, brain planner, nervous rules, and workflows.
- Added tests for transport message codecs.
- Added tests for engine action interaction pipes.
- Added tests for tile-distance interaction behavior.
- Expanded hybrid thinking tests significantly around direct chat, command handling, combat, stuck recovery, and benchmark behavior.

## Pulled commit ledger

These are the commits pulled in chronological order:

- `58f94176` - Add specs for Workstreams J/K/M/N + update coordination
- `63620ee3` - Default Notion-canonical answers into J/K/N specs + vision
- `b51a30aa` - Add Creative Drafts section to K spec - mottos, flagships, POIs, rituals
- `3744bad1` - Add specs P/Q/R/L: intelligence + behavior + knowledge + cross-resident
- `1ed81e80` - Mark benchmark dashboard tasks complete
- `1f323eab` - Ask for help after failed stuck recovery
- `d3341a99` - Clarify direct chat replies
- `48602a3e` - Persist direct follow commands
- `06aa81d4` - Start weekend autonomous loop; flag R-alpha collision risk
- `6b3ed460` - Narrate combat survival choices
- `e3f73e68` - Switch weekend cron to 30min + refocus on RuneScape basics
- `8a6cd85f` - Document agent sync log
- `568beb38` - Adopt explicit two-line status-log discipline + redirect away from P-alpha
- `6307a081` - Implement token budget enforcement and overshoot rules for knowledge retriever
- `ac45b84e` - docs: append handoff log entry for Workstream P
- `646e6619` - Add agent-facing combat skill knowledge
- `5d8b84c9` - Status: HANDOFF for combat.md skill knowledge slice (646e6619)
- `5df8f531` - Add core benchmark suite task
- `775c54b4` - STARTING line: R-alpha workflow extraction (lock on monolith)
- `48b4a4d4` - Extract workflow predicates to src/controller/spark/runescape-workflows.ts
- `945c5c02` - Import workflow predicates from spark/runescape-workflows in monolith
- `47322b08` - Status log: R-alpha HANDOFF - runescape-workflows.ts extracted (Plan alpha)
- `aaf156a0` - STARTING: SOUL -> prompt -> decision pipeline deep audit (soul fields -> behavior)
- `ccd5b7d2` - Status: STARTING SOUL -> prompt pipeline audit slice
- `9470fe9b` - SOUL: archetype/voice/fears/loves now shape prompt envelope
- `caa9ecb2` - Status: HANDOFF slice 1 - soul fields -> prompt directive sections
- `64e3eae4` - SOUL: archetype/voice/fears/loves now shape Brain + Body prompts
- `f1303d65` - Status: HANDOFF slice 2 - soul -> Brain/Body identity injection
- `7ff828dd` - SOUL: add goals/alignment/aesthetic fields and propagate to prompts
- `ff155a1a` - Status: HANDOFF slice 3 - goals/alignment/aesthetic landed
- `a10e8d1b` - SOUL: add coherence regression test for soul -> prompt threading
- `4d4d2045` - Status: HANDOFF slice 4 - SOUL coherence regression complete
- `ea616bf5` - STARTING: parallel skill knowledge expansion (prayer/mining/fishing-deep/cooking-deep)
- `e0a20ad7` - Add agent-facing prayer skill knowledge (docs/runescape-skill/skills/prayer.md)
- `3b09f218` - docs(runescape-skill): add agent-facing mining skill reference
- `a185636f` - docs: add woodcutting, firemaking, and fletching playbooks to docs/runescape-skill/
- `218b6f1d` - docs: finalize roadmap status and coordination log for woodcutting, firemaking, fletching playbooks
- `9d87f6c4` - Add agent-facing fishing skill knowledge
- `e3184f32` - docs(runescape-skill): add agent-facing Cooking skill reference
- `95ab1e65` - Reconcile README to list all 8 skill files + HANDOFF for parallel expansion
- `d86bc6c3` - HANDOFF verification + STARTING G4 trading verbs
- `bbd66f25` - docs & tests: add modular regional geography playbooks and implement plan_continuation test
- `35e8b0b2` - coordination: log handoff for regional geography playbooks and plan_continuation test
- `73f9a2a0` - docs: add agent-facing playbooks for smithing, crafting, and thieving skills
- `d8acbd78` - G4 slice 1: trading.ts kernel - typed actions + preconditions + safety + lifecycle
- `1c52ef08` - G4 slice 2: extend AgentAction typed union with trade verbs + zod schema
- `19e7809b` - G4 slice 3: add trade-request workflow card
- `8374a01b` - G4 slice 4: agent-facing trading.md skill reference
- `03529b3b` - docs: log G4 trading verbs HANDOFF (slices 1-4 complete)
- `05fa571c` - STARTING: R-beta body routine extraction
- `3db2aeb9` - R-beta slice 1: extract firemakingAction to runescape-body-routines
- `a33ad95d` - R-beta slice 2: extract levelOneWoodcuttingAction
- `beaba1e8` - R-beta slice 3: extract starterFishingAction
- `6d9c9239` - Improve stuck exploration recovery
- `f30d34aa` - Log stuck recovery handoff
- `ad9a990f` - R-beta slice 4: extract buryBonesAction
- `a5f248a9` - R-beta slice 5: extract starterFishingCookingAction
- `748bde7b` - docs: add farming, herblore, and runecrafting playbooks to agent-facing knowledge
- `e8386e25` - R-beta slice 6: extract opportunisticPickupAction
- `727896bc` - R-beta slice 7: extract prayerTrainingAction
- `d3e16dd3` - R-beta slice 8: extract combatLootOrPrayerAction
- `e95c00d9` - Keep exploration patrols local
- `8e3651a4` - R-beta slice 9: extract combatTrainingAction
- `ea0ebfb7` - R-beta slice 10: extract explorationAction (final body routine)
- `8e376ba5` - docs: log R-beta body-routines extraction HANDOFF
- `81d12956` - STARTING: R-gamma nervous-rules extraction
- `2030355c` - Log live patrol verification
- `2ae2011f` - R-gamma slice 1: extract stuckOpenObstacleAction
- `9a307620` - R-gamma slice 2: extract stuckBlockerReportAction
- `75fd69b1` - R-gamma slice 3: extract stuckHelpRequestAction
- `cde40f29` - R-gamma slice 4: extract shouldEmitPresenceBeacon timing predicate
- `407284e0` - R-gamma slice 5: extract latestCombatAttacker + fleeTarget
- `09fe1eb9` - docs: log R-gamma nervous-rules extraction HANDOFF
- `449bc436` - docs: complete Workstream P2 skills (Agility, Construction, Slayer)
- `c3d8d2c3` - STARTING: R-delta brain-planner extraction
- `49e330c0` - R-delta slice 1: extract brainCompletionSchema + parseBrainCompletion
- `23cf468d` - R-delta slice 2: extract goalId slugify helper
- `12914c61` - R-delta slice 3: extract goal factories + cleanTarget
- `97b4fef7` - Reduce awkward exploration retries
- `2bb8b578` - Log exploration retry handoff
- `2b4364b0` - R-delta slice 4: extract goal-identity predicates
- `87da10c0` - R-delta slice 5: extract cleanSpeech + summarizeGoalForSpeech
- `193d80fa` - Log latest validation handoff
- `01a1d938` - docs: log R-delta brain-planner extraction HANDOFF
- `1214361d` - Session checkpoint: R-delta done; 75 commits, monolith 2785->2243, 918 tests
- `155de6b6` - STARTING: P6 starter-quest knowledge expansion
- `5edfd950` - Add starter-quest knowledge: cooks-assistant
- `522fd0ba` - Add starter-quest knowledge: restless-ghost
- `bb43a1f3` - Add starter-quest knowledge: romeo-and-juliet
- `a2736948` - HANDOFF: P6 starter-quest knowledge expansion COMPLETE
- `5b647982` - STARTING: P5 starter-NPC knowledge expansion
- `f019084a` - Prefer local logs for fire goals
- `2a3745f5` - Apply Biome formatting
- `382cc038` - Log fire goal validation handoff
- `69405162` - Add starter-NPC knowledge: lumbridge
- `fc991e4c` - Add starter-NPC knowledge: varrock
- `b404c8e6` - Add starter-NPC knowledge: draynor-and-wizards-tower
- `eb30562b` - docs: complete Workstream P5 by creating npcs.md and updating roadmap for P4/P5/P6
- `7006fb71` - HANDOFF: P5 NPC knowledge expansion COMPLETE (claude + antigravity coordinated)
- `b470f5d9` - STARTING: P5 items.md expansion
- `97f7f1b0` - Keep firemaking goals on task
- `d133b1a1` - Log firemaking behavior validation
- `0f2f2088` - Expand items.md from 29-line skeleton to full agent reference
- `5d9d0ce` - HANDOFF: P5 items.md expansion COMPLETE
- `3d4035ed` - STARTING: P3 magic.md + ranged.md core skill knowledge
- `4ef39603` - Add core combat-skill knowledge: magic
- `b6eb54c2` - Add core combat-skill knowledge: ranged
- `5b223b1d` - Integrate Magic and Ranged playbooks, mark roadmap task P3 as complete
- `1c6f5864` - HANDOFF: P3 magic.md + ranged.md COMPLETE (combat triangle now complete)
- `be983bcc` - STARTING: P-runtime-knowledge extend ENGINE_KNOWLEDGE_ENTRIES (+5 entries)
- `fa57830e` - Extend ENGINE_KNOWLEDGE_ENTRIES with 5 missing skill entries
- `eb666a2b` - HANDOFF: P-runtime-knowledge +5 entries COMPLETE (residents now see magic/ranged/cooking/smithing/trading)
- `9f9921a9` - Skip stale self-owned log pickups
- `07cae890` - STARTING: P-runtime-knowledge slice 2 +4 quest entries
- `66ecbd6a` - Add 4 quest entries to ENGINE_KNOWLEDGE_ENTRIES
- `5a8ff1bb` - HANDOFF: P-runtime-knowledge slice 2 +4 quest entries COMPLETE (knowledge retriever 8->17 in 2 cycles)
- `37a378a1` - feat(knowledge): implement P1 perception + goal filtered retrieval and token budgeting
- `6aeca5df` - Let local actions interrupt stale moves
- `e24f5711` - STARTING: P5 monsters.md
- `6b2cddea` - Add starter-monster combat reference: monsters.md
- `31d9f189` - HANDOFF: P5 monsters.md COMPLETE (closes P5 prompt)
- `fee2c409` - Keep firemaking ahead of loot pickups
- `b58c894e` - STARTING: P-runtime-knowledge slice 3 +4 monster entries
- `81a034fc` - Add 4 monster combat-target entries to ENGINE_KNOWLEDGE_ENTRIES
- `8249dd7e` - HANDOFF: P-runtime-knowledge slice 3 +4 monster entries COMPLETE (knowledge retriever 8->21 in 3 cycles)
- `8fedfba7` - Format monster knowledge entries
- `56fe5265` - Keep loop breaks from replacing goals
- `2a1c011f` - STARTING: P-runtime-knowledge slice 4 +6 place navigation entries
- `d6916126` - Add 7 place navigation entries to ENGINE_KNOWLEDGE_ENTRIES
- `a7829c93` - HANDOFF: P-runtime-knowledge slice 4 +7 place entries COMPLETE (knowledge retriever 8->28 in 4 cycles)
- `e68ecd45` - feat(spark): integrate voiced phrasebook for stuck recovery reflex (Q2/F3)
- `db6455e8` - Align progress ticks with runtime clock
- `d17f7b99` - STARTING: P-runtime-knowledge slice 5 +5 NPC entries
- `38dd536c` - Add 5 NPC entries to ENGINE_KNOWLEDGE_ENTRIES
- `21ec0668` - HANDOFF: P-runtime-knowledge slice 5 +5 NPC entries COMPLETE (knowledge retriever 8->33 in 5 cycles, 4.1x)
- `861def5c` - Use action effects for make-fire benchmark
- `d66ff20b` - STARTING: P-runtime-knowledge slice 6 +5 item-category entries
- `0297fa03` - Add 5 item-category cross-cutting entries to ENGINE_KNOWLEDGE_ENTRIES
- `3669962f` - HANDOFF: P-runtime-knowledge slice 6 +5 item-category entries COMPLETE (knowledge retriever 8->38 in 6 cycles, 4.75x)
- `2bedd776` - feat(spark): implement Q3 (F5) combat survival personality and heuristics
- `ce72bacf` - STARTING: P-runtime-knowledge slice 7 +3 workflow chain entries
- `3201daa9` - Add 3 multi-skill workflow chain entries to ENGINE_KNOWLEDGE_ENTRIES
- `2023025c` - Relax can-do-now firemaking context test to accept workflow chain
- `c193d6f9` - HANDOFF: P-runtime-knowledge slice 7 +3 workflow chain entries COMPLETE (knowledge retriever 8->41 in 7 cycles, 5.1x)
- `a24b1452` - Record combat benchmark smoke
- `324b97de` - STARTING: P-runtime-knowledge slice 8 +3 survival/death entries
- `28ac4704` - Add 3 survival + death/recovery entries to ENGINE_KNOWLEDGE_ENTRIES
- `8203ce92` - HANDOFF: P-runtime-knowledge slice 8 +3 survival/death entries COMPLETE (knowledge retriever 8->44 in 8 cycles, 5.5x)
- `aa850ea1` - STARTING: P-runtime-knowledge slice 9 +3 communication entries
- `25f9da10` - Add 3 communication entries to ENGINE_KNOWLEDGE_ENTRIES
- `94254b80` - HANDOFF: P-runtime-knowledge slice 9 +3 communication entries COMPLETE (knowledge retriever 8->47 in 9 cycles, 5.9x)
- `e748ca57` - STARTING: P4-docs starter-workflows.md expansion
- `0324a0f9` - Expand starter-workflows.md to match runtime knowledge layer
- `72116664` - HANDOFF: P4-docs starter-workflows.md expansion COMPLETE (6->13 workflows, vocabulary aligned with runtime)
- `4a70f0be` - Fix autonomous fishing-cooking interaction flow
- `88c16725` - STARTING: P-runtime-knowledge slice 10 +3 skill entries (crafting/runecrafting/fletching)
- `a59d7f92` - Add 3 more skill entries (crafting/runecrafting/fletching)
- `440e7139` - HANDOFF: P-runtime-knowledge slice 10 +3 skill entries COMPLETE (knowledge retriever 8->50 in 10 cycles)
- `6d68c9f1` - Fix object interactions and fishing benchmark evidence
- `5913d32a` - STARTING: P-runtime-knowledge slice 11 +2 meta entries (goal selection / progression)
- `ad2cc5fd` - Add 2 meta entries (goal selection + early progression)
- `88354d44` - HANDOFF: P-runtime-knowledge slice 11 +2 meta entries COMPLETE (knowledge retriever 8->52 in 11 cycles)
- `f6dcf55e` - STARTING: P-docs economy.md (currency/economy reference)
- `5d5c290a` - Add starter economy / currency reference: economy.md
- `7eec1e15` - HANDOFF: P-docs economy.md COMPLETE (currency/economy reference, 116 lines)
- `ff456e0a` - Make fishing cooking smoke truthful
- `c1348af6` - Record fishing smoke handoff
- `d915a830` - Append coordination correction
- `de5b3d38` - Correct pushed tip note
- `7252ef2f` - Clarify fishing smoke commit note
- `50a2c728` - STARTING: P-runtime-knowledge slice 12 +2 economy entries
- `14a00dda` - Add 2 economy entries (coin handling + early gp sources)
- `8c8e4139` - HANDOFF: P-runtime-knowledge slice 12 +2 economy entries COMPLETE (knowledge retriever 8->54 in 12 cycles)
- `e3fe4521` - STARTING: META process improvements + Null City foundation audit
- `d39945ea` - Process improvements + Null City foundation audit
- `bacf6604` - HANDOFF: META process retro + Null City foundation audit
- `b5306e65` - Switch agent workflow from direct-to-default to agents/wip + curated milestones
- `d1e9a84b` - AGENTS.md: add branch-workflow pointer to Start Here section
- `9ff07353` - F2 Nearby Human Reaction (Non-command small talk + clarifying questions)
- `2eec94e1` - Vision drift fix + recurring-review convention (Rule 8)
- `b361a11b` - J-alpha-2: Wire observePatron from perception pipeline and patron thanks reflex
- `099e34d2` - feat(patron): implement PatronGateway, administrative CLI controls, and ControllerHost plumbing
- `d298e480` - docs(milestone): complete Q5 command vocabulary and synchronize roadmap tasks
