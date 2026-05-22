import { EventEmitter } from 'events';
import type { ControllerConfig } from './config';
import { ControllerHost, type ControllerHostOptions } from './controller-host';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { MemoryStore } from './memory/memory-store';
import type { RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import type { ResidentRuntime } from './resident-runtime';
import type { Soul } from './soul/soul-schema';
import type { SparkModule } from './spark/modules';
import type { GatewayClient } from './transport/gateway-client';
import type { ConnectResidentPayload, CreateResidentPayload, ResidentSummary } from './transport/message-codecs';

class FakeGateway extends EventEmitter {
    residents: ResidentSummary[] = [];
    connect = jest.fn(async () => undefined);
    hello = jest.fn(async () => undefined);
    close = jest.fn();
    listResidents = jest.fn(async () => this.residents);
    createResident = jest.fn(async (payload: CreateResidentPayload) => {
        const resident = { name: payload.name, online: true, controllerId: 'test-controller' };
        this.residents = [...this.residents, resident];
        return resident;
    });
    connectResident = jest.fn(async (payload: ConnectResidentPayload) => {
        const resident = { name: payload.name, online: true, controllerId: 'test-controller' };
        this.residents = this.residents.filter(item => item.name !== payload.name).concat(resident);
        return resident;
    });
    attach = jest.fn(async (payload: ConnectResidentPayload) => {
        const resident = { name: payload.name, online: true, controllerId: 'test-controller' };
        this.residents = this.residents.filter(item => item.name !== payload.name).concat(resident);
        return resident;
    });
    submitAction = jest.fn(async () => ({ ok: true }));
}

describe('ControllerHost reconcile lifecycle', () => {
    it('re-handshakes and re-attaches desired residents after gateway reconnect', async () => {
        const gateway = new FakeGateway();
        const host = new ControllerHost(config(), dependencies(gateway));

        await host.start();

        expect(gateway.hello).toHaveBeenCalledTimes(1);
        expect(gateway.createResident).toHaveBeenCalledWith({
            name: 'res:pip',
            spawnPosition: undefined,
            initialInventory: undefined,
            initialEquipment: undefined,
        });
        expect(gateway.connectResident).toHaveBeenCalledWith({ name: 'res:pip', observe: true, control: true, onDisconnect: 'idle' });
        expect(runtimeCount(host)).toBe(1);

        gateway.emit('disconnect');
        expect(runtimeCount(host)).toBe(0);

        gateway.residents = [{ name: 'res:pip', online: true }];
        gateway.emit('ready');
        await flushPromises();

        expect(gateway.hello).toHaveBeenCalledTimes(2);
        expect(gateway.connectResident).toHaveBeenLastCalledWith({ name: 'res:pip', observe: true, control: true, onDisconnect: 'idle' });
        expect(gateway.attach).not.toHaveBeenCalled();
        expect(runtimeCount(host)).toBe(1);

        await host.stop();
    });

    it('serializes overlapping reconciles and runs a queued pass for changed gateway state', async () => {
        const gateway = new FakeGateway();
        const host = new ControllerHost(config(), dependencies(gateway));
        let activeLists = 0;
        let maxActiveLists = 0;
        let releaseFirstList: (() => void) | undefined;

        gateway.listResidents.mockImplementation(async () => {
            activeLists += 1;
            maxActiveLists = Math.max(maxActiveLists, activeLists);
            if (!releaseFirstList) {
                await new Promise<void>(resolve => {
                    releaseFirstList = resolve;
                });
                gateway.residents = [{ name: 'res:pip', online: true }];
            }
            activeLists -= 1;
            return gateway.residents;
        });

        const first = host.reconcile();
        const second = host.reconcile();
        releaseFirstList?.();
        await Promise.all([first, second]);

        expect(maxActiveLists).toBe(1);
        expect(gateway.listResidents).toHaveBeenCalledTimes(2);
    });

    it('routes gateway resident ids back to runtime names', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        const host = new ControllerHost(config(), deps);

        await host.start();
        gateway.emit('event', 'resident:res:pip', { kind: 'level_up', skill: 'attack', level: 2 });

        expect(deps.memory?.write).toHaveBeenCalledWith('res:pip', 'skills.md', expect.stringContaining('"level":2'));

        await host.stop();
    });

    it('passes starter items from the soul when creating a resident', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        deps.soulLoader = {
            load: jest.fn((name: string) => ({
                ...soul(name),
                frontmatter: {
                    ...soul(name).frontmatter,
                    spawnPosition: { x: 3225, y: 3230, level: 0 },
                    initialInventory: [{ itemId: 590 }, { itemId: 1351 }, null],
                },
            })),
        } as unknown as ControllerHostOptions['soulLoader'];
        const host = new ControllerHost(config(), deps);

        await host.start();

        expect(gateway.createResident).toHaveBeenCalledWith({
            name: 'res:pip',
            spawnPosition: { x: 3225, y: 3230, level: 0 },
            initialInventory: [{ itemId: 590 }, { itemId: 1351 }, null],
            initialEquipment: undefined,
        });

        await host.stop();
    });

    it('discovers desired residents from soul files during reconcile', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        deps.soulLoader = {
            listResidentNames: jest.fn(() => ['res:newcomer']),
            load: jest.fn((name: string) => soul(name)),
        } as unknown as ControllerHostOptions['soulLoader'];
        const host = new ControllerHost({ ...config(), residents: [] }, deps);

        await host.start();

        expect(gateway.createResident).toHaveBeenCalledWith({
            name: 'res:newcomer',
            spawnPosition: undefined,
            initialInventory: undefined,
            initialEquipment: undefined,
        });
        expect(gateway.connectResident).toHaveBeenCalledWith({ name: 'res:newcomer', observe: true, control: true, onDisconnect: 'idle' });
        expect(runtimeCount(host)).toBe(1);

        await host.stop();
    });

    it('passes configured SPARK modules into created runtimes', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const runtimeFactory = jest.fn((options: { sparkModules?: SparkModule[] }) => {
            void options;
            return runtime;
        });
        const sparkModules = [sparkModule('onion.custom')];
        const host = new ControllerHost(config(), { ...dependencies(gateway), runtimeFactory, sparkModules });

        await host.start();

        expect(runtimeFactory).toHaveBeenCalledWith(expect.objectContaining({ sparkModules }));

        await host.stop();
    });

    it('opens a runtime evidence session for created residents', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const runtimeFactory = jest.fn(
            (options: {
                evidence?: { sessionId: string; store: { currentSession: () => unknown }; trajectory: unknown; library?: unknown };
            }) => {
                void options;
                return runtime;
            },
        );
        const host = new ControllerHost(config(), { ...dependencies(gateway), runtimeFactory });

        await host.start();

        const evidence = runtimeFactory.mock.calls[0]?.[0].evidence;
        expect(evidence?.sessionId).toContain('test-instance');
        expect(evidence?.sessionId).toContain('res-pip');
        expect(evidence?.store.currentSession()).toEqual(expect.objectContaining({ sessionId: evidence?.sessionId }));
        expect(evidence?.trajectory).toBeDefined();
        expect(evidence?.library).toBeDefined();

        await host.stop();
    });

    it('still starts a resident when evidence-session creation throws', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const runtimeFactory = jest.fn((options: { evidence?: unknown }) => {
            void options;
            return runtime;
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Point the memory dir at a non-existent path on a read-only volume to force
        // EvidenceStore.beginSession to throw. /dev/null/evidence-cannot-be-created
        // is guaranteed to fail mkdirSync on macOS and Linux.
        const baseConfig = config();
        const brokenConfig = { ...baseConfig, memory: { ...baseConfig.memory, dir: '/dev/null/evidence-cannot-be-created' } };
        const host = new ControllerHost(brokenConfig, { ...dependencies(gateway), runtimeFactory });

        try {
            await host.start();

            const passedEvidence = runtimeFactory.mock.calls[0]?.[0].evidence;
            // Evidence init failed → resident still started, but evidence is undefined.
            expect(passedEvidence).toBeUndefined();
            expect(errorSpy).toHaveBeenCalled();
            const errorCall = errorSpy.mock.calls[0];
            expect(errorCall[0]).toEqual(expect.stringContaining('evidence init failed for resident'));
            // Use duck-typing rather than instanceof; Jest's cross-realm
            // checks sometimes report the same constructor as a mismatch.
            expect(errorCall[1]).toEqual(expect.objectContaining({ message: expect.any(String) }));
            expect(runtimeFactory).toHaveBeenCalled();

            await host.stop();
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('uses the built-in standard SPARK module registry by default', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const runtimeFactory = jest.fn((options: { sparkModules?: SparkModule[] }) => {
            void options;
            return runtime;
        });
        const host = new ControllerHost(config(), { ...dependencies(gateway), runtimeFactory });

        await host.start();

        const runtimeOptions = runtimeFactory.mock.calls[0]?.[0];
        expect(runtimeOptions).toBeDefined();
        expect(runtimeOptions.sparkModules?.map(module => module.manifest.id)).toContain('onion.runescape.standard');

        await host.stop();
    });

    it('flushes game-skill feedback before stopping', async () => {
        const gateway = new FakeGateway();
        const gameSkill = {
            buildContext: jest.fn(() => ({ knowledgeResults: [], workflowAvailability: [], brainSection: '', bodySection: '' })),
            observeAttempt: jest.fn(),
            flush: jest.fn(async () => undefined),
        };
        const host = new ControllerHost(config(), { ...dependencies(gateway), gameSkill });

        await host.start();
        await host.stop();

        expect(gameSkill.flush).toHaveBeenCalledTimes(1);
    });

    it('pauses a resident runtime and keeps reconcile from restarting it', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const host = new ControllerHost(config(), { ...dependencies(gateway), runtimeFactory: jest.fn(() => runtime) });

        await host.start();
        expect(runtimeCount(host)).toBe(1);

        gateway.emit('residentPaused', 'res:pip', 'dashboard_pause');

        expect(runtime.stop).toHaveBeenCalledWith('dashboard_pause');
        expect(runtimeCount(host)).toBe(0);
        const createCalls = gateway.createResident.mock.calls.length;
        const connectCalls = gateway.connectResident.mock.calls.length;

        await host.reconcile();

        expect(gateway.createResident).toHaveBeenCalledTimes(createCalls);
        expect(gateway.connectResident).toHaveBeenCalledTimes(connectCalls);

        await host.stop();
    });

    it('waits for in-flight perception handlers before flushing game-skill feedback', async () => {
        const gateway = new FakeGateway();
        const gameSkill = {
            buildContext: jest.fn(() => ({ knowledgeResults: [], workflowAvailability: [], brainSection: '', bodySection: '' })),
            observeAttempt: jest.fn(),
            flush: jest.fn(async () => undefined),
        };
        const deps = dependencies(gateway);
        let releasePerception!: () => void;
        const perceptionDone = new Promise<void>(resolve => {
            releasePerception = resolve;
        });
        const runtime = {
            onPerception: jest.fn(async () => {
                await perceptionDone;
            }),
            onEvent: jest.fn(),
            stop: jest.fn(),
        } as unknown as ResidentRuntime;
        const host = new ControllerHost(config(), { ...deps, gameSkill, runtimeFactory: jest.fn(() => runtime) });

        await host.start();
        gateway.emit('perception', 'resident:res:pip', { tick: 1, events: [] });
        await Promise.resolve();
        const stop = host.stop();
        await Promise.resolve();

        expect(gameSkill.flush).not.toHaveBeenCalled();
        releasePerception();
        await stop;

        expect(gameSkill.flush).toHaveBeenCalledTimes(1);
    });
});

