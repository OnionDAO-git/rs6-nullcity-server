import type { ItemDetails, WeaponStyle } from '@engine/config/item-config';
import type { Actor } from '@engine/world/actor/actor';
import { combatStyles, type CombatStyle } from '@engine/world/actor/combat';
import type { Player } from '@engine/world/actor/player/player';
import type { SkillName } from '@engine/world/actor/skills';
import { isPlayer } from '@engine/world/actor/util';

export function weaponAttackRange(item: ItemDetails | null | undefined, fallback: number): number {
    const configured = item?.equipmentData?.weaponInfo?.attack_range;
    return typeof configured === 'number' && configured > 0 ? configured : fallback;
}

export function weaponAttackSpeed(item: ItemDetails | null | undefined, fallback: number): number {
    const configured = item?.equipmentData?.offensiveBonuses?.speed;
    return typeof configured === 'number' && configured > 0 ? configured : fallback;
}

export function selectedCombatStyle(player: Player, weaponStyle: WeaponStyle): CombatStyle | null {
    const saved = player.savedMetadata?.combatStyle as [WeaponStyle, number] | undefined;
    const styleIndex = saved?.[0] === weaponStyle ? saved[1] : 0;
    return combatStyles[weaponStyle]?.[styleIndex] ?? combatStyles[weaponStyle]?.[0] ?? null;
}

export function defensiveStyleBonus(defender: Actor): number {
    if (!isPlayer(defender)) {
        return 0;
    }

    const player = defender as Player;
    const saved = player.savedMetadata?.combatStyle as [WeaponStyle, number] | undefined;
    if (!saved) {
        return 0;
    }

    const style = combatStyles[saved[0]]?.[saved[1]];
    if (!style) {
        return 0;
    }

    if (Array.isArray(style.exp)) {
        return style.exp.includes('defence') ? 1 : 0;
    }
    return style.exp === 'defence' || style.stance === 'longrange' ? 3 : 0;
}

export type AmmoFamily = 'arrow' | 'bolt' | 'dart' | 'bullet';

export function ammoIsCompatible(required: AmmoFamily | undefined, ammoFamily: AmmoFamily | undefined, thrownWeapon: boolean): boolean {
    if (thrownWeapon) {
        return true;
    }
    if (!required) {
        return true;
    }
    return ammoFamily === required;
}

export function rangedXpAwards(damage: number, style: Pick<CombatStyle, 'exp'> | null | undefined): { skill: SkillName; exp: number }[] {
    if (damage <= 0) {
        return [];
    }

    if (Array.isArray(style?.exp) && style.exp.includes('defence')) {
        return [
            { skill: 'ranged', exp: damage * 2 },
            { skill: 'defence', exp: damage * 2 },
            { skill: 'hitpoints', exp: damage * 1.33 },
        ];
    }

    return [
        { skill: 'ranged', exp: damage * 4 },
        { skill: 'hitpoints', exp: damage * 1.33 },
    ];
}
