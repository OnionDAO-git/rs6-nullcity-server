# Fletching Skill - Implementation Spec

Living document for the future subagent implementing Fletching for RuneScape revision 435. This is a handoff spec for one skill, not a broad combat/ranged refactor.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- Fletching has placeholder/partial files under `rs6-nullcity-server/src/plugins/skills/fletching/`:
  - `fletching.plugin.ts` currently exports only `pluginId: 'rs:fletching'`.
  - `fletching-constants.ts` contains recipe data, but it needs validation; several recipes appear to use normal logs for all wood tiers and at least one strung bow output appears mismatched.
  - `fletching-types.ts` defines a minimal `Fletchable`.
- Skill guide data exists at `rs6-nullcity-server/src/plugins/skills/skill-guides/fletching.json`.
- Relevant constants already exist in `src/engine/world/config/item-ids.ts`: knife, feathers, arrow shafts, headless arrows, arrows, bowstrings, unstrung/strung bows, logs, and related ranged materials.
- Item-on-item hooks are supported by `src/engine/action/pipe/item-on-item.action.ts`.
- Button and numeric input hooks are supported by `src/engine/action/pipe/button.action.ts` and `Player.numericInputEvent`.
- Ranged combat exists under `src/engine/world/actor/combat/ranged-strategy.ts`, but Fletching should not change combat behavior except by producing ammunition/items.
- Client skill indexing exists in `rs6-nullcity-client-ts/src/constants/Skill.ts`; no Fletching-specific client code exists.

Do not revert unrelated uncommitted changes. This spec should guide work that builds on the current repo as found.

## Revision-435 Scope

Use the revision-435 cache/config as source of truth. Implement core Fletching production available in the 435 era:

- Knife on logs to make arrow shafts and unstrung shortbows/longbows for supported wood tiers.
- Bowstring on unstrung bows to make strung bows.
- Feathers on arrow shafts to make headless arrows.
- Arrowheads on headless arrows to make finished arrows for supported metal tiers.
- Optional crossbow stocks/bolts only if the 435 cache data and item options are verified.
- Batch amounts should follow available client options: make-1, make-5, make-10, make-X, or equivalent widget/menu behavior.
- Award Fletching XP per successful product or product set, matching 435 data.

Out of scope for the first pass:

- Bolt tipping/enchanting, ogre arrows, brutal arrows, darts, javelins, poisoned ammunition, and quest-only products unless existing data makes them trivial.
- Changes to ranged combat ammo consumption or equipment stats.
- Custom client widgets.

## Server Work In `rs6-nullcity-server`

Replace the placeholder implementation with a tested Fletching module:

- `fletching-types.ts`
  - Expand `Fletchable` to include action category, required tool if any, input items, output item, level, XP, amount-per-action, animation, message labels, and optional widget button mapping.
- `fletching-data.ts` or a cleaned `fletching-constants.ts`
  - Split data into explicit tables:
    - `LOG_CUTTING_RECIPES`
    - `BOW_STRINGING_RECIPES`
    - `HEADLESS_ARROW_RECIPES`
    - `ARROW_FINISHING_RECIPES`
  - Validate all item IDs against `findItem` during startup or tests.
  - Ensure each wood-tier recipe uses that tier's logs, not normal logs.
- `fletching-task.ts`
  - Repeated production task for batch fletching.
  - Validates level, materials, tools, and inventory capacity every production tick.
  - Handles stackable outputs like arrows/headless arrows correctly.
  - Awards XP per action using `Skill.FLETCHING`.
  - Plays a verified animation where possible; isolate unknown IDs in constants.
- `fletching.plugin.ts`
  - Add `item_on_item` hooks for:
    - knife + logs.
    - bowstring + unstrung bow.
    - feather + arrow shafts.
    - arrowheads + headless arrows.
  - For ambiguous products from one input, open the appropriate 435 make interface if verified; otherwise choose only unambiguous item-on-item recipes for v1 and leave bow selection for a follow-up.
  - Add `button` hooks for verified make widgets and numeric input.

Implementation constraints:

- Keep item-order handling symmetric for item-on-item actions.
- Do not consume inputs before all validation passes.
- For outputs with `amount > 1`, ensure stackable and non-stackable behavior both work.
- Prefer replacing/consuming exact slots from the action where possible so item-on-item behavior is predictable.
- Use `findItem` for names and data validation.
- Do not touch ranged combat unless tests show produced arrows cannot be equipped due to missing item config; in that case update item config only.

Suggested tests:

- Knife on logs can create arrow shafts and awards XP.
- Knife on higher-tier logs respects required level and uses correct log ID.
- Bowstring on unstrung bow creates the matching strung bow.
- Feathers on shafts create headless arrows in the configured batch amount.
- Arrowheads on headless arrows create finished arrows and consumes both inputs.
- Batch task stops when one ingredient runs out.
- Low level blocks action without item loss.

## Client Work In `rs6-nullcity-client-ts`

Expected first pass: no client changes.

The existing client should already emit item-on-item, button, and numeric input packets needed by Fletching. The server should use revision-435 widgets and inventory/menu options as-is.

Only touch the client if verified Fletching widgets cannot be used because of a generic decode or dispatch issue:

- Widget/model decode: `src/config/IfType.ts`.
- Menu building and button dispatch: `src/client/Client.ts`.
- Client protocol enums: `src/io/ClientProt.ts` and `src/io/ServerProt.ts`.

Do not add a bespoke Fletching UI overlay in the TypeScript client.

## Data And Config Requirements

- Audit existing `itemIds.logs`, bow, arrow, arrowhead, and string constants against the revision-435 cache.
- Add missing arrowhead item IDs if they are not already present.
- Verify item stackability for shafts, headless arrows, arrowheads, and arrows in `data/config/items/` or cache fallback.
- Verify inventory options for produced bows/arrows so they can be equipped or used by existing ranged systems.
- Keep `skill-guides/fletching.json` aligned with implemented recipes if guide data is expected to represent real availability.
- If a make interface is used, verify widget IDs and button child IDs in `data/config/widgets.json`; do not infer button IDs from another revision.

## Acceptance Checklist

- `rs:fletching` has real hooks and no longer acts as a placeholder.
- At least normal-log arrow shafts and shortbow/longbow flows work.
- Bow stringing creates the matching strung bow for each scoped tier.
- Headless and finished arrows can be made in configured batches.
- Required Fletching levels are enforced.
- XP is awarded exactly according to recipe data.
- Inputs and outputs update immediately in the client inventory.
- Batch actions cancel cleanly on movement/action cancellation and stop on missing ingredients.
- Unit tests cover all scoped recipe categories.
- Manual smoke test confirms no unhandled item-on-item messages for scoped actions.

## Rough Work Estimate

- Audit and correct existing data: 0.5-1 day.
- Task and item-on-item hooks: 1 day.
- Widget/make-X behavior if verified: 0.5-1 day.
- Tests and manual client smoke: 0.5 day.
- Total: 2.5-3.5 engineering days for the scoped first pass.
