import type { ItemOnItemActionHook, itemOnItemActionHandler } from '@engine/action/pipe/item-on-item.action';
import { craftingToolIds, LEATHER_CRAFTING_RECIPES } from './crafting-data';
import { CraftingTask } from './crafting-task';

const makeLeatherItem: itemOnItemActionHandler = details => {
    const availableRecipe =
        [...LEATHER_CRAFTING_RECIPES].reverse().find(recipe => details.player.skills.hasLevel('crafting', recipe.level)) ||
        LEATHER_CRAFTING_RECIPES[0];

    details.player.enqueueTask(CraftingTask, [availableRecipe, 1]);
};

export default {
    pluginId: 'rs:leather_crafting',
    hooks: [
        {
            type: 'item_on_item',
            items: [{ item1: craftingToolIds.needle, item2: 1741 }],
            cancelOtherActions: true,
            handler: makeLeatherItem,
        } as ItemOnItemActionHook,
    ],
};
