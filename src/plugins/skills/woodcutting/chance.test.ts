import type { IHarvestable } from '@engine/world/config/harvestable-object';
import { canCut } from './chance';

const tree = { baseChance: 10 } as IHarvestable;

describe('canCut', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('passes when the roll is inside the tree, axe, and level chance', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);

        expect(canCut(tree, 1, 1)).toBe(true);
    });

    it('fails when the roll exceeds the tree, axe, and level chance', () => {
        jest.spyOn(Math, 'random').mockReturnValue(1);

        expect(canCut(tree, 1, 1)).toBe(false);
    });
});
