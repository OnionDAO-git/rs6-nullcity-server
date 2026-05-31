import { parseCompletion } from './completion-parser';

describe('parseCompletion', () => {
    it('accepts plans, memos, hooks, nervous rules, and variables', () => {
        const parsed = parseCompletion(
            JSON.stringify({
                plan: {
                    id: 'reply',
                    steps: [{ id: 'say', action: { kind: 'say', text: 'hello' }, advanceWhen: { kind: 'next_tick' } }],
                },
                memo: { path: 'events/2026-05-19.md', text: 'Met a traveler.' },
                proposeHook: { id: 'watch-chat', priority: 500, condition: { kind: 'event_kind', value: 'chat' } },
                proposeNervousRule: {
                    id: 'eat-on-hit',
                    priority: 500,
                    condition: { kind: 'event_kind', value: 'hit' },
                    action: { kind: 'eat', slot: 3 },
                    suppressThinking: true,
                },
                proposeVariables: [{ id: 'wariness', initial: 1, min: 0, max: 10 }],
            }),
        );

        expect(parsed.ok).toBe(true);
        expect(parsed.plan?.id).toBe('reply');
        expect(parsed.memo?.[0]?.path).toBe('events/2026-05-19.md');
        expect(parsed.proposeHook?.[0]?.priority).toBe(80);
        expect(parsed.proposeNervousRule?.[0]?.priority).toBe(100);
        expect(parsed.proposeNervousRule?.[0]?.action).toEqual({ kind: 'eat', slot: 3 });
        expect(parsed.proposeVariables?.[0]?.id).toBe('wariness');
    });

    it('accepts explicit durable rememberFact writes', () => {
        const parsed = parseCompletion(
            JSON.stringify({
                rememberFact: [
                    {
                        topic: 'quests',
                        fact: 'Cook asked for an egg, flour, and milk.',
                        reason: 'NPC dialogue gave concrete quest requirements',
                    },
                ],
            }),
        );

        expect(parsed.ok).toBe(true);
        expect(parsed.rememberFact?.[0]).toEqual({
            topic: 'quests',
            fact: 'Cook asked for an egg, flour, and milk.',
            reason: 'NPC dialogue gave concrete quest requirements',
        });
    });

    it('rejects memo path traversal', () => {
        const parsed = parseCompletion(JSON.stringify({ memo: { path: '../outside.md', text: 'bad' } }));

        expect(parsed.ok).toBe(false);
        expect(parsed.cause).toBe('completion_parse_failed');
    });

    it('rejects unsafe rememberFact topics', () => {
        const parsed = parseCompletion(JSON.stringify({ rememberFact: { topic: '../secrets', fact: 'bad' } }));

        expect(parsed.ok).toBe(false);
        expect(parsed.cause).toBe('completion_parse_failed');
    });
});
