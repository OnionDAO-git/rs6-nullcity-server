import { Subject } from 'rxjs';
import npcInteractionActionPipe from './npc-interaction.action';

jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

jest.mock('@engine/action/hook/action-hook', () => ({
    getActionHooks: jest.fn(),
}));

jest.mock('@engine/action/hook/hook-filters', () => ({
    questHookFilter: jest.fn(() => true),
    stringHookFilter: jest.fn((allowed: string | string[], value: string) =>
        Array.isArray(allowed) ? allowed.includes(value) : allowed === value,
    ),
}));

import { getActionHooks } from '@engine/action/hook/action-hook';
import { Position } from '@engine/world/position';

describe('npcInteractionActionPipe', () => {
    const hook = {
        type: 'npc_interaction',
        npcs: 'rs:fishing_spot_net_bait',
        options: 'net',
        walkTo: true,
        handler: jest.fn(),
    };

    beforeEach(() => {
        hook.handler.mockClear();
        (getActionHooks as jest.Mock).mockReturnValue([hook]);
    });

    const playerAt = (position: Position) => ({
        busy: false,
        position,
        getMorphedNpcDetails: jest.fn(() => undefined),
        enqueueBaseTask: jest.fn(),
        pathfinding: { walkTo: jest.fn() },
        outgoingPackets: { chatboxMessage: jest.fn() },
        walkingQueue: { movementQueued$: new Subject() },
    });

    const npcAt = (position: Position) => ({
        key: 'rs:fishing_spot_net_bait',
        id: 69,
        position,
    });

    it('runs walk-to hooks immediately when the player is already diagonally in range', () => {
        const player = playerAt(new Position(3240, 3243, 0));
        const npc = npcAt(new Position(3241, 3242, 0));

        const result = (npcInteractionActionPipe[1] as (...args: unknown[]) => unknown)(player, npc, npc.position, 'net');

        expect(player.enqueueBaseTask).not.toHaveBeenCalled();
        expect(result).toEqual({
            hooks: [hook],
            action: { player, npc, position: npc.position, option: 'net' },
        });
    });

    it('still enqueues a walk-to task when the player is outside interaction range', () => {
        const player = playerAt(new Position(3238, 3242, 0));
        const npc = npcAt(new Position(3241, 3242, 0));

        const result = (npcInteractionActionPipe[1] as (...args: unknown[]) => unknown)(player, npc, npc.position, 'net');

        expect(result).toBeNull();
        expect(player.enqueueBaseTask).toHaveBeenCalledTimes(1);
        expect(player.pathfinding.walkTo).toHaveBeenCalledWith(npc.position, { pathingSearchRadius: 64 });
    });
});
