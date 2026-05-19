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
});
