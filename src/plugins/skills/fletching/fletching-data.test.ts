import { itemIds } from '@engine/world/config/item-ids';
import { arrowFinishingByHead, BOW_STRINGING_RECIPES, HEADLESS_ARROW_RECIPES, logCuttingByLog } from './fletching-data';

describe('fletching data', () => {
    it('uses the matching log for higher-tier bow recipes', () => {
        const oakRecipes = logCuttingByLog.get(itemIds.logs.oak) || [];
        const willowRecipes = logCuttingByLog.get(itemIds.logs.willow) || [];

        expect(oakRecipes.map(recipe => recipe.item.itemId)).toContain(itemIds.bowunstrung.oakshort);
        expect(willowRecipes.map(recipe => recipe.item.itemId)).toContain(itemIds.bowunstrung.willowshort);
        expect(oakRecipes.every(recipe => recipe.ingredient[0].itemId === itemIds.logs.oak)).toBe(true);
        expect(willowRecipes.every(recipe => recipe.ingredient[0].itemId === itemIds.logs.willow)).toBe(true);
    });

    it('strings bows into the matching strung output', () => {
        const oakShortbow = BOW_STRINGING_RECIPES.find(recipe => recipe.ingredient[0].itemId === itemIds.bowunstrung.oakshort);

        expect(oakShortbow?.item.itemId).toBe(itemIds.bowstrung.oakshort);
    });

    it('defines headless and finished arrow batch recipes', () => {
        expect(HEADLESS_ARROW_RECIPES[0].item.amount).toBe(15);
        expect(arrowFinishingByHead.get(itemIds.arrowTips.steel)?.item.itemId).toBe(itemIds.arrows.steel);
    });
});
