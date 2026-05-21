# RuneBench-Inspired Agent Design

This notes what we can steal from `MaxBittker/RuneBench` for our resident controller.

Reference clone: `/Users/james/Code/OnionDAO/.codex-artifacts/reference/RuneBench`

## What RuneBench Gets Right

- **Agents get a real tool surface.** RuneBench does not ask a model to vaguely "play RuneScape"; it gives it `bot.*` high-level actions and `sdk.*` state queries, with concrete examples.
- **Start small, observe, iterate.** The task prompt repeatedly warns against giant scripts. First get one action working, then loop it.
- **Goals are measurable.** Skill tasks optimize peak XP/min. Gold tasks optimize inventory plus bank coins. This gives the AI a scoreboard.
- **Knowledge is local and searchable.** Agents receive markdown wiki files for items, NPCs, shops, and skills.
- **Telemetry is first-class.** `skill_tracker.ts`, `check_xp_rate.ts`, `check_skill_xp.ts`, `check_gold.ts`, and trajectory extraction make behavior inspectable.
- **Tasks are generated from source of truth.** `generate-tasks.ts` creates repeatable benchmark directories rather than hand-maintained one-offs.
- **Long-running behavior is bounded.** RuneBench recommends 10s probes, then 30-60s tests, then longer loops only after evidence.
- **APIs grow from failure analysis.** RuneBench explicitly notes that the SDK improved by categorizing failed runs and adding missing harness features. Our equivalent is action/progress logs feeding new `ResidentActions`, workflow cards, and dashboard diagnostics.

## Translation To NullCity

RuneBench is built around an MCP coding agent that writes TypeScript snippets against `rs-sdk`. Our system is different: a persistent resident runs inside the world and emits one typed `AgentAction` at a time through the controller gateway.

The direct translation is not "let the agent write scripts." The better translation is:

- Brain chooses a measurable ambition.
- Body chooses one next typed action.
- Nervous system handles reflexes and safety.
- The controller records progress and exposes enough telemetry that we can tell whether the loop is alive.
- Prompts include a compact tool/playbook section so inference has a concrete action vocabulary.

## Implement Now

1. **Prompt playbook.**
   Add a compact RuneBench-style playbook to the Brain and Body prompts:
   - one-action probe loop;
   - available `AgentAction` equivalents of RuneBench's `bot.*` tools;
   - supported workflow cards for woodcutting, firemaking, combat, prayer, exploration, trade, and pickup.

2. **Measurable near-term goals.**
   Brain should prefer goals with observable progress:
   - collect logs;
   - light a fire;
   - kill a safe NPC, pick up bones, bury them;
   - explore and report nearby useful objects/NPCs;
   - collect useful owned/unowned ground items.

3. **Body action discipline.**
   Body should choose exactly one action, then observe. Avoid repeated long-distance moves when stuck; use local fallbacks and report what happened.

4. **Dashboard-facing causality.**
   Keep cause labels explicit enough to debug: `woodcutting_level1_routine`, `woodcutting_chain_firemaking`, `combat_loot_pickup`, `routine_loop_break`, etc.

## Current Ported Slice

- `runebench-playbook.ts` now keeps workflow cards as typed data, then renders them into prompts. This gives us one source of truth for prompt text today and future dashboard/routine availability checks.
- `knowledge-retriever.ts` adds a compact local knowledge pack for starter skills and safe behaviors. Brain and Body both receive only the snippets relevant to the active goal and current perception.
- `wiki-importer.ts` can pull bounded snippets from the local RuneBench wiki clone for curated references such as low-level NPCs and starter shops. Local engine config remains authoritative.
- `skill-guide-importer.ts` converts the repo's skill-guide JSON into compact knowledge entries, which is the first step toward generated game knowledge instead of hand-maintained prompt lore.

The next RuneBench idea to port is the measurable-run loop: small benchmark tasks with trajectory/progress artifacts, starting with `make-fire-5m`, then woodcutting, combat-prayer, exploration, and follow/chat.

## Backlog

### Tool Surface

- Add controller-level high-level actions similar to RuneBench `bot.*`: `walkTo`, `interactObject`, `talkTo`, `attackNpc`, `pickupItem`, `useItemOnItem`, `buryBones`, `eatFood`, `requestTrade`.
- Add compound workflow helpers only after the one-action Body loop is stable. Example: a `SkillRoutine` can suggest the next `AgentAction`, but should still submit only one action per tick.

### Knowledge

- Generate resident-readable markdown from local config for:
  - item ids and item keys;
  - NPC names, keys, levels, and drops;
  - object ids and option names;
  - shop inventories when shop support lands;
  - skill guides and beginner workflows.
- Add a compact retrieval step so Brain can see relevant skill/wiki snippets without bloating every prompt.
- Add curated wiki snippets for starter NPCs (`chicken`, `cow`, `goblin`, `giant-rat`) and shops (`lumbridge-general-store`, tool/fishing shops), but keep them bounded and cite source paths.

### Telemetry

- Add a per-resident progress tracker inspired by RuneBench:
  - skill XP samples;
  - inventory/gold samples;
  - position samples;
  - action cause counts;
  - stuck/retry counts.
- Show recent progress deltas in the dashboard.
- Add a "last meaningful progress" timestamp so we can distinguish idle waiting from broken automation.

### Bench Tasks

- Define local benchmark tasks:
  - `make-fire-5m`;
  - `woodcutting-xp-10m`;
  - `combat-prayer-10m`;
  - `explore-lumbridge-5m`;
  - `collect-coins-10m`.
- Add verifiers that read the resident runtime state/action log and final perception.

### Game Systems Needed For Better Automation

- Fishing, Mining, Cooking, Fletching, Smithing, shop, and bank support are what unlock real RuneBench-style goals beyond fire/combat/prayer.
- Trading with humans exists enough for direct interactions, but autonomous economic behavior needs shop/bank support first.
- Questing needs dialogue task memory and quest-varp progress visibility.

## First MVP Design

Add `src/controller/thinking/runebench-playbook.ts` as a prompt-only module. It should export:

- `RUNEBENCH_AGENT_LOOP`: short lessons from RuneBench.
- `AGENT_ACTION_TOOL_SURFACE`: our typed equivalent of the `bot.*` quick reference.
- `SUPPORTED_WORKFLOW_CARDS`: workflows the current server can plausibly execute today.

Then `hybrid-agent-prompts.ts` includes:

- the loop and measurable-goal guidance in Brain;
- the tool surface and workflow cards in Body.

This is intentionally prompt-level first. It improves inference without adding a second scripting layer, and it keeps the current Brain/Body/Nervous-system separation intact.

## Note On "Rimworld"

The request said "Rimworld" once, but the linked project and surrounding context are RuneScape. I am treating that as a typo. If we later build RimWorld-style colony agents, the useful transfer is the same: explicit tools, local knowledge, short probes, telemetry, and verifiable goals.
