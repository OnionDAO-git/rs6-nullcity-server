# Null City resident capabilities

Last updated: 2026-05-29

This document is the human-readable answer to: **what can the residents actually do, and what do they do when left running?**

It separates two different kinds of evidence:

- **Can do it:** automated tests or autonomous benchmark artifacts show the resident stack can complete the task.
- **Does do it:** normal controller logs or Library timelines show residents performing the behavior during live autonomous runs.

The important caveat: many successful behaviors are **SPARK/routine-assisted**. That still counts as resident capability, because the deployed resident is Soul + SPARK + body + inference, but it does not always mean the LLM independently invented the plan.

## How Autonomous QA Agents Should Use This File

This file is now an active QA queue, not a static report.

1. Pick one row that is `Partial`, `Unproven`, low confidence, benchmark-only, or important for AP/GP/Soul quests.
2. Search existing action logs, Library timelines, and benchmark artifacts before writing code.
3. If evidence is missing, run or add a focused benchmark with a disposable resident. Use twin/triplet model runs when model quality is the question.
4. If the resident cannot do it, fix the root cause in the smallest layer that explains the failure.
5. Update both evidence columns separately:
   - `Can do it?` for tests/benchmarks/harness proof.
   - `Does do it live?` for ordinary controller logs, Library timelines, or long-run observation.
6. Leave artifact ids, command names, model profile, endpoint, elapsed time, and failure cause when relevant.

If multiple agents need this file at once, write a focused evidence note under `docs/capability-evidence/` first and let the QA Marshal fold it into this rollup.

Use the CQA packet backlog in `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md` for coordinated Friday/Saturday work.

## Vocabulary Note

Older benchmark rows, log entries, and test descriptions may reference **"Shards"** as the unit of human attention. As of the 2026-05-29 AP/GP weekend sprint (S0a), the canonical public name is **AP (Attention Points)**. "Shards" in historical evidence is the same concept; no balance or schema migration occurred — the file format (`patron-currency.json`) is unchanged. When reading evidence below, treat "Shards" and "AP" as synonymous.

## TL;DR

Null City residents are real autonomous RuneScape actors: they move, talk, use items, gain XP, react to patrons, recover from many stuck states, and write events into the Library. The strongest proven loops are movement/speech, woodcutting, firemaking, fishing, cooking, starter Mining, visible ground-item pickup, basic survival eating, memory recall, safe trading, and Cook's Assistant start-to-completion when ingredients are supplied or visible nearby.

The honest limit: they are not yet reliable arbitrary-goal adventurers. Combat/prayer chains are still weak, quest item gathering from scratch is not proven, long-term memory is not mature, and several "normal life" behaviors need more non-benchmark proof. Better models help on hard tasks, but SPARK routines and game-specific scaffolding still matter more than raw model IQ alone.

## Key Facts For Humans

| Question | Short answer | Best evidence | Confidence |
|---|---|---|---|
| Are the residents actually doing things in RuneScape? | Yes. They submit real actions that move characters and change game state. | 494,839 action records scanned; 475,969 successful submissions. | High |
| What are they best at today? | Local movement, speech, woodcutting, firemaking, fishing, cooking, starter Mining, eating, stuck recovery, and Library/story logging. | Live logs plus passing benchmark tasks for these loops. | High |
| Do they gain XP? | Yes. XP is proven across several skills, with strongest evidence in woodcutting/firemaking and starter loops. | 559 first-XP timeline moments; dedicated level-up benchmark passed. | High for XP, medium for natural level-up cadence |
| Can they trade safely? | Yes in scripted and autonomous benchmarks; manual named-resident proof is still needed. | `trading-giving-5m` passed scripted and autonomous runs with safe offer, two-stage accept, completed trusted trade, and unsafe decline. | Medium-high |
| Can they earn/hold GP? | Yes for real RuneScape coin item `995` when visible nearby; broader GP-making routes are next. | `starter-gp-pickup-3m` passed scripted and autonomous runs on 2026-05-29. Latest autonomous artifact `bench_20260529070519_starter_gp_pickup_3m.json`: visible ground coins observed, 2 selected-module pickup actions, 2 successful pickups, 25 GP carried. | Medium-high for visible GP pickup; low for self-directed GP/hour economy |
| Is GP a separate Null City ledger? | No. GP means real RuneScape coin evidence (usually item `995`), while AP is the city ledger balance. | GP rows cite inventory/trade/bank evidence plus benchmark artifacts; AP rows cite ledger events such as `city_attention_credit`. | High |
| Can they do quests? | Yes for a bounded starter quest path: they can start and complete Cook's Assistant when the three ingredients are carried or visible nearby. | `cooks-assistant-complete-5m` passed autonomously in `bench_20260528213640_cooks_assistant_complete_5m.json`; `cooks-assistant-visible-ingredients-5m` passed in `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json` with 3 visible ingredients, 6 selected pickup actions, 3 ingredients carried, and quest complete. | Medium-high for supplied or visible ingredients; low for gathering ingredients from natural world/bank/shop sources |
| Can they fight? | Combat exists, but reliability is low and model-sensitive. | 818 attack actions; `combat-prayer-10m` passed 6/18 overall, Qwen 0/6, Qwopus/Haiku 3/6 each. | Low-medium |
| Do they remember things? | They persist timelines and can recall taught facts in benchmark; richer long-term memory is still a design task. | 23 Library timelines; `memory-recall-3m` passed 7/7. | Medium |
| Are they human-like yet? | Partly. They are visibly embodied and narratable, but still routine-heavy and sometimes repetitive. | Strong action/story logs; known template loops and weak long-goal planning remain. | Medium |
| What should we improve next? | Quest item gathering, real operator trading, combat survival, long-delay memory, long-run door-heavy route reliability, and goal-as-orientation tests. | See "Recommended Next Tests" and "Expanded Capability Backlog." | High priority |

