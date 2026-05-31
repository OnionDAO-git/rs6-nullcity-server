import type { InferenceHealthResult } from '../llm/inference-health';
import { loadControllerConfig } from '../config';
import { DEFAULT_INFERENCE_CANARY_ENDPOINTS, parseInferenceCanarySmokeArgs, runInferenceCanarySmoke } from './inference-canary-smoke';

describe('inference canary smoke', () => {
    it('defaults to comparing proven default inference against the qwopus canary', () => {
        expect(parseInferenceCanarySmokeArgs([])).toEqual(
            expect.objectContaining({
                configPath: 'controller.yml',
                endpointNames: DEFAULT_INFERENCE_CANARY_ENDPOINTS,
                timeoutMs: 30000,
                json: false,
            }),
        );
    });

    it('keeps the committed canary config on the restart-surviving qwopus default', () => {
        const config = loadControllerConfig('config/controller.inference-canary.yml');

        expect(config.llm.endpoints.default.model).toBe('qwopus3.5-27b-v3@q4_k_s');
        expect(config.llm.endpoints.default.timeoutMs).toBeGreaterThanOrEqual(75_000);
    });

    it('parses explicit endpoints, all-endpoints mode, timeout, and json output', () => {
        expect(parseInferenceCanarySmokeArgs(['--endpoint', 'spacetower_qwopus_q4'])).toEqual(
            expect.objectContaining({
                endpointNames: ['spacetower_qwopus_q4'],
                all: false,
            }),
        );

        expect(
            parseInferenceCanarySmokeArgs([
                '--config',
                'controller.local.yml',
                '--endpoints',
                'default,spacetower_qwen',
                '--endpoint',
                'inf_qwopus_q4',
                '--timeout-ms',
                '45000',
                '--json',
            ]),
        ).toEqual({
            configPath: 'controller.local.yml',
            endpointNames: ['default', 'spacetower_qwen', 'inf_qwopus_q4'],
            timeoutMs: 45000,
            json: true,
            all: false,
        });

        expect(parseInferenceCanarySmokeArgs(['--all'])).toEqual(expect.objectContaining({ all: true, endpointNames: [] }));
    });

    it('probes each requested endpoint without silently falling back to default', async () => {
        const calls: string[] = [];
        const report = await runInferenceCanarySmoke({
            endpoints: {
                default: { baseUrl: 'http://old.test', model: 'old-model', timeoutMs: 60000 },
                spacetower_qwopus_q4: { baseUrl: 'http://new.test', model: 'qwopus', timeoutMs: 30000 },
            },
            endpointNames: ['default', 'spacetower_qwopus_q4'],
            timeoutMs: 1234,
            probe: async ({ endpoint }): Promise<InferenceHealthResult> => {
                calls.push(endpoint);
                return { ok: true, status: 'ok', endpoint, model: endpoint, latencyMs: endpoint === 'default' ? 200 : 50 };
            },
        });

        expect(calls).toEqual(['default', 'spacetower_qwopus_q4']);
        expect(report.ok).toBe(true);
        expect(report.results.map(result => result.endpoint)).toEqual(['default', 'spacetower_qwopus_q4']);
    });

    it('marks unknown endpoint names as failures instead of comparing the wrong model', async () => {
        const report = await runInferenceCanarySmoke({
            endpoints: {
                default: { baseUrl: 'http://old.test', model: 'old-model', timeoutMs: 60000 },
            },
            endpointNames: ['missing'],
            timeoutMs: 1234,
            probe: async ({ endpoint }): Promise<InferenceHealthResult> => ({ ok: true, status: 'ok', endpoint }),
        });

        expect(report.ok).toBe(false);
        expect(report.results).toEqual([
            {
                ok: false,
                status: 'not_configured',
                endpoint: 'missing',
                error: 'endpoint not found in controller config',
            },
        ]);
    });
});
