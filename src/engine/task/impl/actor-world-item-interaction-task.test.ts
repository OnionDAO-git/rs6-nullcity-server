jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

import { Subject } from 'rxjs';
import { Position } from '../../world/position';
import { ActorWorldItemInteractionTask } from './actor-world-item-interaction-task';

describe('ActorWorldItemInteractionTask', () => {
    it('does not queue a walk that can cancel the task when the actor is already in range', () => {
        const walkTo = jest.fn();
        const actor = {
            active: true,
            position: new Position(3200, 3200, 0),
            pathfinding: { walkTo },
            walkingQueue: { movementQueued$: new Subject() },
        };
        const worldItem = {
            itemId: 1511,
            amount: 1,
            position: new Position(3200, 3200, 0),
            removed: false,
            instance: {},
        } as any;

        const task = new ProbeWorldItemTask(actor, worldItem);
        task.execute();

        expect(walkTo).not.toHaveBeenCalled();
        expect(task.exposedWorldItem).toBe(worldItem);
    });
});

class ProbeWorldItemTask extends ActorWorldItemInteractionTask<any> {
    exposedWorldItem: unknown = null;

    public execute(): void {
        super.execute();
        this.exposedWorldItem = this.worldItem;
    }
}
