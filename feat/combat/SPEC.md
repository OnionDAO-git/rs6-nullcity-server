# Combat — Implementation Spec

Living document. Update the status checklist at the bottom as work lands.

## 1. Problem

Clicking "Attack" on an NPC produces `Unhandled NPC interaction: attack <key>` because no `npc_interaction` hook is registered for the `attack` option. Combat-style widgets, hitsplat rendering, NPC death/drop logic, weapon bonuses, and the per-tick task scheduler all exist — but nothing ties them together. Magic-on-NPC has a stub plugin that fires a projectile and logs `'attacking?'`. Ranged and player-death paths do not exist at all.

## 2. Goals

- Player can attack an NPC with melee, ranged, or magic and deal real damage.
- NPCs retaliate when attacked; aggressive NPCs initiate attacks.
- NPCs die at 0 HP, drop loot, respawn.
- Players die at 0 HP (lose items / respawn — see §9).
- XP is awarded per combat style.

Out of scope for v1: prayer modifiers, special attacks, dual-wield, autocast UI, multi-target spells, PvP, poison/venom DoT, safe-deaths/Wilderness rules.

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Inbound packet                                              │
│   - npc-interaction.packet.ts  (opcode 57 → "attack")        │
│   - magic-attack.packet.ts     (opcode 253 → magic_on_npc)   │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Action hook plugin                                          │
│   - melee:  plugins/combat/melee-attack.plugin.ts            │
│   - magic:  plugins/combat/magic-attack.plugin.ts (rewrite)  │
│   - ranged: plugins/combat/ranged-attack.plugin.ts           │
│                                                              │
│  Each hook validates the attacker, builds a CombatStrategy,  │
│  and enqueues a CombatTask on the attacker.                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  CombatTask  (engine/world/actor/combat/combat-task.ts)      │
│   - Repeats per tick (interval = attack-speed ticks).        │
│   - Each tick:                                               │
│       1. Validate attacker & target still alive / in world.  │
│       2. If out of range → walk toward target.               │
│       3. If in range and cooldown elapsed:                   │
│            a. Face target.                                   │
│            b. strategy.play(attacker)  → anim, gfx, proj.    │
│            c. Roll hit via formulas.ts.                      │
│            d. attacker.applyHit(target, damage, type, delay) │
│            e. Award XP via strategy.xpSkills.                │
│            f. Engage defender (start retaliation task).      │
│       4. End if target dead or out-of-aggro range.           │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Actor.applyHit  (engine/world/actor/actor.ts)               │
│   - Schedule a HitsplatTask with `delay` ticks (for ranged   │
│     / magic projectile travel time; 0 for melee).            │
│   - When fired:                                              │
│       1. Decrement target hitpoints skill.                   │
│       2. updateFlags.addDamage(...) → renders splat.         │
│       3. Play defender block / hurt animation.               │
│       4. If hp ≤ 0 → target.handleDeath(attacker).           │
└─────────────────────────────────────────────────────────────┘
```

### Why a shared `CombatTask` instead of three separate tasks

The three damage types differ only in: range, animation/graphics, hit roll inputs, ammo/rune cost, and which XP skills are awarded. Everything else (target validation, walk-to-range, tick cadence, retaliation hookup, death) is identical. We extract those into one task, and let each path pass a `CombatStrategy` object that supplies the differences.

```ts
interface CombatStrategy {
    readonly kind: 'melee' | 'ranged' | 'magic';
    readonly attackRange: number;          // tiles
    readonly attackSpeedTicks: number;     // 4 for most weapons
    canActivate(attacker, defender): { ok: true } | { ok: false; reason: string };
    consumeResources(attacker): boolean;   // ammo / runes; false aborts
    play(attacker, defender): { hitDelay: number };  // anim/gfx/proj
    rollHit(attacker, defender): { damage: number; type: DamageType };
    xpSkills(damage: number): { skill: SkillName; exp: number }[];
}
```

## 4. Files to create

```
src/engine/world/actor/combat/
    combat-task.ts                 # shared per-tick combat loop
    combat-strategy.ts             # interface above + helpers
    formulas.ts                    # accuracy + max-hit roll
    melee-strategy.ts
    ranged-strategy.ts
    magic-strategy.ts
    death.ts                       # npc/player death handler
    retaliation.ts                 # NPC aggression + retaliation

src/plugins/combat/
    melee-attack.plugin.ts         # npc_interaction "attack" hook
    ranged-attack.plugin.ts        # also hooks "attack"; chooses strategy by equipped weapon
    magic-attack.plugin.ts         # REPLACE existing stub — hooks magic_on_npc
    (combat-styles.plugin.ts stays as-is)

data/config/
    spells.json                    # new — spell definitions

feat/combat/
    SPEC.md                        # this file
