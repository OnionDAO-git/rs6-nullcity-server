import { findItem, findNpc } from '@engine/config/config-handler';
import type { WeaponStyle } from '@engine/config/item-config';
import type { Actor } from '@engine/world/actor/actor';
import { combatStyles } from '@engine/world/actor/combat';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import type { SkillName } from '@engine/world/actor/skills';
import { DamageType } from '@engine/world/actor/update-flags';
import { isNpc } from '@engine/world/actor/util';
import { animationIds } from '@engine/world/config/animation-ids';
import { defensiveStyleBonus, weaponAttackRange, weaponAttackSpeed } from './combat-data';
import type { CanActivateResult, CombatStrategy } from './combat-strategy';
import { defenseRoll, meleeAttackRoll, meleeMaxHit, rollAccuracy, rollDamage } from './formulas';
import { applyCombatModifier, resolveCombatModifiers } from './modifiers';

/**
 * Per-weapon-style attack range (in tiles). Anything not listed defaults to 1.
 */
const WEAPON_RANGE: Partial<Record<WeaponStyle, number>> = {
    halberd: 2,
    spear: 2,
};

/**
 * Per-weapon-style attack speed (in ticks). Anything not listed defaults to 4.
 *
 * Numbers reflect SPEC §6.4.
 */
const WEAPON_SPEED: Partial<Record<WeaponStyle, number>> = {
    dagger: 4,
    slash_sword: 4,
    '2h_sword': 6,
    scythe: 5,
    whip: 4,
    unarmed: 3,
    axe: 5,
    mace: 5,
    halberd: 7,
    spear: 5,
    pickaxe: 5,
    claws: 4,
    hammer: 6,
};

const DEFAULT_ATTACK_RANGE = 1;
const DEFAULT_ATTACK_SPEED_TICKS = 4;

/**
 * Type of damage a melee swing deals (matches `combat-styles.json`).
 */
type MeleeDamageType = 'stab' | 'slash' | 'crush';

interface ResolvedStyle {
    weaponStyle: WeaponStyle;
    styleIndex: number;
    damageType: MeleeDamageType;
    exp: SkillName | SkillName[];
    animId: number | null;
}

function resolveWeaponStyle(player: Player): WeaponStyle {
    const equipped = player.getEquippedItem('main_hand');
    if (!equipped) {
        return 'unarmed';
    }

    const details = findItem(equipped.itemId);
    const style = details?.equipmentData?.weaponInfo?.style;
    if (style && combatStyles[style]) {
        return style as WeaponStyle;
    }
    return 'unarmed';
}

/**
 * Map a combat-style animation name (e.g. 'punch', 'stab') to its numeric id.
 */
function lookupAnim(animName: string | string[] | undefined): number | null {
    if (!animName) {
        return null;
    }

    const name = Array.isArray(animName) ? animName[0] : animName;
    if (!name) {
        return null;
    }

    const id = (animationIds.combat as Record<string, number>)[name];
    return typeof id === 'number' ? id : null;
}

function resolveCurrentStyle(player: Player): ResolvedStyle {
    const saved = (player.savedMetadata?.combatStyle as [WeaponStyle, number] | undefined) ?? undefined;
    let weaponStyle: WeaponStyle = saved?.[0] ?? 'unarmed';
    let styleIndex: number = saved?.[1] ?? 0;

    if (!combatStyles[weaponStyle]) {
        weaponStyle = 'unarmed';
    }

    const equippedStyle = resolveWeaponStyle(player);
    if (equippedStyle !== weaponStyle) {
        // Saved metadata might point at a no-longer-equipped weapon. Trust the
        // equipped item over the saved tag, but keep the index if it fits.
        weaponStyle = equippedStyle;
    }

    const stylesForWeapon = combatStyles[weaponStyle];
    if (!stylesForWeapon || stylesForWeapon.length === 0) {
        weaponStyle = 'unarmed';
    }

    const list = combatStyles[weaponStyle];
    if (styleIndex < 0 || styleIndex >= list.length) {
        styleIndex = 0;
    }

    const style = list[styleIndex];
    return {
        weaponStyle,
        styleIndex,
        damageType: style.type === 'ranged' ? 'crush' : style.type,
        exp: style.exp,
        animId: lookupAnim(style.anim),
    };
}

/**
 * Compute the (attack, strength, defence) style-bonus triple from the
 * combat-style's `exp` field. SPEC §6.1: +3 for accurate/aggressive/defensive,
 * +1 for controlled/shared.
 */
function styleBonusesFor(exp: SkillName | SkillName[]): { attack: number; strength: number; defence: number } {
    if (Array.isArray(exp)) {
        return { attack: 1, strength: 1, defence: 1 };
    }

    switch (exp) {
        case 'attack':
            return { attack: 3, strength: 0, defence: 0 };
        case 'strength':
            return { attack: 0, strength: 3, defence: 0 };
        case 'defence':
            return { attack: 0, strength: 0, defence: 3 };
        default:
            return { attack: 1, strength: 1, defence: 1 };
    }
}

/**
 * Read a defender's defensive bonus for the given melee damage type.
 *
 * For Players we read the live `bonuses.defensive` map. For NPCs we fall back
 * to the loaded `NpcDetails.defensiveStats` (the same source `npc-melee-strategy`
 * uses for its own offensive numbers).
 */
