export type FarmingPatchKind = 'allotment';
export type FarmingPatchStatus = 'weeds' | 'empty' | 'planted' | 'dead';

export interface FarmingPatchDefinition {
    key: string;
    kind: FarmingPatchKind;
    objectIds: {
        weeds: number[];
        empty: number[];
        dead?: number[];
    };
}

export interface FarmingCropDefinition {
    key: string;
    name: string;
    patchKind: FarmingPatchKind;
    seedItemId: number;
    produceItemId: number;
    level: number;
    seedAmount: number;
    plantXp: number;
    harvestXp: number;
    growthStageTicks: number[];
    minYield: number;
    maxYield: number;
    objectIds: {
        planted: number;
        watered?: number;
        grown: number;
        dead?: number;
    };
}

export const farmingTools = {
    rake: 5341,
    seedDibber: 5343,
    spade: 952,
    wateringCans: [5331, 5333, 5334, 5335, 5336, 5337, 5338],
    compost: 6032,
};

export const farmingPatches: FarmingPatchDefinition[] = [
    {
        key: 'allotment',
        kind: 'allotment',
        objectIds: {
            weeds: [8550],
            empty: [8551],
            dead: [8553],
        },
    },
];

export const farmingCrops: FarmingCropDefinition[] = [
    {
        key: 'potato',
        name: 'potatoes',
        patchKind: 'allotment',
        seedItemId: 7548,
        produceItemId: 1942,
        level: 1,
        seedAmount: 3,
        plantXp: 8,
        harvestXp: 9,
        growthStageTicks: [5, 5, 5],
        minYield: 3,
        maxYield: 6,
        objectIds: {
            planted: 8558,
            watered: 8559,
            grown: 8564,
            dead: 8553,
        },
    },
    {
        key: 'onion',
        name: 'onions',
        patchKind: 'allotment',
        seedItemId: 7550,
        produceItemId: 1957,
        level: 5,
        seedAmount: 3,
        plantXp: 9.5,
        harvestXp: 10.5,
        growthStageTicks: [6, 6, 6],
        minYield: 3,
        maxYield: 6,
        objectIds: {
            planted: 8566,
            watered: 8567,
            grown: 8572,
            dead: 8553,
        },
    },
];

export const farmingPatchObjectIds = [
    ...new Set([
        ...farmingPatches.flatMap(patch => [...patch.objectIds.weeds, ...patch.objectIds.empty, ...(patch.objectIds.dead ?? [])]),
        ...farmingCrops.flatMap(crop => [crop.objectIds.planted, crop.objectIds.watered, crop.objectIds.grown, crop.objectIds.dead].filter(Boolean) as number[]),
    ]),
];

export const farmingSeedItemIds = farmingCrops.map(crop => crop.seedItemId);

export function getCropBySeed(seedItemId: number): FarmingCropDefinition | undefined {
    return farmingCrops.find(crop => crop.seedItemId === seedItemId);
}

export function getCrop(cropKey: string | undefined): FarmingCropDefinition | undefined {
    return cropKey ? farmingCrops.find(crop => crop.key === cropKey) : undefined;
}

export function getPatchByObjectId(objectId: number): FarmingPatchDefinition | undefined {
    return farmingPatches.find(patch => [...patch.objectIds.weeds, ...patch.objectIds.empty, ...(patch.objectIds.dead ?? [])].includes(objectId));
}

export function isFarmingPatchObject(objectId: number): boolean {
    return farmingPatchObjectIds.includes(objectId);
}
