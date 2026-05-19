import type { Actor } from '@engine/world/actor/actor';
import { getPrayerModifier } from '@engine/world/actor/prayer';

export type CombatStat = 'attack' | 'strength' | 'defence' | 'ranged' | 'magic';

export interface CombatStatModifier {
    multiplier?: number;
    bonus?: number;
}

export type CombatModifiers = Partial<Record<CombatStat, CombatStatModifier>>;

export type CombatModifierProvider = (actor: Actor) => CombatModifiers;

export function resolveCombatModifiers(actor: Actor): CombatModifiers {
    const source = (actor.metadata as { combatModifiers?: CombatModifiers | CombatModifierProvider }).combatModifiers;
    const modifiers = source ? (typeof source === 'function' ? (source(actor) ?? {}) : { ...source }) : {};

    for (const stat of ['attack', 'strength', 'defence', 'ranged', 'magic'] as const) {
        const prayerMultiplier = getPrayerModifier(actor, stat);
        if (prayerMultiplier > 0) {
            modifiers[stat] = {
                ...modifiers[stat],
                multiplier: (modifiers[stat]?.multiplier ?? 1) * (1 + prayerMultiplier),
            };
        }
    }

    return modifiers;
}

export function applyCombatModifier(level: number, modifier?: CombatStatModifier): number {
    const multiplier = modifier?.multiplier ?? 1;
    const bonus = modifier?.bonus ?? 0;
    return Math.max(1, Math.floor(Math.max(1, level) * multiplier) + bonus);
}
