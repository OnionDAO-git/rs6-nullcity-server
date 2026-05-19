# Herblore Skill — Implementation Spec

Audience: future subagent implementing Herblore for RuneScape revision 435. Keep this document current as work lands.

## Current Repo State

- Server repo: `rs6-nullcity-server`.
- Client repo: `rs6-nullcity-client-ts`.
- Skill registry already includes `Skill.HERBLORE` and the `herblore` shortcut in `rs6-nullcity-server/src/engine/world/actor/skills.ts`.
- Existing Herblore plugin:
  - `rs6-nullcity-server/src/plugins/items/herblore/clean-herb.ts` supports identifying/cleaning grimy herbs from inventory, level checks, XP, inventory replacement, and sound.
- Item config exists but is incomplete and partially inaccurate:
  - `data/config/items/skills/herblore/herbs.json` has grimy and clean herbs.
  - `data/config/items/skills/herblore/ingredients.json` only has eye of newt.
  - `data/config/items/skills/herblore/tools.json` has pestle and mortar.
  - `data/config/items/skills/herblore.json` mixes potion guide/display keys with repeated or placeholder game ids and should not be trusted as recipe data.
- `src/engine/world/config/animation-ids.ts` has Herblore `make_potion` and `pestle_and_mortar` ids.
- `src/engine/world/config/sound-ids.ts` has `herblore.clean_herb` and `herblore.make_potion`.
- Client skill constants enable Herblore in `rs6-nullcity-client-ts/src/constants/Skill.ts`.

## Revision-435 Scope

Implement core revision 435 Herblore potion creation and ingredient processing.

In scope:
- Cleaning grimy herbs, keeping existing behavior but moving recipe data to a shared table.
- Water-filled vial + clean herb creates unfinished potion.
- Unfinished potion + secondary ingredient creates finished potion.
- Pestle-and-mortar processing for recipe ingredients that require grinding.
- 3-dose finished potions as primary outputs, with existing item-consumption code handling drinking doses if configured.
- Level requirements, XP, messaging, animation, sound, inventory updates, and busy/action cancellation behavior.
- Recipes visible in the existing skill guide JSON should be craftable where revision 435 item ids are available.

Out of scope for first pass:
- Farming/herb acquisition loops.
- Barbarian mixes.
- Weapon poison application to weapons unless item/equipment poison support already exists.
- Full potion consumption effects for every potion. Add consume metadata only for easy, already-supported effects.

## Server Work (`rs6-nullcity-server`)

Required work:
- Create `src/plugins/skills/herblore/` and move Herblore gameplay there. Keep `src/plugins/items/herblore/clean-herb.ts` as a compatibility wrapper or remove it only if plugin loading remains correct.
- Define typed recipe data:
  - grimy herb to clean herb;
  - vial of water + clean herb to unfinished potion;
  - unfinished potion + secondary ingredient to finished potion;
  - pestle-and-mortar transformations.
- Use existing `item_on_item` action pipe for all mixing/grinding.
- Validate inventory slots before mutation, following the anti-cheat checks in `clean-herb.ts`.
- Use a reusable helper for replacing/removing/adding items so failed inventory adds cannot delete ingredients.
- Apply `player.skills.hasLevel('herblore', level)` and `player.skills.addExp('herblore', xp)`.
- Play `animationIds.herblore.make_potion` and `soundIds.herblore.make_potion` for mixing; use pestle animation where applicable.
- Ensure inventory widget refreshes through `sendUpdateAllWidgetItems(widgets.inventory, player.inventory)`.
- Add tests for cleaning, unfinished potion creation, finished potion creation, grinding, low-level rejection, missing ingredient rejection, and inventory-full edge cases.

Suggested initial recipe set:
- Attack potion, antipoison, strength potion, restore potion, energy potion, defence potion, prayer potion, super attack, super strength, super defence, ranging potion, magic potion, zamorak brew, saradomin brew where revision 435 ids are confirmed.
- Include toadflax/snapdragon/lantadyme herbs already present in `herbs.json` only if the matching potion and ingredient ids are confirmed.

## Client Work (`rs6-nullcity-client-ts`)

Prefer no client changes.

Expected work:
- Verify generic inventory updates, stat updates, animations, and sounds render correctly.
- Do not add client-side Herblore recipes or validation.
- If a recipe needs a make-x dialog later, use existing server widget/dialog patterns first; only inspect client interface behavior if the 435 widget requires custom packet support.

## Data / Config Requirements

- Add missing item configs for:
  - vials, vial of water, unfinished potions;
  - secondary ingredients;
  - finished 3-dose potions and lower-dose variants if consumption is supported;
  - grindable raw ingredients and ground outputs.
- Clean up `data/config/items/skills/herblore.json` so item keys are accurate and not just guide placeholders.
- Preserve existing `herbs.json` keys where possible to avoid breaking `clean-herb.ts` references.
- Add recipe constants in TypeScript first for type safety; consider moving to JSON only after tests make bad ids obvious.
- Confirm all recipe item ids against the revision 435 cache before acceptance.

## Acceptance Checklist

- [ ] Every recipe item referenced by Herblore constants resolves through `findItem`.
- [ ] Grimy herb cleaning still works for all configured herbs.
- [ ] Low Herblore level rejects cleaning and mixing with the correct message.
- [ ] Vial of water + herb creates the correct unfinished potion.
- [ ] Unfinished potion + secondary creates the correct finished potion and grants correct XP.
- [ ] Pestle-and-mortar recipes consume and produce the correct items.
- [ ] Inventory mutation is atomic enough that missing space or stale slots do not delete ingredients.
- [ ] Animations, sounds, and inventory refreshes are sent on successful actions.
- [ ] Tests cover representative success and failure paths.
- [ ] `npm run typecheck` and targeted Jest tests pass in `rs6-nullcity-server`.

## Rough Work Estimate

3-5 days for a usable recipe-backed Herblore pass. Add 1-2 days if many potion item configs or consumption effects need to be corrected before recipes can be verified.
