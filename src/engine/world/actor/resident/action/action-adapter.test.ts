import { findItem } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import { findSpellByKey } from '@engine/world/actor/magic';
import type { Resident } from '@engine/world/actor/resident/resident';
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
        (activeWorld.findActivePlayerByUsername as jest.Mock).mockReset();
        (activeWorld.findObjectAtLocation as jest.Mock).mockReset();
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
