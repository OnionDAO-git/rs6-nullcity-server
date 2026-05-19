import { randomBetween } from '@engine/util/num';

export const canCatchFish = (baseChance: number, catchLevel: number, fishingLevel: number): boolean => {
    if (fishingLevel < catchLevel) {
        return false;
    }

    const chance = baseChance + fishingLevel - catchLevel;
    return randomBetween(0, 255) <= chance;
};
