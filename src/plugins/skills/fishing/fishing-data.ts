import { findItem } from '@engine/config/config-handler';
import type { ItemDetails } from '@engine/config/item-config';
import { randomBetween } from '@engine/util/num';
import type { Player } from '@engine/world/actor/player/player';
import type { FishingCatch, FishingMethod, FishingRequirementIssue, FishingSpot } from './fishing-types';

export const FISHING_METHODS: Record<string, FishingMethod> = {
    net: {
        option: 'net',
        toolItemConfigId: 'rs:small_fishing_net',
        animation: 621,
        baseChance: 90,
        catches: [
            { itemConfigId: 'rs:raw_shrimp', level: 1, experience: 10, weight: 80 },
            { itemConfigId: 'rs:raw_anchovies', level: 15, experience: 40, weight: 20 },
        ],
    },
    bait: {
        option: 'bait',
        toolItemConfigId: 'rs:fishing_rod',
        consumableItemConfigId: 'rs:fishing_bait',
        animation: 622,
        baseChance: 80,
        catches: [
            { itemConfigId: 'rs:raw_sardine', level: 5, experience: 20, weight: 55 },
            { itemConfigId: 'rs:raw_herring', level: 10, experience: 30, weight: 35 },
            { itemConfigId: 'rs:raw_pike', level: 25, experience: 60, weight: 10 },
        ],
    },
    lure: {
        option: 'lure',
        toolItemConfigId: 'rs:fly_fishing_rod',
        consumableItemConfigId: 'rs:feather',
        animation: 622,
        baseChance: 80,
        catches: [
            { itemConfigId: 'rs:raw_trout', level: 20, experience: 50, weight: 70 },
            { itemConfigId: 'rs:raw_salmon', level: 30, experience: 70, weight: 30 },
        ],
    },
    harpoon: {
        option: 'harpoon',
        toolItemConfigId: 'rs:harpoon',
        animation: 618,
        baseChance: 70,
        catches: [
            { itemConfigId: 'rs:raw_tuna', level: 35, experience: 80, weight: 80 },
            { itemConfigId: 'rs:raw_swordfish', level: 50, experience: 100, weight: 20 },
        ],
    },
    cage: {
        option: 'cage',
        toolItemConfigId: 'rs:lobster_pot',
        animation: 619,
        baseChance: 70,
        catches: [{ itemConfigId: 'rs:raw_lobster', level: 40, experience: 90, weight: 100 }],
    },
};

export const FISHING_SPOTS: FishingSpot[] = [
    { npcKey: 'rs:fishing_spot_lure_bait', methods: ['lure', 'bait'] },
    { npcKey: 'rs:fishing_spot_cage_harpoon', methods: ['cage', 'harpoon'] },
    { npcKey: 'rs:fishing_spot_net_harpoon', methods: ['net', 'harpoon'] },
    { npcKey: 'rs:fishing_spot_net_bait', methods: ['net', 'bait'] },
];

export const getFishingSpotKeys = (): string[] => FISHING_SPOTS.map(spot => spot.npcKey);

export const getFishingOptions = (): string[] => [...new Set(Object.values(FISHING_METHODS).map(method => method.option))];

export const getFishingMethod = (npcKey: string, option: string): FishingMethod | null => {
    const spot = FISHING_SPOTS.find(spot => spot.npcKey === npcKey);
    if (!spot) {
        return null;
    }

    const methodKey = spot.methods.find(methodKey => FISHING_METHODS[methodKey]?.option === option.toLowerCase());
    return methodKey ? FISHING_METHODS[methodKey] : null;
};

export const resolveFishingItem = (itemConfigId: string): ItemDetails => {
    const item = findItem(itemConfigId);
    if (!item) {
        throw new Error(`Fishing item config is missing: ${itemConfigId}`);
    }

    return item;
};

export const getEligibleCatches = (method: FishingMethod, fishingLevel: number): FishingCatch[] =>
    method.catches.filter(fish => fishingLevel >= fish.level);

export const selectFishingCatch = (method: FishingMethod, fishingLevel: number): FishingCatch | null => {
    const eligibleCatches = getEligibleCatches(method, fishingLevel);
    if (eligibleCatches.length === 0) {
        return null;
    }

    const totalWeight = eligibleCatches.reduce((sum, fish) => sum + fish.weight, 0);
    let roll = randomBetween(1, totalWeight);

    for (const fish of eligibleCatches) {
        roll -= fish.weight;
        if (roll <= 0) {
            return fish;
        }
    }

    return eligibleCatches[0];
};

export const getRequiredFishingLevel = (method: FishingMethod): number => Math.min(...method.catches.map(fish => fish.level));

export const getFishingRequirementIssue = (player: Player, method: FishingMethod): FishingRequirementIssue | null => {
    const requiredLevel = getRequiredFishingLevel(method);
    if (!player.skills.hasLevel('fishing', requiredLevel)) {
        return { message: `You need a Fishing level of ${requiredLevel} to fish here.` };
    }

    const tool = resolveFishingItem(method.toolItemConfigId);
    if (!player.inventory.has(tool.gameId)) {
        return { message: `You need a ${tool.name.toLowerCase()} to fish here.` };
    }

    if (method.consumableItemConfigId) {
        const consumable = resolveFishingItem(method.consumableItemConfigId);
        if (!player.inventory.has(consumable.gameId)) {
            return { message: `You need some ${consumable.name.toLowerCase()} to fish here.` };
        }
    }

    if (!player.inventory.hasSpace()) {
        return { message: 'Your inventory is too full to hold any more fish.', inventoryFull: true };
    }

    return null;
};
