import type { ItemOnItemActionHook, itemOnItemActionHandler } from '@engine/action/pipe/item-on-item.action';
import { craftingToolIds, GEM_CUTTING_RECIPES } from './crafting-data';
import { CraftingTask } from './crafting-task';

const recipeByGem = new Map(GEM_CUTTING_RECIPES.map(recipe => [recipe.ingredients[0].itemId, recipe]));

const cutGem: itemOnItemActionHandler = details => {
    const gemId = details.usedItem.itemId === craftingToolIds.chisel ? details.usedWithItem.itemId : details.usedItem.itemId;
    const recipe = recipeByGem.get(gemId);

    if (!recipe) {
        details.player.sendMessage("You can't cut that gem.");
        return;
    }

    details.player.enqueueTask(CraftingTask, [recipe, 1]);
};

export default {
    pluginId: 'rs:gem_cutting',
    hooks: [
        {
            type: 'item_on_item',
            items: GEM_CUTTING_RECIPES.map(recipe => ({ item1: craftingToolIds.chisel, item2: recipe.ingredients[0].itemId })),
            cancelOtherActions: true,
            handler: cutGem,
        } as ItemOnItemActionHook,
    ],
};
