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
