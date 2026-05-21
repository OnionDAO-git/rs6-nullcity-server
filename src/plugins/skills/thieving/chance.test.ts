import { pickpocketSuccessChance, rollSuccess, selectReward } from './chance';

describe('thieving chance helpers', () => {
    it('scales success chance with level and clamps at 95%', () => {
        expect(pickpocketSuccessChance({ thievingLevel: 1, targetLevel: 1, baseChance: 0.5, minChance: 0.1, levelFactor: 0.01 })).toBe(0.5);
        expect(pickpocketSuccessChance({ thievingLevel: 99, targetLevel: 1, baseChance: 0.5, minChance: 0.1, levelFactor: 0.01 })).toBe(
            0.95,
        );
    });

    it('does not fall below the configured minimum chance', () => {
        expect(pickpocketSuccessChance({ thievingLevel: 1, targetLevel: 40, baseChance: 0.05, minChance: 0.1, levelFactor: 0.01 })).toBe(
            0.1,
        );
    });

    it('rolls success using the supplied RNG', () => {
        expect(rollSuccess(0.5, () => 0.49)).toBe(true);
        expect(rollSuccess(0.5, () => 0.5)).toBe(false);
    });

    it('selects weighted rewards deterministically', () => {
        const rewards = [
            { itemId: 1, amount: 1, weight: 1 },
            { itemId: 2, amount: 1, weight: 3 },
        ];

        expect(selectReward(rewards, () => 0.1).itemId).toBe(1);
        expect(selectReward(rewards, () => 0.9).itemId).toBe(2);
    });
});
