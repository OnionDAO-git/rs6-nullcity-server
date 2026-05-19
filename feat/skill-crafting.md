# Crafting Skill - Implementation Spec

Living document for the future subagent implementing Crafting for RuneScape revision 435. Keep this file aimed at the implementer responsible for this skill only.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- Crafting is partially implemented under `rs6-nullcity-server/src/plugins/skills/crafting/`:
  - `sheep-plugin.plugin.ts` has shearing hooks, but the actual wool reward logic is commented out around old `setTimeout` behavior and currently emits a debug message.
  - `spinning-wheel.plugin.ts` implements spinning wheel flows for wool/flax/strings with a local `SpinProductTask`.
- Skill guide data exists at `rs6-nullcity-server/src/plugins/skills/skill-guides/crafting.json`.
- Relevant constants already exist in `src/engine/world/config/item-ids.ts`: wool, ball of wool, flax, bowstring, shears, sinew, crossbow string, magic string, and some roots.
- `objectIds.spinningWheel` exists in `src/engine/world/config/object-ids.ts`.
- The action system already supports the required hooks:
  - `item_on_item` for tools on materials.
  - `item_on_object` and `object_interaction` for pottery wheels/furnaces/spinning wheels.
  - `item_on_npc` and `npc_init` for sheep.
  - `button` and numeric input for make-X widgets.
- Client skill indexing exists in `rs6-nullcity-client-ts/src/constants/Skill.ts`; no Crafting-specific client code exists.

Treat existing uncommitted changes as owned by other work. Do not revert or reformat unrelated skill, resident, controller, trade, or combat files.

## Revision-435 Scope

The source of truth is the revision-435 cache/config in this project. Implement Crafting mechanics that fit the 435 client and available world objects:

- Repair and finish sheep shearing using tick-based tasks, not timers.
- Keep and harden spinning wheel behavior.
- Add leather crafting with needle/thread where 435 inventory options support it.
- Add pottery basics if the relevant objects/items/widgets are present: soft clay on pottery wheel, unfired item on pottery oven/furnace, fired output.
- Add gem cutting with chisel for common gems if item IDs and animations are verified.
- Add glassblowing only if molten glass, glassblowing pipe, and products are verified in the 435 cache.
- Award Crafting XP on successful production only.
- Respect required levels, tool requirements, inventory capacity, and item quantities.

Out of scope for the first pass:

- Full jewellery mould/silver/gold furnace interfaces unless the 435 widget IDs and mould data are verified.
- Battle staves, dragonhide, quest-only crafting, and Construction-adjacent material production.
- Any custom client UI not present in revision 435.

## Server Work In `rs6-nullcity-server`

Refactor Crafting into a coherent module while preserving existing plugin behavior:

- `src/plugins/skills/crafting/crafting-types.ts`
  - Shared recipe types for item-on-item, object production, and NPC resource gathering.
- `src/plugins/skills/crafting/crafting-data.ts`
  - Data tables for leather, pottery, gems, spinning products, and optional glass.
  - Tool IDs, input IDs, output IDs, level requirements, XP, animation/sound IDs.
- `src/plugins/skills/crafting/crafting-task.ts`
  - Generic repeated production task for item transforms.
  - Per-tick validation of level, tools, materials, and inventory capacity.
  - Deterministic slot replacement for one-input to one-output actions.
- `src/plugins/skills/crafting/shearing-task.ts`
  - Walk-aware or NPC-aware task replacing the commented timeout logic.
  - Handles sheep escape/failure only if 435 behavior is verified; otherwise implement deterministic shearing success with a TODO for failure chance.
- Update `sheep-plugin.plugin.ts`
  - Remove debug-only behavior.
  - Use task scheduling, play animation/sound, award wool, transform sheep if the existing NPC transform path is safe.
- Update `spinning-wheel.plugin.ts`
  - Move embedded data and task into shared files if needed.
  - Keep widget button IDs only if verified against `data/config/widgets.json`.
  - Fix array input iteration in `SpinProductTask`; the current code can step past the input array.
- Add focused plugins as needed:
  - `leather-crafting.plugin.ts`
  - `gem-cutting.plugin.ts`
  - `pottery.plugin.ts`
  - `glassblowing.plugin.ts` if included.

Implementation constraints:

- Use `Skill.CRAFTING` or `'crafting'` consistently with nearby code.
- Do not use `setTimeout`/`setInterval`; all delayed work must be task-driven.
- Do not merge unrelated fixes into this skill pass.
- Keep recipe data declarative. The task should not know item names or product categories.
- Send inventory updates through the same pattern used by spinning/smithing.
- Use `findItem` for item names in messages.
- Log missing data as implementation errors; do not consume items if a recipe is incomplete.

Suggested tests:

- Shearing success gives wool and releases `busy`.
- Spinning wool/flax consumes input, gives output, awards Crafting XP, and stops at count.
- Low-level spinning/crafting blocks with no item loss.
- Item-on-item recipe uses the correct tool and material regardless of item order.
- Multi-material recipe refuses to start if any ingredient is short.
- Gem cutting and pottery outputs award only configured XP.

## Client Work In `rs6-nullcity-client-ts`

Expected first pass: no client changes.

The existing client already decodes inventory actions, item-on-item, item-on-NPC, item-on-object, object actions, button clicks, numeric input, animations, sounds, and stat updates.

Only touch client code if a verified 435 Crafting interface does not behave correctly:

- Widget decoding: `src/config/IfType.ts`.
- Menu/action dispatch: `src/client/Client.ts` and `src/client/MiniMenuAction.ts`.
- Skill count/indexing: `src/constants/Skill.ts` should not require changes because Crafting already exists.

If client changes are unavoidable, keep them protocol-generic and cover them with a manual smoke test against the server.

## Data And Config Requirements

- Verify item IDs in the revision-435 cache before adding constants:
  - tools: shears, needle, thread, chisel, pottery wheel materials, glassblowing pipe.
  - materials: wool, flax, leather, soft clay, unfired pottery, gems, molten glass.
  - outputs: ball of wool, bowstring, leather items, fired pottery, cut gems, glass products.
- Verify object IDs for pottery wheel, pottery oven, furnace, spinning wheel, and any crafting-specific stations.
- Confirm sheep NPC IDs and transform target IDs in `data/config/npcs/` before using transformation.
- Update item config metadata only when produced items need inventory options, stackability, equipment slots, or consume effects.
- Keep `skill-guides/crafting.json` aligned with newly implemented recipes if that guide is meant to reflect available gameplay.

## Acceptance Checklist

- Sheep shearing no longer emits the debug issue message and can produce wool.
- Spinning wheel still opens and can make at least ball of wool and bowstring.
- Spinning and any new Crafting production use tick tasks and cancel cleanly.
- Low Crafting level blocks recipes with no item loss.
- Tool requirements are enforced.
- Inventory capacity is respected for recipes that add outputs instead of replacing inputs.
- Crafting XP is awarded exactly once per successful product.
- Client inventory and skill tab update immediately.
- No unhandled interaction messages for scoped item/tool/object actions.
- Unit tests cover shearing, spinning, level gates, item-on-item transforms, and cancellation/stop conditions.

## Rough Work Estimate

- Stabilize existing shearing/spinning: 1 day.
- Add shared recipe/task structure: 0.5-1 day.
- Leather/gem/pottery scoped mechanics: 1.5-2.5 days depending on verified widgets/data.
- Tests and manual client smoke: 0.5-1 day.
- Total: 3.5-5.5 engineering days for a solid first pass.
