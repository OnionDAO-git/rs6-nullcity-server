# Slayer Skill - Implementation Spec

Audience: future subagent implementing Slayer for RuneScape revision 435 in this repo. This should integrate with the existing combat/NPC stack without rewriting combat.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- `Skill.SLAYER` and skill name `slayer` already exist in `src/engine/world/actor/skills.ts`.
- There is no `src/plugins/skills/slayer/` gameplay implementation today.
- Skill-guide data exists at `src/plugins/skills/skill-guides/slayer.json`.
- Combat and death flow already exist:
  - Combat task/strategies: `src/engine/world/actor/combat/`.
  - NPC model/config: `src/engine/world/actor/npc.ts`, `src/engine/config/npc-config.ts`.
  - NPC interactions: `src/engine/action/pipe/npc-interaction.action.ts`.
  - Item-on-NPC interactions: `src/engine/action/pipe/item-on-npc.action.ts`.
- NPC configs support metadata through `NpcServerConfig.metadata` in `src/engine/config/npc-config.ts`; use that for Slayer tagging where possible.
- Player saves persist skills and `savedMetadata` in `src/engine/world/actor/player/player-data.ts`; Slayer assignment state can live there if it must survive logout.
- Client skill availability is already enabled in `rs6-nullcity-client-ts/src/constants/Skill.ts`.

## Revision-435 Scope

Implement a revision-435 Slayer v1 centered on assignments and Slayer XP on kills:

- Slayer masters:
  - Add one low-level master for v1, preferably Turael/Spria-style behavior if NPC/cache data exists.
  - Support `assignment`/`task` dialogue or interaction that gives a new task.
- Assignments:
  - Store current assigned monster group and remaining kill count.
  - Prevent assigning a new task while one is active, except a debug/admin reset command if needed.
  - Decrement task count when a qualifying NPC dies to the player.
- Slayer XP:
  - Award Slayer XP when an assigned qualifying NPC is killed.
  - XP should be based on NPC hitpoints or configured Slayer XP where known.
- Slayer requirements:
  - Add metadata/config support for monsters that require a Slayer level.
  - Block or strongly discourage damage to locked Slayer monsters before combat begins where possible.
- Finishing items:
  - Implement only one simple finishing item if the current NPC/data set supports it; otherwise defer.

Defer unless needed:

- Full master progression, points/rewards, bracelets, enchanted gems, superior monsters, broad bolts, Slayer helm, partner tasks, and post-435 systems.
- Complex monster-specific mechanics that require new combat effects.
- Full dialogue tree polish for every Slayer master.

Revision fidelity notes:

- 435-era Slayer is assignment-based and NPC-master driven. Do not import OSRS Slayer reward-shop mechanics unless they existed in the revision target.
- Use NPC groups rather than single IDs for assignments where the cache has variants, e.g. `goblin` can include multiple goblin NPC keys.

## Server Work In `rs6-nullcity-server`

Create:

- `src/plugins/skills/slayer/slayer.plugin.ts`
  - Registers NPC interactions for Slayer masters.
  - Registers hooks/events needed to observe qualifying NPC deaths.
- `src/plugins/skills/slayer/slayer-config.ts`
  - Master definitions, assignment tables, monster groups, level requirements, XP overrides.
- `src/plugins/skills/slayer/slayer-state.ts`
  - Read/write current assignment from `player.savedMetadata.slayer` or an equivalent typed metadata wrapper.
- `src/plugins/skills/slayer/slayer-assignment.ts`
  - Pure helpers for selecting assignments and matching killed NPCs to groups.
- `src/plugins/skills/slayer/slayer-dialogue.ts`
  - Minimal master dialogue or direct interaction handlers.
- `src/plugins/skills/slayer/slayer-kill-listener.ts`
  - Integration point for NPC death/kill attribution.
- Tests for assignment selection, persistence shape, kill matching, and XP/count decrement.

Likely modifications:

- `src/engine/config/npc-config.ts`
  - If needed, type a `metadata.slayer` shape without breaking existing metadata.
- `src/engine/world/actor/combat/death.ts` or the narrowest existing NPC-death integration point
  - Emit/call a hook when a player kills an NPC so Slayer can award XP and decrement assignment.
  - Keep this generic enough for future kill-count features; do not hard-code Slayer into combat if an action/event hook can be added cleanly.
- `src/engine/action/action-pipeline.ts`
  - Add a `npc_death`/`npc_killed` hook only if no suitable death hook exists.
- NPC config YAML files under `data/config/npcs/` only to tag Slayer monsters or add a master spawn.
- `src/plugins/commands/` only for an admin/debug command such as `::slayertask` if manual testing would otherwise be slow.

Implementation details:

- Assignment state should survive logout/server restart. Use `savedMetadata` in player save data unless a stronger local persistence pattern exists by implementation time.
- Count down exactly once per NPC death. Guard against multiple death events or respawn events awarding multiple Slayer XP.
- Qualifying kill matching should use NPC key/group and killer attribution, not only proximity.
- If an NPC has a Slayer level requirement, block before combat starts through the attack plugin/combat-entry path if possible.
- Do not duplicate combat damage or drop logic. Slayer should observe kills and add XP/count behavior.
- Keep assignment selection deterministic/testable by isolating RNG.

## Client Work In `rs6-nullcity-client-ts`

Expected v1 client work is minimal:

- Verify Slayer remains enabled in `src/constants/Skill.ts`.
- Verify NPC interaction menu options for the chosen master are decoded and sent normally.
- No custom task UI is required for v1; use chat/dialogue messages.

Only edit client if testing proves one of these is broken:

- NPC option handling in `src/client/MiniMenuAction.ts`.
- NPC config decoding in `src/config/NpcType.ts`.
- Skill tab presentation hides or mislabels Slayer.

## Data And Config Requirements

- Slayer master NPC key/game ID and spawn location.
- Assignment table:
  - monster group key
  - display name
  - possible counts
  - minimum combat/Slayer level if needed
  - weight
- Monster group mapping from assignment groups to NPC keys.
- Slayer level requirements and optional item requirements for configured monsters.
- XP source:
  - Prefer configured XP per NPC/group where known.
  - Fallback to hitpoints-based XP if the NPC config has reliable HP.
- Dialogue strings for requesting/checking a task.

Data quality bar:

- Every assignment group must have at least one spawnable/killable NPC in current server data.
- Every master must be present in NPC config and either already spawned or explicitly added to spawn config.
- Every configured Slayer requirement must be testable through combat entry or a focused unit test.

## Acceptance Checklist

- A player can receive a Slayer assignment from the configured master.
- Assignment state persists through logout/save/load.
- Killing a matching assigned NPC decrements remaining count once and awards Slayer XP once.
- Killing a nonmatching NPC does not decrement the assignment and does not award Slayer XP.
- Completing the final kill clears or marks the task complete and sends a clear message.
- A player cannot receive a second normal task while one is active.
- A configured Slayer-level-locked NPC cannot be fought or killed for normal progress below the requirement.
- `npm run typecheck` passes in `rs6-nullcity-server`.
- Focused tests cover assignment selection, group matching, persistence, kill decrement, completion, and nonmatching kills.
- Manual smoke: get an assignment, kill one matching NPC, observe count/XP.

## Rough Work Estimate

- Assignment state/config/master interaction: 1.5-2 days.
- Combat death hook integration: 1-2 days depending on current death attribution.
- Slayer XP/count and level gate: 1 day.
- Data setup and tests: 1-2 days.
