import { magicDefenseRoll, meleeAttackRoll, meleeMaxHit, rangedAttackRoll, rangedMaxHit, rollAccuracy, rollDamage } from './formulas';
import { applyCombatModifier, resolveCombatModifiers } from './modifiers';

jest.mock('@engine/world/actor/prayer', () => ({
    getPrayerModifier: jest.fn(() => 0),
}));

describe('combat formulas', () => {
    it('rolls deterministic accuracy and damage with injected rng', () => {
        expect(rollAccuracy(100, 100, () => 0)).toBe(true);
        expect(rollAccuracy(100, 100, () => 0.99)).toBe(false);
        expect(rollDamage(10, () => 0.5)).toBe(5);
    });

    it('applies style bonuses to melee and ranged rolls', () => {
        expect(meleeAttackRoll({ attackLevel: 1, styleBonus: 3, attackBonus: 0 })).toBe(12 * 64);
        expect(meleeMaxHit({ strengthLevel: 1, styleBonus: 3, strengthBonus: 0 })).toBe(1);
        expect(rangedAttackRoll({ rangedLevel: 1, styleBonus: 3, attackBonus: 0 })).toBe(12 * 64);
        expect(rangedMaxHit({ rangedLevel: 1, styleBonus: 3, strengthBonus: 7 })).toBe(1);
    });

    it('uses magic-level-weighted defence for magic attacks', () => {
        expect(
            magicDefenseRoll({
                magicLevel: 50,
                defenseLevel: 10,
                styleBonus: 3,
                magicDefenseBonus: 20,
            }),
        ).toBe(49 * 84);
    });

    it('resolves prayer-compatible combat modifiers from metadata', () => {
        const actor = {
            metadata: {
                combatModifiers: {
                    attack: { multiplier: 1.15, bonus: 2 },
                },
            },
        };

        const modifiers = resolveCombatModifiers(actor as never);
        expect(applyCombatModifier(10, modifiers.attack)).toBe(13);
    });
});
