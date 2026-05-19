# Cooking Skill - Implementation Spec

Living document for the future subagent implementing Cooking for RuneScape revision 435. Keep this file scoped to implementation guidance; update it as work lands.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- There is no Cooking implementation under `rs6-nullcity-server/src/plugins/skills/cooking/` yet.
- A Cooking skill guide exists at `rs6-nullcity-server/src/plugins/skills/skill-guides/cooking.json`; use it as a UI reference, not as authoritative mechanics data.
- Skill IDs and XP helpers live in `rs6-nullcity-server/src/engine/world/actor/skills.ts`; Cooking is `Skill.COOKING`.
- Item definitions are loaded from `rs6-nullcity-server/data/config/items/` through `src/engine/config/item-config.ts` and `src/engine/config/config-handler.ts`.
- Existing item ID constants live in `rs6-nullcity-server/src/engine/world/config/item-ids.ts`; add missing raw/cooked/burnt food IDs there only if the codebase pattern requires constants.
- Existing object ID constants live in `rs6-nullcity-server/src/engine/world/config/object-ids.ts`; add range, stove, cooking fire, and similar object IDs there only when used by code.
- Action pipes already exist for the needed interactions:
  - `src/engine/action/pipe/item-on-object.action.ts`
  - `src/engine/action/pipe/item-on-world-item.action.ts`
  - `src/engine/action/pipe/item-interaction.action.ts`
  - `src/engine/action/pipe/button.action.ts`
- Reusable task patterns exist in:
  - `src/plugins/skills/firemaking/firemaking-task.ts`
  - `src/plugins/skills/smithing/smelting-task.ts`
  - `src/plugins/skills/smithing/forging-task.ts`
  - `src/plugins/skills/crafting/spinning-wheel.plugin.ts`
- Consumable food behavior already exists in `src/plugins/items/consumables/eating.plugin.ts`; Cooking should produce the food items that plugin can consume, not duplicate eating.
- Client skill indexing exists in `rs6-nullcity-client-ts/src/constants/Skill.ts`; no Cooking-specific client code exists.

Treat the current dirty worktree as intentional. Do not revert existing changes in resident, controller, combat, trade, or config files.

## Revision-435 Scope

The source of truth is the revision-435 cache/config used by this project, not OSRS or later RuneScape data. Implement the core free-to-play and early members Cooking surface that is present in the 435 cache:

- Cook raw food on fires, ranges, stoves, and similar cooking objects.
- Support one-off cooking from `item_on_object` and `item_on_world_item`.
- Support batch cooking when revision-435 widgets make it possible without client hacks.
- Award Cooking XP on successful cooked output only.
- Produce burnt output on burn failure where the 435 cache has a burnt item.
- Stop when the requested count is reached, the player runs out of input, the object/world item disappears, the inventory is full for a replacement flow, or the action is cancelled by movement/another action.
- Use 435-era messages, object options, animations, and sounds where available. If exact animation or sound IDs are not proven, isolate them in constants and leave a clear TODO with a cache lookup note.

Out of scope for the first pass:

- Brewing, gnome cooking, pies/cakes/pizzas with multi-stage assembly, dairy churning, and quest-locked special foods unless the data is already complete and cheap to include.
- Reworking the existing eating delay bug in `src/plugins/items/consumables/eating.plugin.ts`.
- Adding custom client interfaces that did not exist in revision 435.

## Server Work In `rs6-nullcity-server`

Create a small Cooking module under `src/plugins/skills/cooking/`:

- `cooking-types.ts`
  - `Cookable` recipe type: raw item, cooked item, optional burnt item, level, XP, burn thresholds, object/fire modifiers, message overrides.
  - `CookingHeatSource` type for range/fire metadata.
- `cooking-data.ts`
  - Cache-backed recipe table for fish, meat, chicken, bread, and other scoped foods.
  - Heat source table keyed by object ID/world-item ID.
  - Burn chance helpers. Keep formulas pure and tested; use level, required level, heat source, and any known 435-specific no-burn thresholds.