```

## 5. Files to modify

- `src/engine/world/actor/actor.ts` — add `applyHit(...)`, `engagedBy`/`engagedTarget` state, `inCombat` flag.
- `src/engine/world/actor/npc.ts` — emit `'death'` instead of just having the listener; add `damage(...)` convenience.
- `src/engine/world/actor/player/player.ts` — add `handleDeath()` hook.
- `src/engine/world/actor/skills.ts` — add `damage(amount)` that clamps at 0 and returns "is dead".
- `src/engine/world/actor/npc.ts` — per-tick retaliation tick into `combat/retaliation.ts`.
- `src/engine/world/actor/magic.ts` — replace stub with `Spell` interface backed by `spells.json`.
- `FEATURES.md` — mark melee/ranged/magic as :heavy_check_mark: when done.

## 6. Game mechanics

We follow simplified RuneScape combat formulas. Numbers tuned to feel right against current NPC stats (goblin: hp 5, atk/str -15 to -21).

### 6.1 Accuracy roll

```
attackRoll  = (effectiveAttackLevel + 8) * (attackBonus + 64)
defenseRoll = (effectiveDefenseLevel + 8) * (defenseBonus + 64)

hitChance =
    attackRoll > defenseRoll
        ? 1 - (defenseRoll + 2) / (2 * (attackRoll + 1))
        : attackRoll / (2 * (defenseRoll + 1))
