import type { Player } from '@engine/world/actor/player/player';
import type { SlayerAssignment } from './slayer-assignment';

export interface SlayerSaveState {
    assignment?: SlayerAssignment;
}

export function getSlayerState(player: Player): SlayerSaveState {
    if (!player.savedMetadata.slayer) {
        player.savedMetadata.slayer = {};
    }
    return player.savedMetadata.slayer as SlayerSaveState;
}

export function getSlayerAssignment(player: Player): SlayerAssignment | undefined {
    return getSlayerState(player).assignment;
}

export function setSlayerAssignment(player: Player, assignment: SlayerAssignment): void {
    getSlayerState(player).assignment = assignment;
}

export function clearSlayerAssignment(player: Player): void {
    delete getSlayerState(player).assignment;
}

export function decrementSlayerAssignment(player: Player): SlayerAssignment | undefined {
    const assignment = getSlayerAssignment(player);
    if (!assignment) {
        return undefined;
    }
    assignment.remaining = Math.max(0, assignment.remaining - 1);
    if (assignment.remaining === 0) {
        clearSlayerAssignment(player);
        return undefined;
    }
    return assignment;
}
