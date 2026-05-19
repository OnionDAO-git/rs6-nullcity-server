export interface FishingCatch {
    itemConfigId: string;
    level: number;
    experience: number;
    weight: number;
}

export interface FishingMethod {
    option: string;
    toolItemConfigId: string;
    consumableItemConfigId?: string;
    animation: number;
    baseChance: number;
    catches: FishingCatch[];
}

export interface FishingSpot {
    npcKey: string;
    methods: string[];
}

export interface FishingRequirementIssue {
    message: string;
    inventoryFull?: boolean;
}
