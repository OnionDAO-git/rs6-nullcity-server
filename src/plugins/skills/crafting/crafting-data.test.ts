import { GEM_CUTTING_RECIPES, LEATHER_CRAFTING_RECIPES, SPINNING_RECIPES, craftingToolIds } from './crafting-data';

describe('crafting data', () => {
    it('defines gem cutting recipes with chisel requirements', () => {
        expect(GEM_CUTTING_RECIPES.map(recipe => recipe.toolIds)).toEqual(
            expect.arrayContaining([expect.arrayContaining([craftingToolIds.chisel])]),
        );
        expect(GEM_CUTTING_RECIPES.find(recipe => recipe.ingredients[0].itemId === 1623)?.output.itemId).toBe(1607);
    });

    it('defines leather recipes with needle and thread requirements', () => {
        const recipe = LEATHER_CRAFTING_RECIPES[0];

        expect(recipe.toolIds).toContain(craftingToolIds.needle);
        expect(recipe.ingredients).toContainEqual({ itemId: craftingToolIds.thread, amount: 1 });
    });

    it('keeps spinning data available for the spinning wheel plugin', () => {
        expect(SPINNING_RECIPES.ballOfWool.requiredLevel).toBe(1);
        expect(SPINNING_RECIPES.bowString.requiredLevel).toBe(10);
    });
});
