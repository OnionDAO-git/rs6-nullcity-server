/**
 * Combat formulas — accuracy + max-hit + damage rolls.
 *
 * All functions accept an optional `rng` parameter that defaults to `Math.random`
 * so callers (especially tests) can inject a deterministic RNG.
 *
 * Formulas follow SPEC §6 in `feat/combat/SPEC.md`.
 */

export type Rng = () => number;

/**
 * Roll for accuracy. Returns true on a successful hit (damage roll proceeds),
 * false on a miss (damage will be 0 / NO_DAMAGE).
 */
export function rollAccuracy(attackRoll: number, defenseRoll: number, rng: Rng = Math.random): boolean {
    const a = Math.max(0, attackRoll);
    const d = Math.max(0, defenseRoll);

    let hitChance: number;
    if (a > d) {
        hitChance = 1 - (d + 2) / (2 * (a + 1));
    } else {
        hitChance = a / (2 * (d + 1));
    }

    if (hitChance <= 0) {
        return false;
    }

    if (hitChance >= 1) {
        return true;
    }

    return rng() < hitChance;
}

/**
 * Roll a uniform integer damage in `[0, maxHit]` inclusive.
 */
export function rollDamage(maxHit: number, rng: Rng = Math.random): number {
    if (maxHit <= 0) {
        return 0;
    }

    return Math.floor(rng() * (maxHit + 1));
}

/* ----------------------------------------------------------------------- *
 * Melee
 * ----------------------------------------------------------------------- */

export interface MeleeAttackStats {
    /** The attacker's current (modified) Attack level. */
    attackLevel: number;
    /** Style bonus added to the effective level (+3 for accurate, +1 for controlled, else 0). */
    styleBonus: number;
    /** The attacker's offensive bonus for the chosen attack type (stab/slash/crush). */
    attackBonus: number;
}

export function meleeAttackRoll(stats: MeleeAttackStats): number {
    const effectiveAttack = Math.max(1, stats.attackLevel + stats.styleBonus + 8);
    return effectiveAttack * (stats.attackBonus + 64);
}

export interface MeleeMaxHitStats {
    /** The attacker's current (modified) Strength level. */
    strengthLevel: number;
    /** Style bonus added to the effective level (+3 for aggressive, +1 for controlled, else 0). */
    styleBonus: number;
    /** The attacker's strength bonus from equipment. */
    strengthBonus: number;
}

export function meleeMaxHit(stats: MeleeMaxHitStats): number {
    const effectiveStrength = Math.max(1, stats.strengthLevel + stats.styleBonus + 8);
    return Math.floor(0.5 + (effectiveStrength * (stats.strengthBonus + 64)) / 640);
}

export interface DefenseStats {
    /** The defender's current (modified) Defence level. */
    defenseLevel: number;
    /** Style bonus from the defender's combat style (+3 for defensive, +1 for controlled, else 0). */
    styleBonus: number;
    /** The defender's defensive bonus for the matching attack type. */
    defenseBonus: number;
}

export function defenseRoll(stats: DefenseStats): number {
    const effectiveDefense = Math.max(1, stats.defenseLevel + stats.styleBonus + 8);
    return effectiveDefense * (stats.defenseBonus + 64);
}

/* ----------------------------------------------------------------------- *
 * Ranged
 * ----------------------------------------------------------------------- */

export interface RangedAttackStats {
    rangedLevel: number;
    styleBonus: number;
    /** Offensive ranged accuracy bonus from equipment. */
    attackBonus: number;
}

export function rangedAttackRoll(stats: RangedAttackStats): number {
    const effective = Math.max(1, stats.rangedLevel + stats.styleBonus + 8);
    return effective * (stats.attackBonus + 64);
}

export interface RangedMaxHitStats {
    rangedLevel: number;
    styleBonus: number;
    /** Ranged strength bonus from the equipped ammo. */
    strengthBonus: number;
}

export function rangedMaxHit(stats: RangedMaxHitStats): number {
    const effective = Math.max(1, stats.rangedLevel + stats.styleBonus + 8);
    return Math.floor(0.5 + (effective * (stats.strengthBonus + 64)) / 640);
}

/* ----------------------------------------------------------------------- *
 * Magic
 * ----------------------------------------------------------------------- */

export interface MagicAttackStats {
    magicLevel: number;
    /** Magic offensive bonus from equipment. */
    magicBonus: number;
}

export function magicAttackRoll(stats: MagicAttackStats): number {
    const effective = Math.max(1, stats.magicLevel + 8);
    return effective * (stats.magicBonus + 64);
}

/**
 * Magic max-hit. `spellBaseDamage` comes from the spell definition; `magicBonus`
 * is the attacker's magic damage bonus (typically the magic offensive bonus,
 * scaled by 3% per point).
 */
export function magicMaxHit(spellBaseDamage: number, magicBonus: number): number {
    if (spellBaseDamage <= 0) {
        return 0;
    }

    return Math.floor(spellBaseDamage * (1 + magicBonus * 0.03));
}
