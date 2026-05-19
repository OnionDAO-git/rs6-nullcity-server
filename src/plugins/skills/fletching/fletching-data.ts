import { itemIds } from '@engine/world/config/item-ids';
import type { Fletchable } from './fletching-types';

const logRecipe = (logId: number, outputId: number, level: number, experience: number, amount = 1): Fletchable => ({
    category: 'log_cutting',
    toolIds: [itemIds.knife],
    item: { itemId: outputId, amount },
    level,
    experience,
    ingredient: [{ itemId: logId, amount: 1 }],
});

const stringRecipe = (unstrungId: number, strungId: number, level: number, experience: number): Fletchable => ({
    category: 'bow_stringing',
    toolIds: [],
    item: { itemId: strungId, amount: 1 },
    level,
    experience,
    ingredient: [
        { itemId: unstrungId, amount: 1 },
        { itemId: itemIds.bowstring, amount: 1 },
    ],
});

const arrowRecipe = (headId: number, arrowId: number, level: number, experience: number): Fletchable => ({
    category: 'arrows',
    toolIds: [],
    item: { itemId: arrowId, amount: 15 },
    level,
    experience,
    ingredient: [
        { itemId: headId, amount: 15 },
        { itemId: itemIds.arrows.headless, amount: 15 },
    ],
});

export const LOG_CUTTING_RECIPES: Fletchable[] = [
    logRecipe(itemIds.logs.normal, itemIds.arrows.shaft, 1, 5, 15),
    logRecipe(itemIds.logs.normal, itemIds.bowunstrung.woodshort, 5, 5),
    logRecipe(itemIds.logs.normal, itemIds.bowunstrung.woodlong, 10, 10),
    logRecipe(itemIds.logs.oak, itemIds.bowunstrung.oakshort, 20, 16.5),
    logRecipe(itemIds.logs.oak, itemIds.bowunstrung.oaklong, 25, 25),
    logRecipe(itemIds.logs.willow, itemIds.bowunstrung.willowshort, 35, 33.3),
    logRecipe(itemIds.logs.willow, itemIds.bowunstrung.willowlong, 40, 41.5),
    logRecipe(itemIds.logs.maple, itemIds.bowunstrung.mapleshort, 50, 50),
    logRecipe(itemIds.logs.maple, itemIds.bowunstrung.maplelong, 55, 58.3),
    logRecipe(itemIds.logs.yew, itemIds.bowunstrung.yewshort, 65, 67.5),
    logRecipe(itemIds.logs.yew, itemIds.bowunstrung.yewlong, 70, 75),
    logRecipe(itemIds.logs.magic, itemIds.bowunstrung.magicshort, 80, 83.3),
    logRecipe(itemIds.logs.magic, itemIds.bowunstrung.magiclong, 85, 91.5),
];

export const BOW_STRINGING_RECIPES: Fletchable[] = [
    stringRecipe(itemIds.bowunstrung.woodshort, itemIds.bowstrung.woodshort, 5, 5),
    stringRecipe(itemIds.bowunstrung.woodlong, itemIds.bowstrung.woodlong, 10, 10),
    stringRecipe(itemIds.bowunstrung.oakshort, itemIds.bowstrung.oakshort, 20, 16.5),
    stringRecipe(itemIds.bowunstrung.oaklong, itemIds.bowstrung.oaklong, 25, 25),
    stringRecipe(itemIds.bowunstrung.willowshort, itemIds.bowstrung.willowshort, 35, 33.3),
    stringRecipe(itemIds.bowunstrung.willowlong, itemIds.bowstrung.willowlong, 40, 41.5),
    stringRecipe(itemIds.bowunstrung.mapleshort, itemIds.bowstrung.mapleshort, 50, 50),
    stringRecipe(itemIds.bowunstrung.maplelong, itemIds.bowstrung.maplelong, 55, 58.3),
    stringRecipe(itemIds.bowunstrung.yewshort, itemIds.bowstrung.yewshort, 65, 67.5),
    stringRecipe(itemIds.bowunstrung.yewlong, itemIds.bowstrung.yewlong, 70, 75),
    stringRecipe(itemIds.bowunstrung.magicshort, itemIds.bowstrung.magicshort, 80, 83.3),
    stringRecipe(itemIds.bowunstrung.magiclong, itemIds.bowstrung.magiclong, 85, 91.5),
];

export const HEADLESS_ARROW_RECIPES: Fletchable[] = [
    {
        category: 'headless_arrows',
        toolIds: [],
        item: { itemId: itemIds.arrows.headless, amount: 15 },
        level: 1,
        experience: 15,
        ingredient: [
            { itemId: itemIds.arrows.shaft, amount: 15 },
            { itemId: itemIds.feather, amount: 15 },
        ],
    },
];

export const ARROW_FINISHING_RECIPES: Fletchable[] = [
    arrowRecipe(itemIds.arrowTips.bronze, itemIds.arrows.bronze, 1, 19.5),
    arrowRecipe(itemIds.arrowTips.iron, itemIds.arrows.iron, 15, 37.5),
    arrowRecipe(itemIds.arrowTips.steel, itemIds.arrows.steel, 30, 75),
    arrowRecipe(itemIds.arrowTips.mithril, itemIds.arrows.mithril, 45, 112.5),
    arrowRecipe(itemIds.arrowTips.adamantite, itemIds.arrows.adamant, 60, 150),
    arrowRecipe(itemIds.arrowTips.runite, itemIds.arrows.rune, 75, 187.5),
];

export const ALL_FLETCHING_RECIPES = [
    ...LOG_CUTTING_RECIPES,
    ...BOW_STRINGING_RECIPES,
    ...HEADLESS_ARROW_RECIPES,
    ...ARROW_FINISHING_RECIPES,
];

export const logCuttingByLog = new Map<number, Fletchable[]>();
for (const recipe of LOG_CUTTING_RECIPES) {
    const logId = recipe.ingredient[0].itemId;
    logCuttingByLog.set(logId, [...(logCuttingByLog.get(logId) || []), recipe]);
}

export const bowStringingByUnstrung = new Map(BOW_STRINGING_RECIPES.map(recipe => [recipe.ingredient[0].itemId, recipe]));
export const arrowFinishingByHead = new Map(ARROW_FINISHING_RECIPES.map(recipe => [recipe.ingredient[0].itemId, recipe]));
