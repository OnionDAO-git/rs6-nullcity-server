import { matchEventKind } from './event-matcher';

describe('event-matcher', () => {
    it('matches identical kinds', () => {
        expect(matchEventKind('chat', 'chat')).toBe(true);
        expect(matchEventKind('level_up', 'level_up')).toBe(true);
    });

    it('matches hit aliases case-insensitively', () => {
        const aliases = ['hit', 'hit_taken', 'hit_received', 'attacked'];
        for (const a of aliases) {
            for (const b of aliases) {
                expect(matchEventKind(a, b)).toBe(true);
                expect(matchEventKind(a.toUpperCase(), b)).toBe(true);
            }
        }
    });

    it('rejects hit matching hit_dealt', () => {
        expect(matchEventKind('hit_taken', 'hit_dealt')).toBe(false);
        expect(matchEventKind('hit', 'hit_dealt')).toBe(false);
        expect(matchEventKind('hit_dealt', 'hit_received')).toBe(false);
    });

    it('matches death aliases case-insensitively', () => {
        expect(matchEventKind('death', 'died')).toBe(true);
        expect(matchEventKind('died', 'death')).toBe(true);
        expect(matchEventKind('DEATH', 'died')).toBe(true);
        expect(matchEventKind('died', 'DIED')).toBe(true);
    });

    it('rejects unrelated event kinds', () => {
        expect(matchEventKind('chat', 'hit')).toBe(false);
        expect(matchEventKind('died', 'level_up')).toBe(false);
        expect(matchEventKind('arrived', 'death')).toBe(false);
    });
});
