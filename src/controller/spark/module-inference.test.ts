import type { LlmClient } from '../llm/llm-client';
import type { RuntimeState } from '../memory/runtime-state';
import { createSparkModuleInference } from './module-inference';
import type { SparkModuleTelemetry } from './module-telemetry';

describe('createSparkModuleInference', () => {
    it('routes requests through named profiles and emits redacted telemetry', async () => {
        const complete = jest.fn(async () => ({
            text: '{"actions":[]}',
            model: 'qwen-test',
            nooped: false,
            promptTokens: 5,
            completionTokens: 3,
        }));
        const telemetry: SparkModuleTelemetry = { emit: jest.fn() };

        const inference = createSparkModuleInference({
            state: runtimeState(),
            llm: { complete } as unknown as LlmClient,
            telemetry,
            profiles: {
                body: { endpoint: 'local-fast', thinking: false, temperature: 0.1, priority: 25 },
                brain: { endpoint: 'local-deep', thinking: true, temperature: 0.3, priority: 5 },
            },
        });

        const response = await inference.complete('body', {
            prompt: 'Use OPENAI_API_KEY=supersecret to decide.',
            temperature: 0.9,
        });

        expect(response.text).toBe('{"actions":[]}');
        expect(complete).toHaveBeenCalledWith({
            endpoint: 'local-fast',
            prompt: 'Use OPENAI_API_KEY=supersecret to decide.',
            thinking: false,
            temperature: 0.9,
            priority: 25,
            signal: undefined,
        });
        expect(telemetry.emit).toHaveBeenCalledWith({
            kind: 'metric',
            message: 'SPARK module inference completed for profile body',
            data: {
                profile: 'body',
                endpoint: 'local-fast',
                thinking: false,
                nooped: false,
                promptTokens: 5,
                completionTokens: 3,
            },
        });
    });

    it('rejects unknown profiles before calling the raw LLM client', async () => {
        const complete = jest.fn(async () => ({ text: '{"actions":[]}', nooped: true }));
        const inference = createSparkModuleInference({
            state: runtimeState(),
            llm: { complete } as unknown as LlmClient,
            telemetry: { emit: jest.fn() },
            profiles: { body: { endpoint: 'local-fast' } },
        });

        await expect(inference.complete('missing', { prompt: 'hello' })).rejects.toThrow('Unknown SPARK inference profile missing');
        expect(complete).not.toHaveBeenCalled();
    });

    it('uses runtime budgets and returns a no-op response when exhausted', async () => {
        const state = runtimeState();
        const complete = jest.fn(async () => ({ text: '{"actions":[]}', nooped: true }));
        const telemetry: SparkModuleTelemetry = { emit: jest.fn() };
        const inference = createSparkModuleInference({
            state,
            llm: { complete } as unknown as LlmClient,
            telemetry,
            profiles: { body: { endpoint: 'local-fast' } },
            budget: { maxRequestsPerTick: 1, maxRequestsPerMinute: 20, maxRequestsPerDay: 2000 },
        });

        await inference.complete('body', { prompt: 'first' });
        const response = await inference.complete('body', { prompt: 'second' });

        expect(response).toEqual({ text: '{"actions":[]}', nooped: true, cancelledBy: 'budget_exhausted:tick' });
        expect(complete).toHaveBeenCalledTimes(1);
        expect(telemetry.emit).toHaveBeenLastCalledWith({
            kind: 'warning',
            message: 'SPARK module inference budget exhausted for profile body',
            data: { profile: 'body', window: 'tick', retryAt: undefined },
        });
    });
});

function runtimeState(): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick: 1,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}
