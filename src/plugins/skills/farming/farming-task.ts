import { Task } from '@engine/task/task';
import { TaskStackGroup, TaskStackType } from '@engine/task/types';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import type { LandscapeObject } from '@runejs/filestore';
import { cropReady, unixGrowthTick } from './farming-clock';
import type { FarmingCropDefinition } from './farming-config';
import { farmingTools, getCrop } from './farming-config';
import { getPatchState, patchKey, setPatchState } from './farming-state';

export type FarmingAction = 'rake' | 'plant' | 'water' | 'compost' | 'harvest' | 'clear';

export class FarmingTask extends Task {
    private elapsedTicks = 0;
    private locked = false;

    public constructor(
        private readonly player: Player,
        private readonly object: LandscapeObject,
        private readonly action: FarmingAction,
        private readonly crop?: FarmingCropDefinition,
    ) {
        super({
            interval: 1,
            repeat: true,
            immediate: true,
            stackType: TaskStackType.NEVER,
            stackGroup: TaskStackGroup.ACTION,
        });
    }

    public execute(): void {
        if (!this.locked) {
            if (this.player.busy) {
                this.stop();
                return;
            }
            this.locked = true;
            this.player.busy = true;
        }

        this.elapsedTicks++;
        if (this.elapsedTicks < 2) {
            return;
        }

        if (this.action === 'rake') {
            this.rake();
        } else if (this.action === 'plant') {
            this.plant();
        } else if (this.action === 'water') {
            this.water();
        } else if (this.action === 'compost') {
            this.compost();
        } else if (this.action === 'harvest') {
            this.harvest();
        } else {
            this.clear();
        }
        this.stop();
    }

    private rake(): void {
        const key = patchKey(this.object);
        const state = getPatchState(this.player, key);
        if (state.status !== 'weeds') {
            this.player.sendMessage('This patch does not need raking.');
            return;
        }
        if (!this.player.inventory.has(farmingTools.rake)) {
            this.player.sendMessage('You need a rake to clear this patch.');
            return;
        }
        setPatchState(this.player, key, { status: 'empty' });
        this.player.sendMessage('You clear the weeds from the patch.');
        this.player.personalInstance.replaceGameObject(8551, this.object);
    }

    private plant(): void {
        const crop = this.crop;
        if (!crop) {
            return;
        }
        const key = patchKey(this.object);
        const state = getPatchState(this.player, key);
        if (state.status !== 'empty') {
            this.player.sendMessage('You need an empty patch before you can plant seeds.');
            return;
        }
        if (!this.player.skills.hasLevel(Skill.FARMING, crop.level)) {
            this.player.sendMessage(`You need a Farming level of ${crop.level} to plant ${crop.name}.`, true);
            return;
        }
        if (!this.player.inventory.has(farmingTools.seedDibber)) {
            this.player.sendMessage('You need a seed dibber to plant seeds.');
            return;
        }
        if (this.player.inventory.amount(crop.seedItemId) < crop.seedAmount) {
            this.player.sendMessage(`You need ${crop.seedAmount} seeds to plant ${crop.name}.`);
            return;
        }
        removeItemAmount(this.player, crop.seedItemId, crop.seedAmount);
        setPatchState(this.player, key, {
            status: 'planted',
            crop: crop.key,
            plantedAtTick: unixGrowthTick(),
            watered: false,
            harvestsRemaining: randomYield(crop),
        });
        this.player.skills.addExp(Skill.FARMING, crop.plantXp);
        this.player.sendMessage(`You plant some ${crop.name} seeds.`);
        this.player.personalInstance.replaceGameObject(crop.objectIds.planted, this.object);
    }

    private water(): void {
        const key = patchKey(this.object);
        const state = getPatchState(this.player, key);
        const crop = getCrop(state.crop);
        if (state.status !== 'planted' || !crop) {
            this.player.sendMessage('There is nothing here that needs watering.');
            return;
        }
        if (!farmingTools.wateringCans.some(can => this.player.inventory.has(can))) {
            this.player.sendMessage('You need a watering can to water this patch.');
            return;
        }
        state.watered = true;
        setPatchState(this.player, key, state);
        this.player.sendMessage('You water the patch.');
        if (crop.objectIds.watered) {
            this.player.personalInstance.replaceGameObject(crop.objectIds.watered, this.object);
        }
    }

    private compost(): void {
        const key = patchKey(this.object);
        const state = getPatchState(this.player, key);
        if (state.status !== 'empty') {
            this.player.sendMessage('You can only compost an empty patch.');
            return;
        }
        const slot = this.player.inventory.removeFirst(farmingTools.compost);
        if (slot === -1) {
            this.player.sendMessage('You need compost to treat this patch.');
            return;
        }
        state.composted = true;
        setPatchState(this.player, key, state);
        this.player.sendMessage('You treat the patch with compost.');
    }

    private harvest(): void {
        const key = patchKey(this.object);
        const state = getPatchState(this.player, key);
        const crop = getCrop(state.crop);
        if (
            state.status !== 'planted' ||
            !crop ||
            state.plantedAtTick === undefined ||
            !cropReady(crop, state.plantedAtTick, unixGrowthTick())
        ) {
            this.player.sendMessage('There is nothing ready to harvest here.');
            return;
        }
        if (!this.player.inventory.hasSpace() && !this.player.inventory.has(crop.produceItemId)) {
            this.player.sendMessage('You need more inventory space to harvest this crop.', true);
            return;
        }
        this.player.giveItem({ itemId: crop.produceItemId, amount: 1 });
        this.player.skills.addExp(Skill.FARMING, crop.harvestXp);
        const remaining = Math.max(0, (state.harvestsRemaining ?? 1) - 1);
        if (remaining > 0) {
            state.harvestsRemaining = remaining;
            setPatchState(this.player, key, state);
            this.player.sendMessage(`You harvest some ${crop.name}.`);
            return;
        }
        setPatchState(this.player, key, { status: 'empty' });
        this.player.sendMessage(`You harvest the last of the ${crop.name}.`);
        this.player.personalInstance.replaceGameObject(8551, this.object);
    }

    private clear(): void {
        const key = patchKey(this.object);
        const state = getPatchState(this.player, key);
        if (state.status === 'empty' || state.status === 'weeds') {
            this.player.sendMessage('There is nothing to clear from this patch.');
            return;
        }
        if (!this.player.inventory.has(farmingTools.spade)) {
            this.player.sendMessage('You need a spade to clear this patch.');
            return;
        }
        setPatchState(this.player, key, { status: 'empty' });
        this.player.sendMessage('You clear the patch.');
        this.player.personalInstance.replaceGameObject(8551, this.object);
    }

    public onStop(): void {
        this.player.busy = false;
    }
}

function randomYield(crop: FarmingCropDefinition): number {
    return crop.minYield + Math.floor(Math.random() * (crop.maxYield - crop.minYield + 1));
}

function removeItemAmount(player: Player, itemId: number, amount: number): void {
    let remaining = amount;
    while (remaining > 0) {
        const slot = player.inventory.findIndex(itemId);
        if (slot === -1) {
            return;
        }

        const item = player.inventory.items[slot];
        if (!item) {
            return;
        }

        if (item.amount > remaining) {
            player.inventory.set(slot, { itemId, amount: item.amount - remaining });
            return;
        }

        remaining -= item.amount;
        player.inventory.remove(slot);
    }
}
