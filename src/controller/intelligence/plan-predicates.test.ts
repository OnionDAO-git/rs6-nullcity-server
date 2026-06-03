import { describe, it, expect } from '@jest/globals';
import { evaluateSuccessPredicate } from './plan-predicates';
import type { SuccessPredicate } from './planner-pass';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyPerception = {};
const perceptionTick100 = { tick: 100 };
const perceptionWithObjects = (objectIds: number[]) => ({
    tick: 50,
    nearby: { objects: objectIds.map(objectId => ({ objectId })) },
});
const makeTimeline = (kinds: string[]): Array<Record<string, unknown>> => kinds.map(kind => ({ kind }));

// ---------------------------------------------------------------------------
// undefined predicate
// ---------------------------------------------------------------------------

describe('evaluateSuccessPredicate — undefined predicate', () => {
    it('returns true when pred is undefined (no predicate → done)', () => {
        expect(evaluateSuccessPredicate(undefined, emptyPerception)).toBe(true);
    });

    it('returns true regardless of perception when pred is undefined', () => {
        expect(evaluateSuccessPredicate(undefined, perceptionTick100)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// library_event_count
// ---------------------------------------------------------------------------

describe('evaluateSuccessPredicate — library_event_count', () => {
    const pred: SuccessPredicate = {
        kind: 'library_event_count',
        eventPattern: 'say',
        threshold: 3,
    };

    it('returns false when libraryTimeline is undefined', () => {
        expect(evaluateSuccessPredicate(pred, emptyPerception)).toBe(false);
    });

    it('returns false when matching count is below threshold', () => {
        const timeline = makeTimeline(['say', 'say', 'move']);
        expect(evaluateSuccessPredicate(pred, emptyPerception, undefined, timeline)).toBe(false);
    });

    it('returns true when matching count meets threshold exactly', () => {
        const timeline = makeTimeline(['say', 'say', 'say']);
        expect(evaluateSuccessPredicate(pred, emptyPerception, undefined, timeline)).toBe(true);
    });

    it('returns true when matching count exceeds threshold', () => {
        const timeline = makeTimeline(['say', 'say', 'say', 'say', 'move']);
        expect(evaluateSuccessPredicate(pred, emptyPerception, undefined, timeline)).toBe(true);
    });

    it('matches by substring (partial kind match)', () => {
        const subPred: SuccessPredicate = {
            kind: 'library_event_count',
            eventPattern: 'plan_stage',
            threshold: 2,
        };
        const timeline = makeTimeline(['plan_stage_done', 'plan_stage_blocked', 'say']);
        expect(evaluateSuccessPredicate(subPred, emptyPerception, undefined, timeline)).toBe(true);
    });

    it('ignores entries where kind is not a string', () => {
        const timeline: Array<Record<string, unknown>> = [
            { kind: 'say' },
            { kind: 42 }, // non-string kind
            { noKind: true },
        ];
        expect(evaluateSuccessPredicate(pred, emptyPerception, undefined, timeline)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// items_at_tiles
// ---------------------------------------------------------------------------

describe('evaluateSuccessPredicate — items_at_tiles', () => {
    const pred: SuccessPredicate = {
        kind: 'items_at_tiles',
        objectIds: [100, 200],
        tileCount: 2,
    };

    it('returns false when no nearby objects', () => {
        expect(evaluateSuccessPredicate(pred, emptyPerception)).toBe(false);
    });

    it('returns false when matched count is below tileCount', () => {
        const perception = perceptionWithObjects([100, 999]);
        expect(evaluateSuccessPredicate(pred, perception)).toBe(false);
    });

    it('returns true when matched count meets tileCount', () => {
        const perception = perceptionWithObjects([100, 200]);
        expect(evaluateSuccessPredicate(pred, perception)).toBe(true);
    });

    it('returns true when matched count exceeds tileCount', () => {
        const perception = perceptionWithObjects([100, 200, 100]);
        expect(evaluateSuccessPredicate(pred, perception)).toBe(true);
    });

    it('ignores objects not in the target set', () => {
        const perception = perceptionWithObjects([999, 888, 777]);
        expect(evaluateSuccessPredicate(pred, perception)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// ticks_elapsed
// ---------------------------------------------------------------------------

describe('evaluateSuccessPredicate — ticks_elapsed', () => {
    const pred: SuccessPredicate = { kind: 'ticks_elapsed', ticks: 10 };

    it('returns false when stageStartedAtTick is undefined', () => {
        expect(evaluateSuccessPredicate(pred, perceptionTick100)).toBe(false);
    });

    it('returns false when perception.tick is undefined', () => {
        expect(evaluateSuccessPredicate(pred, emptyPerception, 90)).toBe(false);
    });

    it('returns false when not enough ticks have elapsed', () => {
        // tick=100, startedAt=95, elapsed=5 < 10
        expect(evaluateSuccessPredicate(pred, perceptionTick100, 95)).toBe(false);
    });

    it('returns true when exactly enough ticks have elapsed', () => {
        // tick=100, startedAt=90, elapsed=10 >= 10
        expect(evaluateSuccessPredicate(pred, perceptionTick100, 90)).toBe(true);
    });

    it('returns true when more than enough ticks have elapsed', () => {
        // tick=100, startedAt=50, elapsed=50 >= 10
        expect(evaluateSuccessPredicate(pred, perceptionTick100, 50)).toBe(true);
    });

    it('returns false on the first tick (startedAt == currentTick, elapsed=0)', () => {
        expect(evaluateSuccessPredicate(pred, perceptionTick100, 100)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// self_assessment
// ---------------------------------------------------------------------------

describe('evaluateSuccessPredicate — self_assessment', () => {
    const pred: SuccessPredicate = { kind: 'self_assessment' };

    it('always returns false', () => {
        expect(evaluateSuccessPredicate(pred, emptyPerception)).toBe(false);
    });

    it('always returns false even with timeline and tick data', () => {
        const timeline = makeTimeline(['say', 'say', 'say', 'say', 'say']);
        expect(evaluateSuccessPredicate(pred, perceptionTick100, 50, timeline)).toBe(false);
    });
});
