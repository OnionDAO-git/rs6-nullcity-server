import type { ItemOnItemActionHook, itemOnItemActionHandler } from '@engine/action/pipe/item-on-item.action';
import { findItem } from '@engine/config/config-handler';
import { itemSelectionDialogue } from '@engine/world/actor/dialogue';
import { itemIds } from '@engine/world/config/item-ids';
import {
    arrowFinishingByHead,
    bowStringingByUnstrung,
    HEADLESS_ARROW_RECIPES,
    logCuttingByLog,
} from './fletching-data';
import { FletchingTask } from './fletching-task';
import type { Fletchable } from './fletching-types';

const logIds = Array.from(logCuttingByLog.keys());
const unstrungBowIds = Array.from(bowStringingByUnstrung.keys());
const arrowheadIds = Array.from(arrowFinishingByHead.keys());

function startRecipeSelection(details: Parameters<itemOnItemActionHandler>[0], recipes: Fletchable[]): void {
    void (async () => {
        const selection = await itemSelectionDialogue(
            details.player,
            'MAKING',
            recipes.map(recipe => ({
                itemId: recipe.item.itemId,
                itemName: findItem(recipe.item.itemId)?.name || `Item ${recipe.item.itemId}`,
            })),
        );

        const recipe = recipes.find(candidate => candidate.item.itemId === selection.itemId);
        if (!recipe) {
            details.player.sendMessage('Could not find fletching recipe, please tell a dev.');
            return;
        }

        const primaryIngredient = recipe.ingredient[0];
        const selectedAmount =
            selection.amount > 0 ? selection.amount : Math.floor(details.player.inventory.amount(primaryIngredient.itemId) / primaryIngredient.amount);

        if (selectedAmount <= 0) {
            details.player.sendMessage("You don't have enough materials to make that.");
            return;
        }

        details.player.enqueueTask(FletchingTask, [recipe, selectedAmount]);
    })().catch(() => undefined);
}

const cutLogs: itemOnItemActionHandler = details => {
    const logId = details.usedItem.itemId === itemIds.knife ? details.usedWithItem.itemId : details.usedItem.itemId;
    const recipes = logCuttingByLog.get(logId);

    if (!recipes) {
        details.player.sendMessage("You can't fletch those logs.");
        return;
    }

    startRecipeSelection(details, recipes);
};

const stringBow: itemOnItemActionHandler = details => {
    const unstrungId = details.usedItem.itemId === itemIds.bowstring ? details.usedWithItem.itemId : details.usedItem.itemId;
    const recipe = bowStringingByUnstrung.get(unstrungId);

    if (!recipe) {
        details.player.sendMessage("You can't string that.");
        return;
    }

    startRecipeSelection(details, [recipe]);
};

const makeHeadlessArrows: itemOnItemActionHandler = details => {
    startRecipeSelection(details, HEADLESS_ARROW_RECIPES);
};

const finishArrows: itemOnItemActionHandler = details => {
    const arrowheadId = details.usedItem.itemId === itemIds.arrows.headless ? details.usedWithItem.itemId : details.usedItem.itemId;
    const recipe = arrowFinishingByHead.get(arrowheadId);

    if (!recipe) {
        details.player.sendMessage("You can't make arrows with that.");
        return;
    }

    startRecipeSelection(details, [recipe]);
};

export default {
    pluginId: 'rs:fletching',
    hooks: [
        {
            type: 'item_on_item',
            items: logIds.map(logId => ({ item1: itemIds.knife, item2: logId })),
            cancelOtherActions: true,
            handler: cutLogs,
        } as ItemOnItemActionHook,
        {
            type: 'item_on_item',
            items: unstrungBowIds.map(unstrungId => ({ item1: itemIds.bowstring, item2: unstrungId })),
            cancelOtherActions: true,
            handler: stringBow,
        } as ItemOnItemActionHook,
        {
            type: 'item_on_item',
            items: [{ item1: itemIds.feather, item2: itemIds.arrows.shaft }],
            cancelOtherActions: true,
            handler: makeHeadlessArrows,
        } as ItemOnItemActionHook,
        {
            type: 'item_on_item',
            items: arrowheadIds.map(arrowheadId => ({ item1: itemIds.arrows.headless, item2: arrowheadId })),
            cancelOtherActions: true,
            handler: finishArrows,
        } as ItemOnItemActionHook,
    ],
};
