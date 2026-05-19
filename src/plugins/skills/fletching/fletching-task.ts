import { findItem, widgets } from '@engine/config/config-handler';
import { ActorTask } from '@engine/task/impl/actor-task';
import { TaskBreakType, TaskStackGroup, TaskStackType } from '@engine/task/types';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import type { Item } from '@engine/world/items/item';
import { logger } from '@runejs/common';
import type { Fletchable } from './fletching-types';

function hasIngredient(player: Player, ingredient: Item): boolean {
    return player.inventory.amount(ingredient.itemId) >= ingredient.amount;
}

function removeIngredient(player: Player, ingredient: Item): void {
    let remaining = ingredient.amount;

    while (remaining > 0) {
        const slot = player.inventory.findIndex(ingredient.itemId);
        const item = player.inventory.items[slot];

        if (slot === -1 || !item) {
            return;
        }

        if (item.amount > remaining) {
            player.inventory.set(slot, { itemId: item.itemId, amount: item.amount - remaining });
            player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
            return;
        }

        remaining -= item.amount;
        player.removeItem(slot);
    }
}

export class FletchingTask extends ActorTask<Player> {
    private elapsedTicks = 0;
    private created = 0;

    public constructor(
        player: Player,
        private readonly recipe: Fletchable,
        private readonly amount: number,
    ) {
        super(player, {
            breakTypes: [TaskBreakType.ON_MOVE],
            stackGroup: TaskStackGroup.ACTION,
            stackType: TaskStackType.NEVER,
        });
    }

    public execute(): void {
        if (this.created >= this.amount) {
            this.stop();
            return;
        }

        if (this.elapsedTicks++ % 3 !== 0) {
            return;
        }

        const output = findItem(this.recipe.item.itemId);
        if (!output) {
            logger.error(`Could not find fletching output item ${this.recipe.item.itemId}.`);
            this.actor.sendMessage(`Could not find fletching output ${this.recipe.item.itemId}. Please tell a dev.`);
            this.stop();
            return;
        }

        if (!this.actor.skills.hasLevel(Skill.FLETCHING, this.recipe.level)) {
            this.actor.sendMessage(`You need a fletching level of ${this.recipe.level} to make ${output.name.toLowerCase()}.`, true);
            this.stop();
            return;
        }

        for (const toolId of this.recipe.toolIds || []) {
            if (!this.actor.inventory.has(toolId)) {
                this.actor.sendMessage(`You need a ${findItem(toolId)?.name.toLowerCase() || 'tool'} to do that.`, true);
                this.stop();
                return;
            }
        }

        const missingIngredient = this.recipe.ingredient.find(ingredient => !hasIngredient(this.actor, ingredient));
        if (missingIngredient) {
            this.actor.sendMessage(`You don't have enough ${findItem(missingIngredient.itemId)?.name.toLowerCase() || 'materials'}.`, true);
            this.stop();
            return;
        }

        const replacementSlot =
            this.recipe.ingredient.length === 1 && this.recipe.ingredient[0].amount === 1
                ? this.actor.inventory.findIndex(this.recipe.ingredient[0].itemId)
                : -1;

        if (replacementSlot === -1 && !this.actor.inventory.canFit(this.recipe.item)) {
            this.actor.sendMessage("You don't have enough inventory space.", true);
            this.stop();
            return;
        }

        for (const ingredient of this.recipe.ingredient) {
            removeIngredient(this.actor, ingredient);
        }

        if (replacementSlot !== -1) {
            this.actor.inventory.set(replacementSlot, this.recipe.item);
            this.actor.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, this.actor.inventory);
        } else {
            this.actor.giveItem(this.recipe.item);
        }

        this.actor.skills.addExp(Skill.FLETCHING, this.recipe.experience);
        this.actor.sendMessage(this.recipe.message || `You make ${output.name.toLowerCase()}.`);
        this.created++;
    }
}
