import { COOKABLE_BY_RAW, OBJECT_HEAT_SOURCES, shouldBurnCookable } from './cooking-data';

describe('cooking data', () => {
    it('looks up raw food recipes', () => {
        expect(COOKABLE_BY_RAW.get(317)?.cookedItemId).toBe(315);
        expect(COOKABLE_BY_RAW.get(2134)?.cookedItemId).toBe(2142);
    });

    it('can deterministically burn or cook from the pure chance helper', () => {
        const recipe = COOKABLE_BY_RAW.get(317)!;
        const fire = OBJECT_HEAT_SOURCES.get(2732)!;

        expect(shouldBurnCookable(recipe, 1, fire, 0.99)).toBe(true);
        expect(shouldBurnCookable(recipe, 99, fire, 0.99)).toBe(false);
    });
});
