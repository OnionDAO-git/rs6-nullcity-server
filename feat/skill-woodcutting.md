# Woodcutting — Implementation Spec

Audience: a future subagent implementing or finishing Woodcutting for RuneScape revision 435 in this repo. Keep changes scoped to Woodcutting unless an explicitly shared helper is needed.

## Current Repo State

Relevant server paths:

- `rs6-nullcity-server/src/plugins/skills/woodcutting/index.ts` registers `rs:woodcutting` for object options `chop down` and `chop`, using `getTreeIds()`.
- `rs6-nullcity-server/src/plugins/skills/woodcutting/woodcutting-task.ts` already has a task-based chopping loop, inventory checks, tool animation, log awarding, XP, stump replacement, respawn, and bird nest roll.
- `rs6-nullcity-server/src/plugins/skills/woodcutting/chance.ts` has the current success roll: `baseChance + toolLevel + woodcuttingLevel` against `0..255`.
- `rs6-nullcity-server/src/engine/world/config/harvestable-object.ts` holds the current `Trees` definitions and object-id maps for normal/dead, achey, oak, willow, teak, dramen, maple, hollow, mahogany, yew, and magic trees.
- `rs6-nullcity-server/src/engine/world/config/harvest-tool.ts` defines axe tiers and `getBestAxe()`.
- `rs6-nullcity-server/src/engine/world/skill-util/harvest-skill.ts` has `canInitiateHarvest()` with Woodcutting-specific level/tool/inventory messages.
- `rs6-nullcity-server/src/engine/world/skill-util/harvest-roll.ts` has `rollBirdsNestType()`.
- `rs6-nullcity-server/src/plugins/skills/skill-guides/woodcutting.json` already exists.
- `rs6-nullcity-server/data/config/items/logs.json` and `rs6-nullcity-server/data/config/items/equipment/hatchets.json` are the primary item config inputs.

Relevant client paths:

- `rs6-nullcity-client-ts/src/client/Client.ts` already sends `OPLOC1..OPLOC5` packets for location options.
- `rs6-nullcity-client-ts/src/client/MiniMenuAction.ts` and `rs6-nullcity-client-ts/src/io/ClientProt.ts` already define location interaction actions/opcodes.
- `rs6-nullcity-server/src/engine/net/inbound-packets/object-interaction.packet.ts` decodes revision-435 object interaction packets and maps option index to the cache object option text.

Known gaps and risks in the current Woodcutting code:

- `WoodcuttingTask.getItemToAdd()` sends a debug message, `Looking for item ...`, to the player. Remove this before acceptance.
- `rollBirdsNestType()` appears to have unreachable bird egg branches because `if (roll > 3)` wraps checks for `roll === 0` and `roll === 1`. Fix or explicitly defer with a test documenting current behavior.
- `harvestable-object.ts` contains duplicated dramen and hollow tree entries and comments saying some items may need to be added. Verify actual item config coverage before changing behavior.
- There are no focused Woodcutting tests in the repo.

## Revision-435 Scope

Implement classic revision-435 Woodcutting behavior, not modern OSRS mechanics unless the 435 cache/config already encodes them.

In scope:

- Chopping trees through object options `Chop down` / `Chop`.
- Axe selection from inventory or equipment, using the best usable axe by Woodcutting level.
- Level checks for tree type and axe type.
- Inventory-full handling before and during repeated chopping.
- Repeated attempts until success, tree depletion, inventory full, player interruption, or object invalidation.
- Correct start message, chopping animation, axe swing sounds, log success message, XP award, and stop animation behavior.
- Stump replacement and respawn using the 435 object ids already present in `harvestable-object.ts`.
- Bird nest drops from eligible tree chopping, with owner and expiry behavior matching existing world item conventions.
- Normal/dead tree, achey, oak, willow, teak, maple, mahogany, yew, and magic tree coverage. Dramen and hollow trees may be included only if supporting item/object config is valid for revision 435.

Out of scope for this skill pass:

- Quest-specific Woodcutting unlocks beyond existing level/item checks.
- Canoes, farming trees, sawmill/plank flows, forestry-style events, or modern skilling boosts.
- Client-side UI redesign. Only packet/menu correctness should be touched if required.

## Server Work In `rs6-nullcity-server`

