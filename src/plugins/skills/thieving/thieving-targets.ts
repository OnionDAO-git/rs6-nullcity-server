import { itemIds } from '@engine/world/config/item-ids';

export interface ThievingReward {
    itemId: number;
    amount: number;
    weight?: number;
}

export interface PickpocketTarget {
    key: string;
    npcKeys: string[];
    level: number;
    xp: number;
    baseChance: number;
    minChance: number;
    levelFactor: number;
    actionTicks: number;
    stunTicks: number;
    damage: number;
    rewards: ThievingReward[];
}

export const pickpocketTargets: PickpocketTarget[] = [
    {
        key: 'man',
        npcKeys: ['rs:man', 'rs:man:0', 'rs:man:1'],
        level: 1,
        xp: 8,
        baseChance: 0.52,
        minChance: 0.1,
        levelFactor: 0.006,
        actionTicks: 2,
        stunTicks: 3,
        damage: 1,
        rewards: [{ itemId: itemIds.coins, amount: 3 }],
    },
    {
        key: 'guard',
        npcKeys: [
            'rs:guard',
            'rs:guard:0',
            'rs:guard:1',
            'rs:guard:2',
            'rs:guard:3',
            'rs:guard:4',
            'rs:guard:5',
            'rs:guard:6',
            'rs:guard:7',
        ],
        level: 40,
        xp: 46.8,
        baseChance: 0.25,
        minChance: 0.08,
        levelFactor: 0.005,
        actionTicks: 2,
        stunTicks: 4,
        damage: 2,
        rewards: [{ itemId: itemIds.coins, amount: 30 }],
    },
];

export const pickpocketNpcKeys = [...new Set(pickpocketTargets.flatMap(target => target.npcKeys))];

export function getPickpocketTarget(npcKey: string): PickpocketTarget | undefined {
    return pickpocketTargets.find(target => target.npcKeys.includes(npcKey));
}
