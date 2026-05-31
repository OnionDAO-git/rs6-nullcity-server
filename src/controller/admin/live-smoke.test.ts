import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { formatLiveSmokeSummary, observeLiveResidents, parseLiveSmokeCliArgs, runLiveSmokeCli, summarizeLiveResidents } from './live-smoke';

describe('live smoke CLI helpers', () => {
    let memoryDir: string;

    beforeEach(() => {
        memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-live-smoke-test-'));
    });

    afterEach(() => {
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('summarizes recent visible resident action from runtime trajectory evidence', () => {
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 118 });
        writeTrajectory('res:agent', [
            { tick: 115, kind: 'say', action: { kind: 'say' }, text: 'I am scouting the sheep field.' },
            { tick: 116, kind: 'action', action: { kind: 'move_to', cause: 'explore_patrol' } },
            { tick: 117, kind: 'action_result', status: 'success' },
            { tick: 118, kind: 'action', action: { kind: 'interact', cause: 'woodcutting_level1_routine' } },
            { tick: 119, kind: 'action_result', status: 'success' },
        ]);

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:agent'], windowTicks: 30 });

        expect(summary).toMatchObject({
            resident: 'res:agent',
            status: 'ok',
            tick: 120,
            recent: {
                actions: 2,
                results: 2,
                successes: 2,
                failures: 0,
                timeouts: 0,
                says: 1,
            },
            lastSay: 'I am scouting the sheep field.',
            lastAction: 'interact',
            issues: [],
        });
    });

    it('flags residents that are ticking but not visibly acting and have been stuck too long', () => {
        writeResidentState('res:agent', { tick: 220, lastMeaningfulProgressAt: 80, stuckSince: 70 });
        writeTrajectory('res:agent', [
            { tick: 216, kind: 'begin_tick' },
            { tick: 217, kind: 'decision', cause: 'body_wait' },
            { tick: 218, kind: 'end_tick', reason: 'tick_complete' },
        ]);

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:agent'], windowTicks: 30, maxStuckTicks: 90 });

        expect(summary.status).toBe('warn');
        expect(summary.issues).toEqual(expect.arrayContaining(['no_recent_visible_activity', 'stuck_for_150_ticks']));
    });

    it('flags residents stuck in repeated no-action decisions even when they still talk', () => {
        writeResidentState('res:agent', { tick: 260, lastMeaningfulProgressAt: 255, stuckSince: 259 });
        writeTrajectory('res:agent', [
            { tick: 230, kind: 'say', text: 'I am hurt. Holding near safety until I find food or heal.' },
            { tick: 231, kind: 'action_result', status: 'success', reason: 'success' },
            ...Array.from({ length: 30 }, (_, index) => ({
                tick: 231 + index,
                kind: 'decision',
                cause: 'low_health_hold_position',
                actionKinds: [],
            })),
        ]);

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:agent'], windowTicks: 40, maxStuckTicks: 90 });

        expect(summary.status).toBe('warn');
        expect(summary.recent).toMatchObject({ actions: 0, decisions: 30, says: 1, results: 1 });
        expect(summary.issues).toContain('decision_loop_without_actions:low_health_hold_position');
    });

    it('accepts follow listen holds when the resident keeps visible speech alive', () => {
        writeResidentState('res:qa-trader', { tick: 300, lastMeaningfulProgressAt: 299, stuckSince: 299 });
        writeTrajectory('res:qa-trader', [
            { tick: 260, kind: 'say', text: 'I have starter supplies ready. Say "trade trade me" to trade.' },
            { tick: 261, kind: 'action_result', status: 'success', reason: 'success' },
            ...Array.from({ length: 30 }, (_, index) => ({
                tick: 262 + index,
                kind: 'decision',
                cause: 'follow_listen_hold',
                actionKinds: [],
            })),
            { tick: 292, kind: 'say', text: 'I have starter supplies ready. Say "trade inventory" to inspect them.' },
            { tick: 293, kind: 'action_result', status: 'success', reason: 'success' },
        ]);

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:qa-trader'], windowTicks: 50, maxStuckTicks: 90 });

        expect(summary.status).toBe('ok');
        expect(summary.recent).toMatchObject({ actions: 0, decisions: 30, says: 2, results: 2 });
        expect(summary.issues).not.toContain('decision_loop_without_actions:follow_listen_hold');
    });

    it('auto-discovers only resident directories with runtime state', () => {
        fs.mkdirSync(path.join(memoryDir, 'library'), { recursive: true });
        fs.mkdirSync(path.join(memoryDir, 'data'), { recursive: true });
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);

        const summaries = summarizeLiveResidents({ memoryDir, windowTicks: 30 });

        expect(summaries.map(summary => summary.resident)).toEqual(['res:agent']);
    });

    it('ignores older higher-tick trajectory files after a controller tick reset', () => {
        writeResidentState('res:agent', { tick: 20, lastMeaningfulProgressAt: 18, stuckSince: 19 });
        writeTrajectory(
            'res:agent',
            [
                { tick: 995, kind: 'action', action: { kind: 'move_to' } },
                { tick: 996, kind: 'action_result', status: 'timeout' },
            ],
            '20260525T010000Z-old-session.jsonl',
        );
        writeTrajectory(
            'res:agent',
            [
                { tick: 18, kind: 'say', text: 'Fresh session.' },
                { tick: 19, kind: 'action', action: { kind: 'move_to' } },
                { tick: 20, kind: 'action_result', status: 'success' },
            ],
            '20260525T030000Z-current-session.jsonl',
        );

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:agent'], windowTicks: 30, maxStuckTicks: 90 });

        expect(summary).toMatchObject({
            tick: 20,
            lastTrajectoryTick: 20,
            status: 'ok',
            recent: { actions: 1, results: 1, successes: 1, timeouts: 0, says: 1 },
            issues: [],
        });
    });

    it('ignores older same-range trajectory files after a controller tick reset', () => {
        writeResidentState('res:agent', { tick: 20, lastMeaningfulProgressAt: 18, stuckSince: 19 });
        writeTrajectory(
            'res:agent',
            [
                { tick: 18, kind: 'action', action: { kind: 'move_to' }, sessionId: 'old-session' },
                { tick: 19, kind: 'action_result', status: 'timeout', sessionId: 'old-session' },
            ],
            '20260525T010000Z-old-session.jsonl',
        );
        writeTrajectory(
            'res:agent',
            [
                { tick: 18, kind: 'say', text: 'Fresh session.', sessionId: 'new-session' },
                { tick: 19, kind: 'action', action: { kind: 'move_to' }, sessionId: 'new-session' },
                { tick: 20, kind: 'action_result', status: 'success', sessionId: 'new-session' },
            ],
            '20260525T030000Z-current-session.jsonl',
        );

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:agent'], windowTicks: 30, maxStuckTicks: 90 });

        expect(summary).toMatchObject({
            tick: 20,
            lastTrajectoryTick: 20,
            status: 'ok',
            recent: { actions: 1, results: 1, successes: 1, timeouts: 0, says: 1 },
            issues: [],
        });
    });

    it('uses current trajectory ticks for recent activity when runtime ticks are cumulative', () => {
        writeResidentState('res:duke-horacio', { tick: 136_400, lastMeaningfulProgressAt: 136_395, stuckSince: 136_400 });
        writeTrajectory('res:duke-horacio', [
            { tick: 6645, kind: 'say', text: 'Still here as Duke Horacio; getting my bearings.', sessionId: 'current-session' },
            { tick: 6646, kind: 'action', action: { kind: 'move_to', cause: 'watchdog_fallback' }, sessionId: 'current-session' },
            { tick: 6646, kind: 'action_result', status: 'success', sessionId: 'current-session' },
            { tick: 6769, kind: 'end_tick', reason: 'tick_complete', sessionId: 'current-session' },
        ]);

        const [summary] = summarizeLiveResidents({ memoryDir, residents: ['res:duke-horacio'], windowTicks: 130, maxStuckTicks: 90 });

        expect(summary.tick).toBe(136_400);
        expect(summary.lastTrajectoryTick).toBe(6769);
        expect(summary.status).toBe('ok');
        expect(summary.recent).toMatchObject({ actions: 1, results: 1, successes: 1, says: 1 });
        expect(summary.issues).not.toContain('no_recent_visible_activity');
    });

    it('parses config, memory, resident, window, and fail-on-warn CLI options', () => {
        expect(
            parseLiveSmokeCliArgs([
                '--config',
                'controller.local.yml',
                '--memory-dir',
                '/tmp/memory',
                '--resident',
                'res:agent',
                '--window-ticks=80',
                '--max-stuck-ticks',
                '40',
                '--observe-seconds',
                '60',
                '--poll-ms=25',
                '--min-observed-actions',
                '2',
                '--min-observed-says=1',
                '--allow-recent-visible',
                '--json',
                '--fail-on-warn',
            ]),
        ).toEqual({
            configPath: 'controller.local.yml',
            memoryDir: '/tmp/memory',
            residents: ['res:agent'],
            windowTicks: 80,
            maxStuckTicks: 40,
            observeSeconds: 60,
            pollMs: 25,
            minObservedActions: 2,
            minObservedSays: 1,
            allowRecentVisible: true,
            json: true,
            failOnWarn: true,
        });
    });

    it('parses live-smoke options from environment variables', () => {
        const oldEnv = { ...process.env };
        process.env.CONTROLLER_CONFIG = 'controller.env.yml';
        process.env.CONTROLLER_MEMORY_DIR = '/env/memory';
        process.env.CONTROLLER_SMOKE_RESIDENTS = 'res:agent,res:mother-anvil';
        process.env.CONTROLLER_SMOKE_WINDOW_TICKS = '100';
        process.env.CONTROLLER_SMOKE_MAX_STUCK_TICKS = '50';
        process.env.CONTROLLER_SMOKE_OBSERVE_SECONDS = '30';
        process.env.CONTROLLER_SMOKE_POLL_MS = '500';
        process.env.CONTROLLER_SMOKE_MIN_OBSERVED_ACTIONS = '5';
        process.env.CONTROLLER_SMOKE_MIN_OBSERVED_SAYS = '3';
        process.env.CONTROLLER_SMOKE_ALLOW_RECENT_VISIBLE = 'true';
        process.env.CONTROLLER_SMOKE_JSON = '1';
        process.env.CONTROLLER_SMOKE_FAIL_ON_WARN = 'true';

        try {
            expect(parseLiveSmokeCliArgs([])).toEqual({
                configPath: 'controller.env.yml',
                memoryDir: '/env/memory',
                residents: ['res:agent', 'res:mother-anvil'],
                windowTicks: 100,
                maxStuckTicks: 50,
                observeSeconds: 30,
                pollMs: 500,
                minObservedActions: 5,
                minObservedSays: 3,
                allowRecentVisible: true,
                json: true,
                failOnWarn: true,
            });
        } finally {
            process.env = oldEnv;
        }
    });

    it('observes new visible activity over a timed live window', async () => {
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            observeMs: 100,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 124, lastMeaningfulProgressAt: 124 });
                writeTrajectory('res:agent', [
                    { tick: 119, kind: 'action_result', status: 'success' },
                    { tick: 121, kind: 'say', text: 'I am heading back to the castle path.' },
                    { tick: 122, kind: 'action', action: { kind: 'move_to', cause: 'return_to_anchor' } },
                    { tick: 123, kind: 'action_result', status: 'success' },
                    { tick: 124, kind: 'decision', cause: 'body_routine' },
                ]);
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({
            durationMs: 100,
            tickDelta: 4,
            actions: 1,
            results: 1,
            successes: 1,
            says: 1,
            decisions: 1,
        });
        expect(summary.issues).not.toContain('no_observed_visible_activity');
    });

    it('allows recently visible ticking residents to stay ok in cohort observation mode', async () => {
        writeResidentState('res:hans', { tick: 200, lastMeaningfulProgressAt: 198, stuckSince: 200 });
        writeTrajectory('res:hans', [
            { tick: 196, kind: 'say', text: 'Still here as Hans; watching the area.' },
            { tick: 197, kind: 'action', action: { kind: 'move_to', cause: 'idle_initiative' } },
            { tick: 198, kind: 'action_result', status: 'success' },
        ]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:hans'],
            observeMs: 100,
            allowRecentVisible: true,
            sleep: async () => {
                writeResidentState('res:hans', { tick: 204, lastMeaningfulProgressAt: 198, stuckSince: 204 });
                writeTrajectory('res:hans', [
                    { tick: 196, kind: 'say', text: 'Still here as Hans; watching the area.' },
                    { tick: 197, kind: 'action', action: { kind: 'move_to', cause: 'idle_initiative' } },
                    { tick: 198, kind: 'action_result', status: 'success' },
                    { tick: 201, kind: 'decision', cause: 'hook_noop' },
                    { tick: 202, kind: 'decision', cause: 'hook_noop' },
                ]);
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({ tickDelta: 4, visibleEvents: 0 });
        expect(summary.issues).not.toContain('no_observed_visible_activity');
    });

    it('uses trajectory tick progress when runtime ticks are cumulative and unchanged during observation', async () => {
        writeResidentState('res:pip', { tick: 138_252, lastMeaningfulProgressAt: 138_245, stuckSince: 138_252 });
        writeTrajectory('res:pip', [{ tick: 21_620, kind: 'end_tick', reason: 'tick_complete', sessionId: 'current-session' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:pip'],
            observeMs: 50,
            sleep: async () => {
                writeResidentState('res:pip', { tick: 138_252, lastMeaningfulProgressAt: 138_245, stuckSince: 138_252 });
                writeTrajectory('res:pip', [
                    { tick: 21_620, kind: 'end_tick', reason: 'tick_complete', sessionId: 'current-session' },
                    { tick: 21_621, kind: 'begin_tick', sessionId: 'current-session' },
                    {
                        tick: 21_622,
                        kind: 'say',
                        text: 'Still here as Pip; getting my bearings near my post.',
                        sessionId: 'current-session',
                    },
                ]);
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({ startTick: 21_620, endTick: 21_622, tickDelta: 2, says: 1 });
        expect(summary.issues).not.toContain('no_observed_tick_progress');
    });

    it('observes activity across trajectory file rotation', async () => {
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }], '20260525T012900Z-local-test.jsonl');

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            observeMs: 50,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 123, lastMeaningfulProgressAt: 123 });
                writeTrajectory(
                    'res:agent',
                    [
                        { tick: 121, kind: 'say', text: 'Fresh file, still moving.' },
                        { tick: 122, kind: 'action', action: { kind: 'move_to' } },
                        { tick: 123, kind: 'action_result', status: 'success' },
                    ],
                    '20260525T013000Z-local-test.jsonl',
                );
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({ actions: 1, results: 1, successes: 1, says: 1, tickDelta: 3 });
    });

    it('observes new activity when mature trajectory rotation drops an old file from the read window', async () => {
        writeResidentState('res:agent', { tick: 140, lastMeaningfulProgressAt: 139 });
        for (let index = 1; index <= 4; index += 1) {
            writeTrajectory(
                'res:agent',
                [
                    { tick: 100 + index, kind: 'say', text: `old ${index}`, sessionId: 'same-session' },
                    { tick: 110 + index, kind: 'action', action: { kind: 'move_to' }, sessionId: 'same-session' },
                    { tick: 120 + index, kind: 'action_result', status: 'success', sessionId: 'same-session' },
                ],
                `20260525T01290${index}Z-local-test.jsonl`,
            );
        }

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            observeMs: 50,
            minObservedActions: 1,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 143, lastMeaningfulProgressAt: 143 });
                writeTrajectory(
                    'res:agent',
                    [
                        { tick: 141, kind: 'say', text: 'new file', sessionId: 'same-session' },
                        { tick: 142, kind: 'action', action: { kind: 'move_to' }, sessionId: 'same-session' },
                        { tick: 143, kind: 'action_result', status: 'success', sessionId: 'same-session' },
                    ],
                    '20260525T013000Z-local-test.jsonl',
                );
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({ actions: 1, results: 1, successes: 1, says: 1, tickDelta: 3 });
    });

    it('keeps observed deltas paired with the requested resident path when runtime resident names differ', async () => {
        writeResidentState('res:alias', { resident: 'res:canonical', tick: 10, lastMeaningfulProgressAt: 10 });
        writeTrajectory('res:alias', [{ tick: 10, kind: 'action_result', status: 'success' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:alias'],
            observeMs: 50,
            sleep: async () => {
                writeResidentState('res:alias', { resident: 'res:canonical', tick: 12, lastMeaningfulProgressAt: 12 });
                writeTrajectory('res:alias', [
                    { tick: 10, kind: 'action_result', status: 'success' },
                    { tick: 11, kind: 'say', text: 'I know my name, but keep watching this folder.' },
                    { tick: 12, kind: 'action', action: { kind: 'move_to' } },
                ]);
            },
        });

        expect(summary.resident).toBe('res:canonical');
        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({ actions: 1, says: 1, tickDelta: 2 });
    });

    it('flags visible appended evidence without tick progress as suspicious', async () => {
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            observeMs: 50,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
                writeTrajectory('res:agent', [
                    { tick: 119, kind: 'action_result', status: 'success' },
                    { tick: 120, kind: 'say', text: 'This line arrived late, but the runtime did not tick.' },
                ]);
            },
        });

        expect(summary.status).toBe('warn');
        expect(summary.observed).toMatchObject({ says: 1, tickDelta: 0 });
        expect(summary.issues).toContain('no_observed_tick_progress');
    });

    it('lets timed fresh action or speech clear stale recent-window visibility warnings', async () => {
        writeResidentState('res:agent', { tick: 1000, lastMeaningfulProgressAt: 999 });
        writeTrajectory('res:agent', [{ tick: 900, kind: 'end_tick', sessionId: 'same-session' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            windowTicks: 30,
            observeMs: 50,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 1010, lastMeaningfulProgressAt: 1009 });
                writeTrajectory('res:agent', [
                    { tick: 900, kind: 'end_tick', sessionId: 'same-session' },
                    { tick: 901, kind: 'say', text: 'Freshly observed despite an old trajectory tick.', sessionId: 'same-session' },
                    { tick: 902, kind: 'action', action: { kind: 'move_to' }, sessionId: 'same-session' },
                ]);
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.recent).toMatchObject({ actions: 1, says: 1 });
        expect(summary.observed).toMatchObject({ actions: 1, says: 1, tickDelta: 10 });
        expect(summary.issues).not.toContain('no_recent_visible_activity');
    });

    it('warns when timed observation only sees a timeout result', async () => {
        writeResidentState('res:agent', { tick: 1000, lastMeaningfulProgressAt: 999 });
        writeTrajectory('res:agent', [{ tick: 900, kind: 'end_tick', sessionId: 'same-session' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            windowTicks: 30,
            observeMs: 50,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 1010, lastMeaningfulProgressAt: 999 });
                writeTrajectory('res:agent', [
                    { tick: 900, kind: 'end_tick', sessionId: 'same-session' },
                    { tick: 901, kind: 'action_result', status: 'timeout', sessionId: 'same-session' },
                ]);
            },
        });

        expect(summary.status).toBe('warn');
        expect(summary.observed).toMatchObject({ actions: 0, results: 1, successes: 0, timeouts: 1, says: 0, tickDelta: 10 });
        expect(summary.issues).toContain('observed_only_timeouts');
    });

    it('warns when timed observation sees actions but no successful result', async () => {
        writeResidentState('res:agent', { tick: 1000, lastMeaningfulProgressAt: 999 });
        writeTrajectory('res:agent', [
            { tick: 900, kind: 'action_result', status: 'success', sessionId: 'same-session' },
            { tick: 901, kind: 'say', text: 'Older proof should not hide a bad live window.', sessionId: 'same-session' },
        ]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            windowTicks: 300,
            observeMs: 50,
            allowRecentVisible: true,
            sleep: async () => {
                writeResidentState('res:agent', { tick: 1020, lastMeaningfulProgressAt: 999 });
                writeTrajectory('res:agent', [
                    { tick: 900, kind: 'action_result', status: 'success', sessionId: 'same-session' },
                    { tick: 901, kind: 'say', text: 'Older proof should not hide a bad live window.', sessionId: 'same-session' },
                    { tick: 1001, kind: 'action', actionKind: 'move_to', sessionId: 'same-session' },
                    { tick: 1002, kind: 'action_result', status: 'timeout', reason: 'timeout', sessionId: 'same-session' },
                    { tick: 1010, kind: 'action', actionKind: 'move_to', sessionId: 'same-session' },
                    { tick: 1011, kind: 'action_result', status: 'timeout', reason: 'timeout', sessionId: 'same-session' },
                ]);
            },
        });

        expect(summary.status).toBe('warn');
        expect(summary.observed).toMatchObject({ actions: 2, results: 2, successes: 0, timeouts: 2, says: 0, tickDelta: 20 });
        expect(summary.issues).toContain('observed_actions_not_succeeding');
    });

    it.each(['hook_noop', 'budget_exhausted:pause'])(
        'warns when timed observation is dominated by inert %s decisions despite sparse visible events',
        async cause => {
            writeResidentState('res:agent', { tick: 1000, lastMeaningfulProgressAt: 999 });
            writeTrajectory('res:agent', [{ tick: 900, kind: 'action_result', status: 'success', sessionId: 'same-session' }]);

            const [summary] = await observeLiveResidents({
                memoryDir,
                residents: ['res:agent'],
                observeMs: 50,
                sleep: async () => {
                    writeResidentState('res:agent', { tick: 1045, lastMeaningfulProgressAt: 999 });
                    writeTrajectory('res:agent', [
                        { tick: 900, kind: 'action_result', status: 'success', sessionId: 'same-session' },
                        ...Array.from({ length: 36 }, (_, index) => ({
                            tick: 1001 + index,
                            kind: 'decision',
                            cause,
                            sessionId: 'same-session',
                        })),
                        { tick: 1040, kind: 'say', text: 'Still here.', sessionId: 'same-session' },
                        { tick: 1041, kind: 'action', action: { kind: 'move_to' }, sessionId: 'same-session' },
                        { tick: 1042, kind: 'action_result', status: 'success', sessionId: 'same-session' },
                    ]);
                },
            });

            expect(summary.status).toBe('warn');
            expect(summary.observed).toMatchObject({ inertDecisions: 36, visibleEvents: 3, tickDelta: 45 });
            expect(summary.issues).toContain(`observed_inert_decision_loop:${cause}`);
        },
    );

    it('accepts sustained visible cadence despite many no-action budget decisions', async () => {
        writeResidentState('res:the-hush', { tick: 1000, lastMeaningfulProgressAt: 999 });
        writeTrajectory('res:the-hush', [{ tick: 900, kind: 'action_result', status: 'success', sessionId: 'same-session' }]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:the-hush'],
            observeMs: 90_000,
            sleep: async () => {
                writeResidentState('res:the-hush', { tick: 1140, lastMeaningfulProgressAt: 1120 });
                writeTrajectory('res:the-hush', [
                    { tick: 900, kind: 'action_result', status: 'success', sessionId: 'same-session' },
                    ...Array.from({ length: 136 }, (_, index) => ({
                        tick: 1001 + index,
                        kind: 'decision',
                        cause: 'budget_exhausted:pause',
                        sessionId: 'same-session',
                    })),
                    ...Array.from({ length: 7 }, (_, index) => [
                        {
                            tick: 1020 + index * 15,
                            kind: 'say',
                            text: 'I am checking the landmark at 2938,3321.',
                            sessionId: 'same-session',
                        },
                        {
                            tick: 1021 + index * 15,
                            kind: 'action_result',
                            status: 'success',
                            sessionId: 'same-session',
                        },
                    ]).flat(),
                ]);
            },
        });

        expect(summary.status).toBe('ok');
        expect(summary.observed).toMatchObject({ inertDecisions: 136, says: 7, visibleEvents: 14, tickDelta: 140 });
        expect(summary.issues).not.toContain('observed_inert_decision_loop:budget_exhausted:pause');
    });

    it('flags missing observed progress when the resident only keeps old evidence', async () => {
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [
            { tick: 118, kind: 'say', text: 'Old line.' },
            { tick: 119, kind: 'action_result', status: 'success' },
        ]);

        const [summary] = await observeLiveResidents({
            memoryDir,
            residents: ['res:agent'],
            observeMs: 50,
            minObservedActions: 1,
            minObservedSays: 1,
            sleep: async () => {},
        });

        expect(summary.status).toBe('warn');
        expect(summary.observed).toMatchObject({ visibleEvents: 0, actions: 0, says: 0 });
        expect(summary.issues).toEqual(
            expect.arrayContaining([
                'no_observed_visible_activity',
                'no_observed_tick_progress',
                'observed_actions_below_1',
                'observed_says_below_1',
            ]),
        );
    });

    it('formats observed success and timeout deltas for operator QA', () => {
        const output = formatLiveSmokeSummary(memoryDir, [
            {
                resident: 'res:agent',
                status: 'ok',
                tick: 150,
                recent: {
                    actions: 3,
                    results: 3,
                    successes: 2,
                    failures: 0,
                    timeouts: 1,
                    says: 1,
                    decisions: 4,
                },
                observed: {
                    durationMs: 60000,
                    startTick: 100,
                    endTick: 150,
                    tickDelta: 50,
                    actions: 2,
                    results: 2,
                    successes: 1,
                    failures: 0,
                    timeouts: 1,
                    says: 1,
                    decisions: 3,
                    inertDecisions: 0,
                    visibleEvents: 5,
                },
                issues: [],
            },
        ]);

        expect(output).toContain('observed=60000ms/+50t actions=2 results=2 success=1 timeout=1 fail=0 says=1');
    });

    it('returns a failing exit code for timed observations with warnings', async () => {
        const configPath = writeControllerConfig(['res:agent']);
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const code = await runLiveSmokeCli(['--config', configPath, '--observe-seconds=1', '--poll-ms=1']);

        expect(code).toBe(1);
        expect(String(logSpy.mock.calls.at(-1)?.[0])).toContain('no_observed_visible_activity');
        logSpy.mockRestore();
    });

    it('uses configured residents by default so stale benchmark folders do not pollute operator smokes', async () => {
        const configPath = writeControllerConfig(['res:agent']);
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);
        writeResidentState('res:bmk_fire_5m_deadbeef', { tick: 10 });
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const code = await runLiveSmokeCli(['--config', configPath, '--json']);

        expect(code).toBe(0);
        const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as { summaries: Array<{ resident: string }> };
        expect(payload.summaries.map(summary => summary.resident)).toEqual(['res:agent']);
        logSpy.mockRestore();
    });

    it('uses configured residents plus discovered soul residents by default to match ControllerHost desired cohort', async () => {
        const configPath = writeControllerConfig(['res:agent']);
        writeSoul('res:mother-anvil');
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);
        writeResidentState('res:mother-anvil', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:mother-anvil', [{ tick: 119, kind: 'say', text: 'Hot metal will not wait.' }]);
        writeResidentState('res:bmk_fire_5m_deadbeef', { tick: 10 });
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const code = await runLiveSmokeCli(['--config', configPath, '--json']);

        expect(code).toBe(0);
        const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as { summaries: Array<{ resident: string }> };
        expect(payload.summaries.map(summary => summary.resident)).toEqual(['res:agent', 'res:mother-anvil']);
        logSpy.mockRestore();
    });

    function writeResidentState(resident: string, state: Record<string, unknown>): void {
        const dir = residentDir(resident);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'runtime-state.json'), JSON.stringify({ resident, attention: 1000, tick: 0, ...state }), 'utf8');
    }

    function writeTrajectory(resident: string, entries: Array<Record<string, unknown>>, file = '20260525T012900Z-local-test.jsonl'): void {
        const trajectoryDir = path.join(residentDir(resident), 'evidence', 'trajectory');
        fs.mkdirSync(trajectoryDir, { recursive: true });
        fs.writeFileSync(path.join(trajectoryDir, file), `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    }

    function writeControllerConfig(residents: string[]): string {
        const configPath = path.join(memoryDir, 'controller.yml');
        fs.writeFileSync(
            configPath,
            yaml.dump({
                controller: { instanceId: 'test-live-smoke' },
                residents,
                gateway: { url: 'ws://127.0.0.1:1234', controllerId: 'test-controller' },
                inference: { maxConcurrent: 4 },
                souls: { dir: path.join(memoryDir, 'souls') },
                memory: { dir: memoryDir, qmdBin: 'qmd' },
                logging: { dir: path.join(memoryDir, 'logs'), fullPerceptions: false },
                knowledge: {
                    dir: path.join(memoryDir, 'knowledge'),
                    enableSuggestions: false,
                    emitStdout: false,
                    storageMode: 'ephemeral',
                },
                llm: { endpoints: { default: { timeoutMs: 30000 } } },
            }),
            'utf8',
        );
        return configPath;
    }

    function writeSoul(resident: string): void {
        const soulsDir = path.join(memoryDir, 'souls');
        fs.mkdirSync(soulsDir, { recursive: true });
        const slug = resident.replace(/^res:/, 'res-');
        fs.writeFileSync(path.join(soulsDir, `${slug}.md`), `---\nname: ${resident}\narchetype: endurer\n---\n# ${resident}\n`, 'utf8');
    }

    function residentDir(resident: string): string {
        return path.join(
            memoryDir,
            resident
                .replace(/[^a-z0-9_-]+/gi, '-')
                .replace(/^-|-$/g, '')
                .toLowerCase(),
        );
    }
});
