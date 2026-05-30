# Null City resident capabilities

Last updated: 2026-05-30

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

The honest limit: they are not yet reliable arbitrary-goal adventurers. Starter combat is now hot-stack proven, but longer combat/prayer goals are still model-sensitive; quest item gathering from scratch is not proven, long-term memory is not mature, and several "normal life" behaviors need more non-benchmark proof. Better models help on hard tasks, but SPARK routines and game-specific scaffolding still matter more than raw model IQ alone.

## Key Facts For Humans

| Question | Short answer | Best evidence | Confidence |
|---|---|---|---|
| Are the residents actually doing things in RuneScape? | Yes. They submit real actions that move characters and change game state. | 494,839 action records scanned; 475,969 successful submissions. | High |
| What are they best at today? | Local movement, speech, woodcutting, firemaking, fishing, cooking, starter Mining, eating, stuck recovery, and Library/story logging. | Live logs plus passing benchmark tasks for these loops. | High |
| Do they gain XP? | Yes. XP is proven across several skills, with strongest evidence in woodcutting/firemaking and starter loops. | 559 first-XP timeline moments; dedicated level-up benchmark passed. | High for XP, medium for natural level-up cadence |
| Can they trade safely? | Yes in scripted/autonomous benchmarks plus live named-resident operator/no-loop soaks. | `trading-giving-5m` passed scripted/autonomous runs; CQA4 `named_trade_soak_20260530125718.json` shows `res:qa-trader` completed a trusted trade, then declined 3 repeated unsafe prompts with 0 unsafe offer/accept follow-through. | High for directed safe trade; low for spontaneous ordinary-life trade recurrence |
| Can they earn/hold GP? | Yes for real RuneScape coin item `995` when visible nearby; broader GP-making routes are next. | `starter-gp-pickup-3m` passed scripted and autonomous runs on 2026-05-29. Latest autonomous artifact `bench_20260529070519_starter_gp_pickup_3m.json`: visible ground coins observed, 2 selected-module pickup actions, 2 successful pickups, 25 GP carried. | Medium-high for visible GP pickup; low for self-directed GP/hour economy |
| Can GP buy AP? | Yes in controlled benchmark proof and now through the live city HTTP/operator route; ordinary resident-initiated exchange is still separate. | `bench_20260530034914_ap_gp_exchange_5m.json`: real coin item `995` observed, 25 GP burned, 50 AP credited, linked AP+GP evidence accepted. CQA4 HTTP proof on 2026-05-30 exchanged `res:qa-angler` 25 real GP for 50 AP (`275 -> 250` GP, `24953 -> 25003` AP), with Library `city_ap_gp_exchange`, `/economy/live`, and dashboard BFF evidence. | High for substrate/operator route; low-medium for live social emergence |
| Is GP a separate Null City ledger? | No. GP means real RuneScape coin evidence (usually item `995`), while AP is the city ledger balance. | GP rows cite inventory/trade/bank evidence plus benchmark artifacts; AP rows cite ledger events such as `city_attention_credit`. | High |
| Can they do quests? | Yes for a bounded starter quest path: they can start and complete Cook's Assistant when the three ingredients are carried or visible nearby. | `cooks-assistant-complete-5m` passed autonomously in `bench_20260528213640_cooks_assistant_complete_5m.json`; `cooks-assistant-visible-ingredients-5m` passed in `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json` with 3 visible ingredients, 6 selected pickup actions, 3 ingredients carried, and quest complete. | Medium-high for supplied or visible ingredients; low for gathering ingredients from natural world/bank/shop sources |
| Can they fight? | Yes for starter safe combat and bounded Prayer training; broader reliability is still model-sensitive. | 818+ attack actions; historical `combat-prayer-10m` triplets passed 6/18 (`Qwen 0/6`, `Qwopus 3/6`, `Haiku 3/6`). CQA5 fixed an early unsafe-loop abort and then passed 2/2 fresh local autonomous reruns: `bench_20260530122158_combat_prayer_10m.json` and `bench_20260530122229_combat_prayer_10m.json` both show safe attacks, combat-supplied bones, pickup, bury, Prayer XP, and no deaths. Hot-stack named-resident proof now passed: `named_combat_soak_20260530171822.json` shows `res:qa-survivor` reached the Lumbridge goblin field, made 2 safe Goblin attacks, observed combat evidence, and had 0 unsafe attacks/deaths. Follow-up diagnostic `named_combat_soak_20260530173035.json` shows the same resident refused to re-engage while low health instead of dying or looping unsafe attacks. | Medium-high for directed starter combat; medium for bounded low-risk combat/prayer; low-medium for long ordinary combat goals |
| Do they remember things? | They persist timelines and can recall taught facts and delayed route facts in benchmarks; richer long-term memory is still a design task. | 23 Library timelines; `memory-recall-3m` passed 7/7; `memory-route-recall-5m` passed in `bench_20260530103544_memory_route_recall_5m` after direct-chat memory recall and retained-chat dedupe fixes. | Medium-high for taught/seeded facts; medium for ordinary long-run memory |
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
- `data/benchmarks/capability-qa-2026-05-30/bench_20260530103544_memory_route_recall_5m.json` (autonomous delayed route-recall proof after direct-chat memory recall, retained-chat dedupe, and stricter post-question scoring)
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
| `trading-giving-5m` + CQA4 named trade soak | 2 fresh benchmark proof runs plus 2 named-resident live soaks | 100% | 1.000 | Scripted artifact `bench_20260528201331_trading_giving_5m.json` proved the engine/FSM path: 2 trade requests, 1 trade-open event, 1 trade-completed event, safe offer, both accept stages, and unsafe decline. Autonomous artifact `bench_20260528201447_trading_giving_5m.json` proved the selected `onion.runescape.standard` module can respond to peer trade guidance with 20 selected-module actions: 6 trade requests, 2 trade-open events, 1 completed trade, 1 cancelled trade, 2 safe offers, 2 stage-1 accepts, 2 stage-2 accepts, and 2 unsafe declines in 17.9s. Follow-up artifact `named_trade_soak_20260530092531.json` proved ordinary `res:qa-trader` logs can complete a trusted operator-style trade and decline an unsafe peer with a safe inventory delta outside the benchmark harness. No-loop artifact `named_trade_soak_20260530125718.json` proved 1 trusted trade completion plus 3 repeated unsafe prompts: 4 trade requests, 1 safe offer, both accept stages, 3 unsafe declines, 1 trade completion, 3 trade cancellations, safe inventory delta `-1`, and `postUnsafeOffersOrAccepts=0`. |
| `equipment-prep-3m` | 2 successful proof runs | 100% after fix | 1.000 | Scripted run proved the engine action mapping; autonomous run `bench_20260528181711_equipment_prep_3m.json` proved the selected `onion.runescape.standard` module equipped gear before safe combat without benchmark-submitted actions. A pre-fix timeout artifact remains in the folder and is intentionally not counted as post-fix capability proof. |
| `level-up-firemaking-3m` | 1 | 100% | 1.000 | New capability QA task. Resident started one XP below Firemaking 2, lit logs with a real item-on-item action, and emitted `level_up`. |
| `bury-bones-prayer-3m` | 1 | 100% | 1.000 | New capability QA task. Resident buried carried bones, consumed the item, and gained Prayer XP. |
| `starter-mining-5m` | 2 successful proof runs | 100% after fix | 1.000 | New capability QA task. Scripted artifact `bench_20260528192703_starter_mining_5m.json` shows pickaxe present, starter ore observed, ore gained, 2 ore events, and Mining XP increased. Autonomous artifact `bench_20260528192722_starter_mining_5m.json` shows the selected `onion.runescape.standard` module made 2 mining actions with `starter_mining_routine`, ore gained, Mining XP increased, and 0 stuck ticks. A pre-fix timeout artifact proved the benchmark had been selecting a far rock before nearest-rock selection was fixed. |
| `starter-gp-pickup-3m` | 3 proof runs | 100% after fix | 1.000 latest autonomous | New AP/GP capability QA task. Scripted artifact `bench_20260529065910_starter_gp_pickup_3m.json` proved real coin item `995` can be dropped, observed, picked up, and counted as 25 GP. First autonomous artifact `bench_20260529065956_starter_gp_pickup_3m.json` timed out because the benchmark had no active GP goal and the resident looped on stuck exploration. Post-fix autonomous artifact `bench_20260529070519_starter_gp_pickup_3m.json` passed in 5.5s with visible ground coins, 2 selected-module `opportunistic_pickup` actions, 2 successful pickups, `gpGainedFromGround=1`, and 25 GP observed in inventory. |
| `cooks-assistant-start-3m` | 2 successful proof runs | 100% after fix | 1.000 | Scripted artifact `bench_20260528194011_cooks_assistant_start_3m.json` proved the engine dialogue path. A first autonomous run `bench_20260528195818_cooks_assistant_start_3m.json` timed out after one `talk-to` because no dialogue event reached SPARK and the Cook target was cooldowned. Post-fix autonomous artifact `bench_20260528200549_cooks_assistant_start_3m.json` passed in 46s with 18 selected-module actions: 2 `talk-to` attempts, 12 dialogue actions, 4 first-option choices, Cook observed, and quest progress stage 50. |
| `cooks-assistant-complete-5m` | 2 successful proof runs after fixes | Scripted and autonomous pass after fix | 1.000 latest autonomous | New capability QA task. Scripted artifact `bench_20260528211209_cooks_assistant_complete_5m.json` proved full quest hand-in through the game dialogue/plugin path: 23 actions, Cook observed, ingredients consumed, quest complete. The first autonomous attempts exposed real defects: the resident could start the quest but failed to see the Cook for hand-in because stale Cook target failures filtered him out. Post-fix autonomous artifact `bench_20260528213640_cooks_assistant_complete_5m.json` passed in 128s with 54 selected-module actions, 2 start talks, 2 hand-in talks, 40 dialogue actions, 3 ingredients consumed, and quest complete. |
| `cooks-assistant-visible-ingredients-5m` | 2 autonomous proof runs | 100% after fix | 1.000 | New capability QA task. Latest artifact `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json` drops milk/flour/egg during benchmark setup, then requires the autonomous selected module to perceive the visible ground ingredients, pick them up, carry all three, hand them to the Cook, consume all three, and complete the quest. It passed with 3 setup drops, 3 visible ground ingredients, 6 selected-module pickup attempts, 3 carried ingredients after pickup, 2 Cook hand-in talks, and quest complete. This proves visible quest-item pickup, not full natural-world ingredient sourcing. |
| `combat-prayer-10m` / `controller:combat-soak` | 18 historical triplet runs + 2 fresh local post-fix reruns + hot-stack named-resident soak | 33% historical; 100% fresh post-fix local rerun; named soak passed on hot stack | 0.433 historical; 1.000 fresh | Real and now locally reproducible for the bounded safe-combat chain, but historical triplets remain model-sensitive. CQA5 fixed an early verifier abort after combat-supplied bones appeared; post-fix artifacts `bench_20260530122158_combat_prayer_10m.json` and `bench_20260530122229_combat_prayer_10m.json` passed with safe attack -> bones pickup -> bury -> Prayer XP and no deaths. The reusable named-resident soak verifier now passes `11/11` tests, hot-stack artifact `named_combat_soak_20260530171822.json` proves ordinary `res:qa-survivor` safe Goblin attacks with combat evidence, 0 unsafe attacks, and 0 deaths, and diagnostic artifact `named_combat_soak_20260530173035.json` records low-health refusal after prior combat as survival gating rather than an invisible timeout. |

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
| Safe combat and Prayer training | Yes for the bounded low-risk chain; partial for long ordinary combat goals | Hot-stack starter attack now proven; long ordinary combat remains rare | 818+ live `attack` actions; attack/hitpoints/prayer XP signals exist; historical `combat-prayer-10m` triplets passed 6/18 overall (Qwen 0/6, Qwopus 3/6, Haiku 3/6). CQA5 hardened verifier logic so repeated safe attacks no longer auto-fail once combat-supplied bones appear, then passed 2/2 fresh local autonomous reruns: `bench_20260530122158_combat_prayer_10m.json` and `bench_20260530122229_combat_prayer_10m.json` show safe attacks, combat-supplied bones, pickup, bury, Prayer XP, no unsafe targets, and no deaths. Hot-stack named-resident soak `named_combat_soak_20260530171822.json` proves ordinary `res:qa-survivor` followed a real `survive attack goblin` prompt into 2 safe Goblin attacks with combat evidence and no deaths; diagnostic rerun `named_combat_soak_20260530173035.json` shows low-health refusal after prior combat. See `docs/capability-evidence/2026-05-29-cqa11-model-intelligence-twins.md` and `docs/capability-evidence/2026-05-29-cqa5-combat-survival.md`. | Medium-high for directed starter combat; medium for bounded low-risk combat/prayer; low-medium for spontaneous longer combat and model-sensitive goals. |
| Gain XP | Yes | Yes | 559 `first_xp` timeline moments across firemaking, woodcutting, fishing, cooking, attack, hitpoints, and prayer. | High for first-XP detection; especially strong for wood/fire. |
| Level up | Yes | Benchmark-proven, not yet normal-loop-proven | `level-up-firemaking-3m` passed 1/1. Artifact `bench_20260528175312_level_up_firemaking_3m.json` shows 1 firemaking action, 2 `fire_lit` observations, and 2 firemaking `level_up` observations after seeding one XP below Firemaking 2. The local Library scan still found 0 normal-loop `level_up` moments. | Medium as a verified mechanic; needs longer normal skilling runs to prove unscripted leveling cadence. |
| Equip or wield items | Yes | Yes for named-resident prompted equip; spontaneous ordinary-life emergence still thin | `equipment-prep-3m` passed in scripted and autonomous modes after fixing resident action normalization (`wield`/`wear` -> engine `equip`). Scripted artifact `bench_20260528174056_equipment_prep_3m.json` shows 1 equip action, equipment-state evidence, and safe attack submitted afterward. Autonomous artifact `bench_20260528181711_equipment_prep_3m.json` shows the selected `onion.runescape.standard` module made 16 action attempts, including 2 successful equip actions, 2 successful safe attacks, `equipBeforeAttack=1`, and 0 deaths. Follow-up `CQA3` audit on 2026-05-29 found `0` ordinary `kind:"equip"` actions across `data/controller/logs/res:*/actions/*.jsonl`; `CQA10` one-hour normal-life audit also found `equip=0` in 7424 actions. `CQA3-live-rerun` now proves ordinary named-resident gear equip outside the benchmark harness: artifact `data/benchmarks/capability-qa-2026-05-30/named_equip_soak_20260530120900.json` shows `res:qa-survivor` started with two useful gear items in inventory, emitted ordinary thinking-source `equip` actions with cause `combat_equip_useful_gear` at `2026-05-30T12:08:59.655Z` and `2026-05-30T12:09:00.491Z`, ended with both useful items equipped, and had `postEquipAttacks=0`. See `docs/capability-evidence/2026-05-29-cqa3-normal-gear-soak.md`, `docs/capability-evidence/2026-05-29-cqa10-normal-life-audit.md`, and `docs/capability-evidence/2026-05-30-cqa3-live-named-equip-soak.md`. | Medium-high for inventory-to-equipment behavior when useful gear is available and combat is prompted; medium-low for spontaneous gear loops in long ordinary life; attack follow-through remains CQA5. |
| Follow a human/player and respond to name mention | Yes | Some evidence | `follow-and-chat-5m` passed 7/7; log scan found `follow_player_fallback` behavior. | Medium. Benchmark is good; needs more live operator testing. |
| Remember and recall supplied facts/routes | Yes | Yes for taught-fact recall; delayed route recall is benchmark-proven but still needs ordinary named-resident soak proof | `CQA7` audit over `data/agent-logs/res:bmk_memory_*` found 10 memory-recall benchmark runs with prompt receipt in all 10 and clear taught-fact recall responses in 9 (1 malformed structured-dump response). Ordinary controller logs show 29 `nervous:patron-memory-acknowledge` actions across 3 named residents (`res:agent`, `res:hans`, `res:pip`). Follow-up `CQA7` added `memory-route-recall-5m`; after fixing addressed route-memory direct chat and retained-chat dedupe, autonomous live artifact `bench_20260530103544_memory_route_recall_5m` passed with score `1` in 27.6s (`routeRecallQuestions=1`, `sayActions=2`, Lumbridge/Varrock/bank/path detail present). See `docs/capability-evidence/2026-05-30-cqa7-delayed-memory-route-recall.md` and issue `QA-20260529-012`. | Medium-high for taught fact + seeded route recall; medium for full memory reliability until ordinary named residents prove long-delay route/NPC/quest recall outside the harness. |
| Recover from stuck states | Yes | Yes, but noisy | 112,656 `stuck_detected` and 110,464 `stuck_recovered` timeline moments; multiple stuck-recovery fixes landed. | Medium. Recovery happens often, but the high count means stuckness is still a major behavior tax. |
| Patron gifts, asks, witnesses, and Shard-facing story hooks | Yes | Yes | 39 `patron_gift`, 4 `patron_witness`, 3 `patron_ask` timeline events; patron profile/check-in/letters are implemented. | Medium-high for persistence/story surfaces; gameplay influence is still early. |
| AP life-force (low-AP ask + fade/top-up/resume) | Yes | Benchmark-proven end-to-end; named-resident AP ask + top-up now live-proven | S1a replay substrate is landed (`attention` ledger replay helper plus `city_attention_credit` before/after timeline fields). S1b ask/fade artifact `bench_20260529175058_ap_decay_ask_5m.json` passed score 1: the resident said a low-AP appeal at `attentionAfter=10`, then logged out with `cause=attention_exhausted` at `attentionAfter=0`. Follow-up live artifact `bench_20260530021203_ap_topup_resume_5m.json` passed score 1 after runtime fixes: benchmark AP top-up `+3000`, reconnect/retry after late logout close, failed first resume line due `session_closed`, then successful `nervous:attention-topup-resume` say (`topUpJumps=1`, `resumeAfterTopUpActions=1`, final AP `2994`). CQA10b hot-stack proof added ordinary named-resident ask + city top-up: `res:thrand` repeatedly asked for AP (`nervous:request-attention`), then a controlled city API grant credited `+75 AP` (`3000 -> 3075`) and surfaced in Library `city_attention_credit`, `/economy/live`, BFF `/api/nullcity/economy/live`, and the browser dashboard (`res:thrand AP +75 <PATRON #1>`). See `docs/capability-evidence/2026-05-29-s1b-ap-life-force-benchmark-attempt.md` and `docs/capability-evidence/2026-05-30-cqa10b-hot-stack-ordinary-life-audit.md`. | High for AP ask/top-up substrate and dashboard visibility; medium-high for full fade/resume because visible post-fade resume remains benchmark-proven rather than named-resident organic. |
| AP/GP goal hierarchy + Library strategy | Yes for the benchmarked AP-first / GP-evidence-first loop | Live autonomous benchmark-proven, including no-GP honesty | S8c landed AP/GP hierarchy knowledge (`economy-ap-gp-goal-hierarchy`), Brain/Body AP/GP guardrails, urgent low-AP body cadence, and the `ap-gp-library-strategy-5m` benchmark. Live artifact `bench_20260530030614_ap_gp_library_strategy_5m.json` passed score `1` in `3081ms`: visible GP item `995` was seeded, the selected `onion.runescape.standard` module picked up 25 GP, low AP was observed via action metadata, and the resident narrated a practical AP/GP/Library strategy after carrying real coins. QA Marshal closed `QA-20260529-008` for this core strategy proof. Follow-up `CQA9` live artifact `bench_20260530085237_ap_gp_honesty_5m.json` passed score `1` in `1026ms`: no coin item `995` was observed, low AP was observed, the resident emitted AP-request behavior, and unsupported GP/exchange claims stayed at `0`; that no-GP honesty closeout remains tracked by `QA-20260530-002`. See `docs/capability-evidence/2026-05-29-s8c-ap-gp-hierarchy-benchmark-attempt.md` and `docs/capability-evidence/2026-05-30-cqa9-ap-gp-honesty.md`. | Medium-high for core hierarchy behavior under benchmark pressure; medium until ordinary named residents show the same AP/GP/Library planning outside benchmark harnesses. |
| Needs-hierarchy goal selection (live in planner) | Yes — `selectCandidateGoals` is now live in `ensureBenchmarkGoal`; on-demand live-verify path now exists via S-OBS-DRAIN-1 admin AP-drain endpoint | Substrate proven via integration tests; live verification UNBLOCKED (admin endpoint shipped 2026-05-30, runs end-to-end after a controller restart picks up the new binary) | S-AUDIT-FIX-3 (closed QA-20260530-013, audit F3) wired the rules-based needs-hierarchy ranker into the live planner. `goalPoolForBenchmark` builds a 2-source candidate pool (benchmark = `pursue`-tagged + `gpPickupGoal` = `survive`/`earn`-tagged); `buildResidentNeedsContext` projects `RuntimeState.attention` + `attentionProfile.floor` into the `ResidentNeedsContext`; `ensureBenchmarkGoal` in `src/controller/thinking/hybrid-agent-helpers.ts` calls `selectCandidateGoals` and, when `currentTier === 'survive'`, seeds the survival winner instead of the benchmark. Integration tests in `src/controller/thinking/hybrid-agent-thinking-module.test.ts` ("low-AP residents pick the survival candidate (collect-visible-gp) over the benchmark" + healthy-AP pair) prove the ranker fires from the live `think()` path. `fin` 2868/2868 (+9 vs baseline 2859). Conservative wire-up: only the survive band overrides the benchmark; EARN tier preserves benchmark to avoid penalizing all benchmark residents with stale `gpEstimate=0` default. Future packet can broaden once live GP plumbs through. **S-OBS-DRAIN-1 (2026-05-30)** added `POST /api/nullcity/admin/residents/:id/ap-drain {amount, reason}` — the only HTTP path that decreases AP. Operator can now push any resident into the SURVIVE band on-demand (e.g. `res:qa-woodcutter` AP=22486 → drain 22481 → AP=5, wait one tick cycle, observe `state.cognition.activeGoal.id` flip from benchmark/orientation goal to `collect-visible-gp`, top up via `attention-grants` to see it flip back). | Medium-high for substrate proof; live-verify recipe is now substrate-supported (S-OBS-DRAIN-1). Pending hot-stack restart so the running controller picks up the new dist/ binary, then run the recipe in `docs/qa/2026-05-30-live-verify-substrate.md` V1 section to flip from MEDIUM (`wire-up deployed`) → HIGH (`flip observed live`). |
| Goal-as-orientation (soul-level north star biases candidate ranker) | Yes — `soul.orientationGoal` now flows through `ensureBenchmarkGoal` into the needs-hierarchy ranker | Substrate proven via integration tests; live behavior PENDING hot-stack verify | S-GOAL-1 (S14 / `docs/superpowers/specs/2026-05-30-goal-as-orientation-design.md`) extends the F3 wiring with a soul-level orientation goal. Schema: `SoulOrientationGoal { id, description, tier? }` added to `src/controller/soul/soul-schema.ts` (`tier` constrained to `earn|pursue|reflect` so orientation never overrides survive). Ranker: `rankCandidateGoals` gains an `{orientation}` option; id-match awards `ORIENTATION_ID_MATCH_SCORE=6`, tier-tag-match awards `ORIENTATION_ALIGNED_SCORE=5` — both smaller than `ALIGNED_SCORE=10` so survive-aligned tags still beat orientation in survive band. Planner: `goalPoolForBenchmark(taskId, tick, {orientationGoal})` appends an orientation candidate to the pool; `buildResidentNeedsContext` forwards `orientationGoal` into `ResidentNeedsContext` so `selectCandidateGoals` auto-applies the orientation bonus. Wire-up: `ensureBenchmarkGoal` reads `soul.frontmatter.orientationGoal` and, at non-survive tiers, drops the GP-pickup survival candidate from the pool so the orientation candidate wins (workaround for the stale `gpEstimate=0` default until live GP plumbs through). Canonical fixture: `src/controller/soul/starter-souls/res-qa-woodcutter.md` now declares `orientationGoal: { id: master-woodcutting, description: "Master woodcutting and supply the city with logs.", tier: pursue }`. Integration tests in `hybrid-agent-thinking-module.test.ts` ("healthy-AP resident with pursue orientation picks the orientation candidate over the benchmark" + low-AP survival-override pair) prove the soul-aligned goal wins at higher tiers and survival still wins in the survive band. `fin` 2931/2931 (+19 vs S-AUDIT-FIX-7 baseline 2912). | Medium-high for substrate proof; live-verify pending a hot-stack benchmark that adds `orientationGoal: { id: master-woodcutting, tier: pursue }` to a benchmark resident's soul YAML, triggers `think()` at healthy AP, and observes `state.cognition.activeGoal.id === 'master-woodcutting'` — then drains AP below `attentionProfile.floor + 5` and re-triggers to see the goal flip to `collect-visible-gp`. |
| Safe trading FSM | Yes in scripted/autonomous benchmarks and named-resident operator/no-loop soaks | Autonomous benchmark-proven; ordinary named-resident command proof now exists; ordinary one-hour life shows unaided trade intents when the controller is active | `trading-giving-5m` passed fresh scripted and autonomous runs on 2026-05-28. The autonomous artifact `bench_20260528201447_trading_giving_5m.json` shows the selected module emitted `trade_request`, `trade_offer_item`, `trade_accept_stage_1`, `trade_accept_stage_2`, and `trade_decline_untrusted_partner`, producing 1 completed trusted trade and 1 cancelled unsafe trade. Follow-up CQA4 artifact `named_trade_soak_20260530092531.json` proves ordinary `res:qa-trader` action logs can do the same outside the benchmark harness: 2 `trade_request`, 1 safe `trade_offer_item`, both accept stages, 1 `trade_completed`, 1 unsafe `trade_decline`, 1 `trade_cancelled`, and safe inventory delta `-1` shrimp. No-loop artifact `named_trade_soak_20260530125718.json` extends this to 3 repeated unsafe prompts: every unsafe prompt was declined, `tradeCancelledEvents=3`, and `postUnsafeOffersOrAccepts=0`. Latest non-idle CQA10 audit artifact `normal_life_audit_20260530T143812Z.json` captured ordinary non-soak `trade_request=4` and `trade_decline=3` within one hour across live residents; a later freshness window (`normal_life_audit_20260530T163610Z.json`) was fully idle (`0` residents/actions). See `docs/capability-evidence/2026-05-29-cqa4-live-operator-trade.md`, `docs/capability-evidence/2026-05-30-cqa10-normal-life-audit-refresh.md`, and issue `QA-20260529-011`. | High for directed safe trade/no-loop behavior; medium for spontaneous ordinary-life emergence while completion/cancel recurrence still needs repeated non-idle CQA10 windows. |
| Observe and collect RuneScape GP | Yes for visible coin item `995` | Autonomous benchmark-proven; normal GP/hour routes still unproven | City GP inspection now writes `city_gold_observed` Library evidence for real inventory coin item `995`. `starter-gp-pickup-3m` passed scripted proof `bench_20260529065910_starter_gp_pickup_3m.json` and autonomous proof `bench_20260529070519_starter_gp_pickup_3m.json`. Latest autonomous run: 25 GP visible on ground, 2 selected-module `opportunistic_pickup` actions, 2 successful pickups, `gpGainedFromGround=1`, 25 GP carried, no stuck ticks. | Medium-high for AP/GP substrate and visible GP pickup; low for self-directed GP earning routes such as combat loot, shop/bank loops, or target GP/hour plans. |
| AP-for-GP exchange | Yes in controlled live benchmark and city HTTP/operator route | Controlled benchmark-proven; hot-stack operator route proven; ordinary resident-initiated AP/GP exchange still open | S3b artifact `bench_20260530034914_ap_gp_exchange_5m.json` passed score `1`: resident started with real GP coin item `995`, benchmark-side exchange inspected 125 GP, burned 25 GP through gateway inventory authority, credited 50 AP via `CityIntegrationService.exchangeApForGp`, and recorded linked AP+GP exchange evidence. CQA4 AP/GP HTTP proof added `POST /api/nullcity/residents/:id/ap-gp-exchanges` and proved it against the hot stack with online `res:qa-angler`: pre-wealth `275` GP, exchange burned `25` GP, credited `50` AP (`24953 -> 25003`), post-wealth `250` GP, Library `city_ap_gp_exchange`, `/economy/live` `ap_gp_exchange`, and dashboard BFF visibility. This route also exposed and fixed fractional decayed AP evidence validation. Follow-up `QA-20260530-018` exposed a hot-stack GP gateway timeout and then live-proved the isolated city-inventory gateway/backpressure fix: `res:agent` and `res:qa-trader` wealth reads succeeded, and `res:qa-trader` completed a 1 GP item `995` burn for 2 AP (`22965.5 -> 22967.5`) after rebuild/restart. The benchmark and HTTP route are controlled/operator paths, not SPARK-selected social exchange. QA Marshal closed `QA-20260530-001` for the controlled substrate proof; ordinary resident-initiated exchange remains tracked by `QA-20260529-011`. See `docs/capability-evidence/2026-05-30-s3b-ap-gp-exchange-live-proof.md`, `docs/capability-evidence/2026-05-30-cqa4-ap-gp-http-exchange.md`, and `docs/capability-evidence/2026-05-30-qa018-gp-gateway-isolation.md`. | High for exchange substrate and dashboard/operator route; medium for social emergence until a named resident initiates a full AP-for-GP exchange outside the harness. |
| Questing | Partial, improving | Autonomous start, supplied-ingredient completion, and visible-ingredient pickup completion are benchmark-proven; item sourcing from the natural world is still unproven | `cooks-assistant-start-3m` passes in scripted and autonomous modes, and `cooks-assistant-complete-5m` passes in scripted and autonomous modes when the resident starts with milk, flour, and egg. Latest visible-pickup proof `bench_20260528220243_cooks_assistant_visible_ingredients_5m.json`: selected `onion.runescape.standard` picked up visible milk/flour/egg, carried all three, handed them to the Cook, consumed them, and completed the quest. | Medium-high for bounded starter quest completion with carried or visible ingredients; low for self-directed natural ingredient sourcing and arbitrary quests. NOTE: any quest proof is bounded capability evidence, not weekend MVP scope; the simple AP/GP loop does not require questing. |
| Binary GoalContract saved-state (S9a) | Service integration unit-test proven | Not yet live-proven (cloud-only so far) | S9a: `CityIntegrationService.markGoalAchieved(id, {evidence, tick?, apAtCompletion?, gpAtCompletion?})` wires `GoalContractStore.markAchieved` + `LibraryUpdater.observeGoalAchieved` in one idempotent call. HTTP route `POST /api/nullcity/goals/:id/achieve` exposes it to dashboard/admin. Library timeline receives a `goal_achieved` entry (goalId, goalText, evidence, optional AP/GP context, lifeIndex). `story-arc.ts` RESOLUTION_KINDS includes `goal_achieved` → arc advances to `resolve`. `goalContractsToDigestGoalEvents` converts achieved goals into `goal_completed` DigestEvents for the Storyteller. Verifier blocks unsupported goal completion claims. 10 new integration tests green (service + http-server). Idempotent: second achieve call does not write duplicate Library event. | Substrate-ready; live-verify PENDING (cloud cannot run live resident benchmark). |
| One-hour / hot-stack multi-resident normal-life baseline (`CQA10/CQA10b`) | Yes (observability) | Yes, and latest hot-stack window is non-idle again | Earlier non-idle refresh audit (`2026-05-30T11:59Z-12:59Z`) across 23 ordinary residents found 2356 actions at 99.151% submit success with dominant `move_to`/`say` loops, persistent stuck churn (`stuck_detected=660`, `stuck_recovered=570`), AP pressure visible (13/23 residents dropped AP in-window, aggregate drop `11527`), and incremental higher-order emergence (`equip=6`, `attack=1`, `trade_request=4`, `trade_decline=3`). A later stale rerun (`normal_life_audit_20260530T163610Z.json`) correctly exposed an idle stack (`0` residents/actions). CQA10b reran after the hot stack came back: artifact `normal_life_audit_20260530T180241Z.json` captured 23 residents, 3615 actions in 30 minutes, 99.419% success, `attack=89`, `use_item_on_item=111`, `interact=149`, `item_action=7`, 30 AP help requests, and no deaths/logouts. CQA10 now has a reproducible artifact CLI (`npm run controller:normal-life-audit`) instead of ad-hoc scripts. See `docs/capability-evidence/2026-05-29-cqa10-normal-life-audit.md`, `docs/capability-evidence/2026-05-30-cqa10-normal-life-audit-refresh.md`, and `docs/capability-evidence/2026-05-30-cqa10b-hot-stack-ordinary-life-audit.md`. | Medium-high for live-stack observability and AP pressure visibility; medium for economy/combat/social depth until trade completion, GP exchange, heal/re-engage, and level-up recurrence improve in repeated non-idle windows. |
| Cross-resident awareness | Yes | Benchmark-proven; ordinary named-resident proof still pending | L3 LoreBus inbox lets nearby resident events enter perception envelopes. CQA8 follow-up fixed the continuity gap by routing drained LoreBus `world_event` entries into durable `facts/world-events.md` memory and added `world-event-reaction-5m`. Live autonomous artifact `bench_20260530105802_world_event_reaction_5m` passed score `1` in `25.685s`: benchmark injected `res:duke` `fire_lit`, durable fact was retained, peer asked `agent, what did res:duke do nearby?`, and selected module answered `I remember res:duke lit a fire at 3226,3230,0.` See `docs/capability-evidence/2026-05-30-cqa8-cross-resident-awareness.md` and issue `QA-20260530-003`. | Medium-high for benchmarked event-memory reaction; medium until named heroes organically notice and reference each other's events in ordinary controller life. |
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
- Hard combat/prayer chains are model-sensitive. The bounded local safe-combat -> bones -> bury -> Prayer chain is now reproducible post-CQA5, and hot-stack named `res:qa-survivor` starter combat is proven. Longer ordinary combat goals, flee/retreat behavior, and weaker-model reliability still need soak evidence.
- XP gain and level-up mechanics are real, but level-up events were not observed in the scanned normal timelines.
- Equipping/wielding gear is now autonomous-benchmark-proven, but normal long-running named residents have not yet been observed choosing it outside a dedicated task.
- Quest start, supplied-ingredient completion, and visible quest-item pickup are now proven for Cook's Assistant in autonomous benchmark mode; natural-world ingredient sourcing from chickens/cows/windmill/bank/shop is not proven yet.
- "Goal-as-orientation" is not deeply proven yet. Residents can execute known workflows better than they can invent long multi-step plans.
- Trading is now proven in scripted and autonomous benchmarks plus live `res:qa-trader` operator-style and repeated-prompt/no-loop soaks with safe inventory deltas. It still needs a true human/player-operator pass and normal-life recurrence without directed benchmark commands.
- Long-term memory is improving but is not yet at the level Dev described in the meeting: seeded route recall is benchmark-proven, while NPCs met, quests received, deaths, and newly learned ordinary-life facts still need more durable storage/retrieval proof.
- Stuck recovery works, but the volume of stuck/recovered events shows pathing and local loops still need attention.

