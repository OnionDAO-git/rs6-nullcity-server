import type { AgentAction, PerceptionEvent } from '../../transport/message-codecs';
import { verifyTradingGiving5m } from './trading-giving-5m';

describe('verifyTradingGiving5m', () => {
    it('passes when the resident requests trade, offers an item, accepts both stages, and declines an unsafe trade', () => {
        const codex = actor('resident:codex', 'Codex');
        const alice = actor('resident:alice', 'Alice');

        const outcome = verifyTradingGiving5m({
            elapsedMs: 55_000,
            actions: [
                attempt({ kind: 'trade_request', target: codex, cause: 'direct_chat_trade' }),
                attempt({ kind: 'trade_offer_item', inventorySlot: 2, amount: 1, cause: 'trade_offer_safe_item' }),
                attempt({ kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' }),
                attempt({ kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' }),
                attempt({ kind: 'trade_request', target: alice, cause: 'direct_chat_trade' }),
                attempt({ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }),
            ],
            events: [
                chat('agent trade me', 'Codex'),
                { kind: 'trade_opened', partner: codex, sessionId: 'trusted-trade' },
                {
                    kind: 'trade_completed',
                    given: [{ itemId: 1511, key: 'rs:logs', amount: 1 }],
                    received: [],
                },
                chat('agent trade me', 'Alice'),
                { kind: 'trade_opened', partner: alice, sessionId: 'unsafe-trade' },
                { kind: 'trade_cancelled', reason: 'declined' },
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.tradeRequests).toBe(2);
        expect(outcome.metrics?.safeItemOffers).toBe(1);
        expect(outcome.metrics?.acceptStage1).toBe(1);
        expect(outcome.metrics?.acceptStage2).toBe(1);
        expect(outcome.metrics?.unsafeDeclines).toBe(1);
    });

    it('fails clearly when the resident opens trade but never offers a safe item', () => {
        const codex = actor('resident:codex', 'Codex');

        const outcome = verifyTradingGiving5m({
            elapsedMs: 40_000,
            actions: [attempt({ kind: 'trade_request', target: codex, cause: 'direct_chat_trade' })],
            events: [chat('agent trade me', 'Codex'), { kind: 'trade_opened', partner: codex, sessionId: 'trusted-trade' }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No safe item was offered');
        expect(outcome.metrics?.safeItemOffers).toBe(0);
    });
});

function attempt(action: AgentAction) {
    return { action };
}

function chat(text: string, from: string): PerceptionEvent {
    return {
        kind: 'chat',
        from: actor(`resident:${from.toLowerCase()}`, from),
        text,
        to: 'public',
    };
}

function actor(id: string, name: string) {
    return {
        id,
        kind: 'resident' as const,
        name,
        position: { x: 3229, y: 3230, level: 0 },
    };
}
