import { widgets } from '@engine/config/config-handler';
import { ActorActorInteractionTask } from '@engine/task/impl/actor-actor-interaction-task';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { soundIds } from '@engine/world/config/sound-ids';
import type { Item } from '@engine/world/items/item';
import { canCatchFish } from './chance';
import { getFishingRequirementIssue, resolveFishingItem, selectFishingCatch } from './fishing-data';
import type { FishingMethod } from './fishing-types';

export const FISHING_SPOT_INTERACTION_DISTANCE = 7;

export class FishingTask extends ActorActorInteractionTask<Player, Npc> {
    private elapsedTicks = 0;

    public constructor(
        player: Player,
        npc: Npc,
        private readonly method: FishingMethod,
    ) {
        super(player, npc, false, FISHING_SPOT_INTERACTION_DISTANCE);
    }

    public execute(): void {
        super.execute();

        if (!this.isActive) {
            return;
        }

        const fishingSpot = this.other;
        if (!fishingSpot || !fishingSpot.exists) {
            this.stop();
            return;
        }

        const issue = getFishingRequirementIssue(this.actor, this.method);
        if (issue) {
            this.actor.sendMessage(issue.message, issue.inventoryFull);
            if (issue.inventoryFull) {
                this.actor.playSound(soundIds.inventoryFull);
            }
            this.stop();
            return;
        }

        const taskIteration = this.elapsedTicks++;
        if (taskIteration === 0) {
            this.actor.busy = true;
            this.actor.sendMessage('You start fishing.');
            this.actor.face(fishingSpot.position);
            this.actor.playAnimation(this.method.animation);
            return;
        }

        if (taskIteration % 4 !== 0) {
            return;
        }

        this.actor.playAnimation(this.method.animation);

        const caughtFish = selectFishingCatch(this.method, this.actor.skills.fishing.level);
        if (!caughtFish) {
            this.stop();
            return;
        }

        if (!canCatchFish(this.method.baseChance, caughtFish.level, this.actor.skills.fishing.level)) {
            return;
        }

        if (this.method.consumableItemConfigId) {
            this.removeOneConsumable(resolveFishingItem(this.method.consumableItemConfigId).gameId);
        }

        const fishItem = resolveFishingItem(caughtFish.itemConfigId);
        if (!this.actor.giveItem(fishItem.gameId)) {
            this.actor.sendMessage('Your inventory is too full to hold any more fish.', true);
            this.actor.playSound(soundIds.inventoryFull);
            this.stop();
            return;
        }

        this.actor.sendMessage(`You catch some ${fishItem.name.toLowerCase()}.`);
        this.actor.skills.addExp(Skill.FISHING, caughtFish.experience);
    }

    private removeOneConsumable(itemId: number): void {
        const slot = this.actor.inventory.findIndex(itemId);
        if (slot === -1) {
            return;
        }

        const item = this.actor.inventory.items[slot] as Item;
        if (item.amount <= 1) {
            this.actor.removeFirstItem(itemId);
            return;
        }

        const updatedItem = { itemId: item.itemId, amount: item.amount - 1 };
        this.actor.inventory.set(slot, updatedItem, false);
        this.actor.outgoingPackets.sendUpdateSingleWidgetItem(widgets.inventory, slot, updatedItem);
    }

    public onStop(): void {
        super.onStop();

        this.actor.stopAnimation();
        this.actor.busy = false;
    }
}
