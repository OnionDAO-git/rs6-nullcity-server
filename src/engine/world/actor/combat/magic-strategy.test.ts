import { findSpellByKey } from '@engine/world/actor/magic';
import { runeCostAfterStaffSubstitution } from './magic-strategy';

jest.mock('chokidar', () => ({
    watch: jest.fn(),
}));

describe('magic combat resources', () => {
    it('removes elemental rune costs supplied by an equipped staff', () => {
        const runes = [
            { itemKey: 'rs:air_rune', itemId: 556, amount: 5 },
            { itemKey: 'rs:blood_rune', itemId: 565, amount: 1 },
        ];

        expect(runeCostAfterStaffSubstitution(runes, new Set(['rs:air_rune']))).toEqual([
            { itemKey: 'rs:blood_rune', itemId: 565, amount: 1 },
        ]);
    });

    it('defines standard wave spells through fire wave', () => {
        const spell = findSpellByKey('rs:fire_wave');

        expect(spell).toMatchObject({
            level_required: 75,
            base_damage: 20,
            base_xp: 42.5,
        });
    });
});
