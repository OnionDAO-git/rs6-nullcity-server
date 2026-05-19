# Thieving Skill - Implementation Spec

Audience: future subagent implementing Thieving for RuneScape revision 435 in this repo. Keep the first pass small, data-driven, and compatible with existing NPC/object action hooks.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- `Skill.THIEVING` and skill name `thieving` already exist in `src/engine/world/actor/skills.ts`.
- There is no `src/plugins/skills/thieving/` gameplay implementation today.
- Skill-guide data exists at `src/plugins/skills/skill-guides/thieving.json`, but the current file has `"name": "Attack"` despite containing Thieving sections. Fixing that typo is in scope if this skill implementation touches guides.
- Existing action hooks to reuse:
  - NPC interactions: `src/engine/action/pipe/npc-interaction.action.ts`.
  - Object interactions: `src/engine/action/pipe/object-interaction.action.ts`.
  - Walk-to-actor/object wrappers: `src/engine/action/pipe/task/walk-to-actor-plugin-task.ts`, `src/engine/action/pipe/task/walk-to-object-plugin-task.ts`.
- NPC definitions/spawns are loaded through `src/engine/config/npc-config.ts` and `src/engine/config/npc-spawn-config.ts`.
- Item IDs are centralized in `src/engine/world/config/item-ids.ts`; animations in `src/engine/world/config/animation-ids.ts`; sounds in `src/engine/world/config/sound-ids.ts`.
- Existing item reward mechanics should use `player.giveItem(...)`, `player.inventory.hasSpace()`, and normal item config lookups.
- Client skill availability is already enabled in `rs6-nullcity-client-ts/src/constants/Skill.ts`.

## Revision-435 Scope

Implement a revision-435 style Thieving v1:

- Pickpocketing from basic NPCs:
  - Man/woman or citizen at level 1.
  - Farmer at level 10 if NPC data exists.
  - Guard at level 40 if NPC data exists.
- Stall stealing for a small set of available stalls if object IDs and map locations exist.
- Failure behavior:
  - Player is stunned/temporarily busy.
  - NPC faces or reacts to the player where practical.
  - Player takes small damage for pickpocket failures.
  - No reward or XP on failure.
- Success behavior:
  - Reward item/coins are added only if inventory has space.
  - XP is awarded once per successful action.
  - Repeated action is rate-limited by tick task/cooldown, not wall-clock timers.

Defer unless specifically needed:

- Blackjacking, Pyramid Plunder, Rogues' Den, H.A.M. disguise behavior, doors/traps, lockpicking, and chest trap disarming.
- Full NPC awareness/aggression systems beyond a local stun/failure response.
- Global stall depletion visible to all players if the current instance/object replacement APIs make that expensive. Use instance replacement where already supported.

Revision fidelity notes:

- Use 435-era NPCs/options where cache data supports it. Pickpocket option text should come through as `pickpocket`.
- Success chance should scale by player Thieving level and target difficulty. Exact formulas can be approximate but must be isolated in a `chance.ts` file for later correction.

## Server Work In `rs6-nullcity-server`

Create:

- `src/plugins/skills/thieving/thieving.plugin.ts`
  - Registers `npc_interaction` hooks for pickpocket targets.
  - Registers `object_interaction` hooks for stalls/chests selected for v1.
- `src/plugins/skills/thieving/pickpocket-task.ts`
  - Extends or composes existing actor interaction behavior after `walkTo`.
  - Handles level check, inventory space, success roll, reward, XP, failure stun/damage.
- `src/plugins/skills/thieving/stall-task.ts`
  - Handles level check, success, item reward, XP, optional object replacement/depletion, and respawn.
- `src/plugins/skills/thieving/thieving-targets.ts`
  - Data for NPC targets: `npcKeys`, required level, XP, rewards, base chance, stun ticks, damage.
- `src/plugins/skills/thieving/thieving-stalls.ts`
  - Data for object targets: `objectIds`, option, required level, XP, reward table, respawn/depleted object if known.
- `src/plugins/skills/thieving/chance.ts`
  - Pure functions for success rolls, covered by tests.

Modify only as needed:

- `src/engine/world/config/item-ids.ts` for reward aliases used by Thieving.
- `src/engine/world/config/object-ids.ts` for stall/chest aliases.
- `src/engine/world/config/animation-ids.ts` for pickpocket/stun/steal animations if IDs are known.
- `src/plugins/skills/skill-guides/thieving.json` to correct the `"name"` typo and any verified revision-435 guide errors.
- NPC YAML/config files only when a target NPC exists in the cache but is not spawned in a testable location.

Implementation details:

- Do not use `Date.now()` for action cooldowns; use task ticks or a metadata tick counter.
- Respect `player.busy` and avoid overlapping pickpocket attempts.
- Keep reward tables deterministic/testable by accepting injected or isolated RNG functions in pure helpers where practical.
- On failure, set a short action lock, play a known animation if available, send a failure message, and apply damage through the skills/combat-safe APIs already used elsewhere.
- On success, check `player.inventory.hasSpace()` before rolling or awarding.
- Do not let pickpocketing dead, unreachable, or nonmatching NPCs bypass the normal walk-to-actor task.

## Client Work In `rs6-nullcity-client-ts`

Expected v1 client work is minimal:

- Verify NPC `Pickpocket` and object `Steal-from`/`Steal` options produce normal NPC/object interaction packets.
- Verify Thieving remains enabled in `src/constants/Skill.ts`.
- No custom Thieving UI is required.

Only edit client if testing proves one of these is broken:

- Menu option/action mapping in `src/client/MiniMenuAction.ts` does not support the target option index.
- NPC or object config decoding in `src/config/NpcType.ts` or `src/config/LocType.ts` drops options that exist in the 435 cache.
- Skill tab presentation hides or mislabels Thieving.

## Data And Config Requirements

- NPC keys and game IDs for the chosen pickpocket targets.
- Stall/chest object IDs, option names, and replacement/depleted object IDs if depletion is implemented.
- Reward tables:
  - Coins for basic NPCs.
  - Seeds/food/items for stalls only if item IDs are verified.
- XP values and level requirements from revision-435 references.
- Failure messages and stun/damage values.
- Optional sound IDs for success/failure if known.

Data quality bar:

- Every configured NPC key must be resolvable through `findNpc`.
- Every reward item must resolve through `findItem`.
- Every configured object ID must be clickable in the current cache or spawned deliberately for testing.
- Missing authentic animation/sound IDs should be represented as absent config, not guessed constants.

## Acceptance Checklist

- A level-1 player can successfully pickpocket a configured low-level NPC and receive coins/items plus Thieving XP.
- A player below a target requirement receives a clear message and receives no reward/XP.
- Pickpocket failure can occur, stuns/locks the player briefly, applies configured damage, and gives no reward/XP.
- Inventory-full state prevents reward action with a clear message.
- Stall stealing works for at least one configured stall or is explicitly deferred with no dead config.
- Repeated spam clicking cannot start overlapping Thieving tasks or duplicate rewards.
- The guide typo is corrected if the guide file is touched.
- `npm run typecheck` passes in `rs6-nullcity-server`.
- Focused tests cover chance bounds, level gating, success reward/XP, failure behavior, and inventory-full behavior.
- Manual smoke: use the real client to pickpocket one target through the normal menu.

## Rough Work Estimate

- Pickpocket core with 2-3 NPC targets: 1.5-2.5 days.
- Stall core with one target: 1-1.5 days.
- Data verification and spawn setup: 0.5-1.5 days.
- Tests and smoke fixes: 0.5-1 day.
