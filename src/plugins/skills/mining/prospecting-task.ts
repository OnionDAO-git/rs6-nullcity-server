import { findItem } from '@engine/config/config-handler';
import { ActorLandscapeObjectInteractionTask } from '@engine/task/impl/actor-landscape-object-interaction-task';
import type { Player } from '@engine/world/actor/player/player';
import { type IHarvestable, getOreFromRock } from '@engine/world/config/harvestable-object';
import type { LandscapeObject } from '@runejs/filestore';

export class ProspectingTask extends ActorLandscapeObjectInteractionTask<Player> {
    private elapsedTicks = 0;

    public constructor(player: Player, landscapeObject: LandscapeObject, sizeX: number = 1, sizeY: number = 1) {
        super(player, landscapeObject, sizeX, sizeY);
    }

    public execute(): void {
        super.execute();

        if (!this.isActive || !this.landscapeObject) {
            return;
        }

        const taskIteration = this.elapsedTicks++;
        if (taskIteration === 0) {
            this.actor.sendMessage('You examine the rock for ores.');
            this.actor.face(this.landscapeObjectPosition);
            return;
        }

        if (taskIteration < 3) {
            return;
        }

        const ore = getOreFromRock(this.landscapeObject.objectId);
        if (!ore) {
            this.actor.sendMessage('There is currently no ore available in this rock.');
            this.stop();
            return;
        }

        const oreName = this.getOreName(ore);
        if (!oreName) {
            this.actor.sendMessage('Sorry, something went wrong. Please report this to a developer.');
            this.stop();
            return;
        }

        this.actor.sendMessage(`This rock contains ${oreName}.`);
        this.stop();
    }

    private getOreName(ore: IHarvestable): string | null {
        const itemConfigId = typeof ore.items === 'string' ? ore.items : ore.items[0].itemConfigId;
        const oreItem = findItem(itemConfigId);

        if (!oreItem) {
            return null;
        }

        return oreItem.name.toLowerCase().replace(' ore', '');
    }
}
