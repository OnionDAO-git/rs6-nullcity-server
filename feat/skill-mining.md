# Mining — Implementation Spec

Audience: a future subagent implementing or finishing Mining for RuneScape revision 435 in this repo. Keep the pass focused on Mining and avoid changing other skills except for shared harvest helpers that are clearly reusable.

## Current Repo State

Relevant server paths:

- `rs6-nullcity-server/src/plugins/skills/mining/mining.plugin.ts` registers `rs:mining` for object option `mine` across `getAllOreIds()`.
- `rs6-nullcity-server/src/plugins/skills/mining/mining-task.ts` already implements a task with success rolls, tool animation, ore/gem rewards, XP, rock depletion, and respawn.
- `rs6-nullcity-server/src/plugins/skills/mining/chance.ts` has the current success roll: `baseChance + toolLevel + miningLevel` against `0..255`.
- `rs6-nullcity-server/src/plugins/skills/mining/prospecting.plugin.ts` registers `rs:prospecting` for option `prospect`, but currently emits a debug issue message instead of a delayed result.
- `rs6-nullcity-server/src/engine/world/config/harvestable-object.ts` holds ore definitions for clay, copper, tin, iron, coal, silver, gold, mithril, adamant, runite, and a gem rock.
- `rs6-nullcity-server/src/engine/world/config/harvest-tool.ts` defines pickaxe tiers and `getBestPickaxe()`.
- `rs6-nullcity-server/src/engine/world/skill-util/glory-boost.ts` and `rs6-nullcity-server/src/engine/world/skill-util/harvest-roll.ts` support rare gem rolls.
- `rs6-nullcity-server/src/plugins/skills/skill-guides/mining.json` already exists.
- `rs6-nullcity-server/data/config/items/skills/mining.json` and `rs6-nullcity-server/data/config/items/equipment/pickaxes.json` are the primary item config inputs.

Relevant client paths:

- `rs6-nullcity-client-ts/src/client/Client.ts` already sends revision-435 location interaction packets.
- `rs6-nullcity-client-ts/src/client/MiniMenuAction.ts` and `rs6-nullcity-client-ts/src/io/ClientProt.ts` define `OP_LOC*` actions/opcodes.
- `rs6-nullcity-server/src/engine/net/inbound-packets/object-interaction.packet.ts` maps location option index to lower-case cache option names, which the Mining plugin matches.

Known gaps and risks in the current Mining code:

- `MiningTask.execute()` does not call `super.execute()`, even though the task extends `ActorLandscapeObjectInteractionTask`. This risks bypassing range/object validity behavior used by other skilling tasks.
- `MiningTask.hasMaterials()` checks only `inventory.has(this.tool.itemId)`, while `getBestPickaxe()` accepts inventory or equipment via `hasItemOnPerson()`. Equipped pickaxes can be selected and later rejected.
- Level, material, and inventory failures return without stopping, which can leave a task repeatedly messaging or idling.
- `mining.plugin.ts` has a duplicate `if (!tool)` block.
- Prospecting is incomplete and currently sends `[debug] see issue #417`.
- Pure essence and some gem rock behavior are explicitly TODOs in `mining-task.ts`.
- There are no focused Mining tests in the repo.

## Revision-435 Scope

Implement classic revision-435 Mining behavior using the local 435 cache/config as the authority.

In scope:

- Mining rocks through object option `Mine`.
- Prospecting rocks through option `Prospect`, including delayed result synchronized to ticks.
- Pickaxe selection from inventory or equipment, choosing the best usable pickaxe by Mining level.
- Level checks for each ore.
- Inventory-full handling before and during repeated mining.
- Repeated mining attempts until ore success, rock depletion, inventory full, player interruption, or object invalidation.
- Correct start message, pickaxe animation, pickaxe swing sound, ore success message, rare gem message, XP award, and depletion sound.
- Rock replacement to depleted objects and respawn to full rocks.
- Clay, copper, tin, iron, coal, silver, gold, mithril, adamantite, runite, and gem rocks from the existing config.

Out of scope for this skill pass:

- Mining Guild membership gates or quest-specific areas beyond existing map access.
- Shooting stars, concentrated ores, living rock caverns, or any post-435 activity.
- Full rune essence mine routing unless local object ids and travel content already make it straightforward. Pure essence behavior may be stubbed only when clearly gated and tested.

## Server Work In `rs6-nullcity-server`

