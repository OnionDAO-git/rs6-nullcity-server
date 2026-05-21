import { endTickReasonSchema, progressLineSchema, trajectoryLineSchema } from './schemas';

describe('evidence schemas', () => {
    const header = {
        schemaVersion: 1,
        ts: '2026-05-21T08:30:00.000Z',
        tick: 1,
        sessionId: 'session-a',
    };

    it('accepts known end_tick reasons and budget exhaustion reasons', () => {
        for (const reason of [
            'legacy_complete',
            'attention_exhausted',
            'plan_continuation',
            'hook_noop',
            'budget_exhausted:minute',
            'parse_failed',
            'legacy_complete_post_action',
            'tick_complete',
        ]) {
            expect(endTickReasonSchema.parse(reason)).toBe(reason);
            expect(trajectoryLineSchema.parse({ ...header, kind: 'end_tick', reason })).toMatchObject({ kind: 'end_tick', reason });
        }
    });

    it('rejects malformed end_tick reasons', () => {
        expect(() => endTickReasonSchema.parse('made_up')).toThrow();
        expect(() => trajectoryLineSchema.parse({ ...header, kind: 'end_tick', reason: 'made_up' })).toThrow();
    });

    it('accepts begin_tick passthrough details and progress lines', () => {
        expect(trajectoryLineSchema.parse({ ...header, kind: 'begin_tick', perceptionHash: 'abc' })).toMatchObject({
            kind: 'begin_tick',
            perceptionHash: 'abc',
        });
        expect(
            progressLineSchema.parse({
                ...header,
                kind: 'progress',
                meaningful: true,
                reasons: ['xp_gain:woodcutting:50'],
                stuckSince: null,
            }),
        ).toMatchObject({ kind: 'progress', meaningful: true });
    });
});
