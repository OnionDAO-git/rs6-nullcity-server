import { findItem } from '@engine/config/config-handler';
import { Position } from '@engine/world/position';
import { Subject } from 'rxjs';
import { FISHING_METHODS } from './fishing-data';
import { FishingTask } from './fishing-task';

jest.mock('@engine/config/config-handler', () => ({
    findItem: jest.fn(),
    widgets: { inventory: { widgetId: 3214, containerId: 0 } },
}));

jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

describe('FishingTask', () => {
    beforeEach(() => {
        jest.mocked(findItem).mockImplementation((key: string) => {
            if (key === 'rs:small_fishing_net') {
                return { gameId: 303, key, name: 'Small fishing net' } as never;
            }
            if (key === 'rs:raw_shrimp') {
                return { gameId: 317, key, name: 'Raw shrimp' } as never;
            }
            return null;
        });
    });

    it('marks the actor busy while fishing and clears busy when stopped', () => {
        const player = {
            busy: false,
            position: new Position(3235, 3241, 0),
            walkingQueue: { movementQueued$: new Subject() },
            skills: {
                fishing: { level: 1 },
                hasLevel: jest.fn(() => true),
                addExp: jest.fn(),
            },
            inventory: {
                has: jest.fn(() => true),
                hasSpace: jest.fn(() => true),
            },
            sendMessage: jest.fn(),
            face: jest.fn(),
            playAnimation: jest.fn(),
            playSound: jest.fn(),
            stopAnimation: jest.fn(),
            giveItem: jest.fn(() => true),
        };
        const npc = {
            key: 'rs:fishing_spot_net_bait',
            exists: true,
            position: new Position(3239, 3244, 0),
        };

        const task = new FishingTask(player as never, npc as never, FISHING_METHODS.net);

        task.execute();

        expect(player.busy).toBe(true);
        expect(player.sendMessage).toHaveBeenCalledWith('You start fishing.');

        task.stop();

        expect(player.busy).toBe(false);
        expect(player.stopAnimation).toHaveBeenCalled();
    });
});
