import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    classifyDecisionCause,
    collectInferenceHealth,
    parseInferenceHealthAuditArgs,
    runInferenceHealthAuditCli,
    type InferenceHealthReport,
} from './inference-health-audit';

describe('inference health audit', () => {
    it('parses defaults with a 30-minute window ending at now', () => {
        const now = new Date('2026-05-31T18:00:00.000Z');
        const options = parseInferenceHealthAuditArgs([], now);

        expect(options.durationMs).toBe(1_800_000);
        expect(options.windowEnd.toISOString()).toBe('2026-05-31T18:00:00.000Z');
        expect(options.windowStart.toISOString()).toBe('2026-05-31T17:30:00.000Z');
        expect(options.trajectoryRoot).toBe(path.join('data', 'controller', 'memory'));
        expect(options.outputDir).toBe(path.join('data', 'benchmarks', 'capability-qa-2026-05-31', 'inference-audit'));
    });

    it('honours --start/--end/--trajectory-root/--output overrides', () => {
        const now = new Date('2026-05-31T18:00:00.000Z');
        const options = parseInferenceHealthAuditArgs(
            [
                '--start=2026-05-31T10:00:00.000Z',
                '--end=2026-05-31T10:30:00.000Z',
                '--trajectory-root=/tmp/traj',
                '--output=/tmp/out',
                '--top=5',
                '--exclude-prefix=res:test_',
            ],
            now,
        );

        expect(options.windowStart.toISOString()).toBe('2026-05-31T10:00:00.000Z');
        expect(options.windowEnd.toISOString()).toBe('2026-05-31T10:30:00.000Z');
        expect(options.trajectoryRoot).toBe('/tmp/traj');
        expect(options.outputDir).toBe('/tmp/out');
        expect(options.maxTopRows).toBe(5);
        expect(options.excludeResidentPrefixes).toContain('res:test_');
    });

    describe('classifyDecisionCause', () => {
        it('maps every salvage class onto a health class (SPARK + brain spellings)', () => {
            // clean / usable
            expect(classifyDecisionCause('completion_action')).toBe('clean');
            expect(classifyDecisionCause('plan_generated')).toBe('clean');
            expect(classifyDecisionCause('brain_goal')).toBe('clean');
            expect(classifyDecisionCause('candidate_fallback')).toBe('clean');
            expect(classifyDecisionCause('empty_completion_idle_initiative')).toBe('clean');
            expect(classifyDecisionCause('brain_clean')).toBe('clean');

            // recovered_* — was broken, parser salvaged it
            expect(classifyDecisionCause('empty_completion_recovered_after_think_strip')).toBe('recovered');
            expect(classifyDecisionCause('empty_completion_recovered_from_fence')).toBe('recovered');
            expect(classifyDecisionCause('empty_completion_recovered_trailing_comma')).toBe('recovered');
            expect(classifyDecisionCause('empty_completion_salvaged_lenient')).toBe('recovered');
            expect(classifyDecisionCause('brain_recovered_after_think_strip')).toBe('recovered');
            expect(classifyDecisionCause('brain_salvaged_lenient')).toBe('recovered');

            // truncation (bucket B)
            expect(classifyDecisionCause('empty_completion_think_only_no_answer')).toBe('think_only_no_answer');
            expect(classifyDecisionCause('brain_think_only_no_answer')).toBe('think_only_no_answer');

            // reflex pre-emption (bucket C)
            expect(classifyDecisionCause('thinking_cancelled')).toBe('thinking_cancelled');
            expect(classifyDecisionCause('thinking_watchdog_timeout')).toBe('thinking_cancelled');

            // schema mismatch
            expect(classifyDecisionCause('empty_completion_schema_mismatch')).toBe('schema_mismatch');
            expect(classifyDecisionCause('brain_schema_mismatch')).toBe('schema_mismatch');
            expect(classifyDecisionCause('completion_parse_failed')).toBe('schema_mismatch');

            // truly empty (bare empty_completion is conservatively truly_empty)
            expect(classifyDecisionCause('empty_completion')).toBe('truly_empty');
            expect(classifyDecisionCause('empty_completion_truly_empty')).toBe('truly_empty');
            expect(classifyDecisionCause('brain_truly_empty')).toBe('truly_empty');
            expect(classifyDecisionCause(undefined)).toBe('truly_empty');
            expect(classifyDecisionCause('')).toBe('truly_empty');
        });
    });

    it('rolls up a mixed-cause fixture per resident and in aggregate', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-health-'));
        const trajectoryRoot = path.join(root, 'memory');

        // res:agent — 8 brain-eligible decisions covering every class:
        //   clean x2, recovered x2, think_only x1, cancelled x1, schema x1, empty x1
        // usable = (2 + 2) / 8 = 0.5
        writeTrajectory(trajectoryRoot, 'res:agent', [
            decision('2026-05-31T17:31:00.000Z', 'completion_action'),
            decision('2026-05-31T17:32:00.000Z', 'brain_goal', { planChange: { id: 'goal:harvest', steps: 3 } }),
            decision('2026-05-31T17:33:00.000Z', 'empty_completion_recovered_after_think_strip'),
            decision('2026-05-31T17:34:00.000Z', 'empty_completion_salvaged_lenient'),
            decision('2026-05-31T17:35:00.000Z', 'empty_completion_think_only_no_answer'),
            decision('2026-05-31T17:36:00.000Z', 'thinking_cancelled'),
            decision('2026-05-31T17:37:00.000Z', 'empty_completion_schema_mismatch'),
            decision('2026-05-31T17:38:00.000Z', 'empty_completion'),
            // planning: 4 attributable actions, 3 carry a goalId
            action('2026-05-31T17:31:05.000Z', 'move_to', 'goal:harvest'),
            sayLine('2026-05-31T17:32:05.000Z', 'goal:harvest'),
            action('2026-05-31T17:33:05.000Z', 'interact', 'goal:cook'),
            action('2026-05-31T17:34:05.000Z', 'eat'), // no goalId
        ]);

        // res:hero — 4 decisions: clean x3, truly_empty x1 → usable 0.75
        writeTrajectory(trajectoryRoot, 'res:hero', [
            decision('2026-05-31T17:40:00.000Z', 'completion_action'),
            decision('2026-05-31T17:41:00.000Z', 'plan_generated', { planChange: { id: 'goal:patrol', steps: 2 } }),
            decision('2026-05-31T17:42:00.000Z', 'brain_clean'),
            decision('2026-05-31T17:43:00.000Z', 'brain_truly_empty'),
            action('2026-05-31T17:40:05.000Z', 'move_to', 'goal:patrol'),
        ]);

        // benchmark resident excluded by default prefix
        writeTrajectory(trajectoryRoot, 'res:bmk_runner', [decision('2026-05-31T17:41:00.000Z', 'completion_action')]);

        // out-of-window decision is ignored
        writeTrajectory(trajectoryRoot, 'res:stale', [decision('2026-05-31T10:00:00.000Z', 'completion_action')]);

        const report = collectInferenceHealth({
            trajectoryRoot,
            windowStart: new Date('2026-05-31T17:30:00.000Z'),
            windowEnd: new Date('2026-05-31T18:00:00.000Z'),
            generatedAt: new Date('2026-05-31T18:00:00.000Z'),
        });

        // only res:agent + res:hero counted
        expect(report.activeResidents).toBe(2);
        expect(report.brainEligibleDecisions).toBe(12);

        // aggregate breakdown: agent(2,2,1,1,1,1) + hero(3,0,0,0,0,1)
        expect(report.breakdown).toEqual({
            clean: 5,
            recovered: 2,
            think_only_no_answer: 1,
            thinking_cancelled: 1,
            schema_mismatch: 1,
            truly_empty: 2,
        });
        // headline: (5 + 2) / 12 = 0.5833
        expect(report.usableBrainDecisionRate).toBe(0.5833);
        expect(report.hasBrainSignal).toBe(true);

        // planning aggregate: agent 3/4 + hero 1/1 = 4/5
        expect(report.goalAttributedActions).toBe(4);
        expect(report.totalAttributableActions).toBe(5);
        expect(report.goalFollowThroughRate).toBe(0.8);
        // distinct goals: agent {goal:harvest, goal:cook} = 2 ; hero {goal:patrol} = 1
        expect(report.goalsEmitted).toBe(3);

        const agent = report.residentSlices.find(s => s.resident === 'res:agent');
        expect(agent).toBeDefined();
        expect(agent!.brainEligibleDecisions).toBe(8);
        expect(agent!.usableBrainDecisionRate).toBe(0.5);
        expect(agent!.breakdown).toEqual({
            clean: 2,
            recovered: 2,
            think_only_no_answer: 1,
            thinking_cancelled: 1,
            schema_mismatch: 1,
            truly_empty: 1,
        });
        expect(agent!.goalsEmitted).toBe(2);
        expect(agent!.goalAttributedActions).toBe(3);
        expect(agent!.goalFollowThroughRate).toBe(0.75);

        const hero = report.residentSlices.find(s => s.resident === 'res:hero');
        expect(hero!.usableBrainDecisionRate).toBe(0.75);

        fs.rmSync(root, { recursive: true, force: true });
    });

    it('writes a JSON artifact and reports a no-signal window without failing', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-health-cli-'));
        const trajectoryRoot = path.join(root, 'memory');
        const outputDir = path.join(root, 'out');

        writeTrajectory(trajectoryRoot, 'res:agent', [
            decision('2026-05-31T17:31:00.000Z', 'completion_action'),
            decision('2026-05-31T17:32:00.000Z', 'empty_completion_recovered_from_fence'),
        ]);

        const stdout: string[] = [];
        const code = await runInferenceHealthAuditCli(
            [
                `--trajectory-root=${trajectoryRoot}`,
                `--output=${outputDir}`,
                '--start=2026-05-31T17:30:00.000Z',
                '--end=2026-05-31T18:00:00.000Z',
            ],
            { stdout: chunk => stdout.push(chunk), now: new Date('2026-05-31T18:00:00.000Z') },
        );

        expect(code).toBe(0);
        const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
        expect(files).toHaveLength(1);
        const report: InferenceHealthReport = JSON.parse(fs.readFileSync(path.join(outputDir, files[0]), 'utf8'));
        expect(report.usableBrainDecisionRate).toBe(1); // clean + recovered = 2/2
        expect(stdout.join('')).toContain('usable-brain-rate=100.0%');

        // empty window → no brain signal, still exit 0
        const stdout2: string[] = [];
        const emptyCode = await runInferenceHealthAuditCli(
            [
                `--trajectory-root=${trajectoryRoot}`,
                `--output=${outputDir}`,
                '--start=2020-01-01T00:00:00.000Z',
                '--end=2020-01-01T00:30:00.000Z',
            ],
            { stdout: chunk => stdout2.push(chunk), now: new Date('2026-05-31T18:00:00.000Z') },
        );
        expect(emptyCode).toBe(0);
        expect(stdout2.join('')).toContain('NO brain-eligible decisions');

        fs.rmSync(root, { recursive: true, force: true });
    });
});

function residentSlug(resident: string): string {
    return resident.replace(':', '-');
}

function writeTrajectory(trajectoryRoot: string, resident: string, lines: Record<string, unknown>[]): void {
    const dir = path.join(trajectoryRoot, residentSlug(resident), 'evidence', 'trajectory');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, '20260531T000000Z-session.jsonl');
    fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8');
}

function decision(ts: string, cause: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { schemaVersion: 1, ts, tick: 1, sessionId: 'session', kind: 'decision', cause, ...extra };
}

function action(ts: string, actionKind: string, goalId?: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        ts,
        tick: 1,
        sessionId: 'session',
        kind: 'action',
        actionKind,
        action: { kind: actionKind },
        ...(goalId ? { goalId } : {}),
    };
}

function sayLine(ts: string, goalId?: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        ts,
        tick: 1,
        sessionId: 'session',
        kind: 'say',
        actionKind: 'say',
        action: { kind: 'say', text: 'hi' },
        text: 'hi',
        ...(goalId ? { goalId } : {}),
    };
}
