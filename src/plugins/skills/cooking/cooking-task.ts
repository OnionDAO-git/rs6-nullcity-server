import { findItem, widgets } from '@engine/config/config-handler';
import { ActorTask } from '@engine/task/impl/actor-task';
import { TaskBreakType, TaskStackGroup, TaskStackType } from '@engine/task/types';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { animationIds } from '@engine/world/config/animation-ids';
import { logger } from '@runejs/common';
import { shouldBurnCookable } from './cooking-data';
import type { Cookable, CookingHeatSource } from './cooking-types';

export class CookingTask extends ActorTask<Player> {
    private elapsedTicks = 0;
    private cooked = 0;

    public constructor(
        player: Player,
        private readonly cookable: Cookable,
        private readonly heatSource: CookingHeatSource,
        private readonly amount: number,
    ) {
        super(player, {
            breakTypes: [TaskBreakType.ON_MOVE],
            stackGroup: TaskStackGroup.ACTION,
            stackType: TaskStackType.NEVER,
        });
    }

    public execute(): void {
        if (this.cooked >= this.amount) {
            this.stop();
            return;
        }

        if (this.elapsedTicks++ % 3 !== 0) {
            return;
        }

        if (!this.actor.skills.hasLevel(Skill.COOKING, this.cookable.level)) {
            const cookedItem = findItem(this.cookable.cookedItemId);
            this.actor.sendMessage(`You need a cooking level of ${this.cookable.level} to cook ${cookedItem?.name.toLowerCase() || 'that'}.`, true);
            this.stop();
            return;
        }

        const inputSlot = this.actor.inventory.findIndex(this.cookable.rawItemId);
        if (inputSlot === -1) {
            const rawItem = findItem(this.cookable.rawItemId);
            this.actor.sendMessage(`You don't have any ${rawItem?.name.toLowerCase() || 'raw food'} left.`, true);
            this.stop();
            return;
        }

        const burned = shouldBurnCookable(this.cookable, this.actor.skills.getLevel(Skill.COOKING), this.heatSource);
        const outputItemId = burned ? this.cookable.burntItemId : this.cookable.cookedItemId;

        if (outputItemId === undefined) {
            logger.error(`Cooking recipe ${this.cookable.rawItemId} burned without a burnt output.`);
            this.stop();
            return;
        }

        const outputItem = findItem(outputItemId);
        if (!outputItem) {
            this.actor.sendMessage(`Could not find cooked item ${outputItemId}. Please tell a dev.`);
            logger.error(`Could not find cooking output item ${outputItemId}.`);
            this.stop();
            return;
        }

        this.actor.inventory.set(inputSlot, { itemId: outputItemId, amount: 1 });
        this.actor.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, this.actor.inventory);

        if (burned) {
            this.actor.sendMessage(`You accidentally burn the ${findItem(this.cookable.rawItemId)?.name.toLowerCase() || 'food'}.`);
        } else {
            this.actor.skills.addExp(Skill.COOKING, this.cookable.experience);
            this.actor.sendMessage(`You successfully cook the ${outputItem.name.toLowerCase()}.`);
        }

        this.actor.playAnimation(animationIds.smelting);
        this.cooked++;
    }
}
