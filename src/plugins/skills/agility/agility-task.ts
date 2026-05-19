import { ActorLandscapeObjectInteractionTask } from '@engine/task/impl/actor-landscape-object-interaction-task';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { DamageType } from '@engine/world/actor/update-flags';
import { Position } from '@engine/world/position';
import type { LandscapeObject } from '@runejs/filestore';
import type { AgilityObstacle, AgilityRouteStep } from './agility-config';
import { recordAgilityObstacle } from './agility-state';

function failRoll(obstacle: AgilityObstacle, level: number): boolean {
    if (!obstacle.fail) {
        return false;
    }
    const reduction = Math.max(0, level - obstacle.level) * (obstacle.fail.levelReduction ?? 0);
    const chance = Math.max(obstacle.fail.minChance ?? 0, obstacle.fail.chance - reduction);
    return Math.random() < chance;
}

function stepToPosition(start: Position, step: AgilityRouteStep): Position {
    return new Position(start.x + step.x, start.y + step.y, step.level ?? start.level);
}

export class AgilityTask extends ActorLandscapeObjectInteractionTask<Player> {
    private elapsedTicks = 0;
    private started = false;
    private failed = false;
    private startPosition: Position | null = null;
    private route: AgilityRouteStep[];

    public constructor(
        player: Player,
        landscapeObject: LandscapeObject,
        private readonly obstacle: AgilityObstacle,
    ) {
        super(player, landscapeObject);
        this.route = obstacle.route;
    }

    public execute(): void {
        super.execute();

        const object = this.landscapeObject;
        if (!object) {
            return;
        }

        if (!this.started) {
            if (!this.actor.skills.hasLevel(Skill.AGILITY, this.obstacle.level)) {
                this.actor.sendMessage(`You need an Agility level of ${this.obstacle.level} to use this obstacle.`, true);
                this.stop();
                return;
            }

            this.started = true;
            this.actor.metadata.blockObjectInteractions = true;
            this.actor.busy = true;
            this.startPosition = this.actor.position.copy();
            this.actor.face(new Position(object.x, object.y, object.level));
            if (this.obstacle.animation !== undefined) {
                this.actor.playAnimation(this.obstacle.animation);
            }

            this.failed = failRoll(this.obstacle, this.actor.skills.agility.level);
            if (this.failed) {
                this.route = this.obstacle.fail?.route ?? [];
            }
        }

        this.elapsedTicks++;
        const ticksPerStep = Math.max(1, this.obstacle.ticks ?? 1);
        if (this.elapsedTicks % ticksPerStep !== 0) {
            return;
        }

        const currentStep = this.route.shift();
        if (currentStep && this.startPosition) {
            this.actor.position = stepToPosition(this.startPosition, currentStep);
            return;
        }

        if (this.failed) {
            this.actor.sendMessage(this.obstacle.fail?.message ?? 'You fail to complete the obstacle.');
            if (this.obstacle.fail?.damage) {
                this.actor.applyHit(this.actor, this.obstacle.fail.damage, DamageType.DAMAGE, 0);
            }
            this.stop();
            return;
        }

        if (this.obstacle.successMessage) {
            this.actor.sendMessage(this.obstacle.successMessage);
        }
        this.actor.skills.addExp(Skill.AGILITY, this.obstacle.xp);
        recordAgilityObstacle(this.actor, this.obstacle);
        this.stop();
    }

    public onStop(): void {
        delete this.actor.metadata.blockObjectInteractions;
        this.actor.busy = false;
        this.actor.stopAnimation();
    }
}
