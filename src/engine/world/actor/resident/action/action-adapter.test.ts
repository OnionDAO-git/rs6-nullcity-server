import { findItem } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import { findSpellByKey } from '@engine/world/actor/magic';
import type { Resident } from '@engine/world/actor/resident/resident';
import { filestore } from '@server/game/game-server';
import { ActionAdapter } from './action-adapter';
import type { ActorRef } from './agent-action';

const mockActionPipelineCall = jest.fn();

jest.mock('@engine/config/config-handler', () => ({
    findItem: jest.fn(),
    widgets: { inventory: { widgetId: 3214, containerId: 0 } },
}));

jest.mock('@engine/world', () => ({
    activeWorld: {
        npcList: [],
        playerList: [],
        findActivePlayerByUsername: jest.fn(),
        findObjectAtLocation: jest.fn(),
    },
}));

jest.mock('@engine/world/actor/magic', () => ({
    findSpellByKey: jest.fn(),
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

const npcRef = (): ActorRef => ({
    id: 'npc:3',
    kind: 'npc',
    key: 'rs:goblin',
    name: 'Goblin',
    position: { x: 3200, y: 3200, level: 0 },
});

const resident = (): Resident =>
    ({
        inventory: { items: [{ itemId: 42, amount: 1 }] },
        actionPipeline: { call: mockActionPipelineCall },
    }) as unknown as Resident;

describe('ActionAdapter', () => {
    beforeEach(() => {
        jest.mocked(findItem).mockReturnValue({ gameId: 42, key: 'rs:test_item' } as never);
        jest.mocked(findSpellByKey).mockReturnValue(null);
        mockActionPipelineCall.mockClear();
        (activeWorld.npcList as unknown[]).length = 0;
        (activeWorld.playerList as unknown[]).length = 0;
        (activeWorld.findActivePlayerByUsername as jest.Mock).mockReset();
        (activeWorld.findObjectAtLocation as jest.Mock).mockReset();
        jest.mocked(filestore.configStore.objectStore.getObject).mockReset();
    });

    it('echoes resident speech to nearby human players as a chatbox message', () => {
        const sendMessage = jest.fn();
        const speakingResident = {
            username: 'res:agent',
            position: { x: 3230, y: 3239, level: 0 },
            toActorRef: jest.fn(() => ({ id: 'resident:res:agent', kind: 'resident', name: 'res:agent', position: { x: 3230, y: 3239, level: 0 } })),
            emitPerceptionEvent: jest.fn(),
            playerEvents: { emit: jest.fn() },
            inventory: { items: [] },
            actionPipeline: { call: mockActionPipelineCall },
        } as unknown as Resident;
        (activeWorld.playerList as unknown[]).push(
            speakingResident,
            { username: 'Codex', isActive: true, position: { x: 3231, y: 3239, level: 0 }, sendMessage },
            { username: 'Far', isActive: true, position: { x: 3300, y: 3300, level: 0 }, sendMessage: jest.fn() },
        );

        const result = new ActionAdapter().apply(speakingResident, {
            kind: 'say',
            text: 'Visible hello',
        });

        expect(result).toEqual({ ok: true });
        expect(sendMessage).toHaveBeenCalledWith('res:agent: Visible hello');
    });

    it('walks move_to actions to the exact requested tile', () => {
        let queued = false;
        const walkingQueue = {
            clear: jest.fn(() => {
                queued = false;
            }),
            moving: jest.fn(() => queued),
            valid: false,
        };
        const walkTo = jest.fn();
        walkTo.mockImplementation(() => {
            queued = true;
            walkingQueue.valid = true;
        });
        const movingResident = {
            position: { x: 3218, y: 3201, level: 0 },
            pathfinding: { walkTo },
            walkingQueue,
        } as unknown as Resident;

        const result = new ActionAdapter().apply(movingResident, {
            kind: 'move_to',
            target: { x: 3219, y: 3202, level: 0 },
        });

        expect(result).toEqual({ ok: true });
        expect(walkTo).toHaveBeenCalledWith(
            expect.objectContaining({ x: 3219, y: 3202, level: 0 }),
            { pathingSearchRadius: 3, ignoreDestination: false },
        );
    });

    it('rejects move_to actions when no path can be queued', () => {
        const walkTo = jest.fn();
        const walkingQueue = {
            clear: jest.fn(),
            moving: jest.fn(() => false),
            valid: false,
        };
        const movingResident = {
            position: { x: 3218, y: 3201, level: 0 },
            pathfinding: { walkTo },
            walkingQueue,
        } as unknown as Resident;

        const result = new ActionAdapter().apply(movingResident, {
            kind: 'move_to',
            target: { x: 3219, y: 3202, level: 0 },
        });

        expect(result).toEqual({ ok: false, reason: 'no_path' });
        expect(walkTo).toHaveBeenCalledWith(
            expect.objectContaining({ x: 3219, y: 3202, level: 0 }),
            { pathingSearchRadius: 3, ignoreDestination: false },
        );
        expect(walkingQueue.clear).toHaveBeenCalled();
    });

    it('queues a normal route toward distant move_to targets', () => {
        let queued = false;
        const walkingQueue = {
            clear: jest.fn(() => {
                queued = false;
            }),
            moving: jest.fn(() => queued),
            valid: false,
        };
        const walkTo = jest.fn(() => {
            queued = true;
            walkingQueue.valid = true;
        });
        const movingResident = {
            position: { x: 3224, y: 3201, level: 0 },
            pathfinding: { walkTo },
            walkingQueue,
        } as unknown as Resident;

        const result = new ActionAdapter().apply(movingResident, {
            kind: 'move_to',
            target: { x: 3228, y: 3201, level: 0 },
        });

        expect(result).toEqual({ ok: true });
        expect(walkTo).toHaveBeenCalledWith(
            expect.objectContaining({ x: 3228, y: 3201, level: 0 }),
            { pathingSearchRadius: 6, ignoreDestination: false },
        );
    });

    it('tries alternate local steps when the preferred step cannot queue', () => {
        let queued = false;
        const walkingQueue = {
            clear: jest.fn(() => {
                queued = false;
            }),
            moving: jest.fn(() => queued),
            valid: false,
        };
        const walkTo = jest.fn((position: { x: number; y: number }) => {
            if (position.x === 3225 && position.y === 3200) {
                queued = true;
                walkingQueue.valid = true;
            }
        });
        const movingResident = {
            position: { x: 3224, y: 3200, level: 0 },
            pathfinding: { walkTo },
            walkingQueue,
        } as unknown as Resident;

        const result = new ActionAdapter().apply(movingResident, {
            kind: 'move_to',
            target: { x: 3228, y: 3204, level: 0 },
        });

        expect(result).toEqual({ ok: true });
        expect(walkTo).toHaveBeenCalledWith(
            expect.objectContaining({ x: 3225, y: 3200, level: 0 }),
            { pathingSearchRadius: 3, ignoreDestination: false },
        );
    });

    it('walks range move_to actions on a normal route to the nearest reachable tile beside the target', () => {
        let queued = false;
        const walkingQueue = {
            clear: jest.fn(() => {
                queued = false;
            }),
            moving: jest.fn(() => queued),
            valid: false,
        };
        const walkTo = jest.fn((position: { x: number; y: number }) => {
            if (position.x === 3229 && position.y === 3208) {
                queued = true;
                walkingQueue.valid = true;
            }
        });
        const movingResident = {
            position: { x: 3227, y: 3205, level: 0 },
            pathfinding: { walkTo },
            walkingQueue,
        } as unknown as Resident;

        const result = new ActionAdapter().apply(movingResident, {
            kind: 'move_to',
            target: { x: 3230, y: 3209, level: 0 },
            range: 1,
        });

        expect(result).toEqual({ ok: true });
        expect(walkTo).toHaveBeenCalledWith(
            expect.objectContaining({ x: 3229, y: 3208, level: 0 }),
            { pathingSearchRadius: 5, ignoreDestination: false },
        );
    });

    it('falls back to a verified local step only when the direct route cannot queue', () => {
        let queued = false;
        const walkingQueue = {
            clear: jest.fn(() => {
                queued = false;
            }),
            moving: jest.fn(() => queued),
            valid: false,
        };
        const walkTo = jest.fn((position: { x: number; y: number }) => {
            if (position.x === 3225 && position.y === 3201) {
                queued = true;
                walkingQueue.valid = true;
            }
        });
        const movingResident = {
            position: { x: 3224, y: 3200, level: 0 },
            pathfinding: { walkTo },
            walkingQueue,
        } as unknown as Resident;

        const result = new ActionAdapter().apply(movingResident, {
            kind: 'move_to',
            target: { x: 3228, y: 3204, level: 0 },
        });

        expect(result).toEqual({ ok: true });
        expect(walkTo).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ x: 3228, y: 3204, level: 0 }),
            { pathingSearchRadius: 6, ignoreDestination: false },
        );
        expect(walkTo).toHaveBeenCalledWith(
            expect.objectContaining({ x: 3225, y: 3201, level: 0 }),
            { pathingSearchRadius: 3, ignoreDestination: false },
        );
    });

    it('translates object action aliases to configured object options before dispatch', () => {
        const object = { objectId: 1902 };
        (activeWorld.findObjectAtLocation as jest.Mock).mockReturnValue({ object, cacheOriginal: true });
        jest.mocked(filestore.configStore.objectStore.getObject).mockReturnValue({
            gameId: 1902,
            name: 'Tree',
            options: ['Chop down'],
        } as never);

        const actingResident = resident();
        const result = new ActionAdapter().apply(actingResident, {
            kind: 'interact',
            target: { objectId: 1902, position: { x: 3230, y: 3209, level: 0 } },
            option: 'action-1',
        });

        expect(result).toEqual({ ok: true });
        expect(mockActionPipelineCall).toHaveBeenCalledWith(
            'object_interaction',
            actingResident,
            object,
            expect.objectContaining({ name: 'Tree' }),
            expect.objectContaining({ x: 3230, y: 3209, level: 0 }),
            'chop down',
            true,
        );
    });

    it('dispatches use_item_on against NPCs through the engine item-on-npc pipe', () => {
        const npc = { type: 'npc', position: { x: 3200, y: 3200, level: 0 } };
        (activeWorld.npcList as unknown[])[3] = npc;

        const result = new ActionAdapter().apply(resident(), {
            kind: 'use_item_on',
            itemSlot: 0,
            target: npcRef(),
        });

        expect(result).toEqual({ ok: true });
        expect(mockActionPipelineCall).toHaveBeenCalledWith(
            'item_on_npc',
            expect.anything(),
            npc,
            npc.position,
            { itemId: 42, amount: 1 },
            3214,
            0,
        );
    });

    it('rejects use_item_on when the inventory slot is empty', () => {
        const emptyResident = {
            inventory: { items: [] },
            actionPipeline: { call: mockActionPipelineCall },
        } as unknown as Resident;

        const result = new ActionAdapter().apply(emptyResident, {
            kind: 'use_item_on',
            itemSlot: 0,
            target: npcRef(),
        });

        expect(result).toEqual({ ok: false, reason: 'empty_inventory_slot' });
        expect(mockActionPipelineCall).not.toHaveBeenCalled();
    });

    it('dispatches use_item_on_item through the engine item-on-item pipe', () => {
        const actingResident = {
            inventory: {
                items: [
                    { itemId: 590, amount: 1 },
                    { itemId: 1511, amount: 1 },
                ],
            },
            actionPipeline: { call: mockActionPipelineCall },
        } as unknown as Resident;

        const result = new ActionAdapter().apply(actingResident, {
            kind: 'use_item_on_item',
            itemSlot: 0,
            targetSlot: 1,
        } as never);

        expect(result).toEqual({ ok: true });
        expect(mockActionPipelineCall).toHaveBeenCalledWith(
            'item_on_item',
            actingResident,
            { itemId: 590, amount: 1 },
            0,
            3214,
            { itemId: 1511, amount: 1 },
            1,
            3214,
        );
    });

    it('dispatches NPC cast_spell actions through the engine magic-on-npc pipe', () => {
        const npc = { type: 'npc', position: { x: 3200, y: 3200, level: 0 } };
        (activeWorld.npcList as unknown[])[3] = npc;
        jest.mocked(findSpellByKey).mockReturnValue({ widget_id: 192, button_id: 1152 } as never);

        const actingResident = resident();
        const result = new ActionAdapter().apply(actingResident, {
            kind: 'cast_spell',
            spellKey: 'rs:wind_strike',
            target: npcRef(),
        });

        expect(result).toEqual({ ok: true });
        expect(mockActionPipelineCall).toHaveBeenCalledWith('magic_on_npc', npc, actingResident, 192, 1152);
    });

    it('rejects cast_spell when no configured spell exists', () => {
        const result = new ActionAdapter().apply(resident(), {
            kind: 'cast_spell',
            spellKey: 'rs:not_real',
            target: npcRef(),
        });

        expect(result).toEqual({ ok: false, reason: 'spell_not_found' });
        expect(mockActionPipelineCall).not.toHaveBeenCalled();
    });
});
