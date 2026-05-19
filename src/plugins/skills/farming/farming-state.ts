import type { Player } from '@engine/world/actor/player/player';
import type { FarmingPatchStatus } from './farming-config';

export interface FarmingPatchState {
    status: FarmingPatchStatus;
    crop?: string;
    plantedAtTick?: number;
    watered?: boolean;
    composted?: boolean;
    harvestsRemaining?: number;
}

export interface FarmingSaveState {
    patches: Record<string, FarmingPatchState>;
}

export function patchKey(position: { x: number; y: number; level: number }): string {
    return `${position.x},${position.y},${position.level}`;
}

export function getFarmingState(player: Player): FarmingSaveState {
    if (!player.savedMetadata.farming) {
        player.savedMetadata.farming = { patches: {} };
    }
    const state = player.savedMetadata.farming as FarmingSaveState;
    if (!state.patches) {
        state.patches = {};
    }
    return state;
}

export function getPatchState(player: Player, key: string): FarmingPatchState {
    const state = getFarmingState(player);
    if (!state.patches[key]) {
        state.patches[key] = { status: 'weeds' };
    }
    return state.patches[key];
}

export function setPatchState(player: Player, key: string, patchState: FarmingPatchState): void {
    getFarmingState(player).patches[key] = patchState;
}

export function clearPatchState(player: Player, key: string): void {
    getFarmingState(player).patches[key] = { status: 'empty' };
}
