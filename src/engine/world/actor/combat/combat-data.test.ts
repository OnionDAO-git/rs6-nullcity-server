import { combatStyles } from '@engine/world/actor/combat';
import { ammoIsCompatible, rangedXpAwards } from './combat-data';

describe('combat style data', () => {
    it('routes longrange ranged style to ranged and defence xp', () => {
        expect(combatStyles.bow[2]).toMatchObject({
            type: 'ranged',
            exp: ['ranged', 'defence'],
            stance: 'longrange',
        });
    });

    it('defines melee style data for common weapon families', () => {
        expect(combatStyles.slash_sword).toHaveLength(4);
        expect(combatStyles.magical_staff).toHaveLength(3);
    });

    it('rejects invalid ranged ammo families but allows thrown weapons', () => {
        expect(ammoIsCompatible('arrow', 'arrow', false)).toBe(true);
        expect(ammoIsCompatible('arrow', 'bolt', false)).toBe(false);
        expect(ammoIsCompatible('dart', undefined, true)).toBe(true);
    });

    it('routes longrange ranged xp to defence', () => {
        expect(rangedXpAwards(5, combatStyles.bow[2])).toEqual([
            { skill: 'ranged', exp: 10 },
            { skill: 'defence', exp: 10 },
            { skill: 'hitpoints', exp: 6.65 },
        ]);
    });
});
