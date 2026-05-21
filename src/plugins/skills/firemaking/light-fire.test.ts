jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

import { Position } from '@engine/world/position';
import { EventEmitter } from 'events';
import { lightFire } from './light-fire';

describe('lightFire', () => {
    it('emits a resident-visible fire_lit event when logs catch', () => {
        const position = new Position(3225, 3230, 0);
        const emitPerceptionEvent = jest.fn();
        const playerEvents = new EventEmitter();
        const playerEventsSeen: unknown[] = [];
        playerEvents.on('fire_lit', event => playerEventsSeen.push(event));
        const player = {
            position,
            metadata: {},
            busy: true,
            playerEvents,
            emitPerceptionEvent,
            instance: {
                getTileModifications: jest.fn(() => ({ mods: { spawnedObjects: [] } })),
                despawnWorldItem: jest.fn(),
                spawnTemporaryGameObject: jest.fn(() => Promise.resolve()),
                spawnWorldItem: jest.fn(),
            },
            playAnimation: jest.fn(),
            sendMessage: jest.fn(),
            skills: {
                firemaking: {
                    addExp: jest.fn(),
                },
            },
            walkingQueue: {
                moveIfAble: jest.fn(() => true),
            },
            face: jest.fn(),
        };
        const worldItemLog = {
            itemId: 1511,
            amount: 1,
            position,
            instance: player.instance,
        };

        lightFire(player as any, position, worldItemLog as any, 40);

        const expectedEvent = {
            kind: 'fire_lit',
            item: { itemId: 1511, amount: 1 },
            position: { x: 3225, y: 3230, level: 0 },
            experience: 40,
        };
        expect(emitPerceptionEvent).toHaveBeenCalledWith(expectedEvent);
        expect(playerEventsSeen).toEqual([expectedEvent]);
    });
});
