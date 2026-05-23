import { Subject } from 'rxjs';
import objectInteractionActionPipe from './object-interaction.action';

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
    const matches = (allowed: number | number[] | string | string[], value: number | string) =>
        Array.isArray(allowed) ? allowed.includes(value as never) : allowed === value;

    return {
        advancedNumberHookFilter: jest.fn(
            (allowed: number | number[], value: number, optionAllowed?: string | string[], option?: string) =>
                optionAllowed === undefined ? matches(allowed, value) : matches(allowed, value) && matches(optionAllowed, option ?? ''),
        ),
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

describe('objectInteractionActionPipe', () => {
    const objectConfig = { gameId: 1, name: 'Range' };
    const hook = {
        type: 'object_interaction',
        objectIds: 1,
        options: 'cook',
        walkTo: true,
        handler: jest.fn(),
    };

    beforeEach(() => {
        hook.handler.mockClear();
        (getActionHooks as jest.Mock).mockReturnValue([hook]);
    });

    const playerAt = (position: Position) => ({
        metadata: { blockObjectInteractions: false },
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

    it('runs walk-to hooks immediately when the player is already diagonally in range of an object', () => {
        const player = playerAt(new Position(3207, 3212, 0));
        const object = objectAt(new Position(3208, 3213, 0));

        const result = (objectInteractionActionPipe[1] as (...args: unknown[]) => unknown)(
            player,
            object,
            objectConfig,
            new Position(object.x, object.y, object.level),
            'cook',
            true,
        );

        expect(player.enqueueBaseTask).not.toHaveBeenCalled();
        expect(result).toEqual({
            hooks: [hook],
            action: {
                player,
                object,
                objectConfig,
                option: 'cook',
                position: new Position(object.x, object.y, object.level),
                cacheOriginal: true,
            },
        });
    });

    it('still enqueues a walk-to task when the player is outside object interaction range', () => {
        const player = playerAt(new Position(3205, 3213, 0));
        const object = objectAt(new Position(3208, 3213, 0));

        const result = (objectInteractionActionPipe[1] as (...args: unknown[]) => unknown)(
            player,
            object,
            objectConfig,
            new Position(object.x, object.y, object.level),
            'cook',
            true,
        );

        expect(result).toBeNull();
        expect(player.enqueueBaseTask).toHaveBeenCalledTimes(1);
    });
});