1. Fix the task lifecycle:
   - Call `super.execute()` first in `MiningTask.execute()`.
   - Return early while walking, but stop on permanent failures: no level, no usable pickaxe, full inventory.
   - Stop animation in `onStop()` if not already handled by the parent task.
   - Ensure depleted/replaced objects invalidate the task cleanly.

2. Align pickaxe handling:
   - Preserve `getBestPickaxe(player)` as the selection entry point.
   - Change material checks to use `hasItemOnPerson()` or track whether the selected pickaxe came from equipment.
   - Keep pickaxe tier levels and animation ids in `harvest-tool.ts` unless revision-435 verification proves they are wrong.

3. Clean the plugin:
   - Remove the duplicate `if (!tool)` branch in `mining.plugin.ts`.
   - Avoid playing the initial animation twice if the task also plays it on first execution.
   - Keep hook options at `['mine']` and `walkTo: true`.

4. Finish prospecting:
   - Replace the debug message with a tick-based task or queued callback.
   - Prospecting should face the rock, wait roughly 3 ticks, then message `This rock contains ...` or `There is currently no ore available in this rock.`
   - Do not use `setTimeout`; keep it inside the task/tick system.

5. Validate ore data:
   - Verify every ore item key resolves through `findItem()`.
   - Verify every rock/depleted object id resolves from the 435 cache.
   - Review very low or negative `baseChance` values and keep them only if intentional for the current chance formula.
   - Document any approximation in code comments only where needed.

6. Add tests:
   - Unit-test `canMine()` boundaries.
   - Add task tests for no pickaxe, equipped pickaxe, insufficient level, full inventory, successful ore reward, XP award, rare gem path, and rock depletion/respawn.
   - Add a prospecting test for delayed message behavior.

## Client Work In `rs6-nullcity-client-ts`

Expected client work is minimal.

- Verify rock cache options generate `Mine` and `Prospect` menu entries and send the correct `OP_LOC*` packets.
- Confirm `Client.ts` location packet emission matches `object-interaction.packet.ts` for all option indexes used by Mining.
- Do not add client-side mining state or prediction.
- Only touch client code if a packet encoding mismatch prevents valid revision-435 interactions.

## Data / Config Requirements

Required data must be available and verified:

- Rock and depleted rock object ids in `rs6-nullcity-server/src/engine/world/config/object-ids.ts`.
- Ore definitions in `rs6-nullcity-server/src/engine/world/config/harvestable-object.ts`.
- Pickaxe item ids, level requirements, and animations in `rs6-nullcity-server/src/engine/world/config/harvest-tool.ts`.
- Ore item configs in `rs6-nullcity-server/data/config/items/skills/mining.json`.
- Pickaxe item configs in `rs6-nullcity-server/data/config/items/equipment/pickaxes.json`.
- Rare gem item configs used by `rollGemType()`.
- Sounds in `rs6-nullcity-server/src/engine/world/config/sound-ids.ts`.
- Skill guide consistency in `rs6-nullcity-server/src/plugins/skills/skill-guides/mining.json`.

Prefer cache-backed object and item lookup over duplicating 435 data in new files.

## Acceptance Checklist

- [ ] Mining clay/copper/tin at level 1 with a bronze pickaxe can reward ore and XP.
- [ ] Mining each configured ore enforces the configured Mining level.
- [ ] The best usable pickaxe on the player's person is selected and works from inventory or equipment.
- [ ] Mining fails with a clear message when the player has no usable pickaxe.
- [ ] Mining stops with inventory-full message and sound when inventory has no free slot.
- [ ] Successful mining depletes rocks according to config and respawns them.
- [ ] Rare gem roll can award configured gems without replacing the normal ore path incorrectly.
- [ ] Prospecting no longer emits debug text and returns a delayed ore message.
- [ ] Player movement or another action cancels mining via the task system.
- [ ] `npm run typecheck` passes in `rs6-nullcity-server`.
- [ ] Focused Jest tests for Mining and Prospecting pass.
- [ ] `bun run build` passes in `rs6-nullcity-client-ts` if client files are touched.

## Rough Work Estimate

- Fix task lifecycle, pickaxe handling, and plugin cleanup: 1 day.
- Finish prospecting and data validation: 0.5 to 1 day.
- Add focused tests: 1 day.
- Client verification: 0.25 day if no changes are needed, 0.5 day if packet mapping needs adjustment.

Total: 2.5 to 3.5 days.