```

`effectiveAttackLevel` for players = `attack.level + styleBonus + 8` where `styleBonus` is `+3` for an attack-XP style, `+1` for controlled, else `0`. Same shape for strength/defence/ranged/magic.

For NPCs, `effectiveAttackLevel` = the NPC's `offensive_stats.attack` (or `ranged`/`magic`) clamped to ≥1.

### 6.2 Max hit

**Melee:**
```
maxHit = floor(0.5 + effectiveStrength * (strengthBonus + 64) / 640)
```

**Ranged:** identical formula using `effectiveRangedStrength` and `rangedStrengthBonus` (from the ammo's `ranged_strength`).

**Magic:** `maxHit = spell.baseDamage * (1 + magicBonus * 0.03)` floored. Spell base damage from `spells.json`.

### 6.3 Damage roll

If `Math.random() < hitChance`: `damage = floor(Math.random() * (maxHit + 1))`. Otherwise `damage = 0` and `DamageType.NO_DAMAGE`.

### 6.4 Attack speed

Default 4 ticks (~2.4s). Pull from weapon config if present (we'll add `weapon_info.attack_speed`, optional). Magic uses 5 ticks. Bows 4. Crossbows 5. Daggers 4. 2h 6.

### 6.5 Attack range

- Melee (most): 1 tile (orthogonal adjacency).
- Halberd / spear: 2 tiles.
- Bow / crossbow: 7 tiles.
- Thrown / dart: 4 tiles.
- Magic: 10 tiles.

## 7. Resource consumption

### 7.1 Ammo (ranged)

- Check the `quiver` equipment slot for an item whose key matches the bow's allowed ammo type (we'll add `weapon_info.ammo_type` to bow configs).
- On a successful **fired** attack (regardless of hit/miss), decrement the stack by 1.
- If ammo hits 0, the next tick's `canActivate` returns `{ ok: false, reason: 'no ammo' }`.

### 7.2 Runes (magic)

- Each spell in `spells.json` declares its rune cost: `[{ "itemKey": "rs:air_rune", "amount": 1 }, ...]`.
- Before each cast, check inventory for all runes. If any missing → abort cast, chatbox "You do not have enough runes".
- On cast, consume runes from inventory.
- Splash (missed cast) still consumes runes; impact graphic = `85` instead of the spell graphic.

## 8. NPC retaliation & aggression

### 8.1 Retaliation

When `CombatTask` lands a hit on an NPC, it calls `engageDefender(defender, attacker)`:
- If defender already has an active combat task → do nothing.
- Else enqueue a new `CombatTask` on the defender with target = attacker and an NPC-flavored melee strategy built from `combatAnimations.attack` and `offensive_stats`.

### 8.2 Aggression

Optional v1.5: add `aggressive: boolean` and `aggro_range: number` to `NpcDetails`. In `Npc.tick()`, if not in combat, scan nearby players within `aggro_range` and engage the first one. Default `false` — most NPCs only retaliate.

## 9. Death

### 9.1 NPC

In `applyHit`'s post-damage step, if `target.skills.hitpoints.level <= 0`:
- Stop the defender's combat task and walking queue.
- `npc.npcEvents.emit('death', attacker, npc)` — this triggers the existing `processDeath` which plays death anim + drops loot.
- Wait `death-anim-duration` ticks (3 for the default 2304 animation), then `npc.kill(true)` (respawns).

### 9.2 Player

In `applyHit` for a Player target with hp ≤ 0:
- Stop player's tasks.
- Play death animation (2304), play oh-dear gfx (lazily reuse `animationIds.death`).
- After 3 ticks: drop all inventory + worn equipment as a world item owned by killer.
- Reset hp to max, teleport to Lumbridge spawn (`3222, 3219, 0`), restore stat-drained levels.
- Chatbox: "Oh dear, you are dead!"

## 10. Edge cases

- **Target despawned or teleported away**: combat task validates target every tick; if `!target.active || distance > 16` → stop task, clear `engagedTarget`.
- **Player logs out mid-combat**: existing `destroy()` clears scheduler; nothing extra needed.
- **Multi-hit projectile delay**: with attack-speed 4 and travel delay 2, a player firing a bow can have two hits in flight. We schedule via `setTimeout`-equivalent in the task scheduler — one `HitsplatTask` per hit.
- **NPC morph**: respect `getMorphedNpcDetails(npc)` when reading combat stats, the same way `npc-interaction.packet.ts:44` does today.
- **Already-dead defender**: `applyHit` no-ops if `target.skills.hitpoints.level <= 0` already.

## 11. Tests

For each strategy add a focused unit-style test under `src/engine/world/actor/combat/*.test.ts`:

- `formulas.test.ts` — fixed RNG, verify hit chance and max-hit calculations against hand-computed expected values for a few attacker/defender stat combos.
- `combat-task.test.ts` — mock attacker and defender, run task ticks, assert that:
    - out of range → walks
    - in range → hit applied
    - target dies → task stops
- One end-to-end test per strategy: stub the world, attack a goblin, assert it dies in ≤N ticks and drops bones.

## 12. Rollout

1. Land §4 skeleton + §6 formulas + tests (no plugin wiring yet).
2. Land melee plugin + retaliation. Verify against a goblin in-game.
3. Land ranged plugin + ammo consumption.
4. Land magic plugin + `spells.json` + rune consumption.
5. Wire NPC aggression (optional).
6. Mark FEATURES.md.

## 12.5 Implementation notes (from foundation agent)

- `HitsplatTask` constructor is `(target, damage, type, attacker, delay = 0)`.
  `Actor.applyHit(...)` forwards its `hitDelay` arg into the task so projectile /
  spell travel time works. The earlier draft of §4 omitted the `delay` parameter
  on the task constructor.
- `CombatTask` sets `attacker.metadata.combatTarget = defender` in its
  constructor and clears it on `onStop()`. Downstream plugins must NOT touch
  `metadata.combatTarget` directly.
- `CombatTask` uses `TaskStackType.NEVER` so a fresh attack order cancels the
  in-flight combat task on the same actor.
- `Skills.damage(amount)` clamps at 0 and returns `{ dead, remaining }`.
- `Skills.getMaxLevel(skill)` returns the natural level computed from
  accumulated exp (ignores stat drains).

## 13. Open questions

- Do we want a UI auto-retaliate toggle, or always retaliate? **v1: always retaliate.**
- Should we cap XP rate via `serverConfig.expRate` (already applied in `Skills.addExp`) or also add a combat-specific multiplier? **v1: rely on existing expRate.**
- Should `aggressive` NPCs check combat level diff (low-level players skipped)? **v1: no — straight range check.**

---

## Status checklist

Update as we go. ✅ done · 🟡 in progress · ⬜ not started.

### Shared engine
- ✅ `combat/formulas.ts` — accuracy + max-hit
- ✅ `combat/combat-strategy.ts` — interface + types
- ✅ `combat/combat-task.ts` — per-tick loop
- ✅ `combat/death.ts` — NPC death wiring (emit existing event)
- ✅ `combat/death.ts` — Player death handler
- ✅ `actor.applyHit(...)` on Actor
- ✅ `skills.damage(amount)` returns "is dead"
- ✅ HitsplatTask (projectile-delay handling)

### Dispatcher (melee + ranged)
- ✅ `plugins/combat/attack-npc.plugin.ts` — single `npc_interaction "attack"` hook
  that picks `createPlayerRangedStrategy` if a ranged weapon is equipped, else
  falls back to `createPlayerMeleeStrategy`. Replaces the two separate plugin
  files originally sketched in §4 — they would have collided on the same
  `options: 'attack'` hook.

### Melee
- ✅ `combat/melee-strategy.ts`
- ✅ Walk-to-range via existing pathfinding (handled in CombatTask)
- ✅ Combat-style XP routing (from `combatStyles[style][idx].exp`)

### Ranged
- ✅ `combat/ranged-strategy.ts`
- ✅ Quiver-slot ammo check + consume
- ✅ Bow vs crossbow vs thrown range tables
- ✅ Projectile graphics per ammo type

### Magic
- ✅ `data/config/spells.json` (Wind/Water/Earth/Fire Strike + Bolt + Blast)
- ✅ `world/actor/magic.ts` — replace stub with `Spell` loader
- ✅ `combat/magic-strategy.ts`
- ✅ `plugins/buttons/magic-attack.plugin.ts` — REWRITE
- ✅ Rune inventory check + consume
- ✅ Splash graphic on miss

### Retaliation & aggression
- ✅ `combat/retaliation.ts` — engage attacker on hit (NPC-only in v1)
- ⬜ Npc.tick() aggression scan (gated by `aggressive` flag) — v1.5
- ⬜ `aggressive` + `aggro_range` fields on NpcDetails (optional v1.5) — v1.5

### Tests
- ⬜ `formulas.test.ts`
- ⬜ `combat-task.test.ts`
- ⬜ Per-strategy smoke tests

### Docs
- ✅ FEATURES.md — Combat / Melee / Ranged / Magic flipped to :heavy_check_mark:
