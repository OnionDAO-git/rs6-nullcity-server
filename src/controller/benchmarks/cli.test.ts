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
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
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

    it('parses benchmark options from environment variables', () => {
        process.env.CONTROLLER_BENCHMARK_TASK = 'combat-prayer-10m';
        process.env.CONTROLLER_BENCHMARK_MODULE = 'onion.runescape.test';
        process.env.CONTROLLER_BENCHMARK_OUTPUT_DIR = 'data/test-benchmarks';
        process.env.CONTROLLER_BENCHMARK_MODE = 'autonomous';
        process.env.CONTROLLER_BENCHMARK_DRY_RUN = 'true';

        expect(parseBenchmarkCliArgs([])).toEqual({
            taskId: 'combat-prayer-10m',
            moduleId: 'onion.runescape.test',
            configPath: 'controller.yml',
            outputDir: 'data/test-benchmarks',
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

    it('can dry-run the full core benchmark suite', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(
            ['--task', 'all', '--module', 'onion.runescape.standard', '--mode', 'autonomous', '--dry-run'],
            {
                stdout: text => writes.push(text),
            },
        );

        const output = writes.join('');
        expect(exitCode).toBe(0);
        expect(output).toContain('"suite":{"id":"all"');
        expect(output).toContain('"id":"make-fire-5m"');
        expect(output).toContain('"id":"equipment-prep-3m"');
        expect(output).toContain('"id":"combat-prayer-10m"');
        expect(output).toContain('"id":"cooks-assistant-complete-5m"');
        expect(output).toContain('"mode":"autonomous"');
        expect(GatewayClient).not.toHaveBeenCalled();
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
        expect(writes.join('')).toContain('"task":{"id":"follow-and-chat-5m","version":"0.3.0"');
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

    it('can dry-run the starter-mining benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'starter-mining-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"starter-mining-5m","version":"0.1.0"');
    });

    it('can dry-run the Cooks Assistant quest-start benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(
            ['--task', 'cooks-assistant-start-3m', '--module', 'onion.runescape.standard', '--dry-run'],
            {
                stdout: text => writes.push(text),
            },
        );

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"cooks-assistant-start-3m","version":"0.1.0"');
    });

    it('can dry-run the Cooks Assistant quest-complete benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(
            ['--task', 'cooks-assistant-complete-5m', '--module', 'onion.runescape.standard', '--dry-run'],
            {
                stdout: text => writes.push(text),
            },
        );

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"cooks-assistant-complete-5m","version":"0.1.0"');
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

    it('can dry-run the equipment-prep benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'equipment-prep-3m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"equipment-prep-3m","version":"0.1.0"');
    });

    it('can dry-run the level-up firemaking benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'level-up-firemaking-3m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"level-up-firemaking-3m","version":"0.1.0"');
    });

    it('can dry-run the bury-bones prayer benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'bury-bones-prayer-3m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"bury-bones-prayer-3m","version":"0.1.0"');
    });

    it('can dry-run the memory-recall benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'memory-recall-3m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"memory-recall-3m","version":"0.1.0"');
    });

    it('can dry-run the trading-giving benchmark task', async () => {
        const writes: string[] = [];

        const exitCode = await runBenchmarkCli(['--task', 'trading-giving-5m', '--module', 'onion.runescape.standard', '--dry-run'], {
            stdout: text => writes.push(text),
        });

        expect(exitCode).toBe(0);
        expect(writes.join('')).toContain('"task":{"id":"trading-giving-5m","version":"0.1.0"');
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

    it('passes resolved inference profile metadata to benchmark runs', async () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-cli-profile-'));
        const gateway = {
            connect: jest.fn().mockResolvedValue(undefined),
            hello: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
        };

        (loadControllerConfig as jest.Mock).mockReturnValue({
            gateway: {
                url: 'ws://localhost:3000',
                authToken: 'test-token',
                controllerId: 'test-controller',
            },
            llm: {
                endpoints: {
                    default: {
                        profileId: 'haiku',
                        endpointId: 'openrouter',
                        provider: 'openrouter',
                        baseUrl: 'https://openrouter.ai/api',
                        model: 'anthropic/claude-3.5-haiku',
                        timeoutMs: 45000,
                    },
                },
                profiles: {},
            },
        });
        (GatewayClient as unknown as jest.Mock).mockImplementation(() => gateway);
        (BenchmarkRunner as jest.Mock).mockImplementation(() => ({
            run: jest.fn().mockResolvedValue(benchmarkArtifact()),
        }));

        const exitCode = await runBenchmarkCli(['--task', 'make-fire-5m', '--module', 'onion.runescape.standard', '--output', outputDir], {
            stdout: () => undefined,
        });

        expect(exitCode).toBe(0);
        expect(BenchmarkRunner).toHaveBeenCalledWith(
            expect.objectContaining({
                modelProfile: 'haiku',
                inference: {
                    profileId: 'haiku',
                    endpointId: 'openrouter',
                    provider: 'openrouter',
                    baseUrl: 'https://openrouter.ai/api',
                    model: 'anthropic/claude-3.5-haiku',
                },
            }),
        );
    });

    it('runs every core benchmark for --task all and prints a suite summary', async () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-cli-suite-'));
        const writes: string[] = [];
        const gateway = {
            connect: jest.fn().mockResolvedValue(undefined),
            hello: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
        };

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
        (BenchmarkRunner as jest.Mock).mockImplementation(({ task }) => ({
            run: jest.fn().mockResolvedValue(
                benchmarkArtifact({
                    runId: `bench_${task.id.replace(/-/g, '_')}`,
                    task: { id: task.id, version: task.version },
                    score: task.id === 'combat-prayer-10m' ? 0.5 : 1,
                }),
            ),
        }));

        const exitCode = await runBenchmarkCli(['--task', 'all', '--module', 'onion.runescape.standard', '--output', outputDir], {
            stdout: text => writes.push(text),
        });

        const output = writes.join('');
        expect(exitCode).toBe(0);
        expect(BenchmarkRunner).toHaveBeenCalledTimes(15);
        expect(output).toContain('"benchmark":{"taskId":"make-fire-5m"');
        expect(output).toContain('"benchmark":{"taskId":"cooks-assistant-start-3m"');
        expect(output).toContain('"benchmark":{"taskId":"cooks-assistant-complete-5m"');
        expect(output).toContain('"benchmark":{"taskId":"bury-bones-prayer-3m"');
        expect(output).toContain('"benchmark":{"taskId":"level-up-firemaking-3m"');
        expect(output).toContain('"suite":{"id":"all"');
        expect(output).toContain('"total":15');
        expect(output).toContain('"passed":15');
        expect(output).toContain('"averageScore":0.9666666666666667');
        expect(fs.existsSync(path.join(outputDir, 'bench_make_fire_5m.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'bench_combat_prayer_10m.json'))).toBe(true);
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
