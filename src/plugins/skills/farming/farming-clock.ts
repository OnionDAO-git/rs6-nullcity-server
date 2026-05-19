import type { FarmingCropDefinition } from './farming-config';

export function growthTicksElapsed(plantedAtTick: number, nowTick: number): number {
    return Math.max(0, nowTick - plantedAtTick);
}

export function growthStage(crop: FarmingCropDefinition, plantedAtTick: number, nowTick: number): number {
    let elapsed = growthTicksElapsed(plantedAtTick, nowTick);
    for (let stage = 0; stage < crop.growthStageTicks.length; stage++) {
        elapsed -= crop.growthStageTicks[stage];
        if (elapsed < 0) {
            return stage;
        }
    }
    return crop.growthStageTicks.length;
}

export function cropReady(crop: FarmingCropDefinition, plantedAtTick: number, nowTick: number): boolean {
    return growthStage(crop, plantedAtTick, nowTick) >= crop.growthStageTicks.length;
}

export function unixGrowthTick(date: Date = new Date(), tickMillis = 600): number {
    return Math.floor(date.getTime() / tickMillis);
}
