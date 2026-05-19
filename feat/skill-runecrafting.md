# Runecrafting Skill — Implementation Spec

Audience: future subagent implementing Runecrafting for RuneScape revision 435. Keep this document current as work lands.

## Current Repo State

- Server repo: `rs6-nullcity-server`.
- Client repo: `rs6-nullcity-client-ts`.
- Skill registry already includes `Skill.RUNECRAFTING` and the `runecrafting` shortcut in `rs6-nullcity-server/src/engine/world/actor/skills.ts`.
- Item ids exist in `rs6-nullcity-server/src/engine/world/config/item-ids.ts` for essence, runes, talismans, and tiaras.
- Item configs exist in `rs6-nullcity-server/data/config/items/skills/runecrafting.json` for many runes, essence, talismans, and tiaras. Review this file carefully: at least `rs:air_tiara` appears to use game id `5523`, while code expects blank tiara `5525` and air tiara `5527`.
- Existing plugins:
  - `src/plugins/skills/runecrafting/runecrafting-altar.plugin.ts` handles talisman-on-mysterious-ruins entry and altar portal exit.
  - `src/plugins/skills/runecrafting/runecrafting-crafting.plugin.ts` crafts normal and combination runes.
  - `src/plugins/skills/runecrafting/runecrafting-tiara.plugin.ts` updates tiara config `491` on equip/unequip.
  - `src/plugins/items/runecrafting/tiaras.plugin.ts` duplicates one air-tiara config behavior and should be removed or folded into the skill plugin.
  - `src/plugins/skills/runecrafting/runecrafting-constants.ts` has hardcoded altars, runes, talismans, tiaras, combination runes, and multiplier logic.
- Mining already has essence mining support listed in `FEATURES.md`; verify actual behavior in `src/plugins/skills/mining/*`.
- Client skill constants enable Runecrafting in `rs6-nullcity-client-ts/src/constants/Skill.ts`.

## Revision-435 Scope

Implement revision 435 Runecrafting behavior around rune essence and the standard altar network.

In scope:
- Normal rune crafting for air, mind, water, earth, fire, body, cosmic, chaos, nature, law, and death.
- Rune essence vs pure essence restrictions matching 435:
  - low/basic runes can use rune or pure essence;
  - higher runes require pure essence.
- Correct rune multipliers by Runecrafting level.
- Talisman entry into mysterious ruins and exit through altar portals.
- Tiara creation at altars and tiara equip state on config `491`.
- Combination rune crafting for mist, dust, mud, smoke, steam, and lava with correct requirements, talisman consumption chance, and rune/essence costs.
- Basic failure messaging and inventory refresh.

Out of scope for first pass:
- Abyss, pouches, ZMI, Ourania, astral/blood/soul altar content unless revision-435 data and maps are already usable.
- Quest locks for cosmic/law/death if supporting quests are not implemented.
- Rune essence mine access if existing mining coverage is incomplete; document as dependency.

## Server Work (`rs6-nullcity-server`)

Build on the current plugin files rather than rewriting from scratch.

Required work:
- Audit item ids in `data/config/items/skills/runecrafting.json` against `src/engine/world/config/item-ids.ts` and cache game ids. Fix mismatches before gameplay changes.
- Remove duplicated tiara behavior from `src/plugins/items/runecrafting/tiaras.plugin.ts` or narrow it so it cannot conflict with `src/plugins/skills/runecrafting/runecrafting-tiara.plugin.ts`.
- Convert `runecrafting-constants.ts` to a stricter definition shape:
  - no `as RunecraftingRune` around possibly undefined `Map.get()` values;
  - fail fast at module load if a referenced altar/talisman/tiara/rune is missing;
  - add explicit required essence kind and optional quest/members notes.
- Fix normal crafting inventory removal:
  - do not remove both rune and pure essence groups blindly if both exist;
  - remove only the amount actually crafted;
  - preserve inventory slots predictably.
- Fix combination rune crafting:
  - `requiredRunesIndex > 0` currently rejects slot `0`; use `>= 0`;
  - XP should use `amountToCraft`, not all available essence;
  - support binding necklace if present in scope, or explicitly leave TODO.
- Implement tiara creation with blank tiara + matching talisman on altar, level requirement, XP, resulting tiara, talisman removal, config update only when equipped.
- Add animations/sounds/gfx if confirmed for revision 435; otherwise keep gameplay correct and leave audiovisual ids as TODOs.
- Add tests for normal crafting, essence restrictions, multipliers, combination runes, tiara creation, tiara equip config, and altar entry/exit.

## Client Work (`rs6-nullcity-client-ts`)

Prefer no client changes.

Expected work:
- Verify client receives inventory updates, stat updates, map rebuild/teleport, and config `491` for tiara unlock/equip visuals.
- If config `491` does not affect the 435 client as expected, inspect `rs6-nullcity-client-ts/src/client/Client.ts` varp handling and note the real config id/bit mapping in the server constants.
- Do not add client-side Runecrafting rules.

## Data / Config Requirements

- Confirm all runecrafting item ids in:
  - `data/config/items/skills/runecrafting.json`;
  - `src/engine/world/config/item-ids.ts`.
- Confirm altar object ids and portal ids in `runecrafting-constants.ts` against revision 435 cache object definitions.
- Add missing examine/tradable/stackable data for runes, essence, talismans, and tiaras only where needed for server behavior.
- Add or verify scenery spawns for mysterious ruins/altars/portals if cache maps do not provide interaction objects in target areas.
- Document quest/member restrictions in constants even if enforcement is deferred.

## Acceptance Checklist

- [ ] All configured rune, essence, talisman, and tiara item ids resolve through `findItem`.
- [ ] Correct talisman on mysterious ruins teleports to the altar; wrong talisman does not.
- [ ] Portal exits return to the matching overworld location.
- [ ] Normal rune crafting consumes the correct essence amount and grants correct rune count/XP.
- [ ] Pure essence restrictions are enforced for higher runes and combination runes.
- [ ] Combination crafting accepts inventory slot `0`, consumes runes/essence correctly, and grants correct XP.
- [ ] Blank tiara + talisman creates the matching tiara with correct XP.
- [ ] Equipping/unequipping tiaras updates the expected client config without duplicate plugins fighting.
- [ ] Tests cover the core crafting paths and edge cases.
- [ ] `npm run typecheck` and targeted Jest tests pass in `rs6-nullcity-server`.

## Rough Work Estimate

2-4 days to harden the existing implementation into a reliable first pass. Add 1 day if cache/object spawn verification exposes missing altar objects or broken item ids across many configs.
