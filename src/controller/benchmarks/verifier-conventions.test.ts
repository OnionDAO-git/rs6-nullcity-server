import fs from 'fs';
import os from 'os';
import path from 'path';
import { classifyFailureReason, emitVerifierConventions, rewardSchema } from './verifier-conventions';
import type { BenchmarkArtifact } from './benchmark-artifact';

describe('verifier conventions', () => {
    it('writes reward.json, reward.txt, and stdout markers from a benchmark artifact', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-reward-'));
        const writes: string[] = [];

        const result = emitVerifierConventions({
            artifact: artifact(),
            outputDir,
            stdout: text => writes.push(text),
        });

        expect(result.reward).toEqual({
            value: 0.8,
            unit: 'score',
            taskId: 'make-fire-5m',
            runId: 'bench_20260520_make_fire_001',
            moduleId: 'onion.runescape.standard',
            moduleVersion: '0.1.0',
            failure_reason: 'none',
        });
        expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'reward.json'), 'utf8'))).toEqual(result.reward);
        expect(fs.readFileSync(path.join(outputDir, 'reward.txt'), 'utf8')).toBe('0.8\n');
        expect(writes.join('')).toContain('__REWARD_JSON_START__');
        expect(writes.join('')).toContain('"failure_reason":"none"');
        expect(writes.join('')).toContain('__REWARD_JSON_END__');
    });

    it('copies retained evidence artifacts into the benchmark output directory', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-reward-'));
        const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-runtime-'));
        const trajectoryPath = path.join(runtimeDir, 'trajectory', '20260521-run.jsonl');
        const progressPath = path.join(runtimeDir, 'progress', '20260521-run.jsonl');
        fs.mkdirSync(path.dirname(trajectoryPath), { recursive: true });
        fs.mkdirSync(path.dirname(progressPath), { recursive: true });
        fs.writeFileSync(trajectoryPath, '{"kind":"action"}\n');
        fs.writeFileSync(progressPath, '{"kind":"progress"}\n');

        emitVerifierConventions({
            artifact: artifact({
                evidence: {
                    artifactPaths: [trajectoryPath, progressPath],
                },
            }),
            outputDir,
        });

        expect(fs.readFileSync(path.join(outputDir, 'evidence', 'trajectory', '20260521-run.jsonl'), 'utf8')).toBe(
            '{"kind":"action"}\n',
        );
        expect(fs.readFileSync(path.join(outputDir, 'evidence', 'progress', '20260521-run.jsonl'), 'utf8')).toBe(
            '{"kind":"progress"}\n',
        );
    });

    it('classifies benchmark failures into the shared failure taxonomy', () => {
        expect(classifyFailureReason(artifact())).toBe('none');
        expect(classifyFailureReason(artifact({ status: 'timeout', failureReason: 'task timed out' }))).toBe('timeout');
        expect(classifyFailureReason(artifact({ status: 'error', failureReason: 'threw TypeError' }))).toBe('exception');
        expect(classifyFailureReason(artifact({ status: 'failed', failureReason: 'resident died during combat' }))).toBe('died');
        expect(classifyFailureReason(artifact({ status: 'failed', failureReason: 'budget exhausted: day' }))).toBe('budget_exhausted');
        expect(classifyFailureReason(artifact({ status: 'cancelled', failureReason: 'kernel aborted run' }))).toBe('kernel_aborted');
        expect(classifyFailureReason(artifact({ status: 'failed', failureReason: 'no fire observed' }))).toBe('goal_not_met');
    });

    it('rejects reward payloads outside the failure taxonomy', () => {
        expect(() =>
            rewardSchema.parse({
                value: 0,
                unit: 'score',
                taskId: 'task',
                runId: 'run',
                moduleId: 'module',
                moduleVersion: '0.1.0',
                failure_reason: 'close_enough',
            }),
        ).toThrow();
    });
});

function artifact(overrides: Partial<BenchmarkArtifact> = {}): BenchmarkArtifact {
    return {
        schemaVersion: 1,
        runId: 'bench_20260520_make_fire_001',
        task: { id: 'make-fire-5m', version: '0.1.0' },
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        mode: 'autonomous',
        resident: 'res:agent',
        modelProfile: 'local-qwen-body',
        commits: [{ repo: 'rs6-nullcity-server', sha: '8e9dfa956aa0ec049bd389b42f43d14089baf8c3' }],
        startedAt: '2026-05-20T10:00:00.000Z',
        endedAt: '2026-05-20T10:01:00.000Z',
        durationMs: 60_000,
        status: 'passed',
        score: 0.8,
        metrics: { selectedModuleActions: 2 },
        evidence: { summaries: ['fire observed'] },
        generatedAt: '2026-05-20T10:01:01.000Z',
        ...overrides,
    };
}
