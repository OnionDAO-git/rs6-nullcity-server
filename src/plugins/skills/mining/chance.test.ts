import type { IHarvestable } from '@engine/world/config/harvestable-object';
import { canMine } from './chance';

const ore = { baseChance: 10 } as IHarvestable;

describe('canMine', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('passes when the roll is inside the ore, pickaxe, and level chance', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);

        expect(canMine(ore, 1, 1)).toBe(true);
    });

    it('fails when the roll exceeds the ore, pickaxe, and level chance', () => {
        jest.spyOn(Math, 'random').mockReturnValue(1);

        expect(canMine(ore, 1, 1)).toBe(false);
    });
});
