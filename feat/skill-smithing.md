# Smithing Skill - Implementation Spec

Living document for the future subagent implementing Smithing for RuneScape revision 435. This spec assumes the implementer is working inside the current codebase, where Smithing is already partially present.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- Smithing has partial implementations under `rs6-nullcity-server/src/plugins/skills/smithing/`:
  - `smelting.plugin.ts`, `smelting-task.ts`, `smelting-constants.ts`, `smelting-types.ts`
  - `forging.plugin.ts`, `forging-task.ts`, `forging-constants.ts`, `forging-types.ts`
- Existing smelting uses `object_interaction` on `objectIds.furnace` and widget button hooks for `widgets.furnace`.
- Existing forging uses `item_on_object` for bars on anvils and item interaction options such as `make`, `make-5`, and `make-10`.
- Existing tasks award `Skill.SMITHING` XP and update inventory/widgets manually.
- Relevant constants exist in:
  - `src/engine/world/config/item-ids.ts` for ores, bars, hammer, and many smithable outputs.
  - `src/engine/world/config/object-ids.ts` for `furnace`.
  - `src/plugins/skills/smithing/*-constants.ts` for recipes/widget IDs.
- Skill guide data exists at `src/plugins/skills/skill-guides/smithing.json`.
- Client skill indexing exists in `rs6-nullcity-client-ts/src/constants/Skill.ts`; no Smithing-specific client code exists.

Treat existing uncommitted changes as other work. Do not revert them and do not reformat unrelated files.

## Revision-435 Scope

Use the revision-435 cache/config and widgets as source of truth. The first complete Smithing pass should cover:

- Smelting ores into bars at furnaces:
  - bronze, iron, silver, steel, gold, mithril, adamant, rune.
  - blurite only if the quest/data requirements are verified.
  - iron failure chance if applicable to revision 435.
  - coal requirements for steel and higher tiers.
- Forging bars into supported equipment at anvils:
  - weapons and armor already represented in `forging-constants.ts`.
  - correct bars-per-product, level requirements, XP, and output amounts.
  - hammer requirement.
- Existing furnace/anvil widgets should be used where possible.
- Make-1, make-5, make-10, and make-X should work only where the revision-435 client exposes those controls.

Out of scope for the first pass:

- Cannonballs, quest-only smithing, dragon/Barbarian smithing, blast furnace, jewellery crafting, and Construction materials.
- Reworking equipment bonuses except where produced items are impossible to equip due to missing item config.
- Custom client UI.

## Server Work In `rs6-nullcity-server`

Stabilize and complete the existing Smithing module rather than replacing it wholesale:

- Data validation:
  - Audit `smelting-constants.ts` and `forging-constants.ts` against revision-435 item IDs, widget IDs, levels, XP, and material counts.
  - Add startup/test validation that every recipe input/output resolves through `findItem`.
  - Verify `anvilIds` and furnace object IDs against cache objects.
- `smelting-task.ts`
  - Fix low-level handling so the task stops after sending the level message; it currently returns without stopping.
  - Improve "not enough materials" messages to name missing ores rather than the output bar.
  - Add iron ore failure behavior if confirmed for 435.
  - Ensure each production tick consumes the exact required ores and awards XP once.
- `smelting.plugin.ts`
  - Keep object and button hook structure.
  - Confirm `widgets.furnace` child IDs and button mapping.
  - Handle make-X numeric input cancellation consistently.
- `forging-task.ts`
  - Validate Smithing level inside the task too, not only before enqueue, because stats/inventory can change during batch production.
  - Stop with a player message when materials run out.
  - Play verified hammer/anvil animation and sound from constants.
  - Use inventory/container update patterns consistently.
- `forging.plugin.ts`
  - Remove repeated runtime flattening of recipe maps from hot paths; precompute lookup maps once at module load.
  - Validate selected smithable against the currently open anvil/bar context if the interface exposes enough state. Prevent making an item from a stale widget state after inventory changes.
  - Add make-X if the revision-435 widget supports it.

Implementation constraints:

- Do not consume ores/bars until all validation passes for that item.
- Do not rely only on widget-open checks for security; always validate inventory, level, tool, and selected output server-side.
- Keep quest gates explicit and data-driven. The existing Knight's Sword TODO in `smelting.plugin.ts` should not block standard bars.
- Use `Skill.SMITHING` for XP and level checks.
- Keep formulas/data in constants; task code should be category-agnostic.

Suggested tests:

- Bronze smelting consumes copper+tin and produces bronze bar.
- Steel or higher smelting consumes correct coal amount.
- Low-level smelting stops and consumes nothing.
- Missing ores stop task and consume nothing.
- Forging requires hammer.
- Forging consumes correct number of bars and creates output.
- Batch forging stops when bars run out.
- Recipe lookup maps contain all widget-exposed items.

## Client Work In `rs6-nullcity-client-ts`

Expected first pass: no client changes.

The current TypeScript client already handles the furnace/anvil widgets, button clicks, numeric input, inventory updates, stat updates, animations, and sounds used by the server.

Only touch the client if a verified revision-435 widget is decoded or dispatched incorrectly:

- Widget decode: `src/config/IfType.ts`.
- Button/menu handling: `src/client/Client.ts`.
- Protocol enum corrections: `src/io/ClientProt.ts` and `src/io/ServerProt.ts`.

Do not implement server mechanics by adding client-only shortcuts. Smithing must remain authoritative on the server.

## Data And Config Requirements

- Verify all ore, bar, hammer, weapon, armor, and tool IDs in `src/engine/world/config/item-ids.ts`.
- Verify furnace and anvil object IDs in `src/engine/world/config/object-ids.ts` and `forging-constants.ts`.
- Verify `data/config/widgets.json` entries for furnace and anvil interfaces.
- Ensure smithable output items have correct equipment metadata in `data/config/items/` if they are equipable.
- Keep `skill-guides/smithing.json` aligned with recipes that are actually implemented.
- Add sound/animation IDs to `src/engine/world/config/sound-ids.ts` and `src/engine/world/config/animation-ids.ts` only after cache verification.

## Acceptance Checklist

- Furnace smelting works for the scoped bar set with correct materials and XP.
- Anvil forging works for the scoped item set with correct bar counts and XP.
- Hammer requirement is enforced for forging.
- Low-level and missing-material paths consume no items.
- Batch smelting/forging stops cleanly on count reached, missing materials, cancellation, or widget closure.
- Iron failure behavior is either implemented with tests or explicitly documented as deferred pending 435 verification.
- Client inventory, widget containers, and skill tab update immediately.
- Recipe lookup no longer does repeated full-map flattening during each item interaction.
- Unit tests cover smelting, forging, levels, materials, batch stops, and lookup validation.
- Manual client smoke test confirms no unhandled furnace/anvil interactions for scoped actions.

## Rough Work Estimate

- Data/widget audit: 0.5-1 day.
- Stabilize existing smelting and forging tasks: 1-1.5 days.
- Lookup refactor and make-X hardening: 0.5-1 day.
- Tests and manual client smoke: 0.5-1 day.
- Total: 2.5-4.5 engineering days depending on how much existing data needs correction.
