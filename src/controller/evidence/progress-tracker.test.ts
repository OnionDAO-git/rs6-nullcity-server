import { ProgressTracker, type ProgressSnapshot } from './progress-tracker';

describe('ProgressTracker', () => {
    it('marks the first sample as meaningful and stores a defensive copy', () => {
        const tracker = new ProgressTracker();
        const first = snapshot({ tick: 1, xpBySkill: { woodcutting: 0 } });

        const delta = tracker.observe(first);
        first.xpBySkill.woodcutting = 99;

        expect(delta).toEqual({ meaningful: true, reasons: ['initial_sample'], newStuck: false, stuckSince: null });
        expect(tracker.current()).toEqual(snapshot({ tick: 1, xpBySkill: { woodcutting: 0 } }));
    });

    it('reports compact human-readable reasons for meaningful progress', () => {
        const tracker = new ProgressTracker();
        tracker.observe(snapshot({ tick: 1, xpBySkill: { woodcutting: 0 }, inventoryCount: 1, positionHash: 'a', hp: 10 }));

        const delta = tracker.observe(snapshot({ tick: 2, xpBySkill: { woodcutting: 25 }, inventoryCount: 2, positionHash: 'b', hp: 7 }));

        expect(delta).toEqual({
            meaningful: true,
            reasons: ['xp_gain:woodcutting:25', 'inventory:+1', 'position_changed', 'hp:-3'],
            newStuck: false,
            stuckSince: null,
        });
    });

    it('sets stuckSince after the configured threshold and clears it on progress', () => {
        const tracker = new ProgressTracker({ stuckThresholdTicks: 3 });
        tracker.observe(snapshot({ tick: 1 }));
        expect(tracker.observe(snapshot({ tick: 3 })).newStuck).toBe(false);

        const stuck = tracker.observe(snapshot({ tick: 4 }));
        expect(stuck).toEqual({ meaningful: false, reasons: [], newStuck: true, stuckSince: 4 });

        const stillStuck = tracker.observe(snapshot({ tick: 5 }));
        expect(stillStuck).toEqual({ meaningful: false, reasons: [], newStuck: false, stuckSince: 4 });

        const recovered = tracker.observe(snapshot({ tick: 6, positionHash: 'moved' }));
        expect(recovered.stuckSince).toBeNull();
        expect(recovered.meaningful).toBe(true);
    });

    it('does not flag ordinary scouting cadence as stuck before the default threshold', () => {
        const tracker = new ProgressTracker();
        tracker.observe(snapshot({ tick: 1, positionHash: 'lumbridge-bank' }));

        expect(tracker.observe(snapshot({ tick: 31, positionHash: 'lumbridge-bank' }))).toEqual({
            meaningful: false,
            reasons: [],
            newStuck: false,
            stuckSince: null,
        });

        expect(tracker.observe(snapshot({ tick: 46, positionHash: 'lumbridge-bank' }))).toEqual({
            meaningful: false,
            reasons: [],
            newStuck: true,
            stuckSince: 46,
        });
    });

    it('resets all tracking state', () => {
        const tracker = new ProgressTracker({ stuckThresholdTicks: 1 });
        tracker.observe(snapshot({ tick: 1 }));
        tracker.observe(snapshot({ tick: 2 }));

        tracker.reset();

        expect(tracker.current()).toBeNull();
        expect(tracker.observe(snapshot({ tick: 9 }))).toEqual({
            meaningful: true,
            reasons: ['initial_sample'],
            newStuck: false,
            stuckSince: null,
        });
    });
});

function snapshot(overrides: Partial<ProgressSnapshot>): ProgressSnapshot {
    return {
        tick: 1,
        xpBySkill: {},
        inventoryCount: 0,
        positionHash: 'same',
        hp: 10,
        ...overrides,
    };
}
