import { Task } from '@engine/task/task';
import { TaskStackGroup, TaskStackType } from '@engine/task/types';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { DamageType } from '@engine/world/actor/update-flags';
import { animationIds } from '@engine/world/config/animation-ids';
import { pickpocketSuccessChance, rollSuccess, selectReward } from './chance';
import type { PickpocketTarget } from './thieving-targets';

export class PickpocketTask extends Task {
    private elapsedTicks = 0;
    private locked = false;

    public constructor(
        private readonly player: Player,
        private readonly npc: Npc,
        private readonly target: PickpocketTarget,
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
            if (!this.player.skills.hasLevel(Skill.THIEVING, this.target.level)) {
                this.player.sendMessage(`You need a Thieving level of ${this.target.level} to pickpocket this target.`, true);
                this.stop();
                return;
            }
            if (!this.player.inventory.hasSpace() && this.target.rewards.some(reward => !this.player.inventory.has(reward.itemId))) {
                this.player.sendMessage('You do not have enough inventory space to hold your loot.', true);
                this.stop();
                return;
            }
            this.locked = true;
            this.player.busy = true;
            this.player.face(this.npc, false, false, false);
            this.npc.face(this.player, false, false, false);
            this.player.playAnimation(animationIds.combat.punch);
            this.player.sendMessage(`You attempt to pick the ${this.npc.name.toLowerCase()}'s pocket.`);
        }

        this.elapsedTicks++;
        if (this.elapsedTicks < this.target.actionTicks) {
            return;
        }

        const chance = pickpocketSuccessChance({
            thievingLevel: this.player.skills.thieving.level,
            targetLevel: this.target.level,
            baseChance: this.target.baseChance,
            minChance: this.target.minChance,
            levelFactor: this.target.levelFactor,
        });

        if (!rollSuccess(chance)) {
            this.fail();
            return;
        }

        const reward = selectReward(this.target.rewards);
        if (!this.player.giveItem({ itemId: reward.itemId, amount: reward.amount })) {
            this.player.sendMessage('You do not have enough inventory space to hold your loot.', true);
            this.stop();
            return;
        }

        this.player.skills.addExp(Skill.THIEVING, this.target.xp);
        this.player.sendMessage('You pick the target\'s pocket.');
        this.stop();
    }

    private fail(): void {
        this.player.sendMessage('You have been stunned!');
        if (this.target.damage > 0) {
            this.npc.applyHit(this.player, this.target.damage, DamageType.DAMAGE, 0);
        }
        this.elapsedTicks = 0;
        this.player.playAnimation(animationIds.combat.armBlock);
        this.stopAfterStun();
    }

    private stopAfterStun(): void {
        const originalExecute = this.execute.bind(this);
        this.execute = () => {
            this.elapsedTicks++;
            if (this.elapsedTicks >= this.target.stunTicks) {
                this.execute = originalExecute;
                this.stop();
            }
        };
    }

    public onStop(): void {
        this.player.busy = false;
        this.player.stopAnimation();
        this.player.clearFaceActor();
        this.npc.clearFaceActor();
    }
}
