import { animationIds } from '@engine/world/config/animation-ids';
import { itemIds } from '@engine/world/config/item-ids';
import type { CraftingRecipe } from './crafting-types';

export const craftingToolIds = {
    chisel: 1755,
    needle: 1733,
    thread: 1734,
};

export const GEM_CUTTING_RECIPES: CraftingRecipe[] = [
    { toolIds: [craftingToolIds.chisel], ingredients: [{ itemId: 1623, amount: 1 }], output: { itemId: 1607, amount: 1 }, level: 20, experience: 50 },
    { toolIds: [craftingToolIds.chisel], ingredients: [{ itemId: 1621, amount: 1 }], output: { itemId: 1605, amount: 1 }, level: 27, experience: 67.5 },
    { toolIds: [craftingToolIds.chisel], ingredients: [{ itemId: 1619, amount: 1 }], output: { itemId: 1603, amount: 1 }, level: 34, experience: 85 },
    { toolIds: [craftingToolIds.chisel], ingredients: [{ itemId: 1617, amount: 1 }], output: { itemId: 1601, amount: 1 }, level: 43, experience: 107.5 },
];

export const LEATHER_CRAFTING_RECIPES: CraftingRecipe[] = [
    {
        toolIds: [craftingToolIds.needle],
        ingredients: [
            { itemId: 1741, amount: 1 },
            { itemId: craftingToolIds.thread, amount: 1 },
        ],
        output: { itemId: 1059, amount: 1 },
        level: 1,
        experience: 13.8,
        animationId: animationIds.shearSheep,
        successMessage: 'You make a pair of leather gloves.',
    },
    {
        toolIds: [craftingToolIds.needle],
        ingredients: [
            { itemId: 1741, amount: 1 },
            { itemId: craftingToolIds.thread, amount: 1 },
        ],
        output: { itemId: 1061, amount: 1 },
        level: 7,
        experience: 16.3,
        animationId: animationIds.shearSheep,
        successMessage: 'You make a pair of leather boots.',
    },
];

export const SPINNING_RECIPES = {
    ballOfWool: { input: itemIds.wool, output: itemIds.ballOfWool, experience: 2.5, requiredLevel: 1 },
    bowString: { input: itemIds.flax, output: itemIds.bowstring, experience: 15, requiredLevel: 10 },
    rootsCbowString: {
        input: [itemIds.roots.oak, itemIds.roots.willow, itemIds.roots.maple, itemIds.roots.yew],
        output: itemIds.crossbowString,
        experience: 15,
        requiredLevel: 10,
    },
    sinewCbowString: { input: itemIds.sinew, output: itemIds.crossbowString, experience: 15, requiredLevel: 10 },
    magicAmuletString: { input: itemIds.roots.magic, output: itemIds.magicString, experience: 30, requiredLevel: 19 },
};

export const ITEM_ON_ITEM_CRAFTING_RECIPES = [...GEM_CUTTING_RECIPES, ...LEATHER_CRAFTING_RECIPES];
