import { itemIds } from '@engine/world/config/item-ids';
import type { ThievingReward } from './thieving-targets';

export interface StallTarget {
    key: string;
    objectIds: number[];
    options: string[];
    level: number;
    xp: number;
    actionTicks: number;
    depletedObjectId?: number;
    respawnTicks?: number;
    rewards: ThievingReward[];
}

export const stallTargets: StallTarget[] = [
    {
        key: 'vegetable_stall',
        objectIds: [4706, 4708],
        options: ['steal-from', 'steal from', 'steal'],
        level: 2,
        xp: 10,
        actionTicks: 2,
        respawnTicks: 20,
        rewards: [
            { itemId: itemIds.potato, amount: 1, weight: 2 },
            { itemId: itemIds.onion, amount: 1, weight: 1 },
            { itemId: itemIds.cabbage, amount: 1, weight: 1 },
        ],
    },
];

export const stallObjectIds = [...new Set(stallTargets.flatMap(stall => stall.objectIds))];

export function getStallTarget(objectId: number, option: string): StallTarget | undefined {
    const normalizedOption = option.toLowerCase().replace(/-/g, ' ');
    return stallTargets.find(
        stall =>
            stall.objectIds.includes(objectId) &&
            stall.options.some(configuredOption => configuredOption.toLowerCase().replace(/-/g, ' ') === normalizedOption),
    );
}