## How To Explain This To The Team

Short version:

> We have about twenty autonomous RuneScape residents running on a Soul + SPARK + body loop. They can move, talk, chop, light fires, fish, cook, survive low-health moments, recover from many stuck states, accept patron story events, and write their lives into the Library. The strongest proven gameplay loops are woodcutting, firemaking, fishing, cooking, following/chat, exploration reports, and memory recall. Combat is real but still unreliable. The next frontier is making their goals less template-like and their memories more durable.

More precise version:

> The project is no longer just a dashboard or a prompt. The residents submit real game actions, those actions change world/player state, and the controller records outcomes into timelines and portraits. The evidence says the simple skilling loops work. The evidence also says Qwen struggles on harder cognition, especially combat/prayer, while Qwopus and Haiku improve that task but still do not make the agent magically smart. Our next work is to run the named combat soak on a hot controller, benchmark harder goals, improve memory, and move from "can execute routines" toward "can pursue meaningful ambitions."

## Recommended Next Tests

To make this doc stronger, run the following as repeated experiments:

1. **Natural quest gathering:** Cook's Assistant from an empty inventory, requiring egg pickup at the chicken coop, flour from pot/windmill or bank/shop, and milk via bucket/cow. Score route selection, tool recovery, ingredient memory, and hand-in.
2. **Danger survival:** low HP, food available, hostile NPC nearby. Score whether the resident heals/flees before continuing.
3. **Door-heavy long-run soak:** run named residents through indoor/door routes for at least one hour and score repeat open-obstacle success plus fallback route quality outside benchmark harnesses.
4. **Patron conflict:** patron guidance vs distracting local chat. Score whether Shards influence priority without direct puppet control.
5. **Ordinary named-resident memory route recall:** teach a bank/resource fact to a non-benchmark resident, wait at least 10 minutes, then ask the resident to use it later.
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
| Perception | Notice another resident's world event | Benchmark-proven | `world-event-reaction-5m` live artifact `bench_20260530105802_world_event_reaction_5m` proves a nearby `fire_lit` LoreBus event from `res:duke` is persisted and recalled in chat by the selected module. Next proof: named hero-to-hero ordinary soak without benchmark injection. |
| Chat | Ambient Soul line | Proven | Needs variety scoring so heroes stop sounding template-heavy. |
| Chat | Respond when name-mentioned | Proven in benchmark | Add multi-human anti-loop checks. |
| Chat | Refuse to repeat itself | Implemented, not fully scored | Important for event chat quality. |
| Inventory | Receive starter items | Proven | Creation seeds inventory/equipment; used by benchmarks. |
| Inventory | Pick up ground items | Proven for useful loot and visible quest ingredients | Normal logs show successful pickup for logs/coins; `cooks-assistant-visible-ingredients-5m` proves autonomous selected-module pickup of visible milk/flour/egg before quest completion. Next proof should cover ownership safety, natural world spawns, and route-to-item behavior when the item is not already nearby. |
| Inventory | Drop items | Implemented action, unproven live | Needed for cleanup and trading workflows. |
| Inventory | Use item on item | Proven | Firemaking and cooking/fishing workflows exercise this. |
| Inventory | Use item on world object | Partial | Cooking workflow uses item-on-object style evidence; needs direct targeted benchmark. |
| Equipment | Wear/wield useful gear | Proven in scripted/autonomous benchmarks and one named-resident live soak | `CQA3-live-rerun` artifact `named_equip_soak_20260530120900.json` proves `res:qa-survivor` equipped preloaded training sword/shield through ordinary thinking-source `equip` actions; next confidence bump is spontaneous long-run emergence and post-equip combat follow-through. |
| Equipment | Unequip/swap gear | Unproven | Needed for armor/role experiments. |
| Survival | Eat at low HP | Observed | Needs danger survival benchmark with hostile nearby NPC. |
| Survival | Flee/retreat from bad fight | Partial | Meeting notes claim combat flee; CQA5 has bounded no-death combat evidence and `controller:combat-soak` can now verify ordinary named-resident safe attack/no-death evidence, but direct flee/retreat still needs its own artifact. |
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
| Trade | Resident-to-player/resident trade request | Proven in scripted/autonomous benchmarks and named-resident live soaks | `bench_20260528201447_trading_giving_5m.json` shows 6 selected-module `trade_request` attempts after peer trade guidance. `named_trade_soak_20260530125718.json` shows ordinary `res:qa-trader` sent 1 trusted and 3 unsafe `trade_request` actions outside the benchmark harness. Next proof should use a real human/player operator and/or ordinary-life recurrence. |
| Trade | Offer/accept/decline safely | Proven in scripted/autonomous benchmarks and named-resident live no-loop soak | Autonomous proof includes safe item offers, both accept stages, 1 completed trusted trade, 1 cancelled unsafe trade, and 2 unsafe declines. CQA4 `named_trade_soak_20260530125718.json` adds named-resident no-loop proof: safe item offered and given, both accept stages complete, 3 repeated unsafe prompts each declined, and `postUnsafeOffersOrAccepts=0`. |
| Patron | Daily check-in and Shard balance | Implemented | Human-facing surface is available; needs event-day SOP. |
| Patron | Patron gift affects resident attention/story | Partial | Timeline proof exists; gameplay priority override needs stronger proof. |
| Memory | Store timeline moments | Proven | Library timelines are rich. |
| Memory | Recall a taught fact | Proven in benchmark | Needs longer-delay and cross-session proof. |
| Memory | Remember deaths/routes/NPCs/quests | Partially proven for seeded routes; not mature for ordinary life | `bench_20260530103544_memory_route_recall_5m` proves a disposable resident can answer a delayed route question from Library memory. Thursday action item remains: mem0/qmd/MCP retrieval decision plus ordinary NPC/quest/death recall proof. |
| Model intelligence | Local Qwen vs Qwopus/Haiku on hard tasks | Triplet evidence captured; AP/GP strategy now has a live local-module proof | CQA11 consolidated local+paid model artifacts. Easy loops are saturated (all compared profiles pass) while `combat-prayer-10m` remains model-sensitive (`Qwen 0/6`, `Qwopus 3/6`, `Haiku 3/6`). AP/GP hierarchy now has local `onion.runescape.standard` live proof via `bench_20260530030614_ap_gp_library_strategy_5m.json`; see `docs/capability-evidence/2026-05-29-cqa11-model-intelligence-twins.md`. `QA-20260529-008` is closed for AP/GP strategy proof; combat model sensitivity remains under `QA-20260529-004`/`CQA11`. |
| Dashboard | Show model/endpoint/SPARK per resident | Requested, not yet in this doc | Meeting action item; important for model benchmarking. |
| Story | Portraits from timelines | Implemented | Needs quality scoring and quote dedup checks. |
| Story | Storyteller 20-minute world narration | No-paid overseer tick built; scheduled paid-model narration not enabled | `s5b-ncri-proof-20260530T0920` proves NCRI sale/redemption can enter a Storyteller digest as resident-attributed canon, `storyteller:run` can write a reviewable nooped dispatch, and S-STORY-1 adds `storyteller:overseer -- --tick` with `overseer-ledger.jsonl`, duplicate holds, empty-digest skip, and unresolved-ref guard. Next proof is S-STORY-2 cost cap + canon/review queues, then a configured smarter-model run with explicit cost caps. |
| Story / NCRI | Resident-originated NCRI sale and redemption canon | Substrate-proven | `docs/capability-evidence/2026-05-30-s5b-ncri-storyteller-proof.md` plus artifact `data/controller/storyteller/s5b-ncri-proof-20260530T0920/digest.json`: `res:duke` is preserved as the source resident for both `ncri_created` and `ncri_redeemed` digest events. Next proof should use an ordinary resident-obtained NCRI item/exchange path. |

## Bottom Line

| Question | Answer |
|---|---|
| Are the agents ready enough to show as autonomous residents? | Yes, for skilling, movement, speech, Library/story, and patron surface demos. |
| Are they smart enough to trust with arbitrary goals? | Not yet. They need harder goal benchmarks and better memory. |
| Are they only chopping wood and making fires? | No. Logs show fishing, cooking, eating, combat attempts, patrol/exploration, patron events, stuck recovery, and memory benchmarks. But wood/fire remains the most proven and most repeated behavior. |
| Should we keep benchmarking models? | Yes. The data says model choice matters for hard tasks: Qwen failed hard combat 0/6, while Qwopus and Haiku reached 3/6. |
