# Prayer Skill — Implementation Spec

Audience: future subagent implementing Prayer for RuneScape revision 435. Keep this document current as work lands.

## Current Repo State

- Server repo: `rs6-nullcity-server`.
- Client repo: `rs6-nullcity-client-ts`.
- Skill registry already includes `Skill.PRAYER` and the `prayer` shortcut in `rs6-nullcity-server/src/engine/world/actor/skills.ts`.
- Prayer level contributes to combat level in `Skills.getCombatLevel()`.
- Item configs include bones with `metadata.prayerBuryXp` in `rs6-nullcity-server/data/config/items/bones.json`.
- Bone burying exists in `rs6-nullcity-server/src/plugins/skills/prayer/bury-bones.plugin.ts`: inventory `bury`, animation, sound, remove item, add XP, achievement.
- Prayer tab widget id is configured as `prayerTab: 271` in `rs6-nullcity-server/data/config/widgets.json`.
- The player tabs include `widgets.prayerTab` during login in `rs6-nullcity-server/src/engine/world/actor/player/player.ts`.
- `rs6-nullcity-server/src/engine/action/pipe/prayer.action.ts` exists but is currently a stub-like pipe that logs "You used prayer" and incorrectly queries `button` hooks instead of dedicated prayer hooks.
- `rs6-nullcity-server/src/engine/world/actor/prayer.ts` is an unused placeholder class.
- `rs6-nullcity-server/src/engine/world/config/sound-ids.ts` already contains revision-appropriate prayer activation/deactivation sound ids.
- Client has skill constants in `rs6-nullcity-client-ts/src/constants/Skill.ts`, with Prayer enabled through the standard 435 interface/cache. No client-side prayer logic exists beyond generic interface, varp, stat, and headicon rendering.

## Revision-435 Scope

Implement the revision 435 Prayer tab behavior, not later curses or OSRS additions.

In scope:
- Toggleable standard prayers available on widget `271`.
- Level requirements, drain rates, mutual-exclusion groups, activation/deactivation sounds, and client config/varp state.
- Current prayer points drain while active, stop at zero, and restore through supported recharge altars.
- Combat integration for stat prayers and overhead protection prayers.
- `Protect Item`, `Rapid Restore`, `Rapid Heal`, `Retribution`, `Redemption`, and `Smite` to the extent the existing combat/death engine can support them.
- Headicon updates for overhead prayers through player appearance sync.
- Keep bone burying as the XP source already implemented.

Out of scope for first pass:
- Ancient curses.
- Ectofuntus, gilded altars, chapel burners, and cemetery-specific modifiers unless added as optional follow-up.
- Quest-locked late prayers if the quest engine lacks the source quest; gate them by level only and leave quest hooks as TODOs.

## Server Work (`rs6-nullcity-server`)

Create or replace a focused Prayer implementation under `src/plugins/skills/prayer/` and shared state under `src/engine/world/actor/prayer.ts`.

Required work:
- Define `PrayerId`, metadata, and active state:
  - widget child/button id for widget `271`;
  - level requirement;
  - drain rate;
  - sound id;
  - client config bit/index;
  - overhead headicon, if any;
  - effect category such as attack, strength, defence, ranged, magic, overhead, utility, or death-effect.
- Fix `src/engine/action/pipe/prayer.action.ts` or route prayer clicks through the existing button pipe consistently. Do not leave a second unused action vocabulary.
- Store active prayers and current prayer points on `Player` through `Skills.prayer.modifiedLevel` or a small `PrayerState` owned by the player. Persist only normal skill XP/level in existing saves; active prayers should clear on logout.
- Add a per-tick drain task or hook. The drain must be deterministic, independent of client frame rate, and easy to test.
- On activation:
  - verify level and current prayer points;
  - deactivate mutually exclusive prayers;
  - update client config state;
  - play activation sound;
  - update overhead headicon and appearance if needed.
- On deactivation:
  - update client config state;
  - play deactivation sound unless the prayer is being replaced in the same group;
  - clear overhead headicon if applicable.
- Integrate with combat:
  - expose prayer bonuses to melee/ranged/magic max-hit and accuracy/defence calculations in `src/engine/world/actor/combat/*`;
  - implement protect-from effects against NPC/player combat strategies;
  - apply `Smite` to target prayer points on successful hits;
  - apply death-effect prayers in the death path where feasible.
- Add object interaction for prayer recharge altars once 435 altar object ids are confirmed from cache/config.
- Add tests for activation rules, group exclusion, drain-to-zero, recharge, and combat modifiers.

## Client Work (`rs6-nullcity-client-ts`)

Prefer no protocol changes.

Expected work:
- Verify the existing 435 client handles `VARP_SMALL`/`VARP_LARGE`, `UPDATE_STAT`, tab interface `271`, and headicons correctly.
- If server-side config writes do not visibly toggle prayer sprites, inspect `rs6-nullcity-client-ts/src/client/Client.ts` varp/interface script handling and document the required varp/config id mapping.
- Do not hardcode gameplay rules in the client. The client should remain a renderer of server state.

## Data / Config Requirements

- Add a prayer definition table, preferably `src/plugins/skills/prayer/prayer-constants.ts`, unless a JSON config fits existing patterns better.
- Confirm widget child ids and config bit layout for revision 435 Prayer tab `271`.
- Confirm overhead prayer headicon ids used by `rs6-nullcity-client-ts/src/dash3d/ClientPlayer.ts`.
- Confirm recharge altar object ids from cache/object dumps before wiring object hooks.
- Keep `data/config/items/bones.json` as the bone bury XP source; add missing bones there only if they are present in revision 435.
- Update `src/engine/world/config/sound-ids.ts` only if missing sound ids are confirmed.

## Acceptance Checklist

- [ ] Burying every configured bone grants correct Prayer XP and updates inventory.
- [ ] Prayer tab toggles work through a real client on widget `271`.
- [ ] Level-gated prayers reject low-level players with a clear message.
- [ ] Mutually exclusive prayers deactivate correctly.
- [ ] Active prayers drain points at deterministic rates and all deactivate at zero.
- [ ] Prayer points can be restored at a supported altar.
- [ ] Combat prayers affect combat calculations and overhead headicons.
- [ ] Logout/login clears active prayers without corrupting saved Prayer XP.
- [ ] Tests cover activation, drain, recharge, and at least one combat modifier.
- [ ] `npm run typecheck` and targeted Jest tests pass in `rs6-nullcity-server`.

## Rough Work Estimate

3-5 days for a solid first pass with standard prayers, drain, UI state, and basic combat integration. Add 1-2 days if death-effect prayers and altar object coverage require engine changes.
