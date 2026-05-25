import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { parseLiveSmokeCliArgs, runLiveSmokeCli, summarizeLiveResidents } from './live-smoke';

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

    it('auto-discovers only resident directories with runtime state', () => {
        fs.mkdirSync(path.join(memoryDir, 'library'), { recursive: true });
        fs.mkdirSync(path.join(memoryDir, 'data'), { recursive: true });
        writeResidentState('res:agent', { tick: 120, lastMeaningfulProgressAt: 119 });
        writeTrajectory('res:agent', [{ tick: 119, kind: 'action_result', status: 'success' }]);

        const summaries = summarizeLiveResidents({ memoryDir, windowTicks: 30 });

        expect(summaries.map(summary => summary.resident)).toEqual(['res:agent']);
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
                '--json',
                '--fail-on-warn',
            ]),
        ).toEqual({
            configPath: 'controller.local.yml',
            memoryDir: '/tmp/memory',
            residents: ['res:agent'],
            windowTicks: 80,
            maxStuckTicks: 40,
            json: true,
            failOnWarn: true,
        });
    });

    it('uses configured residents by default so stale benchmark folders do not pollute operator smokes', async () => {
        const configPath = path.join(memoryDir, 'controller.yml');
        fs.writeFileSync(
            configPath,
            yaml.dump({
                controller: { instanceId: 'test-live-smoke' },
                residents: ['res:agent'],
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

    function writeResidentState(resident: string, state: Record<string, unknown>): void {
        const dir = residentDir(resident);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'runtime-state.json'), JSON.stringify({ resident, attention: 1000, tick: 0, ...state }), 'utf8');
    }

    function writeTrajectory(resident: string, entries: Array<Record<string, unknown>>): void {
        const trajectoryDir = path.join(residentDir(resident), 'evidence', 'trajectory');
        fs.mkdirSync(trajectoryDir, { recursive: true });
        fs.writeFileSync(
            path.join(trajectoryDir, '20260525T012900Z-local-test.jsonl'),
            `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`,
            'utf8',
        );
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
