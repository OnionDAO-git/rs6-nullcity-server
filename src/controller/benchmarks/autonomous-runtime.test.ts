import { EventEmitter } from 'events';
import type { ControllerConfig } from '../config';
import { ResidentRuntime } from '../resident-runtime';
import { ResidentRuntimeBenchmarkDriver } from './autonomous-runtime';
import type { BenchmarkAutonomousRuntimeContext } from './benchmark-runner';

jest.mock('../resident-runtime', () => ({
    ResidentRuntime: jest.fn().mockImplementation(() => ({
        onPerception: jest.fn(async () => undefined),
        onEvent: jest.fn(),
        stop: jest.fn(),
    })),
}));

describe('ResidentRuntimeBenchmarkDriver', () => {
    it('wires runtime evidence and exposes trajectory/progress artifact paths', async () => {
        const context = benchmarkContext();
        const driver = new ResidentRuntimeBenchmarkDriver({
            config: config(),
            gateway: new FakeGateway() as never,
            module: context.module,
            sparkModules: [],
        });

        await driver.start(context);

        const runtimeOptions = (ResidentRuntime as jest.Mock).mock.calls[0]?.[0];
        expect(runtimeOptions.evidence).toEqual(
            expect.objectContaining({
                sessionId: expect.stringContaining('make-fire-5m'),
                trajectory: expect.anything(),
                store: expect.anything(),
                library: expect.anything(),
            }),
        );
        expect(context.recordArtifactPath).toHaveBeenCalledWith(expect.stringContaining('/trajectory/'));
        expect(context.recordArtifactPath).toHaveBeenCalledWith(expect.stringContaining('/progress/'));
        expect(context.recordArtifactPath).toHaveBeenCalledWith(expect.stringContaining('/library/'));
        expect(context.recordArtifactPath).toHaveBeenCalledWith(expect.stringContaining('timeline.jsonl'));
        expect(context.recordArtifactPath).toHaveBeenCalledWith(expect.stringContaining('portrait.json'));
        expect(context.recordArtifactPath).toHaveBeenCalledWith(expect.stringContaining('portrait.md'));

        await driver.stop('test_complete');
    });

    it('records final action effect evidence from runtime attempts for autonomous task verifiers', async () => {
        const context = benchmarkContext();
        const driver = new ResidentRuntimeBenchmarkDriver({
            config: config(),
            gateway: new FakeGateway() as never,
            module: context.module,
            sparkModules: [],
        });

        await driver.start(context);
        const runtimeOptions = (ResidentRuntime as jest.Mock).mock.calls.at(-1)?.[0];

        runtimeOptions.gameSkill.observeAttempt({
            resident: context.resident,
            producer: 'body',
            perception: { tick: 7, events: [] },
            attempt: {
                attemptId: 'attempt-1',
                resident: context.resident,
                producer: 'body',
                action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'woodcutting_chain_firemaking' },
                submittedAt: '2026-05-23T02:20:00.000Z',
                requestId: 'request-1',
                evidence: [
                    {
                        source: 'perception',
                        detail: {
                            kind: 'action_effect_observed',
                            actionKind: 'use_item_on_item',
                            changed: ['inventory', 'nearbyWorldItems'],
                        },
                    },
                ],
                finalStatus: 'success',
            },
        });

        expect(context.recordActionAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: 'request-1',
                action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'woodcutting_chain_firemaking' },
                finalStatus: 'success',
                evidence: expect.arrayContaining([
                    expect.objectContaining({
                        detail: expect.objectContaining({ kind: 'action_effect_observed' }),
                    }),
                ]),
                sparkModule: context.module,
            }),
        );

        await driver.stop('test_complete');
    });
});

class FakeGateway extends EventEmitter {
    off(eventName: string, listener: (...args: unknown[]) => void): this {
        return this.removeListener(eventName, listener);
    }
}

function benchmarkContext(): BenchmarkAutonomousRuntimeContext {
    return {
        resident: 'res:bmk_fire',
        task: { id: 'make-fire-5m', version: '0.1.0', timeoutMs: 5000, run: jest.fn() },
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        signal: new AbortController().signal,
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordArtifactPath: jest.fn(),
        recordSummary: jest.fn(),
    };
}

function config(): ControllerConfig {
    return {
        controller: { instanceId: 'test-instance' },
        residents: [],
        gateway: { url: 'ws://benchmark.test', controllerId: 'test-controller' },
        inference: { maxConcurrent: 1 },
        souls: { dir: '/tmp/souls' },
        memory: { dir: '/tmp/memory', qmdBin: '' },
        logging: { dir: '/tmp/logs', fullPerceptions: false },
        knowledge: { dir: '/tmp/knowledge', enableSuggestions: false, emitStdout: false, storageMode: 'ephemeral' },
        llm: { endpoints: {} },
    };
}
