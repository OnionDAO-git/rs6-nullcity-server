import { EventEmitter } from 'events';
import type { ControllerConfig } from './config';
import { ControllerHost, type ControllerHostOptions } from './controller-host';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { MemoryStore } from './memory/memory-store';
import type { RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import type { Soul } from './soul/soul-schema';
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
        expect(gateway.createResident).toHaveBeenCalledWith({ name: 'res:pip', spawnPosition: undefined });
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

function config(): ControllerConfig {
    return {
        residents: ['res:pip'],
        gateway: { url: 'ws://controller-host.test', controllerId: 'test-controller' },
        inference: { maxConcurrent: 1 },
        souls: { dir: '/tmp/souls' },
        memory: { dir: '/tmp/memory', qmdBin: '' },
        logging: { dir: '/tmp/logs', fullPerceptions: false },
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
