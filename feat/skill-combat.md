# Combat Skills - Implementation Spec

This spec is for one combat-focused subagent. Do not split Attack, Strength,
Defence, Hitpoints, Ranged, Prayer, and Magic into independent server rewrites:
they share task scheduling, hit application, equipment bonuses, UI state, and
NPC retaliation. Prayer has its own dedicated spec in `feat/skill-prayer.md`,
but combat must expose the hooks that Prayer modifiers consume.

Revision target: RuneScape 435, late October 2006. Hunter, Summoning, and
Dungeoneering are out of scope.

## Current Repo State

- `rs6-nullcity-server/src/engine/world/actor/skills.ts` defines Attack,
  Defence, Strength, Hitpoints, Ranged, Prayer, and Magic.
- `rs6-nullcity-server/feat/combat/SPEC.md` is the existing v1 combat design.
  It is useful background, but several items listed there have already landed.
- `rs6-nullcity-server/src/engine/world/actor/combat/combat-task.ts` is the
  shared combat loop.
- `rs6-nullcity-server/src/engine/world/actor/combat/combat-strategy.ts`
  defines the pluggable melee/ranged/magic strategy contract.
- `rs6-nullcity-server/src/engine/world/actor/combat/formulas.ts` contains
  simplified accuracy and max-hit formulas.
- `rs6-nullcity-server/src/engine/world/actor/combat/melee-strategy.ts`
  awards Attack, Strength, Defence, and Hitpoints XP from selected melee style.
- `rs6-nullcity-server/src/engine/world/actor/combat/ranged-strategy.ts`
  handles basic Ranged attacks, ammo consumption, projectiles, and Ranged XP.
- `rs6-nullcity-server/src/engine/world/actor/combat/magic-strategy.ts`
  handles basic spell-on-NPC Magic combat and rune costs.
- `rs6-nullcity-server/src/plugins/combat/attack-npc.plugin.ts` starts ranged
  if a ranged weapon is equipped, otherwise melee.
- `rs6-nullcity-server/src/plugins/buttons/magic-attack.plugin.ts` starts Magic
  combat from spellbook-on-NPC.
- `rs6-nullcity-server/src/plugins/buttons/magic-teleports.plugin.ts` handles
  standard spellbook teleports and Magic XP.
- `rs6-nullcity-server/data/config/spells.json` is the current spell data.
- `rs6-nullcity-server/data/config/combat-styles.json` drives combat style
  selection.
- `rs6-nullcity-client-ts/src/client/Client.ts` already handles `UPDATE_STAT`,
  player/NPC updates, hitmarks, projectiles, interface buttons, varps, inventory
  packets, and sound/animation packets.
- `rs6-nullcity-client-ts/src/constants/Skill.ts` mirrors the client-side skill
  ids and must remain compatible with the server enum.

## Revision-435 Scope

Implement combat to a useful 435-era baseline:

- Melee accuracy, max-hit, attack speed, attack range, weapon styles, and XP
  routing for Attack, Strength, Defence, controlled styles, and Hitpoints.
- Ranged weapons, arrows/bolts/darts/throwing knives where present in config,
  ammo compatibility, ammo loss, projectile rendering, Ranged XP, defensive
  Ranged style if the 435 interface exposes it.
- Standard spellbook combat spells, rune costs, elemental staves, autocast
  support if the 435 client exposes the relevant widget state, splash behavior,
  Magic XP, and Hitpoints XP.
- NPC retaliation and aggression for combat NPCs that should attack first.
- NPC death, drops, respawn, and kill credit.
- Player death, respawn, item loss rules sufficient for non-Wilderness gameplay.
- Prayer modifier hooks for active Prayer effects; the Prayer skill spec owns
  drain, UI activation, and recharge.
- Stat drain/boost interactions from consumables and future Herblore potions.

Explicitly out of scope unless this subagent has spare time after the baseline:

- Full Wilderness/PvP rules.
- Special attacks.
- Poison and disease.
- Multi-combat area rules beyond a data flag and conservative target limit.
- Ancient Magicks, Lunar spells, or post-435 equipment.

## Server Work In `rs6-nullcity-server`

1. Audit existing combat behavior before changing formulas.
   - Add focused tests around `formulas.ts`, melee style XP, ranged ammo
     consumption, Magic rune consumption, death, and retaliation.
   - Preserve the `CombatTask` strategy boundary unless a proven bug requires
     changing it.

2. Make combat data-driven.
   - Add or normalize weapon metadata in item config: attack speed, attack
     range, ammo type, attack style family, projectile id, and defensive/offense
     bonuses.
   - Add or normalize ammo metadata: ammo family, ranged strength, projectile
     id, and allowed weapon classes.
   - Move hard-coded melee/ranged speed and range tables behind config helpers
     with safe defaults.
   - Ensure NPC config exposes attack, strength, defence, ranged, magic,
     attack speed, attack range, max hit, aggression, poison flag if present,
     death animation, attack animation, block animation, and respawn delay.

3. Improve formulas to match 435 closely enough for gameplay.
   - Keep deterministic tests with injectable RNG.
   - Apply style bonuses from selected combat style.
   - Include Prayer modifiers through a small combat-modifier pipeline.
   - Include equipment bonuses and NPC combat stats.
   - Keep Magic defence behavior documented. If exact 435 formula is uncertain,
     isolate it in `formulas.ts` and test the chosen approximation.