1. Preserve the plugin entry point:
   - Keep `pluginId: 'rs:woodcutting'`.
   - Keep object interactions routed through `ActorLandscapeObjectInteractionTask` so walking, interruption, and object validation follow the existing task system.

2. Harden the task:
   - Remove player-facing debug messages.
   - Ensure `super.execute()` remains first in `WoodcuttingTask.execute()`.
   - Stop the task rather than looping forever when level, axe, inventory, or object validity fails.
   - Confirm the task still handles multi-tile tree object sizes from `findObject()`.
   - Use `Skill.WOODCUTTING` consistently through `player.skills.addExp(...)` or the existing shortcut, matching local style.

3. Validate and clean tree data:
   - Verify every tree item key in `Trees` resolves through `findItem()`.
   - Verify every healthy tree id and stump id resolves from the 435 cache or existing object config.
   - Remove duplicate dramen/hollow entries if they cause duplicate ids or inconsistent behavior.
   - Keep respawn times in ticks and document any values that are approximations.

4. Fix nest behavior:
   - Decide whether nest drop is in-scope for this pass. If yes, fix `rollBirdsNestType()` weights and add tests.
   - If nest item configs are incomplete, fall back to a single configured nest item or defer nests explicitly in this spec's checklist when implementing.

5. Add tests:
   - Unit-test `canCut()` boundaries with deterministic random mocking if local test patterns allow it.
   - Add task tests for no axe, insufficient level, full inventory, successful log award, XP award, and tree depletion replacement.
   - Prefer small helpers under existing test utility paths rather than broad integration scaffolding.

## Client Work In `rs6-nullcity-client-ts`

Expected client work is minimal.

- Verify 435 location options on tree objects create the expected `MiniMenuAction.OP_LOC*` action and server opcode.
- Verify no client changes are needed for the existing menu text coming from cache `LocType` options.
- If an interaction fails only because the client sends a different option index than the server expects, adjust packet/action mapping with a small targeted change and document it in the implementation PR.
- Do not add custom client-side Woodcutting state; the server is authoritative.

## Data / Config Requirements

Required data must be available and verified:

- Tree object ids and stump ids in `rs6-nullcity-server/src/engine/world/config/object-ids.ts`.
- Tree harvest definitions in `rs6-nullcity-server/src/engine/world/config/harvestable-object.ts`.
- Axe item ids, levels, and animations in `rs6-nullcity-server/src/engine/world/config/harvest-tool.ts`.
- Log items in `rs6-nullcity-server/data/config/items/logs.json`.
- Axe/hatchet items in `rs6-nullcity-server/data/config/items/equipment/hatchets.json`.
- Sounds in `rs6-nullcity-server/src/engine/world/config/sound-ids.ts`.
- Skill guide consistency in `rs6-nullcity-server/src/plugins/skills/skill-guides/woodcutting.json`.

If a 435 cache object or item is missing from local JSON config but exists in cache, prefer using `findItem()` / cache-backed config behavior rather than duplicating data by hand.

## Acceptance Checklist

- [ ] Chopping a normal tree with a bronze axe at level 1 gives logs and 25 Woodcutting XP.
- [ ] Chopping oak/willow/yew/magic enforces the configured Woodcutting level.
- [ ] The best usable axe on the player's person is selected and its animation is used.
- [ ] Chopping fails with a clear message when the player has no usable axe.
- [ ] Chopping stops with inventory-full message and sound when inventory has no free slot.
- [ ] Successful chopping replaces depletable trees with stumps and respawns the healthy tree.
- [ ] Player movement or another action cancels the chopping task via the task system.
- [ ] No player-facing debug messages remain.
- [ ] Bird nest behavior is either tested and working or explicitly disabled/deferred with no broken item spawns.
- [ ] `npm run typecheck` passes in `rs6-nullcity-server`.
- [ ] Focused Jest tests for Woodcutting pass.
- [ ] `bun run build` passes in `rs6-nullcity-client-ts` if client files are touched.

## Rough Work Estimate

- Finish existing server behavior and data cleanup: 1 to 2 days.
- Add focused tests and deterministic random seams: 0.5 to 1 day.
- Client verification: 0.25 day if no changes are needed, 0.5 day if packet mapping needs adjustment.

Total: 2 to 3.5 days.
