import { AgentActionSchema } from './agent-action';

describe('AgentActionSchema', () => {
    it('accepts resident actor refs with fractional combat levels from live perception', () => {
        expect(() =>
            AgentActionSchema.parse({
                kind: 'trade_request',
                target: {
                    id: 'player:res:codex-tv1',
                    kind: 'resident',
                    name: 'res:codex-tv1',
                    position: { x: 3214, y: 3204, level: 0 },
                    hpFraction: 1,
                    combatLevel: 3.4,
                },
            }),
        ).not.toThrow();
    });

    it('accepts a buy_from_shop action (residents can purchase a needed tool)', () => {
        expect(() => AgentActionSchema.parse({ kind: 'buy_from_shop', itemId: 1351, quantity: 1 })).not.toThrow();
    });

    it('rejects buy_from_shop missing itemId or quantity', () => {
        expect(() => AgentActionSchema.parse({ kind: 'buy_from_shop', quantity: 1 })).toThrow();
        expect(() => AgentActionSchema.parse({ kind: 'buy_from_shop', itemId: 1351 })).toThrow();
    });
});
