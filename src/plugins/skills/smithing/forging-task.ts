import { widgets } from '@engine/config/config-handler';
import { findItem } from '@engine/config/config-handler';
import { ActorTask } from '@engine/task/impl/actor-task';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { itemIds } from '@engine/world/config/item-ids';
import type { Smithable } from './forging-types';

/**
 * A task that handles the forging of an item.
 *
 * Operates repeatedly every 4 ticks, and stops when the player has forged the amount they wanted.
 *
 * @author jameskmonger
 */
export class ForgingTask extends ActorTask<Player> {
    private elapsedTicks = 0;
    private amountForged = 0;

    constructor(
        player: Player,
        private readonly smithable: Smithable,
        private readonly amount: number,
    ) {
        super(player);
    }

    public execute(): void {
        const taskIteration = this.elapsedTicks++;

        // completed the task if we've forged the amount we wanted
        if (this.amountForged >= this.amount) {
            this.stop();
            return;
        }

        // TODO (Jameskmonger) remove magic number
        this.actor.playAnimation(898);

        // only do something every 4 ticks
        if (taskIteration % 4 !== 0) {
            return;
        }

        // can't continue
        if (!this.actor.inventory.has(itemIds.hammer)) {
            this.actor.sendMessage('You need a hammer to work the metal with.', true);
            this.stop();
            return;
        }

        if (!this.hasLevel()) {
            const item = findItem(this.smithable.item.itemId);
            this.actor.sendMessage(`You have to be at least level ${this.smithable.level} to smith ${item?.name || 'that item'}.`, true);
            this.stop();
            return;
        }

        if (!this.hasMaterials()) {
            const ingredient = findItem(this.smithable.ingredient.itemId);
            this.actor.sendMessage(`You don't have enough ${ingredient?.name || 'bars'}.`, true);
            this.stop();
            return;
        }

        // Remove ingredients
        for (let i = 0; i < this.smithable.ingredient.amount; i++) {
            this.actor.inventory.removeFirst(this.smithable.ingredient.itemId);
        }

        // Add item to inventory
        this.actor.inventory.add({
            itemId: this.smithable.item.itemId,
            amount: this.smithable.item.amount,
        });

        this.actor.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, this.actor.inventory);
        this.actor.skills.addExp(Skill.SMITHING, this.smithable.experience);

        this.amountForged++;
    }

    /**
     * Whether the player has the required materials to forge the item.
     * @returns {boolean} True if the player has the required materials, false otherwise.
     */
    private hasMaterials() {
        return this.smithable.ingredient.amount <= this.actor.inventory.amount(this.smithable.ingredient.itemId);
    }

    private hasLevel() {
        return this.actor.skills.hasLevel(Skill.SMITHING, this.smithable.level);
    }
}
