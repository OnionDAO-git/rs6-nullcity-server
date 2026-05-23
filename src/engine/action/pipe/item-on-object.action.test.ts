import { Subject } from 'rxjs';
import itemOnObjectActionPipe from './item-on-object.action';

jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(() => ({ rendering: { sizeX: 1, sizeY: 1 } })),
            },
        },
    },
}));

jest.mock('@engine/action/hook/action-hook', () => ({
    getActionHooks: jest.fn(),
}));

jest.mock('@engine/action/hook/hook-filters', () => {
    const matches = (allowed: number | number[], value: number) => (Array.isArray(allowed) ? allowed.includes(value) : allowed === value);

    return {
        advancedNumberHookFilter: jest.fn((allowed: number | number[], value: number) => matches(allowed, value)),
        questHookFilter: jest.fn(() => true),
    };
});

jest.mock('@engine/world', () => ({
    activeWorld: {
        findObjectAtLocation: jest.fn(() => ({ object: {} })),
    },
}));

import { getActionHooks } from '@engine/action/hook/action-hook';
import { Position } from '@engine/world/position';

describe('itemOnObjectActionPipe', () => {
    const objectConfig = { gameId: 1, name: 'Fire' };
    const item = { itemId: 317, amount: 1 };
    const hook = {
        type: 'item_on_object',
        objectIds: 1,
        itemIds: 317,
        walkTo: true,
        handler: jest.fn(),
    };

    beforeEach(() => {
        hook.handler.mockClear();
        (getActionHooks as jest.Mock).mockReturnValue([hook]);
    });

    const playerAt = (position: Position) => ({
        position,
        enqueueBaseTask: jest.fn(),
        outgoingPackets: { chatboxMessage: jest.fn() },
        pathfinding: { walkTo: jest.fn() },
        walkingQueue: { movementQueued$: new Subject() },
    });

    const objectAt = (position: Position) => ({
        objectId: 1,
        x: position.x,
        y: position.y,
        level: position.level,
        type: 10,
        orientation: 0,
    });

    it('runs walk-to hooks immediately when the player is already diagonally in range of the target object', () => {
        const player = playerAt(new Position(3240, 3243, 0));
        const object = objectAt(new Position(3241, 3242, 0));
        const position = new Position(object.x, object.y, object.level);

        const result = (itemOnObjectActionPipe[1] as (...args: unknown[]) => unknown)(
            player,
            object,
            objectConfig,
            position,
            item,
            149,
            93,
            true,
        );

        expect(player.enqueueBaseTask).not.toHaveBeenCalled();
        expect(result).toEqual({
            hooks: [hook],
            action: {
                player,
                object,
                objectConfig,
                position,
                item,
                itemWidgetId: 149,
                itemContainerId: 93,
                cacheOriginal: true,
            },
        });
    });

    it('still enqueues a walk-to task when the player is outside item-on-object interaction range', () => {
        const player = playerAt(new Position(3238, 3242, 0));
        const object = objectAt(new Position(3241, 3242, 0));

        const result = (itemOnObjectActionPipe[1] as (...args: unknown[]) => unknown)(
            player,
            object,
            objectConfig,
            new Position(object.x, object.y, object.level),
            item,
            149,
            93,
            true,
        );

        expect(result).toBeNull();
        expect(player.enqueueBaseTask).toHaveBeenCalledTimes(1);
    });
});
