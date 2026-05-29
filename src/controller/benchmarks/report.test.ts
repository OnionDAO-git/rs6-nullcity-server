import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildBenchmarkReport, formatBenchmarkReportMarkdown, runBenchmarkReportCli } from './report';

describe('benchmark report', () => {
    it('aggregates artifacts by profile, task, and mode', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-report-'));
        writeJson(path.join(root, 'qwen-pass.json'), artifact({ status: 'passed', score: 1, durationMs: 1000 }));
        writeJson(
            path.join(root, 'qwen-fail.json'),
            artifact({
                runId: 'bench_qwen_fail',
                status: 'failed',
                score: 0.25,
                durationMs: 3000,
                failureReason: 'no useful recovery action',
            }),
        );
        writeJson(
            path.join(root, 'nested', 'haiku.json'),
            artifact({
                runId: 'bench_haiku_pass',
                modelProfile: 'legacy-haiku',
                status: 'passed',
                score: 0.8,
                durationMs: 2000,
                inference: {
                    profileId: 'openrouter_haiku',
                    endpointId: 'openrouter',
                    provider: 'openrouter',
                    model: 'anthropic/claude-3.5-haiku',
                    promptTokens: 100,
                    completionTokens: 50,
                    estimatedCostUsd: 0.00028,
                },
            }),
        );
        writeJson(path.join(root, 'reward.json'), { value: 1 });

        const report = buildBenchmarkReport(root, new Date('2026-05-28T12:00:00.000Z'));

        expect(report.artifacts).toBe(3);
        expect(report.skipped).toBe(1);
        expect(report.rows).toHaveLength(2);
        expect(report.rows[0]).toMatchObject({
            profileId: 'local-qwen',
            taskId: 'make-fire-5m',
            mode: 'autonomous',
            runs: 2,
            passed: 1,
            passRate: 0.5,
            averageScore: 0.625,
            averageDurationMs: 2000,
            promptTokens: 240,
            completionTokens: 80,
            estimatedCostUsd: 0.00056,
        });
        expect(report.rows[0].failureReasons).toEqual(['no useful recovery action']);
        expect(report.rows[1]).toMatchObject({
            profileId: 'openrouter_haiku',
            endpointId: 'openrouter',
            provider: 'openrouter',
            model: 'anthropic/claude-3.5-haiku',
            runs: 1,
            passed: 1,
            estimatedCostUsd: 0.00028,
        });
    });

    it('formats a markdown table for human comparison', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-report-'));
        writeJson(path.join(root, 'qwen.json'), artifact({ status: 'passed' }));

        const markdown = formatBenchmarkReportMarkdown(buildBenchmarkReport(root, new Date('2026-05-28T12:00:00.000Z')));

        expect(markdown).toContain('# Null City benchmark report');
        expect(markdown).toContain('| Profile | Task | Mode | Runs | Pass | Avg score | Avg sec | Tokens | Cost |');
        expect(markdown).toContain('| local-qwen | make-fire-5m | autonomous | 1 | 100% | 1.000 | 1.0 | 160 | $0.000280 |');
    });

    it('prints JSON or markdown from the CLI', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-report-'));
        writeJson(path.join(root, 'qwen.json'), artifact({ status: 'passed' }));
        const writes: string[] = [];

        const exitCode = await runBenchmarkReportCli(['--input', root, '--json'], {
            stdout: text => writes.push(text),
            stderr: () => undefined,
            now: () => new Date('2026-05-28T12:00:00.000Z'),
        });

        expect(exitCode).toBe(0);
        expect(JSON.parse(writes.join('')).rows[0].profileId).toBe('local-qwen');
    });
});

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        runId: 'bench_qwen_pass',
        task: { id: 'make-fire-5m', version: '0.1.0' },
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        mode: 'autonomous',
        resident: 'res:bmk_qwen',
        modelProfile: 'local-qwen',
        inference: {
            profileId: 'local-qwen',
            endpointId: 'inf',
            provider: 'openai-compatible',
            model: 'qwen/qwen3.6-27b',
            promptTokens: 120,
            completionTokens: 40,
            pricing: {
                promptTokenUsd: 0.000001,
                completionTokenUsd: 0.000004,
            },
        },
        commits: [{ repo: 'rs6-nullcity-server', sha: '8e9dfa956aa0ec049bd389b42f43d14089baf8c3' }],
        startedAt: '2026-05-20T10:00:00.000Z',
        endedAt: '2026-05-20T10:00:01.000Z',
        durationMs: 1000,
        status: 'passed',
        score: 1,
        metrics: { selectedModuleActions: 3 },
        evidence: { summaries: ['benchmark finished'] },
        generatedAt: '2026-05-20T10:00:01.000Z',
        ...overrides,
    };
}