function dependencies(gateway: FakeGateway): ControllerHostOptions {
    const state = new Map<string, RuntimeState>();
    return {
        once: true,
        gateway: gateway as unknown as GatewayClient,
        soulLoader: { load: jest.fn((name: string) => soul(name)) } as unknown as ControllerHostOptions['soulLoader'],
        memory: {
            ensureResident: jest.fn(() => '/tmp/nullcity-controller-host-test'),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore,
        stateStore: {
            load: jest.fn((resident: string, attention: number, legacyKind: string) => {
                const runtimeState =
                    state.get(resident) ||
                    ({
                        resident,
                        attention,
                        tick: 0,
                        legacy: { kind: legacyKind, progress: {}, complete: false },
                        budgets: {
                            minuteStartedAt: new Date(0).toISOString(),
                            dayStartedAt: new Date(0).toISOString(),
                            requestsThisMinute: 0,
                            requestsToday: 0,
                        },
                        variables: {},
                        hookCooldowns: {},
                        shadowedHooks: [],
                    } satisfies RuntimeState);
                state.set(resident, runtimeState);
                return runtimeState;
            }),
            save: jest.fn(),
        } as unknown as RuntimeStateStore,
        llm: {} as LlmClient,
        actionLog: { append: jest.fn() } as unknown as ActionLog,
        inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
    };
}

function fakeRuntime(): ResidentRuntime {
    return {
        onPerception: jest.fn(async () => undefined),
        onEvent: jest.fn(),
        stop: jest.fn(),
    } as unknown as ResidentRuntime;
}

function sparkModule(id: string): SparkModule {
    return {
        manifest: {
            id,
            version: '0.1.0',
            displayName: id,
            capabilities: ['thinking'],
            risk: 'reviewed',
        },
    };
}

function config(): ControllerConfig {
    return {
        controller: { instanceId: 'test-instance' },
        residents: ['res:pip'],
        gateway: { url: 'ws://controller-host.test', controllerId: 'test-controller' },
        inference: { maxConcurrent: 1 },
        souls: { dir: '/tmp/souls' },
        memory: { dir: '/tmp/memory', qmdBin: '' },
        logging: { dir: '/tmp/logs', fullPerceptions: false },
        knowledge: { dir: '/tmp/knowledge', enableSuggestions: true, emitStdout: false, storageMode: 'ephemeral' },
        llm: { endpoints: {} },
    };
}

function soul(name: string): Soul {
    return {
        frontmatter: {
            name,
            archetype: 'mentor',
            legacy: { kind: 'mentor', parameters: { targetMenteeCount: 1 } },
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
        },
        body: '# Test soul',
        sourcePath: '/tmp/soul.md',
    };
}

function runtimeCount(host: ControllerHost): number {
    return (host as unknown as { runtimes: Map<string, unknown> }).runtimes.size;
}

async function flushPromises(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}
