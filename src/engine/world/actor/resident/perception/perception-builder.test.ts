import { activeWorld } from '@engine/world';
import type { Player } from '@engine/world/actor/player/player';
import { Position } from '@engine/world/position';
import { PerceptionBuilder } from './perception-builder';

jest.mock('@engine/world', () => ({
    activeWorld: {
        tickCount: 123,
        findNearbyPlayers: jest.fn(() => []),
        findNearbyNpcs: jest.fn(() => []),
        findObjectAtLocation: jest.fn(),
        chunkManager: {
            getChunkForWorldPosition: jest.fn(),
            getSurroundingChunks: jest.fn(),
        },
    },
}));

jest.mock('@engine/world/actor/trade/trade-engine', () => ({
    TradeEngine: {
        activeSessionFor: jest.fn(() => null),
    },
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

describe('PerceptionBuilder', () => {
    it('keeps active static objects resolved by the world lookup', () => {
        const tree = { objectId: 1278, x: 3205, y: 3213, level: 0, orientation: 0 };
        const chunk = { filestoreLandscapeObjects: new Map([['tree', tree]]) };
        const instance = instanceWithSpawnedObjects([]);
        const player = playerAt({ x: 3204, y: 3212, level: 0 }, instance);

        jest.mocked(activeWorld.chunkManager.getChunkForWorldPosition).mockReturnValue(chunk as never);
        jest.mocked(activeWorld.chunkManager.getSurroundingChunks).mockReturnValue([chunk] as never);
        jest.mocked(activeWorld.findObjectAtLocation).mockReturnValue({ object: tree, cacheOriginal: true } as never);

        const perception = new PerceptionBuilder({ visionRange: 18 }).buildForPlayer(player);

        expect(perception.nearby.objects).toContainEqual({
            objectId: 1278,
            position: { x: 3205, y: 3213, level: 0 },
            orientation: 0,
        });
    });

    it('dedupes an active object that also appears as a spawned instance object', () => {
        const openDoor = { objectId: 1517, x: 3216, y: 3218, level: 0, orientation: 3 };
        const chunk = { filestoreLandscapeObjects: new Map([['open-door', openDoor]]) };
        const instance = instanceWithSpawnedObjects([openDoor]);
        const player = playerAt({ x: 3204, y: 3212, level: 0 }, instance);

        jest.mocked(activeWorld.chunkManager.getChunkForWorldPosition).mockReturnValue(chunk as never);
        jest.mocked(activeWorld.chunkManager.getSurroundingChunks).mockReturnValue([chunk] as never);
        jest.mocked(activeWorld.findObjectAtLocation).mockReturnValue({ object: openDoor, cacheOriginal: false } as never);

        const perception = new PerceptionBuilder({ visionRange: 18 }).buildForPlayer(player);

        const matchingDoors = perception.nearby.objects.filter(
            object => object.objectId === 1517 && object.position.x === 3216 && object.position.y === 3218,
        );
        expect(matchingDoors).toHaveLength(1);
    });

    it('does not expose hidden original objects after an instance replacement', () => {
        const closedDoor = { objectId: 1516, x: 3217, y: 3218, level: 0, orientation: 0 };
        const openDoor = { objectId: 1517, x: 3216, y: 3218, level: 0, orientation: 3 };
        const chunk = { filestoreLandscapeObjects: new Map([['closed-door', closedDoor]]) };
        const instance = instanceWithSpawnedObjects([openDoor]);
        const player = playerAt({ x: 3204, y: 3212, level: 0 }, instance);

        jest.mocked(activeWorld.chunkManager.getChunkForWorldPosition).mockReturnValue(chunk as never);
        jest.mocked(activeWorld.chunkManager.getSurroundingChunks).mockReturnValue([chunk] as never);
        jest.mocked(activeWorld.findObjectAtLocation).mockReturnValue({ object: null, cacheOriginal: false } as never);

        const perception = new PerceptionBuilder({ visionRange: 18 }).buildForPlayer(player);

        expect(perception.nearby.objects).toContainEqual({
            objectId: 1517,
            position: { x: 3216, y: 3218, level: 0 },
            orientation: 3,
        });
        expect(perception.nearby.objects).not.toContainEqual(
            expect.objectContaining({
                objectId: 1516,
                position: { x: 3217, y: 3218, level: 0 },
            }),
        );
    });

    it('exposes quest progress in resident perception', () => {
        const instance = instanceWithSpawnedObjects([]);
        const player = {
            ...playerAt({ x: 3208, y: 3215, level: 0 }, instance),
            quests: [
                { questId: 'rs:cooks_assistant', progress: 50, complete: false },
                { questId: 'rs:done', progress: 'complete', complete: true },
            ],
        } as unknown as Player;

        const perception = new PerceptionBuilder({ visionRange: 18 }).buildForPlayer(player);

        expect(perception.resident.quests).toEqual({
            'rs:cooks_assistant': { progress: 50, complete: false },
            'rs:done': { progress: 'complete', complete: true },
        });
    });
});

function instanceWithSpawnedObjects(spawnedObjects: unknown[]): Player['instance'] {
    return {
        instanceId: 'main',
        chunkModifications: new Map([
            [
                'chunk',
                {
                    mods: new Map([
                        [
                            'tile',
                            {
                                spawnedObjects,
                                hiddenObjects: [],
                                worldItems: [],
                            },
                        ],
                    ]),
                },
            ],
        ]),
    } as unknown as Player['instance'];
}

function playerAt(position: { x: number; y: number; level: number }, instance: Player['instance']): Player {
    return {
        type: 'player',
        username: 'Codex',
        position: new Position(position.x, position.y, position.level),
        instance,
        personalInstance: instanceWithSpawnedObjects([]),
        metadata: {},
        busy: false,
        inCombat: false,
        inventory: { items: [] },
        equipment: { items: [] },
        equals: jest.fn(() => false),
        skills: {
            hitpoints: { level: 10 },
            values: [],
            getMaxLevel: jest.fn(() => 10),
            getLevel: jest.fn(() => 1),
            getCombatLevel: jest.fn(() => 3.4),
        },
    } as unknown as Player;
}
