jest.mock('@engine/config/config-handler', () => ({
    findItem: jest.fn(),
}));

import { FISHING_METHODS, getEligibleCatches, selectFishingCatch } from './fishing-data';

describe('fishing data', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('gates mixed catch tables by fishing level', () => {
        expect(getEligibleCatches(FISHING_METHODS.net, 1).map(fish => fish.itemConfigId)).toEqual(['rs:raw_shrimp']);
        expect(getEligibleCatches(FISHING_METHODS.net, 15).map(fish => fish.itemConfigId)).toEqual(['rs:raw_shrimp', 'rs:raw_anchovies']);
    });

    it('selects a weighted eligible catch', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.99);

        expect(selectFishingCatch(FISHING_METHODS.net, 15)?.itemConfigId).toBe('rs:raw_anchovies');
    });
});
