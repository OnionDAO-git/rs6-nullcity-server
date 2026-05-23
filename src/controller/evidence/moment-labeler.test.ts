import { EVIDENCE_SCHEMA_VERSION, type TrajectoryLine, trajectoryLineSchema } from './schemas';
import { MOMENT_KINDS, type MomentKind, MomentLabeler, type MomentLine } from './moment-labeler';

/**
 * Lightweight trajectory-builder stub. Real TrajectoryBuilder requires an
 * EvidenceStore session; for unit tests we capture lines into an array and
 * validate them against the schema.
 */
function makeSpyBuilder() {
    const lines: TrajectoryLine[] = [];
    const now = new Date('2026-05-23T11:00:00.000Z');
    let tick = 1;
    const builder = {
        append(kind: 'moment', fields: Record<string, unknown>): TrajectoryLine {
            const line: TrajectoryLine = {
                schemaVersion: EVIDENCE_SCHEMA_VERSION,
                ts: now.toISOString(),
                tick,
                sessionId: 'session-test',
                kind,
                ...fields,
            } as TrajectoryLine;
            // Confirm the line still satisfies the trajectory schema after
            // we added the 'moment' kind. If this throws the schema change
            // is broken.
            trajectoryLineSchema.parse(line);
            lines.push(line);
            return line;
        },
        bumpTick() {
            tick += 1;
        },
    };
    return { builder, lines };
}

describe('MomentLabeler (RB-MOMENTS)', () => {
    describe('MOMENT_KINDS exposes the canonical four labels', () => {
        it('lists first_log, fire_lit, stuck_recovery, unsafe_combat_avoided', () => {
            expect([...MOMENT_KINDS].sort()).toEqual(['fire_lit', 'first_log', 'stuck_recovery', 'unsafe_combat_avoided']);
        });
    });

    describe('schemas.ts accepts moment as a trajectory line kind', () => {
        it('round-trips a moment line through trajectoryLineSchema without error', () => {
            const candidate = {
                schemaVersion: EVIDENCE_SCHEMA_VERSION,
                ts: new Date('2026-05-23T11:00:00.000Z').toISOString(),
                tick: 5,
                sessionId: 'session-test',
                kind: 'moment' as const,
                moment: { kind: 'first_log' as MomentKind, detail: { tree: 'tree' } },
            };
            const parsed = trajectoryLineSchema.parse(candidate);
            expect(parsed.kind).toBe('moment');
        });
    });

    describe('noteLogChopped — first_log is once-per-labeler', () => {
        it('emits a first_log moment on the first call only', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteLogChopped({ logItemId: 1511 });
            labeler.noteLogChopped({ logItemId: 1511 });
            labeler.noteLogChopped({ logItemId: 1521 });

            expect(lines).toHaveLength(1);
            const moment = (lines[0] as unknown as MomentLine).moment;
            expect(moment.kind).toBe('first_log');
            expect(moment.detail).toEqual({ logItemId: 1511 });
        });
    });

    describe('noteFireLit — emits every time (reflex already gates dedup)', () => {
        it('emits a fire_lit moment per call', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteFireLit({ position: { x: 3243, y: 3209, level: 0 } });
            labeler.noteFireLit({ position: { x: 3244, y: 3209, level: 0 } });

            expect(lines).toHaveLength(2);
            expect((lines[0] as unknown as MomentLine).moment.kind).toBe('fire_lit');
            expect((lines[0] as unknown as MomentLine).moment.detail).toEqual({ position: { x: 3243, y: 3209, level: 0 } });
            expect((lines[1] as unknown as MomentLine).moment.detail).toEqual({ position: { x: 3244, y: 3209, level: 0 } });
        });
    });

    describe('noteStuckResolved — only emits when duration >= threshold (default 3 ticks)', () => {
        it('does NOT emit when duration < 3 ticks (transient stuck not worth labeling)', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteStuckResolved({ durationTicks: 1, reason: 'pathing' });
            labeler.noteStuckResolved({ durationTicks: 2, reason: 'pathing' });

            expect(lines).toHaveLength(0);
        });

        it('emits a stuck_recovery moment when durationTicks >= 3', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteStuckResolved({ durationTicks: 3, reason: 'fence-open' });
            labeler.noteStuckResolved({ durationTicks: 8, reason: 'asked-for-help' });

            expect(lines).toHaveLength(2);
            const first = (lines[0] as unknown as MomentLine).moment;
            expect(first.kind).toBe('stuck_recovery');
            expect(first.detail).toEqual({ durationTicks: 3, reason: 'fence-open' });
        });

        it('honors a caller-supplied stuckThresholdTicks', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder, stuckThresholdTicks: 10 });

            labeler.noteStuckResolved({ durationTicks: 5, reason: 'whatever' });
            labeler.noteStuckResolved({ durationTicks: 10, reason: 'whatever' });

            expect(lines).toHaveLength(1);
            expect((lines[0] as unknown as MomentLine).moment.detail).toEqual({ durationTicks: 10, reason: 'whatever' });
        });
    });

    describe('noteUnsafeCombatAvoided — emits on every call (nervous-rule preempt is the gate)', () => {
        it('emits an unsafe_combat_avoided moment with the rule id + target', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteUnsafeCombatAvoided({ ruleId: 'flee-when-outmatched', targetName: 'lesser_demon' });

            expect(lines).toHaveLength(1);
            const moment = (lines[0] as unknown as MomentLine).moment;
            expect(moment.kind).toBe('unsafe_combat_avoided');
            expect(moment.detail).toEqual({ ruleId: 'flee-when-outmatched', targetName: 'lesser_demon' });
        });
    });

    describe('reset() — re-arms the once-per-labeler moments (session boundary)', () => {
        it('lets first_log fire again after reset', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteLogChopped({ logItemId: 1511 });
            labeler.noteLogChopped({ logItemId: 1511 });
            expect(lines).toHaveLength(1);

            labeler.reset();
            labeler.noteLogChopped({ logItemId: 1511 });
            expect(lines).toHaveLength(2);
            expect((lines[1] as unknown as MomentLine).moment.kind).toBe('first_log');
        });
    });

    describe('moment payload shape integrates with library timeline consumers', () => {
        it('writes lines whose `moment` field has { kind, detail } and no leaked internal state', () => {
            const { builder, lines } = makeSpyBuilder();
            const labeler = new MomentLabeler({ builder });

            labeler.noteFireLit({ position: { x: 1, y: 2, level: 0 } });

            const line = lines[0] as unknown as MomentLine;
            const allowedKeys = new Set(['kind', 'detail']);
            for (const key of Object.keys(line.moment)) {
                expect(allowedKeys.has(key)).toBe(true);
            }
        });
    });
});
