import {
    actorRefFromPerception,
    parseNamedTradeSoakArgs,
    peerSpawnsNearPerception,
    verifyNamedTradeSoakEvidence,
    type NamedTradeSoakInventoryItem,
    type NamedTradeSoakLogEntry,
} from './named-trade-soak';

describe('named trade soak verifier', () => {
    it('passes only when ordinary named-resident logs show trusted trade, unsafe decline, and inventory delta', () => {
        const outcome = verifyNamedTradeSoakEvidence({
            resident: 'res:qa-trader',
            trustedPeer: 'res:codex-cqa4',
            unsafePeer: 'res:alice-cqa4',
            unsafeRepeatCount: 1,
            entries: [
                log({ kind: 'trade_request', target: peer('res:codex-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_offer_item', inventorySlot: 0, amount: 1, cause: 'trade_offer_safe_item' }),
                log({ kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' }),
                log({ kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
            ],
            inventoryBefore: [item(1511, 5), item(590, 1), item(315, 3), item(995, 25)],
            inventoryAfter: [item(1511, 4), item(590, 1), item(315, 3), item(995, 25)],
            tradeCompletedEvents: 1,
            tradeCancelledEvents: 1,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            tradeRequests: 2,
            trustedTradeRequests: 1,
            unsafeTradeRequests: 1,
            safeItemOffers: 1,
            acceptStage1: 1,
            acceptStage2: 1,
            safeInventoryDelta: -1,
            unsafeDeclines: 1,
            postUnsafeOffersOrAccepts: 0,
            inventoryDeltaItem1511: -1,
            tradeCompletedEvents: 1,
            tradeCancelledEvents: 1,
        });
    });

    it('passes a repeated unsafe prompt soak only when every unsafe request is declined without follow-up offers', () => {
        const outcome = verifyNamedTradeSoakEvidence({
            resident: 'res:qa-trader',
            trustedPeer: 'res:codex-cqa4',
            unsafePeer: 'res:alice-cqa4',
            unsafeRepeatCount: 3,
            entries: [
                log({ kind: 'trade_request', target: peer('res:codex-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_offer_item', inventorySlot: 0, amount: 1, cause: 'trade_offer_safe_item' }),
                log({ kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' }),
                log({ kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
            ],
            inventoryBefore: [item(1511, 5), item(315, 3)],
            inventoryAfter: [item(1511, 4), item(315, 3)],
            tradeCompletedEvents: 1,
            tradeCancelledEvents: 3,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            unsafeRepeatTarget: 3,
            unsafeTradeRequests: 3,
            unsafeDeclines: 3,
            postUnsafeOffersOrAccepts: 0,
            tradeCancelledEvents: 3,
        });
    });

    it('fails a repeated unsafe prompt soak if the resident offers or accepts after the unsafe peer starts prompting', () => {
        const outcome = verifyNamedTradeSoakEvidence({
            resident: 'res:qa-trader',
            trustedPeer: 'res:codex-cqa4',
            unsafePeer: 'res:alice-cqa4',
            unsafeRepeatCount: 2,
            entries: [
                log({ kind: 'trade_request', target: peer('res:codex-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_offer_item', inventorySlot: 0, amount: 1, cause: 'trade_offer_safe_item' }),
                log({ kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' }),
                log({ kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_offer_item', inventorySlot: 1, amount: 1, cause: 'trade_offer_safe_item' }),
            ],
            inventoryBefore: [item(1511, 5)],
            inventoryAfter: [item(1511, 4)],
            tradeCompletedEvents: 1,
            tradeCancelledEvents: 1,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('Unsafe peer prompted trade loop produced offer/accept actions');
        expect(outcome.metrics.postUnsafeOffersOrAccepts).toBe(1);
    });

    it('fails a repeated unsafe prompt soak if not every unsafe request is declined', () => {
        const outcome = verifyNamedTradeSoakEvidence({
            resident: 'res:qa-trader',
            trustedPeer: 'res:codex-cqa4',
            unsafePeer: 'res:alice-cqa4',
            unsafeRepeatCount: 2,
            entries: [
                log({ kind: 'trade_request', target: peer('res:codex-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_offer_item', inventorySlot: 0, amount: 1, cause: 'trade_offer_safe_item' }),
                log({ kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' }),
                log({ kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
                log({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
                log({ kind: 'trade_request', target: peer('res:alice-cqa4'), cause: 'direct_chat_trade' }),
            ],
            inventoryBefore: [item(1511, 5)],
            inventoryAfter: [item(1511, 4)],
            tradeCompletedEvents: 1,
            tradeCancelledEvents: 1,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('Not every repeated unsafe trade prompt was declined');
        expect(outcome.metrics.unsafeDeclines).toBe(1);
    });

    it('fails when there is no ordinary action-log trade request from the named resident', () => {
        const outcome = verifyNamedTradeSoakEvidence({
            resident: 'res:qa-trader',
            trustedPeer: 'res:codex-cqa4',
            unsafePeer: 'res:alice-cqa4',
            unsafeRepeatCount: 1,
            entries: [log({ kind: 'say', text: 'I can trade.' })],
            inventoryBefore: [item(1511, 5)],
            inventoryAfter: [item(1511, 5)],
            tradeCompletedEvents: 0,
            tradeCancelledEvents: 0,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordinary action-log trade_request');
        expect(outcome.metrics.tradeRequests).toBe(0);
    });

    it('parses defaults for the QA trader operator soak', () => {
        expect(parseNamedTradeSoakArgs([], new Date('2026-05-30T09:15:30.000Z'))).toMatchObject({
            resident: 'res:qa-trader',
            trustedPeer: 'res:codex-cqa4-091530',
            unsafePeer: 'res:alice-cqa4-091530',
            commandPrefix: 'trade',
            unsafeRepeatCount: 1,
            configPath: 'controller.yml',
            outputDir: 'data/benchmarks/capability-qa-2026-05-30',
        });
    });

    it('parses unsafe repeat count for no-loop soak runs', () => {
        expect(parseNamedTradeSoakArgs(['--unsafe-repeats', '3'], new Date('2026-05-30T09:15:30.000Z'))).toMatchObject({
            unsafeRepeatCount: 3,
        });
        expect(parseNamedTradeSoakArgs(['--unsafe-repeats=2'], new Date('2026-05-30T09:15:30.000Z'))).toMatchObject({
            unsafeRepeatCount: 2,
        });
    });

    it('places soak peer residents on the target tile so trade soaks do not measure pathing drift', () => {
        expect(
            peerSpawnsNearPerception({
                resident: {
                    position: { x: 3211, y: 3204, level: 0 },
                },
            }),
        ).toEqual({
            trustedSpawn: { x: 3211, y: 3204, level: 0 },
            unsafeSpawn: { x: 3211, y: 3204, level: 0 },
        });
    });

    it('builds the live gateway actor ref for reciprocal peer trade requests', () => {
        expect(
            actorRefFromPerception('res:qa-trader', {
                resident: {
                    id: 'resident:res:qa-trader',
                    name: 'QA Trader',
                    position: { x: 3211, y: 3204, level: 0 },
                },
            }),
        ).toEqual({
            id: 'resident:res:qa-trader',
            kind: 'resident',
            name: 'QA Trader',
            position: { x: 3211, y: 3204, level: 0 },
        });
    });
});

function log(action: Record<string, unknown>): NamedTradeSoakLogEntry {
    return {
        t: '2026-05-30T09:00:00.000Z',
        source: 'thinking',
        action,
        result: { ok: true },
    };
}

function item(itemId: number, amount: number): NamedTradeSoakInventoryItem {
    return { itemId, amount };
}

function peer(name: string): Record<string, unknown> {
    return {
        id: `resident:${name}`,
        kind: 'resident',
        name,
        position: { x: 3211, y: 3204, level: 0 },
    };
}
