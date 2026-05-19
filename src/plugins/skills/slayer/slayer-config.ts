export interface SlayerAssignmentOption {
    group: string;
    minCount: number;
    maxCount: number;
    weight: number;
    minSlayerLevel?: number;
}

export interface SlayerMaster {
    key: string;
    npcKeys: string[];
    assignments: SlayerAssignmentOption[];
}

export interface SlayerMonsterGroup {
    key: string;
    name: string;
    npcKeys: string[];
    xp?: number;
}

export interface SlayerLevelRequirement {
    npcKeys: string[];
    level: number;
    message?: string;
}

export const slayerMonsterGroups: SlayerMonsterGroup[] = [
    {
        key: 'goblins',
        name: 'goblins',
        npcKeys: [
            'rs:goblin',
            'rs:goblin_with_spear',
            'rs:goblin_with_helmet',
            'rs:goblin_green_with_sprear',
            'rs:goblin_red_with_sprear',
            'rs:goblin_red_with_shield',
            'rs:goblin_green_with_shield',
            'rs:goblin_guard',
        ],
        xp: 5,
    },
    {
        key: 'men',
        name: 'men',
        npcKeys: ['rs:man', 'rs:man:0', 'rs:man:1'],
        xp: 7,
    },
];

export const slayerMasters: SlayerMaster[] = [
    {
        key: 'lumbridge_slayer_contact',
        npcKeys: ['rs:runescape_guide'],
        assignments: [
            { group: 'goblins', minCount: 5, maxCount: 12, weight: 4 },
            { group: 'men', minCount: 5, maxCount: 10, weight: 2 },
        ],
    },
];

export const slayerLevelRequirements: SlayerLevelRequirement[] = [
    {
        npcKeys: ['rs:goblin_guard'],
        level: 5,
        message: 'You need a Slayer level of 5 to fight this creature.',
    },
];

export const slayerMasterNpcKeys = [...new Set(slayerMasters.flatMap(master => master.npcKeys))];

export function getSlayerMaster(npcKey: string): SlayerMaster | undefined {
    return slayerMasters.find(master => master.npcKeys.includes(npcKey));
}

export function getSlayerMonsterGroup(groupKey: string): SlayerMonsterGroup | undefined {
    return slayerMonsterGroups.find(group => group.key === groupKey);
}

export function getSlayerRequirement(npcKey: string): SlayerLevelRequirement | undefined {
    return slayerLevelRequirements.find(requirement => requirement.npcKeys.includes(npcKey));
}

export function getGroupForNpc(npcKey: string): SlayerMonsterGroup | undefined {
    return slayerMonsterGroups.find(group => group.npcKeys.includes(npcKey));
}