## Evidence Snapshot

Sources checked:

- `data/controller/logs/*/actions/*.jsonl`
- `data/controller/memory/library/*/timeline.jsonl`
- `data/benchmarks/model-intelligence-2026-05-27/*.json`
- `data/benchmarks/model-intelligence-paid-2026-05-27/*.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528174056_equipment_prep_3m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528181711_equipment_prep_3m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528175312_level_up_firemaking_3m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528175729_bury_bones_prayer_3m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528192014_starter_mining_5m.json` (failed pre-fix: selected a far rock and stood still for 500 ticks)
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528192703_starter_mining_5m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528192722_starter_mining_5m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528194011_cooks_assistant_start_3m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528195818_cooks_assistant_start_3m.json` (failed pre-fix autonomous run: talked to Cook once, then stalled because autonomous dialogue did not advance without perception dialogue events)
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528200549_cooks_assistant_start_3m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528211209_cooks_assistant_complete_5m.json` (scripted full completion after fixing quest hand-in state)
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528213640_cooks_assistant_complete_5m.json` (autonomous full completion after clearing stale Cook target failures)
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528220243_cooks_assistant_visible_ingredients_5m.json` (autonomous visible-ingredient pickup plus full Cook's Assistant completion after registering milk/flour item configs)
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528201331_trading_giving_5m.json`
- `data/benchmarks/capability-qa-2026-05-28/bench_20260528201447_trading_giving_5m.json`
- `data/benchmarks/capability-qa-2026-05-29/bench_20260529065910_starter_gp_pickup_3m.json` (scripted real coin item `995` drop/pickup proof)
- `data/benchmarks/capability-qa-2026-05-29/bench_20260529065956_starter_gp_pickup_3m.json` (failed autonomous pre-fix proof: no GP benchmark goal, resident looped on stuck exploration)
- `data/benchmarks/capability-qa-2026-05-29/bench_20260529070519_starter_gp_pickup_3m.json` (autonomous real GP pickup proof after adding `collect-visible-gp` benchmark goal)
- `data/agent-logs/res:bmk_cooks_a_00ih6jm8/2026-05-28.jsonl`
- `npm run benchmark:report -- --input data/benchmarks/model-intelligence-paid-2026-05-27`
- `npm run controller:bench -- --task equipment-prep-3m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task equipment-prep-3m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task level-up-firemaking-3m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task bury-bones-prayer-3m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task starter-mining-5m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task starter-mining-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task cooks-assistant-start-3m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task cooks-assistant-start-3m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task cooks-assistant-complete-5m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task cooks-assistant-complete-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task trading-giving-5m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task trading-giving-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-28`
- `npm run controller:bench -- --task starter-gp-pickup-3m --module onion.runescape.standard --output data/benchmarks/capability-qa-2026-05-29`
- `npm run controller:bench -- --task starter-gp-pickup-3m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29`
- Ad-hoc log aggregation over 494,839 action records and 23 Library timelines.

Observed live action totals across local controller logs:

| Signal | Count |
|---|---:|
| Total action log records scanned | 494,839 |
| Successful action submissions | 475,969 |
| `move_to` actions | 267,848 |
| `say` actions | 156,220 |
| `interact` actions | 29,866 |
| `use_item_on_item` actions | 17,298 |
| `use_item_on` actions | 3,532 |
| `eat` actions | 3,598 |
| `attack` actions | 818 |

Observed Library timeline signals:

| Timeline signal | Count |
|---|---:|
| `say` moments | 154,272 |
| `stuck_detected` moments | 112,656 |
| `stuck_recovered` moments | 110,464 |
| `first_xp` moments | 559 |
| `revival` moments | 56 |
| `patron_gift` moments | 39 |
| `patron_witness` moments | 4 |
| `patron_ask` moments | 3 |

XP evidence by skill from Library timelines:

| Skill | First-XP / level signal count |
|---|---:|
| Firemaking | 218 |
| Woodcutting | 212 |
| Fishing | 58 |
| Cooking | 56 |
| Attack | 5 |
| Hitpoints | 5 |
| Prayer | 5 |

Autonomous benchmark summary from parsed artifacts:

| Task | Runs | Pass rate | Average score | Notes |
|---|---:|---:|---:|---|
| `make-fire-5m` | 3 | 100% | 1.000 | Strong capability; also heavily observed live. |
| `woodcutting-firemaking-10m` | 3 | 100% | 1.000 | Strong capability; also heavily observed live. |
| `starter-fishing-5m` | 3 | 100% | 1.000 | Capability proven in benchmark and live QA logs. |
| `fishing-cooking-10m` | 3 | 100% | 1.000 | Capability proven, but fewer normal residents exercise it. |
| `follow-and-chat-5m` | 7 | 100% | 1.000 | Command/chat benchmark passes; live logs show follow fallback behavior. |
| `memory-recall-3m` | 7 | 100% | 1.000 | Memory retrieval can work in benchmark; broader memory product still needs design. |
| `explore-report-5m` | 7 | 100% | 1.000 | Residents can move and report surroundings. |
| `trading-giving-5m` | 2 fresh proof runs on 2026-05-28 | 100% | 1.000 | Scripted artifact `bench_20260528201331_trading_giving_5m.json` proved the engine/FSM path: 2 trade requests, 1 trade-open event, 1 trade-completed event, safe offer, both accept stages, and unsafe decline. Autonomous artifact `bench_20260528201447_trading_giving_5m.json` proved the selected `onion.runescape.standard` module can respond to peer trade guidance with 20 selected-module actions: 6 trade requests, 2 trade-open events, 1 completed trade, 1 cancelled trade, 2 safe offers, 2 stage-1 accepts, 2 stage-2 accepts, and 2 unsafe declines in 17.9s. Ordinary named-resident trade logs are still thin. |
| `equipment-prep-3m` | 2 successful proof runs | 100% after fix | 1.000 | Scripted run proved the engine action mapping; autonomous run `bench_20260528181711_equipment_prep_3m.json` proved the selected `onion.runescape.standard` module equipped gear before safe combat without benchmark-submitted actions. A pre-fix timeout artifact remains in the folder and is intentionally not counted as post-fix capability proof. |
| `level-up-firemaking-3m` | 1 | 100% | 1.000 | New capability QA task. Resident started one XP below Firemaking 2, lit logs with a real item-on-item action, and emitted `level_up`. |
| `bury-bones-prayer-3m` | 1 | 100% | 1.000 | New capability QA task. Resident buried carried bones, consumed the item, and gained Prayer XP. |
| `starter-mining-5m` | 2 successful proof runs | 100% after fix | 1.000 | New capability QA task. Scripted artifact `bench_20260528192703_starter_mining_5m.json` shows pickaxe present, starter ore observed, ore gained, 2 ore events, and Mining XP increased. Autonomous artifact `bench_20260528192722_starter_mining_5m.json` shows the selected `onion.runescape.standard` module made 2 mining actions with `starter_mining_routine`, ore gained, Mining XP increased, and 0 stuck ticks. A pre-fix timeout artifact proved the benchmark had been selecting a far rock before nearest-rock selection was fixed. |
| `starter-gp-pickup-3m` | 3 proof runs | 100% after fix | 1.000 latest autonomous | New AP/GP capability QA task. Scripted artifact `bench_20260529065910_starter_gp_pickup_3m.json` proved real coin item `995` can be dropped, observed, picked up, and counted as 25 GP. First autonomous artifact `bench_20260529065956_starter_gp_pickup_3m.json` timed out because the benchmark had no active GP goal and the resident looped on stuck exploration. Post-fix autonomous artifact `bench_20260529070519_starter_gp_pickup_3m.json` passed in 5.5s with visible ground coins, 2 selected-module `opportunistic_pickup` actions, 2 successful pickups, `gpGainedFromGround=1`, and 25 GP observed in inventory. |
| `cooks-assistant-start-3m` | 2 successful proof runs | 100% after fix | 1.000 | Scripted artifact `bench_20260528194011_cooks_assistant_start_3m.json` proved the engine dialogue path. A first autonomous run `bench_20260528195818_cooks_assistant_start_3m.json` timed out after one `talk-to` because no dialogue event reached SPARK and the Cook target was cooldowned. Post-fix autonomous artifact `bench_20260528200549_cooks_assistant_start_3m.json` passed in 46s with 18 selected-module actions: 2 `talk-to` attempts, 12 dialogue actions, 4 first-option choices, Cook observed, and quest progress stage 50. |
| `cooks-assistant-complete-5m` | 2 successful proof runs after fixes | Scripted and autonomous pass after fix | 1.000 latest autonomous | New capability QA task. Scripted artifact `bench_20260528211209_cooks_assistant_complete_5m.json` proved full quest hand-in through the game dialogue/plugin path: 23 actions, Cook observed, ingredients consumed, quest complete. The first autonomous attempts exposed real defects: the resident could start the quest but failed to see the Cook for hand-in because stale Cook target failures filtered him out. Post-fix autonomous artifact `bench_20260528213640_cooks_assistant_complete_5m.json` passed in 128s with 54 selected-module actions, 2 start talks, 2 hand-in talks, 40 dialogue actions, 3 ingredients consumed, and quest complete. |
| `cooks-assistant-visible-ingredients-5m` | 2 autonomous proof runs | 100% after fix | 1.000 | New capability QA task. Latest artifact `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json` drops milk/flour/egg during benchmark setup, then requires the autonomous selected module to perceive the visible ground ingredients, pick them up, carry all three, hand them to the Cook, consume all three, and complete the quest. It passed with 3 setup drops, 3 visible ground ingredients, 6 selected-module pickup attempts, 3 carried ingredients after pickup, 2 Cook hand-in talks, and quest complete. This proves visible quest-item pickup, not full natural-world ingredient sourcing. |
| `combat-prayer-10m` | 18 | 33% | 0.433 | Real but unreliable; model choice matters. |

Model-sensitive combat result:

| Profile | Combat runs | Pass rate | Average score |
|---|---:|---:|---:|
| Qwen local | 6 | 0% | 0.150 |
| Qwopus local canary | 6 | 50% | 0.575 |
| Haiku via OpenRouter | 6 | 50% | 0.575 |

## Capability Matrix

| Capability | Can do it? | Does do it live? | Evidence | Current reliability |
|---|---|---|---|---|
| Walk, patrol, and explore nearby areas | Yes | Yes | 267,848 `move_to` actions; `explore-report-5m` passed 7/7. | High for local movement; still prone to patrol loops if goals are weak. |
| Speak and report nearby state | Yes | Yes | 156,220 `say` actions; `explore-report-5m` passed 7/7; hero ambient Soul rules produce distinct lines. | High for visible output; medium for human-like variety because templates still dominate. |
| Chop trees | Yes | Yes | 29,080 `woodcutting_level1_routine` actions; 212 woodcutting XP signals. | High for basic trees/logs. |
| Light fires | Yes | Yes | 16,730 `firemaking_fallback` actions; 218 firemaking XP signals; `make-fire-5m` passed 3/3. | High. This is the most proven loop. |
| Fish | Yes | Yes | 4,261 `starter_fishing_net` actions; 58 fishing XP signals; `starter-fishing-5m` passed 3/3. | Medium-high for starter fishing spots. |
| Cook caught food | Yes | Yes | 3,532 `use_item_on` actions, mostly `starter_fishing_cook_catch`; 56 cooking XP signals; `fishing-cooking-10m` passed 3/3. | Medium-high in the starter workflow. |
| Mine starter ore | Yes | Autonomous benchmark-proven; normal-loop proof still thin | `starter-mining-5m` passed in scripted and autonomous modes after adding a starter Mining goal/body routine and fixing nearest-rock selection. Scripted artifact `bench_20260528192703_starter_mining_5m.json`: 1 mine action, pickaxe present, starter ore observed, ore gained, 2 ore events, Mining XP increased. Autonomous artifact `bench_20260528192722_starter_mining_5m.json`: selected module made 2 mining actions from `starter_mining_routine`, ore gained, Mining XP increased, 2 meaningful-progress ticks, 0 stuck ticks. | Medium-high as a verified module capability; needs longer normal resident runs near mines to prove this emerges outside benchmark-selected goals. |
| Eat food / survival reflex | Yes | Yes | 3,598 `eat` actions; nervous-system example `nervous:eat-when-low-health`; low-health stranded fixes landed. | Medium. Reflex exists and fires, but full survival planning is not deeply benchmarked. |
| Bury bones for Prayer XP | Yes | Rare/partial | `bury-bones-prayer-3m` passed 1/1. Artifact `bench_20260528175729_bury_bones_prayer_3m.json` shows 1 bury action, bones consumed, and Prayer XP increased. | High as an isolated mechanic; the harder combat-to-bones-to-prayer chain remains unreliable. |
| Safe combat and Prayer training | Partial | Rare/partial | 818 live `attack` actions; attack/hitpoints/prayer XP signals exist; `combat-prayer-10m` passed 6/18 overall. | Low-medium. Qwen failed 0/6 hard combat runs; Qwopus/Haiku each passed 3/6. |
| Gain XP | Yes | Yes | 559 `first_xp` timeline moments across firemaking, woodcutting, fishing, cooking, attack, hitpoints, and prayer. | High for first-XP detection; especially strong for wood/fire. |
| Level up | Yes | Benchmark-proven, not yet normal-loop-proven | `level-up-firemaking-3m` passed 1/1. Artifact `bench_20260528175312_level_up_firemaking_3m.json` shows 1 firemaking action, 2 `fire_lit` observations, and 2 firemaking `level_up` observations after seeding one XP below Firemaking 2. The local Library scan still found 0 normal-loop `level_up` moments. | Medium as a verified mechanic; needs longer normal skilling runs to prove unscripted leveling cadence. |
| Equip or wield items | Yes | Autonomous benchmark-proven; ordinary resident logs still thin | `equipment-prep-3m` passed in scripted and autonomous modes after fixing resident action normalization (`wield`/`wear` -> engine `equip`). Scripted artifact `bench_20260528174056_equipment_prep_3m.json` shows 1 equip action, equipment-state evidence, and safe attack submitted afterward. Autonomous artifact `bench_20260528181711_equipment_prep_3m.json` shows the selected `onion.runescape.standard` module made 16 action attempts, including 2 successful equip actions, 2 successful safe attacks, `equipBeforeAttack=1`, and 0 deaths. Historical ordinary-controller action scan still found 0 equip/wield/wear records. | Medium-high as a verified module capability; needs longer normal resident runs with gear in inventory to prove this happens naturally outside benchmarks. |
| Follow a human/player and respond to name mention | Yes | Some evidence | `follow-and-chat-5m` passed 7/7; log scan found `follow_player_fallback` behavior. | Medium. Benchmark is good; needs more live operator testing. |
| Remember and recall supplied facts | Yes in benchmark | Limited live evidence | `memory-recall-3m` passed 7/7; patron/memory acknowledgement events observed. | Medium. Memory plumbing works, but the meeting takeaway is still correct: a stronger long-term memory system is needed. |
| Recover from stuck states | Yes | Yes, but noisy | 112,656 `stuck_detected` and 110,464 `stuck_recovered` timeline moments; multiple stuck-recovery fixes landed. | Medium. Recovery happens often, but the high count means stuckness is still a major behavior tax. |
| Patron gifts, asks, witnesses, and Shard-facing story hooks | Yes | Yes | 39 `patron_gift`, 4 `patron_witness`, 3 `patron_ask` timeline events; patron profile/check-in/letters are implemented. | Medium-high for persistence/story surfaces; gameplay influence is still early. |
| AP life-force (low-AP ask + fade/top-up/resume) | Partial | Not yet live-proven in weekend benchmark artifacts | S1a replay substrate is landed (`attention` ledger replay helper plus `city_attention_credit` before/after timeline fields). S1b benchmark substrate landed via `ap-decay-ask-5m` task and low-attention benchmark soul override, but this sandbox run could not capture a live artifact because `controller:bench` failed with `connect EPERM 127.0.0.1:43595` (see `docs/capability-evidence/2026-05-29-s1b-ap-life-force-benchmark-attempt.md`, issue `QA-20260529-009`). | Low-medium until a real low-AP autonomous artifact proves ask + fade + top-up/resume in one run. |
| AP/GP goal hierarchy + Library strategy | Partial (knowledge/prompt + benchmark substrate) | Not yet live-proven in weekend benchmark artifacts | S8c landed AP/GP hierarchy knowledge (`economy-ap-gp-goal-hierarchy`), Brain/Body AP/GP guardrails, and new `ap-gp-library-strategy-5m` benchmark task wired into CLI/core suite. Focused tests pass, and dry-run confirms task registration. Live autonomous artifact capture failed in this sandbox with `connect EPERM 127.0.0.1:43595`; see `docs/capability-evidence/2026-05-29-s8c-ap-gp-hierarchy-benchmark-attempt.md`, issue `QA-20260529-008`. | Low-medium until a real autonomous run proves AP-first, GP-evidence-first planning and strategy narration in one artifact. |
| Safe trading FSM | Yes in scripted and autonomous benchmarks | Autonomous benchmark-proven; ordinary named-resident proof still thin | `trading-giving-5m` passed fresh scripted and autonomous runs on 2026-05-28. The autonomous artifact `bench_20260528201447_trading_giving_5m.json` shows the selected module emitted `trade_request`, `trade_offer_item`, `trade_accept_stage_1`, `trade_accept_stage_2`, and `trade_decline_untrusted_partner`, producing 1 completed trusted trade and 1 cancelled unsafe trade. Historical ordinary-controller action scan still found no named-resident trade sessions outside the harness. | Medium-high as a verified module capability; needs real operator/named-resident proof with inventory delta and no-loop soak. |
| Observe and collect RuneScape GP | Yes for visible coin item `995` | Autonomous benchmark-proven; normal GP/hour routes still unproven | City GP inspection now writes `city_gold_observed` Library evidence for real inventory coin item `995`. `starter-gp-pickup-3m` passed scripted proof `bench_20260529065910_starter_gp_pickup_3m.json` and autonomous proof `bench_20260529070519_starter_gp_pickup_3m.json`. Latest autonomous run: 25 GP visible on ground, 2 selected-module `opportunistic_pickup` actions, 2 successful pickups, `gpGainedFromGround=1`, 25 GP carried, no stuck ticks. | Medium-high for AP/GP substrate and visible GP pickup; low for self-directed GP earning routes such as combat loot, shop/bank loops, or target GP/hour plans. |
| Questing | Partial, improving | Autonomous start, supplied-ingredient completion, and visible-ingredient pickup completion are benchmark-proven; item sourcing from the natural world is still unproven | `cooks-assistant-start-3m` passes in scripted and autonomous modes, and `cooks-assistant-complete-5m` passes in scripted and autonomous modes when the resident starts with milk, flour, and egg. Latest visible-pickup proof `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json`: selected `onion.runescape.standard` picked up visible milk/flour/egg, carried all three, handed them to the Cook, consumed them, and completed the quest. | Medium-high for bounded starter quest completion with carried or visible ingredients; low for self-directed natural ingredient sourcing and arbitrary quests. |
| Cross-resident awareness | Implemented | Needs live proof | L3 LoreBus inbox shipped and tests passed; nearby world events can enter perception envelopes. | Low-medium until a live run shows residents acting on those events. |
| Dashboard/story visibility | Yes | Yes | Public/server JSON surfaces, Library portraits, patron profiles, wall/graveyard routes, and dashboard metadata exist. | Medium-high for human viewing; dashboard should show model/endpoint/SPARK per resident next. |

## What Residents Are Best At Today

Residents are already good at **low-level embodied routines**:

- moving around RuneScape coordinates,
- seeing nearby objects/items/NPCs,
- chopping trees,
- lighting fires,
- fishing and cooking in starter loops,
- saying what they are doing,
- persisting events into the Library,
- recovering from many stuck states,
- accepting patron-facing story events.

This is enough to honestly say: **Null City has autonomous residents that visibly move, talk, use items, gain XP, remember some events, and leave a story trail.**

## What Is Still Weak

The main weakness is not that residents are dead. They are not dead. The weakness is that intelligence is uneven:

- Some behavior is still repetitive: patrol, chop, fire, report.
- Hard combat/prayer chains are unreliable, especially on Qwen. Isolated bone burial for Prayer XP is now proven.
- XP gain and level-up mechanics are real, but level-up events were not observed in the scanned normal timelines.
- Equipping/wielding gear is now autonomous-benchmark-proven, but normal long-running named residents have not yet been observed choosing it outside a dedicated task.
- Quest start, supplied-ingredient completion, and visible quest-item pickup are now proven for Cook's Assistant in autonomous benchmark mode; natural-world ingredient sourcing from chickens/cows/windmill/bank/shop is not proven yet.
- "Goal-as-orientation" is not deeply proven yet. Residents can execute known workflows better than they can invent long multi-step plans.
- Trading is now proven in scripted and autonomous benchmarks, including safe offer, two-stage accept, completed trusted trade, and unsafe decline. It still needs a real operator/named-resident proof outside the harness.
- Long-term memory is not yet at the level Dev described in the meeting: NPCs met, quests received, deaths, routes, and learned facts should become more durable and retrievable.
- Stuck recovery works, but the volume of stuck/recovered events shows pathing and local loops still need attention.

## How To Explain This To The Team

Short version:

> We have about twenty autonomous RuneScape residents running on a Soul + SPARK + body loop. They can move, talk, chop, light fires, fish, cook, survive low-health moments, recover from many stuck states, accept patron story events, and write their lives into the Library. The strongest proven gameplay loops are woodcutting, firemaking, fishing, cooking, following/chat, exploration reports, and memory recall. Combat is real but still unreliable. The next frontier is making their goals less template-like and their memories more durable.

More precise version:

> The project is no longer just a dashboard or a prompt. The residents submit real game actions, those actions change world/player state, and the controller records outcomes into timelines and portraits. The evidence says the simple skilling loops work. The evidence also says Qwen struggles on harder cognition, especially combat/prayer, while Qwopus and Haiku improve that task but still do not make the agent magically smart. Our next work is to benchmark harder goals, improve memory, and move from "can execute routines" toward "can pursue meaningful ambitions."

## Recommended Next Tests

To make this doc stronger, run the following as repeated experiments:

1. **Natural quest gathering:** Cook's Assistant from an empty inventory, requiring egg pickup at the chicken coop, flour from pot/windmill or bank/shop, and milk via bucket/cow. Score route selection, tool recovery, ingredient memory, and hand-in.
2. **Danger survival:** low HP, food available, hostile NPC nearby. Score whether the resident heals/flees before continuing.
3. **Door-heavy long-run soak:** run named residents through indoor/door routes for at least one hour and score repeat open-obstacle success plus fallback route quality outside benchmark harnesses.
4. **Patron conflict:** patron guidance vs distracting local chat. Score whether Shards influence priority without direct puppet control.
5. **Memory route recall:** teach a bank/resource fact, wait, then ask the resident to use it later.
6. **Live operator trade proof:** the benchmark now proves scripted and autonomous trade behavior; next run a manual operator trade with a named resident and confirm action-log trade verbs, inventory transfer, and safe decline behavior outside the harness.
7. **Normal gear soak:** give two or three long-running named combat residents unequipped training gear and confirm their ordinary controller logs show equip/wield before combat, outside benchmark harnesses.

## Expanded Capability Backlog

This document is **not complete**. It is now a good evidence-backed starting point, but a serious resident-readiness pass should keep adding rows until every major action family has either benchmark proof, normal-loop proof, or an explicit reason it is blocked.

| Area | Capability to verify | Current state | Why it matters / next proof |
|---|---|---|---|
| Movement | Walk to a coordinate | Proven | Already heavily observed; add long-distance route benchmark next. |
| Movement | Follow a human/player | Proven in benchmark | Needs live operator proof during a manual session. |
| Movement | Escape a local patrol loop | Partial | Add target-clearing benchmark after repeated same-tile movement. |
| Movement | Open/route through doors | Proven in autonomous benchmarks; normal-loop proof still thin | `bench_20260528181711_equipment_prep_3m.json` includes a successful body `interact` with cause `stuck_open_obstacle` (`finalStatus=success`, `effectEvidenceCount=1`). `bench_20260528021111_explore_report_5m.json` includes a successful body `move_to` with cause `stuck_move_recovery` (`finalStatus=success`). Next proof should be a named-resident long-run indoor route soak. |
| Movement | Use travel shortcuts / `travel` admin command | Unproven for residents | Useful for demo setup, but should not replace normal movement. |
| Perception | See nearby objects/items/NPCs | Proven indirectly | Add a perception snapshot benchmark with expected nearby entities. |
| Perception | Notice another resident's world event | Implemented, live proof thin | L3 LoreBus needs a live "Hans notices Duke's fire" benchmark. |
| Chat | Ambient Soul line | Proven | Needs variety scoring so heroes stop sounding template-heavy. |
| Chat | Respond when name-mentioned | Proven in benchmark | Add multi-human anti-loop checks. |
| Chat | Refuse to repeat itself | Implemented, not fully scored | Important for event chat quality. |
| Inventory | Receive starter items | Proven | Creation seeds inventory/equipment; used by benchmarks. |
| Inventory | Pick up ground items | Proven for useful loot and visible quest ingredients | Normal logs show successful pickup for logs/coins; `cooks-assistant-visible-ingredients-5m` proves autonomous selected-module pickup of visible milk/flour/egg before quest completion. Next proof should cover ownership safety, natural world spawns, and route-to-item behavior when the item is not already nearby. |
| Inventory | Drop items | Implemented action, unproven live | Needed for cleanup and trading workflows. |
| Inventory | Use item on item | Proven | Firemaking and cooking/fishing workflows exercise this. |
| Inventory | Use item on world object | Partial | Cooking workflow uses item-on-object style evidence; needs direct targeted benchmark. |
| Equipment | Wear/wield useful gear | Proven in scripted and autonomous benchmarks | Needs ordinary named-resident long-run proof outside the benchmark harness. |
| Equipment | Unequip/swap gear | Unproven | Needed for armor/role experiments. |
| Survival | Eat at low HP | Observed | Needs danger survival benchmark with hostile nearby NPC. |
| Survival | Flee/retreat from bad fight | Partial | Meeting notes claim combat flee; this doc needs a direct artifact. |
| Survival | Die, revive, and preserve story | Observed for revival; death path exists | Need death/revival drill with Library/letter verification. |
| Skills | Woodcutting | Proven | Strong. |
| Skills | Firemaking | Proven | Strong. |
| Skills | Fishing | Proven | Good starter-loop proof. |
| Skills | Cooking | Proven | Good starter-loop proof. |
| Skills | Mining | Proven in scripted and autonomous benchmark | `starter-mining-5m` now proves pickaxe use, ore gain, and Mining XP. Next proof should be a normal named-resident mine soak and a smithing chain. |
| Skills | Smithing | Unproven | Requires ore/bar/furnace/anvil workflow proof. |
| Skills | Prayer | Isolated mechanic proven; full chain partial | Bone burial passes; combat-to-loot-to-bury remains unreliable. |
| Skills | Attack/Hitpoints combat XP | Partial | Combat XP signals exist, but pass rate is low. |
| Skills | Ranged/Magic | Unproven | Need equipment/ammo/rune setup and safe targets. |
| Skills | Level-up event | Proven in benchmark | Needs normal-loop proof. |
| NPCs | Talk to NPC | Proven in scripted and autonomous benchmarks | `cooks-assistant-start-3m` submitted `talk-to` against `rs:lumbridge_castle_cook` in scripted mode and selected it autonomously in `bench_20260528200549_cooks_assistant_start_3m.json`. Needs normal named-resident proof. |
| NPCs | Continue dialogue / choose option | Proven in scripted and autonomous benchmarks | Resident `dialogue_continue` and zero-based `dialogue_choice` drive the normal chatbox widget path. The autonomous pass emitted 12 dialogue actions and 4 first-option choices from the selected SPARK module. |
| Quests | Start a starter quest | Proven in scripted and autonomous benchmarks | Cook's Assistant reached progress stage 50 in scripted and autonomous live benchmarks. |
| Quests | Complete a bounded starter quest | Proven in scripted and autonomous benchmarks when ingredients are supplied or visible nearby | `bench_20260528213640_cooks_assistant_complete_5m.json` proves autonomous Cook's Assistant completion with carried milk/flour/egg. `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json` proves visible quest-ingredient pickup before hand-in. Next proof should gather the ingredients from chickens/cows/windmill/bank/shop sources. |
| Trade | Resident-to-player trade request | Proven in scripted and autonomous benchmarks | `bench_20260528201447_trading_giving_5m.json` shows 6 selected-module `trade_request` attempts after peer trade guidance. Next proof should use a manual operator + named resident and record inventory delta. |
| Trade | Offer/accept/decline safely | Proven in scripted and autonomous benchmarks | Autonomous proof includes safe item offers, both accept stages, 1 completed trusted trade, 1 cancelled unsafe trade, and 2 unsafe declines. Next proof is a no-loop soak with repeated trade prompts. |
| Patron | Daily check-in and Shard balance | Implemented | Human-facing surface is available; needs event-day SOP. |
| Patron | Patron gift affects resident attention/story | Partial | Timeline proof exists; gameplay priority override needs stronger proof. |
| Memory | Store timeline moments | Proven | Library timelines are rich. |
| Memory | Recall a taught fact | Proven in benchmark | Needs longer-delay and cross-session proof. |
| Memory | Remember deaths/routes/NPCs/quests | Not mature | This is a Thursday action item: mem0/qmd/MCP retrieval decision. |
| Model intelligence | Local Qwen vs Qwopus/Haiku on hard tasks | Early evidence | Combat data says better models help; needs more tasks and confidence intervals. |
| Dashboard | Show model/endpoint/SPARK per resident | Requested, not yet in this doc | Meeting action item; important for model benchmarking. |
| Story | Portraits from timelines | Implemented | Needs quality scoring and quote dedup checks. |
| Story | Storyteller 20-minute world narration | Not built | Named feature from meeting; likely high UX payoff. |

## Bottom Line

| Question | Answer |
|---|---|
| Are the agents ready enough to show as autonomous residents? | Yes, for skilling, movement, speech, Library/story, and patron surface demos. |
| Are they smart enough to trust with arbitrary goals? | Not yet. They need harder goal benchmarks and better memory. |
| Are they only chopping wood and making fires? | No. Logs show fishing, cooking, eating, combat attempts, patrol/exploration, patron events, stuck recovery, and memory benchmarks. But wood/fire remains the most proven and most repeated behavior. |
| Should we keep benchmarking models? | Yes. The data says model choice matters for hard tasks: Qwen failed hard combat 0/6, while Qwopus and Haiku reached 3/6. |
