import type { itemInteractionActionHandler } from '@engine/action/pipe/item-interaction.action';
import type { itemOnItemActionHandler } from '@engine/action/pipe/item-on-item.action';
import { findItem, widgets } from '@engine/config/config-handler';
import { Skill } from '@engine/world/actor/skills';
import { animationIds } from '@engine/world/config/animation-ids';
import { soundIds } from '@engine/world/config/sound-ids';
import type { Item } from '@engine/world/items/item';
import { cleanHerbRecipes, finishedPotionRecipes, grindingRecipes, itemId, recipeItemIds, unfinishedPotionRecipes } from './herblore-data';

function sameItem(item: Item | null, expectedItemId: number): boolean {
    return item?.itemId === expectedItemId && item.amount >= 1;
}

function replaceTwoWithOne(
    player: Parameters<itemOnItemActionHandler>[0]['player'],
    firstSlot: number,
    secondSlot: number,
    outputItemId: number,
): boolean {
    if (firstSlot === secondSlot) {
        return false;
    }

    player.inventory.set(firstSlot, { itemId: outputItemId, amount: 1 });
    player.inventory.remove(secondSlot);
    player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
    return true;
}

function findPair<T>(usedItemId: number, usedWithItemId: number, recipes: T[], getPair: (recipe: T) => [number, number]): T | undefined {
    return recipes.find(recipe => {
        const [a, b] = getPair(recipe);
        return (usedItemId === a && usedWithItemId === b) || (usedItemId === b && usedWithItemId === a);
    });
}

const cleanHerb: itemInteractionActionHandler = details => {
    const { player, itemId: clickedItemId, itemSlot } = details;
    const recipe = cleanHerbRecipes.find(recipe => itemId(recipe.grimy) === clickedItemId);
    if (!recipe) {
        return;
    }

    if (!player.skills.hasLevel(Skill.HERBLORE, recipe.level)) {
        player.sendMessage(`You need a Herblore level of ${recipe.level} to identify this herb.`, true);
        return;
    }

    if (!sameItem(player.inventory.items[itemSlot], clickedItemId)) {
        player.sendMessage('You need to have the herb in your inventory to clean it.');
        return;
    }

    player.skills.addExp(Skill.HERBLORE, recipe.xp);
    player.inventory.set(itemSlot, { itemId: itemId(recipe.clean), amount: 1 });
    player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
    player.playSound(soundIds.herblore.clean_herb);
};

const mixItems: itemOnItemActionHandler = details => {
    const { player, usedItem, usedWithItem, usedSlot, usedWithSlot } = details;
    if (
        !sameItem(player.inventory.items[usedSlot], usedItem.itemId) ||
        !sameItem(player.inventory.items[usedWithSlot], usedWithItem.itemId)
    ) {
        player.sendMessage('You need the ingredients in your inventory to do that.');
        return;
    }

    const unfinishedRecipe = findPair(usedItem.itemId, usedWithItem.itemId, unfinishedPotionRecipes, recipe => [
        itemId('rs:vial:water'),
        itemId(recipe.herb),
    ]);
    if (unfinishedRecipe) {
        const herbSlot = player.inventory.items[usedSlot]?.itemId === itemId(unfinishedRecipe.herb) ? usedSlot : usedWithSlot;
        const vialSlot = herbSlot === usedSlot ? usedWithSlot : usedSlot;
        replaceTwoWithOne(player, vialSlot, herbSlot, itemId(unfinishedRecipe.unfinished));
        player.playAnimation(animationIds.herblore.make_potion);
        player.playSound(soundIds.herblore.make_potion);
        player.sendMessage('You put the herb into the vial of water.');
        return;
    }

    const finishedRecipe = findPair(usedItem.itemId, usedWithItem.itemId, finishedPotionRecipes, recipe => [
        itemId(recipe.unfinished),
        itemId(recipe.secondary),
    ]);
    if (finishedRecipe) {
        if (!player.skills.hasLevel(Skill.HERBLORE, finishedRecipe.level)) {
            player.sendMessage(`You need a Herblore level of ${finishedRecipe.level} to make that potion.`);
            return;
        }
        const unfinishedSlot = player.inventory.items[usedSlot]?.itemId === itemId(finishedRecipe.unfinished) ? usedSlot : usedWithSlot;
        const secondarySlot = unfinishedSlot === usedSlot ? usedWithSlot : usedSlot;
        replaceTwoWithOne(player, unfinishedSlot, secondarySlot, itemId(finishedRecipe.potion));
        player.skills.addExp(Skill.HERBLORE, finishedRecipe.xp);
        player.playAnimation(animationIds.herblore.make_potion);
        player.playSound(soundIds.herblore.make_potion);
        player.sendMessage(`You mix the ${findItem(finishedRecipe.potion)?.name ?? 'potion'}.`);
        return;
    }

    const grindingRecipe = findPair(usedItem.itemId, usedWithItem.itemId, grindingRecipes, recipe => [
        itemId('rs:pestle_and_mortar'),
        itemId(recipe.raw),
    ]);
    if (grindingRecipe) {
        const rawSlot = player.inventory.items[usedSlot]?.itemId === itemId(grindingRecipe.raw) ? usedSlot : usedWithSlot;
        player.inventory.set(rawSlot, { itemId: itemId(grindingRecipe.ground), amount: 1 });
        player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
        player.playAnimation(animationIds.herblore.pestle_and_mortar);
        player.sendMessage(`You grind the ${findItem(grindingRecipe.raw)?.name ?? 'ingredient'}.`);
    }
};

export default {
    pluginId: 'rs:herblore',
    hooks: [
        {
            type: 'item_interaction',
            widgets: widgets.inventory,
            options: ['identify', 'clean'],
            itemIds: cleanHerbRecipes.map(recipe => itemId(recipe.grimy)),
            handler: cleanHerb,
            cancelOtherActions: true,
        },
        {
            type: 'item_on_item',
            items: recipeItemIds().map(recipeId => ({ item1: recipeId })),
            handler: mixItems,
        },
    ],
};