4. Complete melee.
   - Validate weapon style after equipment changes.
   - Use correct animation per weapon and style when available.
   - Support controlled XP split and defensive style behavior.
   - Stop combat cleanly on movement, logout, death, target despawn, or range
     break.

5. Complete ranged.
   - Validate bow/crossbow/thrown compatibility.
   - Support stack decrement, thrown weapon decrement, and optional ammo drop
     recovery if implemented.
   - Use projectile ids and travel timing from data where available.
   - Add messages for missing ammo and invalid ammo.
   - Refresh equipment and inventory widgets after ammo changes.

6. Complete Magic.
   - Expand `data/config/spells.json` to all 435 standard combat spells.
   - Add elemental staff infinite-rune support for all relevant staves.
   - Add level checks, rune checks, cast animation, projectile, impact, splash,
     base XP, and damage XP.
   - Add autocast state only if the client-side widget and packets are verified.
   - Keep teleports in `magic-teleports.plugin.ts` consistent with spell data
     where possible.

7. Complete NPC combat.
   - Implement aggression scanning with radius and multi-combat constraints.
   - Implement retaliation rules and target switching rules.
   - Use NPC attack speed, animations, max hit, and bonuses from config.
   - Stop NPC tasks when NPC dies, despawns, or resets.

8. Complete death and drops.
   - NPC death must play animation, award kill credit, emit drop logic, remove
     the NPC, and respawn it at the correct time.
   - Player death must stop tasks, clear combat target, play animation, move the
     player to the respawn point, restore Hitpoints, and apply conservative
     item loss rules.
   - Avoid rewriting trade/bank/inventory systems; use existing inventory and
     world item APIs.

9. Wire Prayer and consumable modifiers.
   - Expose active Prayer modifiers as a pure function or small service that
     `CombatTask`/strategies can query.
   - Let food and future potions modify current skill levels without corrupting
     base XP levels.

10. Keep agent work isolated.
    - Do not rewrite unrelated skilling plugins.
    - Do not edit `dist/`; it is build output.
    - Do not rely on debug commands for acceptance.

## Client Work In `rs6-nullcity-client-ts`

Most combat implementation should be server-side because the 435 client already
knows how to render server-driven combat. Client work is compatibility and
packet support:

- Verify `src/constants/Skill.ts` matches server skill ids, including the
  Construction gap at index 21.
- Verify `Client.ts` correctly renders:
  - player and NPC hitmarks,
  - health bars,
  - primary animations,
  - spot animations,
  - projectiles,
  - `UPDATE_STAT`,
  - `UPDATE_INV_FULL` / `UPDATE_INV_PARTIAL`,
  - equipment/inventory item updates,
  - `VARP_SMALL` / `VARP_LARGE` for combat-style and Prayer state.
- If server packets expose a RuneJS custom variant, add packet parsing only in
  the custom protocol branch and keep stock 435 parsing intact.
- Verify combat-style button sends the expected `IF_BUTTON` packet and child id
  for every weapon style in `combat-styles.json`.
- Verify spellbook-on-NPC sends `magic_on_npc` data that the server maps to the
  right widget id and button id.
- If autocast is implemented, inspect the 435 interface behavior first. Add
  only the minimum client patch needed to send or preserve autocast selection.
- Do not build a modern overlay or custom combat UI. Use the cache interfaces.

## Data And Config Requirements

- `data/config/items/**`: complete equipment bonuses, weapon style, attack
  speed, attack range, ammo metadata, projectile metadata, and staff elemental
  rune behavior.
- `data/config/npcs/**`: complete combat stats, animations, attack speed,
  aggression, respawn time, drops, and Slayer-specific metadata where relevant.
- `data/config/spells.json`: standard combat spell definitions through 435.
- `data/config/combat-styles.json`: style definitions and XP routing for all
  weapon families present in item config.
- Add fixtures for representative weapons, ammo, staves, spells, and NPCs used
  by tests.

## Acceptance Checklist

- A level-3 player can melee a goblin, take retaliation damage, gain the correct
  combat XP, kill the goblin, see drops, and see the goblin respawn.
- Changing melee combat style changes XP routing and visible animation where
  data supports it.
- A bow/crossbow attack consumes compatible ammo and rejects missing or invalid
  ammo.
- A Magic combat spell consumes runes, splashes correctly, hits correctly, and
  awards Magic and Hitpoints XP.
- Elemental staff rune substitution works for supported staves.
- NPC aggression works only for NPCs configured as aggressive.
- Player death stops combat and returns the player to the configured respawn
  state without corrupting inventory or skill data.
- Prayer modifiers can be consumed by combat formulas once `skill-prayer.md`
  lands.
- Client shows hitmarks, health bars, animations, graphics, projectiles,
  inventory updates, and stat updates without a custom UI.
- Unit tests cover formulas, XP routing, resource costs, death, and task stop
  conditions.

## Rough Work Estimate

- Baseline formula/data/test pass: 3-5 days.
- Melee completion: 3-5 days.
- Ranged completion: 4-7 days.
- Magic combat completion: 5-8 days.
- NPC retaliation/aggression/death polish: 5-8 days.
- Player death and item-loss baseline: 3-5 days.
- Client verification and small compatibility patches: 2-4 days.

Total: 4-7 focused weeks for a strong 435 baseline. Full edge-case parity,
especially PvP, special attacks, poison, and complete NPC behavior, is a larger
follow-up project.