- `cooking-task.ts`
  - `CookingTask extends ActorTask<Player>` or a walk-aware task if cooking a world item.
  - Validates input and level every production tick.
  - Replaces the raw item slot with cooked/burnt output when possible to avoid unnecessary inventory churn.
  - Uses `player.skills.addExp(Skill.COOKING, recipe.experience)` only on success.
  - Sends inventory updates through existing container events or `outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory)` consistently with nearby plugins.
- `cooking.plugin.ts`
  - `item_on_object` hook for raw food on ranges/stoves.
  - `item_on_world_item` hook for raw food on fire world items.
  - Optional `object_interaction` hook for `cook` object option only if it can infer a raw item through an existing widget flow.
  - Optional `button` hooks for a make-X widget only if the widget IDs are verified in `data/config/widgets.json`.

Implementation constraints:

- Follow existing plugin shape: default export with `pluginId: 'rs:cooking'` and a `hooks` array.
- Do not block the event loop or use `setTimeout`; use task ticks.
- Do not hard-code item names in mechanics; use `findItem` for messages and debug errors.
- Do not silently consume items on missing recipe data. Send a useful player message and log the missing ID.
- Keep random burn rolls injectable or pure enough to test deterministically.
- Prefer small data tables over branching in the task.

Suggested tests:

- Recipe lookup for raw/cooked/burnt IDs.
- Level gate blocks low-level player and does not consume input.
- Successful cook consumes exactly one raw item, produces cooked item, awards XP.
- Burn consumes exactly one raw item, produces burnt item, awards no XP.
- Batch task stops on missing input.
- Fire cooking rejects missing/expired world item.

## Client Work In `rs6-nullcity-client-ts`

Expected first pass: no client changes.

The TypeScript client already supports inventory item-on-object/item-on-world-item packets, stat updates, chatbox messages, animations, sounds, widgets, and numeric input. Keep Cooking server-compatible with the existing revision-435 client protocol.

Only touch the client if verification proves a 435 cooking widget is decoded incorrectly:

- Inspect widget decoding in `src/config/IfType.ts` and menu/button handling in `src/client/Client.ts`.
- Keep fixes generic to widget/button behavior, not Cooking-specific UI shortcuts.
- Rebuild generated client outputs only if this repo's workflow requires it; otherwise leave `out/` and `public/client/` alone unless the project convention says they are checked in.

## Data And Config Requirements

- Add missing cooking item IDs to `src/engine/world/config/item-ids.ts` only for code readability. Prefer cache names via `findItem` when possible.
- Add missing heat source object IDs to `src/engine/world/config/object-ids.ts`.
- Verify `data/config/widgets.json` has any cooking/make-X widgets before adding button hooks.
- Ensure produced cooked foods have correct `consume_effects` metadata in `data/config/items/` so `rs:eating` works after Cooking creates them.
- Add or update item groups only if the repo already uses those groups for inventory/action filtering.
- Use revision-435 cache names and IDs. Do not copy OSRS item IDs blindly.

## Acceptance Checklist

- A player can cook at least the scoped raw fish/meat set on a range.
- A player can cook the same scoped set on a fire/world fire item where 435 supports it.
- Low Cooking level blocks the action with no item loss.
- Burn chance can produce burnt items and never awards Cooking XP.
- Successful cooking awards exact configured Cooking XP and updates the client skill tab.
- Batch cooking stops cleanly on count reached, no input, cancellation, or invalid heat source.
- Inventory updates are visible immediately in the client.
- Existing eating behavior works for produced cooked food.
- Unit tests cover recipe lookup, level gates, burn/success output, XP, and batch stop conditions.
- Manual smoke test on `rs6-nullcity-client-ts` confirms no unhandled interaction messages for the scoped actions.

## Rough Work Estimate

- Data audit and recipe table: 0.5-1 day.
- Core task and hooks: 1 day.
- Burn chance and batch behavior: 0.5-1 day.
- Tests and manual client smoke: 0.5 day.
- Total: 2.5-3.5 engineering days for the scoped first pass.
