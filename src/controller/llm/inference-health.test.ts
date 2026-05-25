import { runInferenceHealthProbe } from './inference-health';

describe('runInferenceHealthProbe', () => {
    it('passes when the configured endpoint returns the expected health JSON', async () => {
        const complete = jest.fn(async () => ({
            text: '{"health":"ok","probe":"nullcity-inference-health"}',
            model: 'qwen-health',
            nooped: false,
            promptTokens: 12,
            completionTokens: 7,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
            now: fakeClock(1000, 1185),
        });

        expect(result).toMatchObject({
            ok: true,
            status: 'ok',
            endpoint: 'default',
            model: 'qwen-health',
            latencyMs: 185,
            promptTokens: 12,
            completionTokens: 7,
        });
        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({
                endpoint: 'default',
                model: 'qwen-health',
                temperature: 0,
                thinking: false,
            }),
        );
    });

    it('fails without calling the LLM when the endpoint is not configured for completions', async () => {
        const complete = jest.fn();

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: { default: { timeoutMs: 30000 } },
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'not_configured',
            endpoint: 'default',
        });
        expect(complete).not.toHaveBeenCalled();
    });

    it('flags nooped completions as unhealthy because no real model answer arrived', async () => {
        const complete = jest.fn(async () => ({
            text: '{"actions":[]}',
            model: 'qwen-health',
            nooped: true,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'nooped_completion',
            endpoint: 'default',
            model: 'qwen-health',
        });
    });

    it('flags empty completions as unhealthy even when the HTTP call itself succeeds', async () => {
        const complete = jest.fn(async () => ({
            text: '   ',
            model: 'qwen-health',
            nooped: false,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'empty_completion',
            endpoint: 'default',
            model: 'qwen-health',
        });
    });

    it('flags unexpected completions that do not satisfy the probe contract', async () => {
        const complete = jest.fn(async () => ({
            text: '{"actions":[]}',
            model: 'qwen-health',
            nooped: false,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'unexpected_completion',
            endpoint: 'default',
            model: 'qwen-health',
        });
    });

    it('accepts an exact JSON answer after stripping Qwen thinking text', async () => {
        const complete = jest.fn(async () => ({
            text: '<think>checking</think>\n{"health":"ok","probe":"nullcity-inference-health"}',
            model: 'qwen-health',
            nooped: false,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
        });

        expect(result).toMatchObject({
            ok: true,
            status: 'ok',
            endpoint: 'default',
        });
    });

    it('rejects prose wrapped around the expected JSON health object', async () => {
        const complete = jest.fn(async () => ({
            text: 'Sure: {"health":"ok","probe":"nullcity-inference-health"}',
            model: 'qwen-health',
            nooped: false,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'unexpected_completion',
        });
    });

    it('rejects extra keys in the expected JSON health object', async () => {
        const complete = jest.fn(async () => ({
            text: '{"health":"ok","probe":"nullcity-inference-health","extra":true}',
            model: 'qwen-health',
            nooped: false,
        }));

        const result = await runInferenceHealthProbe({
            complete,
            endpoints: {
                default: { baseUrl: 'http://localhost:1234', model: 'qwen-health', timeoutMs: 60000 },
            },
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'unexpected_completion',
        });
    });
});

function fakeClock(...values: number[]): () => number {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
}
