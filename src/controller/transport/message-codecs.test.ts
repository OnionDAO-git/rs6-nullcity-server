/**
 * Message-codec contract tests (focused on G4 trading verbs).
 *
 * Validates that the four trading verbs the controller authors via
 * `src/controller/actions/trading.ts` round-trip cleanly through the zod
 * `agentActionSchema`, alongside the pre-existing engine-style shapes.
 */
import { agentActionSchema, tradeActionTargetSchema, type AgentAction } from './message-codecs';

describe('agentActionSchema — G4 trading verbs', () => {
    describe('trade_request', () => {
        it('accepts the controller-facing residentId-only target', () => {
            const action: AgentAction = { kind: 'trade_request', target: { residentId: 'res:foo' } };
            const parsed = agentActionSchema.parse(action);
            expect(parsed).toEqual(action);
        });

        it('accepts the controller-facing playerHandle-only target', () => {
            const action: AgentAction = { kind: 'trade_request', target: { playerHandle: 'codex' } };
            const parsed = agentActionSchema.parse(action);
            expect(parsed).toEqual(action);
        });

        it('accepts a target with both residentId and playerHandle', () => {
            const action: AgentAction = {
                kind: 'trade_request',
                cause: 'direct_chat_trade',
                target: { residentId: 'res:foo', playerHandle: 'codex' },
            };
            const parsed = agentActionSchema.parse(action);
            expect(parsed).toEqual(action);
        });

        it('rejects an empty target ({} satisfies neither residentId nor playerHandle)', () => {
            const action = { kind: 'trade_request', target: {} };
            expect(() => agentActionSchema.parse(action)).toThrow(/trade target/);
        });

        it('still accepts the legacy engine-style ActorRef target', () => {
            const action = {
                kind: 'trade_request',
                target: { id: 'player:codex', kind: 'player', name: 'codex', position: { x: 1, y: 1, level: 0 } },
            };
            const parsed = agentActionSchema.parse(action);
            expect(parsed).toMatchObject({ kind: 'trade_request' });
        });
    });

    describe('trade_offer_item', () => {
        it('accepts the controller-facing itemId + quantity form', () => {
            const action: AgentAction = { kind: 'trade_offer_item', itemId: 1511, quantity: 5 };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });

        it('accepts itemId + quantity + slot + cause', () => {
            const action: AgentAction = {
                kind: 'trade_offer_item',
                itemId: 1511,
                quantity: 5,
                slot: 2,
                cause: 'proactive_offer',
            };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });

        it('still accepts the legacy inventorySlot + amount form', () => {
            const action = { kind: 'trade_offer_item', inventorySlot: 0, amount: 1 };
            expect(agentActionSchema.parse(action)).toMatchObject({ kind: 'trade_offer_item' });
        });

        it('rejects non-positive quantity', () => {
            expect(() => agentActionSchema.parse({ kind: 'trade_offer_item', itemId: 1511, quantity: 0 })).toThrow();
        });
    });

    describe('trade_accept', () => {
        it('accepts the bare single-stage verb', () => {
            const action: AgentAction = { kind: 'trade_accept' };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });

        it('accepts trade_accept with a cause', () => {
            const action: AgentAction = { kind: 'trade_accept', cause: 'fair_value' };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });

        it('still accepts the two-stage engine verbs (legacy)', () => {
            expect(agentActionSchema.parse({ kind: 'trade_accept_stage_1' })).toMatchObject({
                kind: 'trade_accept_stage_1',
            });
            expect(agentActionSchema.parse({ kind: 'trade_accept_stage_2' })).toMatchObject({
                kind: 'trade_accept_stage_2',
            });
        });
    });

    describe('trade_decline', () => {
        it('accepts the bare verb', () => {
            const action: AgentAction = { kind: 'trade_decline' };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });

        it('accepts a decline with a structured reason', () => {
            const action: AgentAction = { kind: 'trade_decline', reason: 'unfair', cause: 'fairness_check' };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });

        it('accepts free-form reason strings (forward-compat)', () => {
            const action: AgentAction = { kind: 'trade_decline', reason: 'partner_silent_too_long' };
            expect(agentActionSchema.parse(action)).toEqual(action);
        });
    });

    describe('tradeActionTargetSchema', () => {
        it('requires at least one of residentId or playerHandle', () => {
            expect(() => tradeActionTargetSchema.parse({})).toThrow();
            expect(tradeActionTargetSchema.parse({ residentId: 'a' })).toEqual({ residentId: 'a' });
            expect(tradeActionTargetSchema.parse({ playerHandle: 'a' })).toEqual({ playerHandle: 'a' });
        });
    });

    describe('action metadata', () => {
        it('preserves voiceSource and helpRequestReason on say actions', () => {
            const action: AgentAction = {
                kind: 'say',
                text: 'I need help getting unstuck.',
                voiceSource: 'phrasebook',
                helpRequestReason: 'blocked_by_obstacle',
            };

            expect(agentActionSchema.parse(action)).toEqual(action);
        });
    });

    it('round-trips all four G4 verbs through JSON without dropping fields', () => {
        const verbs: AgentAction[] = [
            { kind: 'trade_request', cause: 'a', target: { residentId: 'res:foo', playerHandle: 'codex' } },
            { kind: 'trade_offer_item', cause: 'b', itemId: 1511, quantity: 5, slot: 2 },
            { kind: 'trade_accept', cause: 'c' },
            { kind: 'trade_decline', cause: 'd', reason: 'unfair' },
        ];

        for (const verb of verbs) {
            const roundTripped = JSON.parse(JSON.stringify(verb));
            expect(agentActionSchema.parse(roundTripped)).toEqual(verb);
        }
    });
});
