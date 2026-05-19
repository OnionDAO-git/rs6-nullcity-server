import { itemIds } from '@engine/world/config/item-ids';
import { objectIds } from '@engine/world/config/object-ids';
import type { Cookable, CookingHeatSource } from './cooking-types';

const burntFish = 323;

export const COOKABLES: Cookable[] = [
    { rawItemId: 2132, cookedItemId: 2142, burntItemId: itemIds.witchesPotion.burntMeat, level: 1, experience: 30 },
    { rawItemId: 2134, cookedItemId: 2142, burntItemId: itemIds.witchesPotion.burntMeat, level: 1, experience: 30 },
    { rawItemId: 2138, cookedItemId: 2140, burntItemId: itemIds.witchesPotion.burntMeat, level: 1, experience: 30 },
    { rawItemId: 317, cookedItemId: 315, burntItemId: 7954, level: 1, experience: 30, stopBurningLevel: 34 },
    { rawItemId: 327, cookedItemId: 325, burntItemId: burntFish, level: 1, experience: 40, stopBurningLevel: 38 },
    { rawItemId: 321, cookedItemId: 319, burntItemId: burntFish, level: 1, experience: 30, stopBurningLevel: 34 },
    { rawItemId: 345, cookedItemId: 347, burntItemId: burntFish, level: 5, experience: 50, stopBurningLevel: 41 },
    { rawItemId: 353, cookedItemId: 355, burntItemId: 357, level: 10, experience: 60, stopBurningLevel: 45 },
    { rawItemId: 335, cookedItemId: 333, burntItemId: 343, level: 15, experience: 70, stopBurningLevel: 50 },
    { rawItemId: 341, cookedItemId: 339, burntItemId: 343, level: 18, experience: 75, stopBurningLevel: 52 },
    { rawItemId: 349, cookedItemId: 351, burntItemId: 343, level: 20, experience: 80, stopBurningLevel: 58 },
    { rawItemId: 331, cookedItemId: 329, burntItemId: 343, level: 25, experience: 90, stopBurningLevel: 58 },
    { rawItemId: 359, cookedItemId: 361, burntItemId: 367, level: 30, experience: 100, stopBurningLevel: 65 },
    { rawItemId: 377, cookedItemId: 379, burntItemId: 381, level: 40, experience: 120, stopBurningLevel: 74 },
    { rawItemId: 371, cookedItemId: 373, burntItemId: 375, level: 45, experience: 140, stopBurningLevel: 86 },
    { rawItemId: 383, cookedItemId: 385, burntItemId: 387, level: 80, experience: 210, stopBurningLevel: 99 },
    { rawItemId: 2307, cookedItemId: 2309, burntItemId: 2311, level: 1, experience: 40, stopBurningLevel: 38 },
];

export const COOKING_HEAT_SOURCES: CookingHeatSource[] = [
    { id: objectIds.fire, type: 'object', name: 'fire', burnBonus: -5 },
    { id: 114, type: 'object', name: 'range', burnBonus: 6 },
    { id: 2728, type: 'object', name: 'range', burnBonus: 6 },
    { id: 2729, type: 'object', name: 'range', burnBonus: 6 },
    { id: 2730, type: 'object', name: 'stove', burnBonus: 4 },
    { id: 2731, type: 'object', name: 'range', burnBonus: 6 },
    { id: 2859, type: 'object', name: 'range', burnBonus: 6 },
    { id: 4172, type: 'object', name: 'range', burnBonus: 6 },
    { id: 9682, type: 'object', name: 'range', burnBonus: 6 },
];

export const COOKABLE_BY_RAW = new Map<number, Cookable>(COOKABLES.map(cookable => [cookable.rawItemId, cookable]));
export const OBJECT_HEAT_SOURCES = new Map<number, CookingHeatSource>(
    COOKING_HEAT_SOURCES.filter(source => source.type === 'object').map(source => [source.id, source]),
);

export function shouldBurnCookable(cookable: Cookable, cookingLevel: number, heatSource: CookingHeatSource, roll = Math.random()): boolean {
    if (!cookable.burntItemId) {
        return false;
    }

    const noBurnLevel = heatSource.name === 'fire' ? cookable.fireStopBurningLevel || cookable.stopBurningLevel : cookable.stopBurningLevel;
    if (noBurnLevel !== undefined && cookingLevel >= noBurnLevel) {
        return false;
    }

    const effectiveLevel = cookingLevel + heatSource.burnBonus;
    const levelDelta = Math.max(0, effectiveLevel - cookable.level);
    const successChance = Math.max(0.35, Math.min(0.98, 0.55 + levelDelta * 0.018));

    return roll >= successChance;
}
