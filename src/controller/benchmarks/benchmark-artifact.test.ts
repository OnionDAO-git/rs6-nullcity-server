import { benchmarkArtifactSchema, normalizeBenchmarkArtifact } from './benchmark-artifact';

describe('benchmarkArtifactSchema', () => {
    it('accepts a complete passed run artifact', () => {
        const parsed = benchmarkArtifactSchema.parse(artifact());

        expect(parsed.runId).toBe('bench_20260520_make_fire_001');
        expect(parsed.module).toEqual({ id: 'onion.runescape.standard', version: '0.1.0' });
        expect(parsed.mode).toBe('scripted');
        expect(parsed.status).toBe('passed');
        expect(parsed.metrics.actionsAttempted).toBe(7);
    });

    it('records autonomous benchmark mode when modules drive their own actions', () => {
        const parsed = benchmarkArtifactSchema.parse(artifact({ mode: 'autonomous' }));

        expect(parsed.mode).toBe('autonomous');
    });

    it('records benchmark inference metadata separately from legacy modelProfile', () => {
        const parsed = benchmarkArtifactSchema.parse(
            artifact({
                inference: {
                    profileId: 'haiku',
                    endpointId: 'openrouter',
                    provider: 'openrouter',
                    baseUrl: 'https://openrouter.ai/api',
                    model: 'anthropic/claude-3.5-haiku',
                    promptTokens: 120,
                    completionTokens: 40,
                    estimatedCostUsd: 0.000256,
                },
            }),
        );

        expect(parsed.inference).toEqual({
            profileId: 'haiku',
            endpointId: 'openrouter',
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api',
            model: 'anthropic/claude-3.5-haiku',
            promptTokens: 120,
            completionTokens: 40,
            estimatedCostUsd: 0.000256,
        });
        expect(parsed.modelProfile).toBe('local-qwen-body');
    });

    it('rejects artifacts without module identity', () => {
        const candidate = artifact({ module: undefined });

        expect(benchmarkArtifactSchema.safeParse(candidate).success).toBe(false);
    });

    it('rejects invalid statuses', () => {
        const candidate = artifact({ status: 'mostly-ok' });

        expect(benchmarkArtifactSchema.safeParse(candidate).success).toBe(false);
    });

    it('requires a failure reason for unsuccessful runs', () => {
        const failed = artifact({ status: 'failed', failureReason: 'no fire observed' });
        const missingReason = artifact({ status: 'failed', failureReason: undefined });

        expect(benchmarkArtifactSchema.safeParse(failed).success).toBe(true);
        expect(benchmarkArtifactSchema.safeParse(missingReason).success).toBe(false);
    });

    it('normalizes derived duration and timestamps for artifact writers', () => {
        const normalized = normalizeBenchmarkArtifact(
            artifact({
                startedAt: '2026-05-20T10:00:00.000Z',
                endedAt: '2026-05-20T10:00:10.500Z',
                durationMs: undefined,
            }),
        );

        expect(normalized.durationMs).toBe(10_500);
        expect(normalized.generatedAt).toMatch(/^2026-/);
    });
});

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        runId: 'bench_20260520_make_fire_001',
        task: { id: 'make-fire-5m', version: '0.1.0' },
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        mode: 'scripted',
        resident: 'res:agent',
        modelProfile: 'local-qwen-body',
        commits: [
            {
                repo: 'rs6-nullcity-server',
                sha: '8e9dfa956aa0ec049bd389b42f43d14089baf8c3',
                branch: 'codex/body-waiter-coordinator',
            },
        ],
        startedAt: '2026-05-20T10:00:00.000Z',
        endedAt: '2026-05-20T10:01:12.000Z',
        durationMs: 72_000,
        status: 'passed',
        score: 1,
        metrics: {
            actionsAttempted: 7,
            invalidActions: 0,
            unsafeActions: 0,
            inferenceCalls: 3,
        },
        evidence: {
            actionAttemptIds: ['attempt-1', 'attempt-2'],
            inferenceRequestIds: ['brain-1'],
            summaries: ['Logs were consumed and a fire appeared nearby.'],
        },
        generatedAt: '2026-05-20T10:01:13.000Z',
        ...overrides,
    };
}
