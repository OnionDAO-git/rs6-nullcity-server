import type { Player } from '@engine/world/actor/player/player';
import type { LandscapeObject } from '@runejs/filestore';
import { cropReady } from './farming-clock';
import { getCrop, getPatchByObjectId } from './farming-config';
import type { FarmingPatchState } from './farming-state';
import { getFarmingState, getPatchState, patchKey, setPatchState } from './farming-state';

export function getObjectPatchState(player: Player, object: LandscapeObject): FarmingPatchState {
    const key = patchKey(object);
    const hasPersistedState = Object.prototype.hasOwnProperty.call(getFarmingState(player).patches, key);
    const state = getPatchState(player, key);
    const patch = getPatchByObjectId(object.objectId);
    if (!hasPersistedState && patch?.objectIds.empty.includes(object.objectId)) {
        const initialState: FarmingPatchState = { status: 'empty' };
        setPatchState(player, key, initialState);
        return initialState;
    }
    return state;
}

export function visiblePatchObjectId(state: FarmingPatchState, currentObjectId: number, nowTick: number): number {
    if (state.status === 'empty' || state.status === 'weeds') {
        return currentObjectId;
    }
    if (state.status === 'dead') {
        const crop = getCrop(state.crop);
        return crop?.objectIds.dead ?? currentObjectId;
    }

    const crop = getCrop(state.crop);
    if (!crop || state.plantedAtTick === undefined) {
        return currentObjectId;
    }
    if (cropReady(crop, state.plantedAtTick, nowTick)) {
        return crop.objectIds.grown;
    }
    return state.watered && crop.objectIds.watered ? crop.objectIds.watered : crop.objectIds.planted;
}

export function syncPatchObject(player: Player, object: LandscapeObject, nowTick: number): void {
    const state = getObjectPatchState(player, object);
    const visibleObjectId = visiblePatchObjectId(state, object.objectId, nowTick);
    if (visibleObjectId !== object.objectId) {
        player.personalInstance.replaceGameObject(visibleObjectId, object);
    }
}
