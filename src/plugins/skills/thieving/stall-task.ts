import { Task } from '@engine/task/task';
import { TaskStackGroup, TaskStackType } from '@engine/task/types';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import type { LandscapeObject } from '@runejs/filestore';
import { selectReward } from './chance';
import type { StallTarget } from './thieving-stalls';

export class StallTask extends Task {
    private elapsedTicks = 0;
    private locked = false;

    public constructor(
        private readonly player: Player,
        private readonly object: LandscapeObject,
        private readonly stall: StallTarget,
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
            if (!this.player.skills.hasLevel(Skill.THIEVING, this.stall.level)) {
                this.player.sendMessage(`You need a Thieving level of ${this.stall.level} to steal from this stall.`, true);
                this.stop();
                return;
            }
            if (!this.player.inventory.hasSpace()) {
                this.player.sendMessage('You do not have enough inventory space to hold your loot.', true);
                this.stop();
                return;
            }
            this.locked = true;
            this.player.busy = true;
            this.player.sendMessage('You attempt to steal from the stall.');
        }

        this.elapsedTicks++;
        if (this.elapsedTicks < this.stall.actionTicks) {
            return;
        }

        const reward = selectReward(this.stall.rewards);
        if (!this.player.giveItem({ itemId: reward.itemId, amount: reward.amount })) {
            this.player.sendMessage('You do not have enough inventory space to hold your loot.', true);
            this.stop();
            return;
        }

        this.player.skills.addExp(Skill.THIEVING, this.stall.xp);
        this.player.sendMessage('You steal from the stall.');
        if (this.stall.depletedObjectId) {
            this.player.instance.replaceGameObject(this.stall.depletedObjectId, this.object, this.stall.respawnTicks);
        }
        this.stop();
    }

    public onStop(): void {
        this.player.busy = false;
    }
}
