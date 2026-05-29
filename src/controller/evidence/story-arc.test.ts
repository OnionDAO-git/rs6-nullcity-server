import { inferStoryArc } from './story-arc';

describe('inferStoryArc', () => {
    it('moves from pitch to funding to progress as resident evidence accumulates', () => {
        const arc = inferStoryArc([
            { kind: 'say', tick: 1, text: 'I need support to light the witness fire.' },
            { kind: 'patron_gift', tick: 2, patronHandle: 'patron:ember', amount: 12 },
            { kind: 'first_xp', tick: 3, skill: 'Firemaking' },
        ]);

        expect(arc.phase).toBe('progress');
        expect(arc.latestEventTick).toBe(3);
        expect(arc.latestEventKind).toBe('first_xp');
        expect(arc.evidence).toEqual({
            pitches: 1,
            fundingEvents: 1,
            progressEvents: 1,
            resolutionEvents: 0,
            letterEvents: 0,
        });
    });

    it('treats closing letters as the final visible phase after a resolution', () => {
        const arc = inferStoryArc([
            { kind: 'say', tick: 4, text: 'I want to finish this vow before dusk.' },
            { kind: 'legacy_event', tick: 9, event: { cause: 'completed vow' } },
            { kind: 'epitaph', tick: 10, text: 'Tell my patron the vow is complete.' },
        ]);

        expect(arc.phase).toBe('letter');
        expect(arc.latestEventTick).toBe(10);
        expect(arc.latestEventKind).toBe('epitaph');
        expect(arc.evidence.resolutionEvents).toBe(1);
        expect(arc.evidence.letterEvents).toBe(1);
    });

    it('does not regress from progress back to pitch when a resident repeats a need', () => {
        const arc = inferStoryArc([
            { kind: 'say', tick: 1, text: 'I need logs for the fire.' },
            { kind: 'patron_gift', tick: 2, patronHandle: 'patron:ember', amount: 12 },
            { kind: 'first_xp', tick: 3, skill: 'Firemaking' },
            { kind: 'say', tick: 4, text: 'I still need safer ground.' },
        ]);

        expect(arc.phase).toBe('progress');
        expect(arc.latestEventTick).toBe(3);
        expect(arc.latestEventKind).toBe('first_xp');
        expect(arc.evidence.pitches).toBe(2);
    });

    it('falls back to pitch when no arc evidence has appeared yet', () => {
        const arc = inferStoryArc([{ kind: 'say', tick: 7, text: 'The square is quiet today.' }]);

        expect(arc.phase).toBe('pitch');
        expect(arc.latestEventTick).toBeUndefined();
        expect(arc.evidence.pitches).toBe(0);
    });

    it('does not count ordinary exploratory speech as a pitch', () => {
        const arc = inferStoryArc([{ kind: 'say', tick: 11, text: 'I can find the oak path from here.' }]);

        expect(arc.phase).toBe('pitch');
        expect(arc.latestEventKind).toBeUndefined();
        expect(arc.evidence.pitches).toBe(0);
    });

    it('treats goal_achieved as a resolution event advancing the arc to resolve', () => {
        const arc = inferStoryArc([
            { kind: 'say', tick: 1, text: 'I need to find 100 GP per hour.' },
            { kind: 'patron_gift', tick: 2, patronHandle: 'patron:alice', amount: 500 },
            {
                kind: 'goal_achieved',
                tick: 10,
                goalId: 'goal-abc',
                goalText: 'Find a reliable way to make 100 GP/hour.',
                evidence: 'runtime:bank-balance',
            },
        ]);

        expect(arc.phase).toBe('resolve');
        expect(arc.latestEventKind).toBe('goal_achieved');
        expect(arc.latestEventTick).toBe(10);
        expect(arc.evidence.resolutionEvents).toBe(1);
    });

    it('goal_achieved counts as a resolution but partial XP progress does not', () => {
        const arcPartial = inferStoryArc([{ kind: 'first_xp', tick: 5, skill: 'Mining' }]);
        expect(arcPartial.evidence.resolutionEvents).toBe(0);
        expect(arcPartial.phase).toBe('progress');

        const arcComplete = inferStoryArc([
            { kind: 'first_xp', tick: 5, skill: 'Mining' },
            { kind: 'goal_achieved', tick: 15, goalId: 'g1', goalText: 'Mine ore', evidence: 'bench' },
        ]);
        expect(arcComplete.evidence.resolutionEvents).toBe(1);
        expect(arcComplete.phase).toBe('resolve');
    });

    it('arc advances to letter phase when a letter follows goal_achieved resolution', () => {
        const arc = inferStoryArc([
            { kind: 'goal_achieved', tick: 10, goalId: 'g1', goalText: 'Goal done', evidence: 'e1' },
            { kind: 'epitaph', tick: 12, text: 'My goal is complete.' },
        ]);

        expect(arc.phase).toBe('letter');
        expect(arc.evidence.resolutionEvents).toBe(1);
        expect(arc.evidence.letterEvents).toBe(1);
    });
});
