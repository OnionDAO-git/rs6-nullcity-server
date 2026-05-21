import type { ProgressLine, TrajectoryLine } from './schemas';
import {
    classifyProgressLine,
    classifyTrajectoryLine,
    isDiagnosticTrajectoryLine,
    isStoryProgressLine,
    isStoryTrajectoryLine,
} from './significance';

describe('evidence significance predicates', () => {
    it('promotes resident speech and legacy events to the story lane', () => {
        const say = trajectory({ kind: 'say', text: 'I found a tree.' });
        const legacy = trajectory({ kind: 'legacy_event', event: { cause: 'attention_exhausted', complete: true } });

        expect(isStoryTrajectoryLine(say)).toBe(true);
        expect(classifyTrajectoryLine(say)).toEqual(
            expect.objectContaining({
                lane: 'story',
                storyKind: 'say',
                timelineEvent: expect.objectContaining({ kind: 'say', text: 'I found a tree.' }),
            }),
        );
        expect(classifyTrajectoryLine(legacy)).toEqual(expect.objectContaining({ lane: 'story', storyKind: 'legacy_event' }));
    });

    it('keeps kernel telemetry in the diagnostic lane', () => {
        for (const kind of ['hook', 'budget', 'plan', 'error'] as const) {
            const line = trajectory({ kind });
            expect(isDiagnosticTrajectoryLine(line)).toBe(true);
            expect(isStoryTrajectoryLine(line)).toBe(false);
            expect(classifyTrajectoryLine(line)).toEqual(expect.objectContaining({ lane: 'diagnostic' }));
        }
    });

    it('does not promote routine successful action results', () => {
        const line = trajectory({ kind: 'action_result', status: 'success', reason: 'ok' });

        expect(isStoryTrajectoryLine(line)).toBe(false);
        expect(classifyTrajectoryLine(line)).toEqual(expect.objectContaining({ lane: 'diagnostic' }));
    });

    it('promotes patron events to the story lane', () => {
        const line = trajectory({ kind: 'patron', patronKind: 'patron_gift', patronHandle: 'Alice', artifact: 'tinderbox' });

        expect(classifyTrajectoryLine(line)).toEqual(
            expect.objectContaining({
                lane: 'story',
                storyKind: 'patron_gift',
                timelineEvent: expect.objectContaining({ kind: 'patron_gift', patronHandle: 'Alice', artifact: 'tinderbox' }),
            }),
        );
    });

    it('promotes first peer encounters and repeated peer interactions', () => {
        const target = {
            id: 'resident:res:codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3228, y: 3230, level: 0 },
        };
        const line = trajectory({ kind: 'action', actionKind: 'trade_request', action: { kind: 'trade_request', target } });

        expect(classifyTrajectoryLine(line, { seenPeers: new Set() })).toEqual(
            expect.objectContaining({
                lane: 'story',
                storyKind: 'first_peer_encounter',
                timelineEvent: expect.objectContaining({
                    kind: 'first_peer_encounter',
                    peer: 'Codex',
                    peerId: 'resident:res:codex',
                    actionKind: 'trade_request',
                }),
            }),
        );
        expect(
            classifyTrajectoryLine(line, { seenPeers: new Set(['resident:res:codex']), peerInteractionCounts: new Map([[target.id, 2]]) }),
        ).toEqual(
            expect.objectContaining({
                lane: 'story',
                storyKind: 'relationship_repeated',
                timelineEvent: expect.objectContaining({
                    kind: 'relationship_repeated',
                    peer: 'Codex',
                    peerId: 'resident:res:codex',
                    interactions: 3,
                }),
            }),
        );
    });

    it('promotes first XP gains and stuck recovery from progress lines', () => {
        const firstXp = progress({ meaningful: true, reasons: ['xp_gain:woodcutting:25'] });
        const recovered = progress({ meaningful: true, reasons: ['inventory:+1'] });

        expect(isStoryProgressLine(firstXp, { seenXpSkills: new Set() })).toBe(true);
        expect(classifyProgressLine(firstXp, { seenXpSkills: new Set() })).toEqual(
            expect.objectContaining({ lane: 'story', storyKind: 'first_xp' }),
        );
        expect(classifyProgressLine(recovered, { previousStuckSince: 3 })).toEqual(
            expect.objectContaining({ lane: 'story', storyKind: 'stuck_recovered' }),
        );
    });

    it('does not promote repeat XP gains or non-meaningful progress without a new stuck signal', () => {
        const repeatXp = progress({ meaningful: true, reasons: ['xp_gain:woodcutting:25'] });
        const idle = progress({ meaningful: false, reasons: [], stuckSince: null });

        expect(isStoryProgressLine(repeatXp, { seenXpSkills: new Set(['woodcutting']) })).toBe(false);
        expect(classifyProgressLine(idle)).toEqual(expect.objectContaining({ lane: 'none' }));
    });

    it('promotes newly detected stuck states', () => {
        const line = progress({ meaningful: false, reasons: [], stuckSince: 42 });

        expect(classifyProgressLine(line, { previousStuckSince: null })).toEqual(
            expect.objectContaining({ lane: 'story', storyKind: 'stuck_detected' }),
        );
        expect(classifyProgressLine(line, { previousStuckSince: 42 })).toEqual(expect.objectContaining({ lane: 'none' }));
    });
});

function trajectory(overrides: Partial<TrajectoryLine>): TrajectoryLine {
    return {
        schemaVersion: 1,
        ts: '2026-05-21T11:00:00.000Z',
        tick: 12,
        sessionId: 'session-a',
        kind: 'action',
        ...overrides,
    } as TrajectoryLine;
}

function progress(overrides: Partial<ProgressLine>): ProgressLine {
    return {
        schemaVersion: 1,
        ts: '2026-05-21T11:00:00.000Z',
        tick: 12,
        sessionId: 'session-a',
        kind: 'progress',
        meaningful: false,
        reasons: [],
        stuckSince: null,
        ...overrides,
    };
}
