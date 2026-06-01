import { parseClientMessage } from './messages';

describe('agent protocol messages', () => {
    it('parses trade action frames', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'trade-1',
                kind: 'submit_action',
                payload: {
                    name: 'alice',
                    action: {
                        kind: 'trade_offer_item',
                        inventorySlot: 3,
                        amount: 1,
                    },
                },
            }),
        );

        expect(message.kind).toBe('submit_action');
        if (message.kind !== 'submit_action') {
            throw new Error('Expected submit_action');
        }
        expect(message.payload.action.kind).toBe('trade_offer_item');
    });

    it('parses inventory item-on-item action frames', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'fire-1',
                kind: 'submit_action',
                payload: {
                    name: 'res:agent',
                    action: {
                        kind: 'use_item_on_item',
                        itemSlot: 0,
                        targetSlot: 1,
                    },
                },
            }),
        );

        expect(message.kind).toBe('submit_action');
        if (message.kind !== 'submit_action') {
            throw new Error('Expected submit_action');
        }
        expect(message.payload.action).toEqual({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 });
    });

    it('parses generic inventory item action frames', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'bury-1',
                kind: 'submit_action',
                payload: {
                    name: 'res:agent',
                    action: {
                        kind: 'item_action',
                        slot: 3,
                        option: 'bury',
                    },
                },
            }),
        );

        expect(message.kind).toBe('submit_action');
        if (message.kind !== 'submit_action') {
            throw new Error('Expected submit_action');
        }
        expect(message.payload.action).toEqual({ kind: 'item_action', slot: 3, option: 'bury' });
    });

    it('rejects malformed action frames', () => {
        expect(() =>
            parseClientMessage(
                JSON.stringify({
                    v: 1,
                    kind: 'submit_action',
                    payload: {
                        name: 'alice',
                        action: {
                            kind: 'trade_offer_item',
                            inventorySlot: -1,
                            amount: 0,
                        },
                    },
                }),
            ),
        ).toThrow();
    });

    it('parses resident creation with starter inventory and skill seeds', () => {
        const appearance = {
            gender: 0,
            head: 2,
            torso: 21,
            arms: 29,
            legs: 39,
            hands: 34,
            feet: 43,
            facialHair: 12,
            hairColor: 4,
            torsoColor: 7,
            legColor: 9,
            feetColor: 3,
            skinColor: 2,
        };
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'create-firepal',
                kind: 'create_resident',
                payload: {
                    name: 'res:firepal',
                    spawnPosition: { x: 3222, y: 3202, level: 0 },
                    appearance,
                    initialInventory: [{ itemId: 590, amount: 1 }, 1511, null],
                    initialSkills: { firemaking: { exp: 82, level: 1 }, cooking: 81 },
                },
            }),
        );

        expect(message.kind).toBe('create_resident');
        if (message.kind !== 'create_resident') {
            throw new Error('Expected create_resident');
        }
        expect(message.payload.appearance).toEqual(appearance);
        expect(message.payload.initialInventory).toEqual([{ itemId: 590, amount: 1 }, 1511, null]);
        expect(message.payload.initialSkills).toEqual({ firemaking: { exp: 82, level: 1 }, cooking: 81 });
    });

    it('parses operator inventory ensure requests', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'ensure-net',
                kind: 'ensure_inventory_item',
                payload: {
                    name: 'res:qa-survivor',
                    item: 303,
                    amount: 1,
                },
            }),
        );

        expect(message.kind).toBe('ensure_inventory_item');
        if (message.kind !== 'ensure_inventory_item') {
            throw new Error('Expected ensure_inventory_item');
        }
        expect(message.payload).toEqual({ name: 'res:qa-survivor', item: 303, amount: 1 });
    });

    it('rejects malformed operator inventory ensure amounts', () => {
        expect(() =>
            parseClientMessage(
                JSON.stringify({
                    v: 1,
                    kind: 'ensure_inventory_item',
                    payload: {
                        name: 'res:qa-survivor',
                        item: 303,
                        amount: 0,
                    },
                }),
            ),
        ).toThrow();
    });

    it('parses observable subject list requests', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'subjects-1',
                kind: 'list_observable_subjects',
                payload: {
                    includeResidents: false,
                    includePlayers: true,
                },
            }),
        );

        expect(message.kind).toBe('list_observable_subjects');
        if (message.kind !== 'list_observable_subjects') {
            throw new Error('Expected list_observable_subjects');
        }
        expect(message.payload.includeResidents).toBe(false);
        expect(message.payload.includePlayers).toBe(true);
    });

    it('parses resident pause requests', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'pause-1',
                kind: 'pause_resident',
                payload: {
                    name: 'res:firepal',
                    cause: 'dashboard_pause',
                },
            }),
        );

        expect(message.kind).toBe('pause_resident');
        if (message.kind !== 'pause_resident') {
            throw new Error('Expected pause_resident');
        }
        expect(message.payload).toEqual({ name: 'res:firepal', cause: 'dashboard_pause' });
    });

    it('parses player spectator session requests', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'observe-1',
                kind: 'observe_subject',
                payload: {
                    subject: { kind: 'player', username: 'alice' },
                    mode: 'free-camera',
                },
            }),
        );

        expect(message.kind).toBe('observe_subject');
        if (message.kind !== 'observe_subject') {
            throw new Error('Expected observe_subject');
        }
        expect(message.payload.subject).toEqual({ kind: 'player', username: 'alice' });
        expect(message.payload.mode).toBe('free-camera');
    });

    it('rejects malformed spectator subjects', () => {
        expect(() =>
            parseClientMessage(
                JSON.stringify({
                    v: 1,
                    kind: 'observe_subject',
                    payload: {
                        subject: { kind: 'player', name: 'alice' },
                    },
                }),
            ),
        ).toThrow();
    });
});