function defenderDefenseBonus(defender: Actor, damageType: MeleeDamageType): number {
    // Player path — engine keeps a live aggregated bonus map.
    const liveBonus = defender.bonuses?.defensive?.[damageType];
    if (typeof liveBonus === 'number' && liveBonus !== 0) {
        return liveBonus;
    }

    if (isNpc(defender)) {
        const npc = defender as Npc;
        let details: ReturnType<typeof findNpc> | undefined;
        try {
            details = findNpc(npc.id);
        } catch {
            details = undefined;
        }
        const defensiveStats = details?.defensiveStats as Record<string, number> | undefined;
        if (defensiveStats && typeof defensiveStats[damageType] === 'number') {
            return defensiveStats[damageType];
        }
        return 0;
    }

    return liveBonus ?? 0;
}

/**
 * Build a {@link CombatStrategy} that swings a player's currently-equipped
 * weapon (or fists) at a defender according to their selected combat style.
 *
 * The strategy reads the player's `savedMetadata.combatStyle` and the
 * equipped main-hand to figure out:
 *   - attack range (1 tile / 2 for halberd+spear)
 *   - attack-speed ticks (style table, default 4)
 *   - damage type (stab/slash/crush) and which XP skills to award.
 *
 * Animation is taken from `combatStyles[style][idx].anim` translated via
 * `animationIds.combat[name]`. NPC defensive bonuses fall back to
 * `findNpc(...).defensiveStats[type]` to mirror `npc-melee-strategy`.
 */
export function createPlayerMeleeStrategy(player: Player): CombatStrategy {
    const equippedStyle = resolveWeaponStyle(player);
    const equippedItem = player.getEquippedItem('main_hand');
    const itemDetails = equippedItem ? findItem(equippedItem.itemId) : null;
    const attackRange = weaponAttackRange(itemDetails, WEAPON_RANGE[equippedStyle] ?? DEFAULT_ATTACK_RANGE);
    const attackSpeedTicks = weaponAttackSpeed(itemDetails, WEAPON_SPEED[equippedStyle] ?? DEFAULT_ATTACK_SPEED_TICKS);

    return {
        kind: 'melee',
        attackRange,
        attackSpeedTicks,

        canActivate(): CanActivateResult {
            return { ok: true };
        },

        consumeResources(): boolean {
            return true;
        },

        play(attacker: Actor): { hitDelay: number } {
            const style = resolveCurrentStyle(player);
            if (style.animId !== null && style.animId > 0) {
                attacker.playAnimation(style.animId);
            }
            return { hitDelay: 0 };
        },

        rollHit(attacker: Actor, defender: Actor): { damage: number; type: DamageType } {
            const style = resolveCurrentStyle(player);
            const bonuses = styleBonusesFor(style.exp);

            const attackerModifiers = resolveCombatModifiers(attacker);
            const defenderModifiers = resolveCombatModifiers(defender);
            const attackLevel = applyCombatModifier(attacker.skills.getLevel('attack'), attackerModifiers.attack);
            const strengthLevel = applyCombatModifier(attacker.skills.getLevel('strength'), attackerModifiers.strength);

            const attackBonus = attacker.bonuses?.offensive?.[style.damageType] ?? 0;
            const strengthBonus = attacker.bonuses?.skill?.strength ?? 0;

            const atk = meleeAttackRoll({
                attackLevel,
                styleBonus: bonuses.attack,
                attackBonus,
            });

            const defenderDefenceLevel = applyCombatModifier(defender.skills.getLevel('defence'), defenderModifiers.defence);
            const def = defenseRoll({
                defenseLevel: Math.max(1, defenderDefenceLevel),
                styleBonus: defensiveStyleBonus(defender),
                defenseBonus: defenderDefenseBonus(defender, style.damageType),
            });

            if (!rollAccuracy(atk, def)) {
                return { damage: 0, type: DamageType.NO_DAMAGE };
            }

            const max = meleeMaxHit({
                strengthLevel,
                styleBonus: bonuses.strength,
                strengthBonus,
            });
            const damage = rollDamage(max);
            return {
                damage,
                type: damage > 0 ? DamageType.DAMAGE : DamageType.NO_DAMAGE,
            };
        },

        xpAwards(damage: number): { skill: SkillName; exp: number }[] {
            if (damage <= 0) {
                return [];
            }

            const style = resolveCurrentStyle(player);
            const hpExp = damage * 1.33;
            const combatExp = damage * 4;

            if (Array.isArray(style.exp)) {
                const split = combatExp / style.exp.length;
                const awards: { skill: SkillName; exp: number }[] = style.exp.map(skill => ({
                    skill,
                    exp: split,
                }));
                awards.push({ skill: 'hitpoints', exp: hpExp });
                return awards;
            }

            switch (style.exp) {
                case 'attack':
                    return [
                        { skill: 'attack', exp: combatExp },
                        { skill: 'hitpoints', exp: hpExp },
                    ];
                case 'strength':
                    return [
                        { skill: 'strength', exp: combatExp },
                        { skill: 'hitpoints', exp: hpExp },
                    ];
                case 'defence':
                    return [
                        { skill: 'defence', exp: combatExp },
                        { skill: 'hitpoints', exp: hpExp },
                    ];
                default: {
                    // Treat 'shared' / unknown exp tags as a three-way split.
                    const split = combatExp / 3;
                    return [
                        { skill: 'attack', exp: split },
                        { skill: 'strength', exp: split },
                        { skill: 'defence', exp: split },
                        { skill: 'hitpoints', exp: hpExp },
                    ];
                }
            }
        },
    } as CombatStrategy;
}
