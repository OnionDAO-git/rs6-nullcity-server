import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadControllerConfig } from '../config';
import { GatewayClient } from '../transport/gateway-client';
import type { BenchmarkArtifact } from './benchmark-artifact';
import { BenchmarkRunner } from './benchmark-runner';
import { parseBenchmarkCliArgs, runBenchmarkCli } from './cli';

jest.mock('../config', () => ({
    loadControllerConfig: jest.fn(),
}));

jest.mock('../transport/gateway-client', () => ({
    GatewayClient: jest.fn(),
}));

jest.mock('./benchmark-runner', () => ({
    BenchmarkRunner: jest.fn(),
}));

describe('benchmark CLI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('parses task, module, config, output, and dry-run flags', () => {
        expect(
            parseBenchmarkCliArgs([
                '--task',
                'make-fire-5m',
                '--module',
                'onion.runescape.standard',
                '--config',
                'controller.yml',
                '--output',
                'data/benchmarks',
                '--mode',
                'autonomous',
                '--dry-run',
            ]),
        ).toEqual({
            taskId: 'make-fire-5m',
            moduleId: 'onion.runescape.standard',
            configPath: 'controller.yml',
            outputDir: 'data/benchmarks',
            mode: 'autonomous',
            dryRun: true,
        });
    });

    it('prints the selected benchmark without touching the gateway in dry-run mode', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'make-fire-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"dryRun":true');
        expect(writes.join('')).toContain('"mode":"scripted"');
        expect(writes.join('')).toContain('"task":{"id":"make-fire-5m","version":"0.1.0"');
        expect(writes.join('')).toContain('"module":{"id":"onion.runescape.standard","version":"0.1.0"}');
    });

    it('can dry-run autonomous benchmark mode', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(
            ['--task', 'make-fire-5m', '--module', 'onion.runescape.standard', '--mode', 'autonomous', '--dry-run'],
            {
                stdout: text => writes.push(text),
            },
        );

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"mode":"autonomous"');
    });

    it('can dry-run the explore-report benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'explore-report-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"explore-report-5m","version":"0.1.0"');
    });

    it('can dry-run the follow-and-chat benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'follow-and-chat-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"follow-and-chat-5m","version":"0.1.0"');
    });

    it('can dry-run the woodcutting-firemaking benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(
            ['--task', 'woodcutting-firemaking-10m', '--module', 'onion.runescape.standard', '--dry-run'],
            {
                stdout: text => writes.push(text),
            },
        );

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"woodcutting-firemaking-10m","version":"0.1.0"');
    });

    it('can dry-run the starter-fishing benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'starter-fishing-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"starter-fishing-5m","version":"0.1.0"');
    });

    it('can dry-run the fishing-cooking benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'fishing-cooking-10m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"fishing-cooking-10m","version":"0.1.0"');
    });

    it('can dry-run the combat-prayer benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'combat-prayer-10m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"combat-prayer-10m","version":"0.1.0"');
    });

    it('writes reward convention artifacts after a benchmark run', async () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-cli-reward-'));
        const writes: string[] = [];
        const gateway = {
            connect: jest.fn().mockResolvedValue(undefined),
            hello: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
        };
        const artifact = benchmarkArtifact();

        (loadControllerConfig as jest.Mock).mockReturnValue({
            gateway: {
                url: 'ws://localhost:3000',
                authToken: 'test-token',
                controllerId: 'test-controller',
            },
            llm: {
                endpoints: {
                    default: { model: 'local-test-model' },
                },
            },
        });
        (GatewayClient as unknown as jest.Mock).mockImplementation(() => gateway);
        (BenchmarkRunner as jest.Mock).mockImplementation(() => ({
            run: jest.fn().mockResolvedValue(artifact),
        }));

        const exitCode = await runBenchmarkCli(['--task', 'make-fire-5m', '--module', 'onion.runescape.standard', '--output', outputDir], {
            stdout: text => writes.push(text),
        });

        const rewardJsonPath = path.join(outputDir, 'reward.json');
        const rewardTxtPath = path.join(outputDir, 'reward.txt');
        const output = writes.join('');
        expect(exitCode).toBe(0);
        expect(JSON.parse(fs.readFileSync(rewardJsonPath, 'utf8'))).toMatchObject({
            value: 0.8,
            taskId: 'make-fire-5m',
            runId: 'bench_20260520_make_fire_001',
            moduleId: 'onion.runescape.standard',
            failure_reason: 'none',
        });
        expect(fs.readFileSync(rewardTxtPath, 'utf8')).toBe('0.8\n');
        expect(output).toContain('__REWARD_JSON_START__');
        expect(output).toContain('__REWARD_JSON_END__');
        expect(output).toContain(`"rewardJsonPath":"${rewardJsonPath}"`);
        expect(output).toContain(`"rewardTxtPath":"${rewardTxtPath}"`);
        expect(gateway.close).toHaveBeenCalledTimes(1);
    });
});

function benchmarkArtifact(overrides: Partial<BenchmarkArtifact> = {}): BenchmarkArtifact {
    return {
        schemaVersion: 1,
        runId: 'bench_20260520_make_fire_001',
        task: { id: 'make-fire-5m', version: '0.1.0' },
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        mode: 'scripted',
        resident: 'res:agent',
        modelProfile: 'local-test-model',
        commits: [{ repo: 'rs6-nullcity-server', sha: '8e9dfa956aa0ec049bd389b42f43d14089baf8c3' }],
        startedAt: '2026-05-20T10:00:00.000Z',
        endedAt: '2026-05-20T10:01:00.000Z',
        durationMs: 60_000,
        status: 'passed',
        score: 0.8,
        metrics: {},
        evidence: {},
        generatedAt: '2026-05-20T10:01:01.000Z',
        ...overrides,
    };
}
