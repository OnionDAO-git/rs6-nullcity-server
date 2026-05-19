import type { SlayerAssignmentOption, SlayerMaster, SlayerMonsterGroup } from './slayer-config';
import { getGroupForNpc, getSlayerMonsterGroup } from './slayer-config';

export interface SlayerAssignment {
    group: string;
    displayName: string;
    remaining: number;
}

export function selectSlayerAssignment(
    master: SlayerMaster,
    slayerLevel: number,
    random: () => number = Math.random,
): SlayerAssignment | undefined {
    const available = master.assignments.filter(option => !option.minSlayerLevel || slayerLevel >= option.minSlayerLevel);
    if (available.length === 0) {
        return undefined;
    }

    const selected = selectWeightedAssignment(available, random);
    const group = getSlayerMonsterGroup(selected.group);
    if (!group) {
        return undefined;
    }

    const remaining = selected.minCount + Math.floor(random() * (selected.maxCount - selected.minCount + 1));
    return {
        group: group.key,
        displayName: group.name,
        remaining,
    };
}

function selectWeightedAssignment(options: SlayerAssignmentOption[], random: () => number): SlayerAssignmentOption {
    const totalWeight = options.reduce((total, option) => total + option.weight, 0);
    let roll = random() * totalWeight;
    for (const option of options) {
        roll -= option.weight;
        if (roll <= 0) {
            return option;
        }
    }
    return options[options.length - 1];
}

export function npcMatchesAssignment(npcKey: string, assignment: SlayerAssignment | undefined): boolean {
    if (!assignment) {
        return false;
    }
    const group = getGroupForNpc(npcKey);
    return group?.key === assignment.group;
}

export function slayerXpForKill(group: SlayerMonsterGroup, fallbackHitpoints: number): number {
    return group.xp ?? Math.max(1, fallbackHitpoints);
}
