import { ActorTask } from '@engine/task/impl/actor-task';
import { TaskBreakType, TaskStackGroup, TaskStackType } from '@engine/task/types';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { animationIds } from '@engine/world/config/animation-ids';
import { itemIds } from '@engine/world/config/item-ids';
import { soundIds } from '@engine/world/config/sound-ids';

export class ShearingTask extends ActorTask<Player> {
    private elapsedTicks = 0;

    public constructor(
        player: Player,
        private readonly npc: Npc,
    ) {
        super(player, {
            breakTypes: [TaskBreakType.ON_MOVE],
            stackGroup: TaskStackGroup.ACTION,
            stackType: TaskStackType.NEVER,
        });
    }

    public execute(): void {
        if (this.elapsedTicks++ === 0) {
            this.actor.busy = true;
            this.actor.playAnimation(animationIds.shearSheep);
            this.actor.playSound(soundIds.shearSheep, 5);
            this.npc.face(this.actor.position);
            return;
        }

        if (!this.actor.giveItem(itemIds.wool)) {
            this.actor.sendMessage("You don't have enough inventory space.");
            this.stop();
            return;
        }

        this.actor.sendMessage('You get some wool.');
        this.npc.say('Baa!');
        this.npc.playSound(soundIds.sheepBaa, 4);
        this.stop();
    }

    public onStop(): void {
        super.onStop();
        this.actor.busy = false;
    }
}
