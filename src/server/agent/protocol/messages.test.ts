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

    it('parses resident creation with starter inventory', () => {
        const message = parseClientMessage(
            JSON.stringify({
                v: 1,
                id: 'create-firepal',
                kind: 'create_resident',
                payload: {
                    name: 'res:firepal',
                    spawnPosition: { x: 3222, y: 3202, level: 0 },
                    initialInventory: [{ itemId: 590, amount: 1 }, 1511, null],
                },
            }),
        );

        expect(message.kind).toBe('create_resident');
        if (message.kind !== 'create_resident') {
            throw new Error('Expected create_resident');
        }
        expect(message.payload.initialInventory).toEqual([{ itemId: 590, amount: 1 }, 1511, null]);
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
