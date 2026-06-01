import {
    scoreOrientationAction,
    OrientationStallTracker,
    ORIENTATION_STALL_WINDOW,
    type OrientationProgressLibraryEvent,
    type OrientationStalledLibraryEvent,
} from './orientation-scorer';

// ---------------------------------------------------------------------------
// scoreOrientationAction
// ---------------------------------------------------------------------------

describe('scoreOrientationAction', () => {
    const goalId = 'master-woodcutting';

    it('detects progress when currentGoalId matches orientationGoalId', () => {
        const result = scoreOrientationAction({
            orientationGoalId: goalId,
            currentGoalId: goalId,
        });
        expect(result.progressDetected).toBe(true);
        expect(result.reason).toBe('goal_id_match');
    });

    it('detects progress when an actionTag exactly equals orientationGoalId', () => {
        const result = scoreOrientationAction({
            orientationGoalId: goalId,
            actionTags: ['some-other-tag', goalId],
        });
        expect(result.progressDetected).toBe(true);
        expect(result.reason).toBe('action_tag_match');
    });

    it('detects progress when an actionTag starts with orientationGoalId + colon', () => {
        const result = scoreOrientationAction({
            orientationGoalId: goalId,
            actionTags: [`${goalId}:level-60`],
        });
        expect(result.progressDetected).toBe(true);
        expect(result.reason).toBe('action_tag_match');
    });

    it('prefers goal_id_match over action_tag_match when both are present', () => {
        const result = scoreOrientationAction({
            orientationGoalId: goalId,
            currentGoalId: goalId,
            actionTags: [goalId],
        });
        expect(result.progressDetected).toBe(true);
        expect(result.reason).toBe('goal_id_match');
    });

    it('returns no progress when currentGoalId is a different goal', () => {
        const result = scoreOrientationAction({
            orientationGoalId: goalId,
            currentGoalId: 'collect-visible-gp',
        });
        expect(result.progressDetected).toBe(false);
        expect(result.reason).toBeUndefined();
    });

    it('returns no progress when actionTags do not match', () => {
        const result = scoreOrientationAction({
            orientationGoalId: goalId,
            actionTags: ['firemaking', 'fishing', 'cooking'],
        });
        expect(result.progressDetected).toBe(false);
    });

    it('returns no progress when both currentGoalId and actionTags are absent', () => {
        const result = scoreOrientationAction({ orientationGoalId: goalId });
        expect(result.progressDetected).toBe(false);
    });

    it('returns no progress when actionTags is empty', () => {
        const result = scoreOrientationAction({ orientationGoalId: goalId, actionTags: [] });
        expect(result.progressDetected).toBe(false);
    });

    it('does NOT match a tag that merely contains the goal id as a substring', () => {
        const result = scoreOrientationAction({
            orientationGoalId: 'wood',
            actionTags: ['master-woodcutting'],
        });
        expect(result.progressDetected).toBe(false);
    });

    it('matches a tag that starts with goalId followed by a colon but not another char', () => {
        expect(
            scoreOrientationAction({
                orientationGoalId: 'wood',
                actionTags: ['wood:chop'],
            }).progressDetected,
        ).toBe(true);

        expect(
            scoreOrientationAction({
                orientationGoalId: 'wood',
                actionTags: ['woodchop'],
            }).progressDetected,
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// OrientationStallTracker
// ---------------------------------------------------------------------------

describe('OrientationStallTracker', () => {
    it('returns zero non-progress ticks on first progress tick', () => {
        const tracker = new OrientationStallTracker(3);
        const result = tracker.record(true);
        expect(result.nonProgressTicks).toBe(0);
        expect(result.newStall).toBe(false);
        expect(result.alreadyStalled).toBe(false);
    });

    it('increments non-progress ticks on each non-progress tick below window', () => {
        const tracker = new OrientationStallTracker(5);
        expect(tracker.record(false).nonProgressTicks).toBe(1);
        expect(tracker.record(false).nonProgressTicks).toBe(2);
        expect(tracker.record(false).nonProgressTicks).toBe(3);
        expect(tracker.record(false).newStall).toBe(false);
    });

    it('signals newStall=true exactly when the window is crossed', () => {
        const tracker = new OrientationStallTracker(3);
        tracker.record(false); // tick 1
        tracker.record(false); // tick 2
        const result = tracker.record(false); // tick 3 — crosses window
        expect(result.newStall).toBe(true);
        expect(result.alreadyStalled).toBe(false);
        expect(result.nonProgressTicks).toBe(3);
    });

    it('signals alreadyStalled on ticks after the crossing tick', () => {
        const tracker = new OrientationStallTracker(3);
        tracker.record(false);
        tracker.record(false);
        tracker.record(false); // crossing tick
        const after = tracker.record(false); // subsequent tick
        expect(after.newStall).toBe(false);
        expect(after.alreadyStalled).toBe(true);
        expect(after.nonProgressTicks).toBe(4);
    });

    it('resets counter and stallEmitted on progress', () => {
        const tracker = new OrientationStallTracker(3);
        tracker.record(false);
        tracker.record(false);
        tracker.record(false); // stall crossed
        const reset = tracker.record(true); // progress
        expect(reset.nonProgressTicks).toBe(0);
        expect(reset.newStall).toBe(false);
        expect(reset.alreadyStalled).toBe(false);
    });

    it('allows a fresh stall after progress resets the tracker', () => {
        const tracker = new OrientationStallTracker(2);
        tracker.record(false);
        tracker.record(false); // newStall = true
        tracker.record(true); // reset
        tracker.record(false); // tick 1 again
        const newStall2 = tracker.record(false); // should fire again
        expect(newStall2.newStall).toBe(true);
    });

    it('reset() clears counter and stallEmitted allowing fresh detection', () => {
        const tracker = new OrientationStallTracker(2);
        tracker.record(false);
        tracker.record(false); // stall emitted
        tracker.reset();
        expect(tracker.nonProgressTicks).toBe(0);
        tracker.record(false);
        const refired = tracker.record(false); // should fire again after reset
        expect(refired.newStall).toBe(true);
    });

    it('uses ORIENTATION_STALL_WINDOW as default', () => {
        const tracker = new OrientationStallTracker();
        for (let i = 0; i < ORIENTATION_STALL_WINDOW - 1; i++) {
            const r = tracker.record(false);
            expect(r.newStall).toBe(false);
        }
        const crossing = tracker.record(false);
        expect(crossing.newStall).toBe(true);
        expect(crossing.nonProgressTicks).toBe(ORIENTATION_STALL_WINDOW);
    });
});

// ---------------------------------------------------------------------------
// Fixture stream integration: scorer + tracker + event shape
// ---------------------------------------------------------------------------

describe('OrientationScorer + StallTracker fixture stream', () => {
    const goalId = 'kill-kbd';
    const goalDescription = 'Kill the King Black Dragon someday';

    function makeProgressEvent(tick: number, reason: 'goal_id_match' | 'action_tag_match'): OrientationProgressLibraryEvent {
        return {
            kind: 'orientation_progress',
            ts: new Date(tick * 1000).toISOString(),
            tick,
            orientationGoalId: goalId,
            orientationGoalDescription: goalDescription,
            reason,
        };
    }

    function makeStalledEvent(tick: number, nonProgressTicks: number): OrientationStalledLibraryEvent {
        return {
            kind: 'orientation_stalled',
            ts: new Date(tick * 1000).toISOString(),
            tick,
            orientationGoalId: goalId,
            orientationGoalDescription: goalDescription,
            nonProgressTicks,
        };
    }

    it('produces the right event sequence for a fixture action stream', () => {
        const tracker = new OrientationStallTracker(3); // small window for test speed

        type StreamEntry = { currentGoalId?: string; actionTags?: string[] };
        const stream: StreamEntry[] = [
            { currentGoalId: goalId }, // tick 0: progress (goal match)
            { currentGoalId: 'earn-gp' }, // tick 1: no progress
            { currentGoalId: 'earn-gp' }, // tick 2: no progress
            { actionTags: [`${goalId}:combat`] }, // tick 3: progress (tag match) — resets stall
            { currentGoalId: 'earn-gp' }, // tick 4: no progress
            { currentGoalId: 'earn-gp' }, // tick 5: no progress
            { currentGoalId: 'earn-gp' }, // tick 6: no progress (3rd since last progress → stall)
            { currentGoalId: 'earn-gp' }, // tick 7: still stalled (alreadyStalled)
        ];

        const progressEvents: OrientationProgressLibraryEvent[] = [];
        const stalledEvents: OrientationStalledLibraryEvent[] = [];

        stream.forEach((entry, tick) => {
            const scored = scoreOrientationAction({
                orientationGoalId: goalId,
                currentGoalId: entry.currentGoalId,
                actionTags: entry.actionTags,
            });

            if (scored.progressDetected && scored.reason) {
                progressEvents.push(makeProgressEvent(tick, scored.reason));
            }

            const stall = tracker.record(scored.progressDetected);
            if (stall.newStall) {
                stalledEvents.push(makeStalledEvent(tick, stall.nonProgressTicks));
            }
        });

        // Expect 2 progress events (ticks 0 and 3)
        expect(progressEvents).toHaveLength(2);
        expect(progressEvents[0].tick).toBe(0);
        expect(progressEvents[0].reason).toBe('goal_id_match');
        expect(progressEvents[0].kind).toBe('orientation_progress');
        expect(progressEvents[1].tick).toBe(3);
        expect(progressEvents[1].reason).toBe('action_tag_match');

        // Expect exactly 1 stall event (tick 6, 3 non-progress ticks after tick 3 reset)
        expect(stalledEvents).toHaveLength(1);
        expect(stalledEvents[0].tick).toBe(6);
        expect(stalledEvents[0].nonProgressTicks).toBe(3);
        expect(stalledEvents[0].kind).toBe('orientation_stalled');

        // Tick 7 should NOT produce another stall event (alreadyStalled, not newStall)
        expect(stalledEvents).toHaveLength(1);
    });

    it('emits no events for a stream with zero orientation actions', () => {
        const tracker = new OrientationStallTracker(10);
        const noOrientationStream = Array.from({ length: 5 }, () => ({ currentGoalId: 'earn-gp' }));

        const events: (OrientationProgressLibraryEvent | OrientationStalledLibraryEvent)[] = [];
        noOrientationStream.forEach((entry, tick) => {
            const scored = scoreOrientationAction({ orientationGoalId: goalId, currentGoalId: entry.currentGoalId });
            if (scored.progressDetected && scored.reason) {
                events.push(makeProgressEvent(tick, scored.reason));
            }
            const stall = tracker.record(scored.progressDetected);
            if (stall.newStall) {
                events.push(makeStalledEvent(tick, stall.nonProgressTicks));
            }
        });

        // Window is 10 but only 5 ticks — no stall, no progress
        expect(events).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Library event schema validation
// ---------------------------------------------------------------------------

describe('OrientationProgressLibraryEvent shape', () => {
    it('has the expected fields', () => {
        const event: OrientationProgressLibraryEvent = {
            kind: 'orientation_progress',
            ts: '2026-05-31T00:00:00.000Z',
            tick: 42,
            orientationGoalId: 'master-wc',
            orientationGoalDescription: 'Master woodcutting',
            reason: 'goal_id_match',
        };
        expect(event.kind).toBe('orientation_progress');
        expect(typeof event.orientationGoalId).toBe('string');
        expect('nonProgressTicks' in (event as unknown as Record<string, unknown>)).toBe(false);
    });
});

describe('OrientationStalledLibraryEvent shape', () => {
    it('has the expected fields', () => {
        const event: OrientationStalledLibraryEvent = {
            kind: 'orientation_stalled',
            ts: '2026-05-31T00:00:00.000Z',
            tick: 200,
            orientationGoalId: 'master-wc',
            orientationGoalDescription: 'Master woodcutting',
            nonProgressTicks: 100,
        };
        expect(event.kind).toBe('orientation_stalled');
        expect(event.nonProgressTicks).toBe(100);
        expect('reason' in (event as unknown as Record<string, unknown>)).toBe(false);
    });
});
