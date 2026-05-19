import type { Actor } from '@engine/world/actor/actor';
import type { SkillName } from '@engine/world/actor/skills';
import type { DamageType } from '@engine/world/actor/update-flags';

/**
 * Which broad family of combat this strategy belongs to.
 */
export type CombatKind = 'melee' | 'ranged' | 'magic';

/**
 * The result of a `canActivate` check.
 *
 * Strategies should return `{ ok: false, reason }` to abort combat with a player-visible
 * explanation; the CombatTask will stop the task on a false result.
 */
export type CanActivateResult = { ok: true } | { ok: false; reason: string };

/**
 * A pluggable strategy describing how a single attacker fights a single defender.
 *
 * The shared {@link CombatTask} pulls these hooks once per tick. Each strategy
 * implementation is responsible for a single combat style (melee, ranged, or magic),
 * the corresponding animations / projectiles, resource consumption (ammo / runes),
 * and the XP table to award on a hit.
 */
export interface CombatStrategy {
    /**
     * The broad combat family — used for analytics, retaliation choice, etc.
     */
    readonly kind: CombatKind;

    /**
     * Maximum range (tiles) at which `consumeResources`/`play` can fire.
     *
     * If the attacker is further than this from the defender, the CombatTask will
     * walk the attacker toward the defender rather than attack.
     */
    readonly attackRange: number;

    /**
     * Number of game ticks between attacks (tick = 600ms).
     *
     * Most weapons use 4 ticks. Magic 5. 2h 6. See SPEC §6.4.
     */
    readonly attackSpeedTicks: number;

    /**
     * Pre-flight check before each attack. Return `{ ok: false, reason }` to abort
     * the entire combat task (e.g. out of ammo, no runes, target untargetable).
     */
    canActivate(attacker: Actor, defender: Actor): CanActivateResult;

    /**
     * Consume per-attack resources (ammo / runes). Called immediately before `play`.
     *
     * Return `false` to abort this attack and stop the combat task. Resources
     * SHOULD be consumed before `play` so a missed magic cast still drains runes.
     */
    consumeResources(attacker: Actor): boolean;

    /**
     * Play animations / graphics / projectiles for this attack. Returns the
     * projectile travel time in ticks so the damage splat can be deferred.
     *
     * For melee, `hitDelay` is always 0. For ranged / magic it depends on distance.
     */
    play(attacker: Actor, defender: Actor): { hitDelay: number };

    /**
     * Roll accuracy and damage for this attack. Called once per fired attack.
     *
     * On a miss the strategy SHOULD return `{ damage: 0, type: DamageType.NO_DAMAGE }`.
     */
    rollHit(attacker: Actor, defender: Actor): { damage: number; type: DamageType };

    /**
     * Return the list of XP awards (skill + amount) for a given damage roll.
     *
     * The CombatTask only routes XP for Player attackers; NPCs return `[]`.
     */
    xpAwards(damage: number): { skill: SkillName; exp: number }[];
}
