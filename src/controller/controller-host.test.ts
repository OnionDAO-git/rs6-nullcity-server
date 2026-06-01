import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ControllerConfig } from './config';
import { BornResidentStore } from './born-resident-store';
import { ControllerHost, type CityInventoryGateway, type ControllerHostOptions } from './controller-host';
import { LettersStore } from './patron/letters-store';
import { PatronStore } from './patron/patron-store';
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
    inspectResidentGold = jest.fn(async (resident: string) => ({ resident, itemId: 995 as const, amount: 125 }));
    burnResidentGold = jest.fn(async (resident: string, amount: number) => ({
        resident,
        itemId: 995 as const,
        burnedAmount: amount,
        remainingAmount: 125 - amount,
    }));
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

    it('enqueues external perception events onto a running runtime', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const host = new ControllerHost(config(), { ...dependencies(gateway), runtimeFactory: jest.fn(() => runtime) });

        await host.start();
        const event = { kind: 'chat', text: 'Can you hear me?', from: { name: 'hd035-smoke' } };

        expect(host.enqueuePerceptionEvent('res:pip', event)).toBe(true);
        expect(runtime.onEvent).toHaveBeenCalledWith(event);

        await host.stop();
    });

    it('routes GP inventory calls through an isolated city gateway when provided', async () => {
        const gateway = new FakeGateway();
        const cityGateway = new FakeGateway();
        gateway.inspectResidentGold.mockRejectedValue(new Error('shared resident gateway overloaded'));
        gateway.burnResidentGold.mockRejectedValue(new Error('shared resident gateway overloaded'));
        cityGateway.inspectResidentGold.mockResolvedValue({ resident: 'res:pip', itemId: 995, amount: 777 });
        cityGateway.burnResidentGold.mockResolvedValue({
            resident: 'res:pip',
            itemId: 995,
            burnedAmount: 25,
            remainingAmount: 752,
        });
        const host = new ControllerHost(config(), {
            ...dependencies(gateway),
            cityGateway: cityGateway as unknown as ControllerHostOptions['cityGateway'],
        });

        await host.start();

        await expect(host.inspectResidentGold('res:pip')).resolves.toEqual({ resident: 'res:pip', itemId: 995, amount: 777 });
        await expect(host.burnResidentGold('res:pip', 25)).resolves.toEqual({
            resident: 'res:pip',
            itemId: 995,
            burnedAmount: 25,
            remainingAmount: 752,
        });

        expect(gateway.inspectResidentGold).not.toHaveBeenCalled();
        expect(gateway.burnResidentGold).not.toHaveBeenCalled();
        expect(cityGateway.connect).toHaveBeenCalledTimes(1);
        expect(cityGateway.hello).toHaveBeenCalledTimes(1);

        await host.stop();

        expect(cityGateway.close).toHaveBeenCalledTimes(1);
    });

    it('passes the host-owned city exchange service into resident runtimes', async () => {
        const gateway = new FakeGateway();
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-host-city-exchange-'));
        const runtimeState = {
            resident: 'res:pip',
            attention: 100,
            tick: 7,
            legacy: { kind: 'mentor', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: new Date(0).toISOString(),
                dayStartedAt: new Date(0).toISOString(),
                requestsThisMinute: 0,
                requestsToday: 0,
            },
            variables: {},
            hookCooldowns: {},
            shadowedHooks: [],
        } satisfies RuntimeState;
        const runtime = {
            ...fakeRuntime(),
            getState: jest.fn(() => runtimeState),
            incrementAttention: jest.fn((amount: number) => {
                runtimeState.attention += amount;
            }),
        } as unknown as ResidentRuntime;
        const runtimeFactory = jest.fn((options: ConstructorParameters<typeof ResidentRuntime>[0]) => {
            void options;
            return runtime;
        });
        const host = new ControllerHost(
            { ...config(), memory: { dir: memoryDir, qmdBin: '' } },
            { ...dependencies(gateway), runtimeFactory },
        );

        await host.start();

        const runtimeOptions = runtimeFactory.mock.calls[0]?.[0];
        expect(runtimeOptions?.cityExchange).toBeDefined();
        await runtimeOptions?.cityExchange?.exchangeApForGp('res:pip', {
            idempotencyKey: 'host-city-exchange',
            gpAmount: 25,
            apAmount: 50,
            cityUserId: 'resident:self',
            sourceType: 'resident',
            sourceId: 'test',
        });
        expect(gateway.burnResidentGold).toHaveBeenCalledWith('res:pip', 25);

        await host.stop();
    });

    it('uses a fresh retryable city gateway for GP inventory calls when the live host owns the gateway', async () => {
        const gateway = new FakeGateway();
        const firstCityGateway = new FakeGateway();
        const secondCityGateway = new FakeGateway();
        const cityGateways = [firstCityGateway, secondCityGateway];
        firstCityGateway.inspectResidentGold.mockRejectedValue(new Error('Gateway socket is not open'));
        secondCityGateway.inspectResidentGold.mockResolvedValue({ resident: 'res:pip', itemId: 995, amount: 321 });
        const host = new ControllerHost(config(), {
            ...dependencies(gateway),
            cityGatewayFactory: jest.fn(() => cityGateways.shift() as unknown as CityInventoryGateway),
        });

        await host.start();

        await expect(host.inspectResidentGold('res:pip')).resolves.toEqual({ resident: 'res:pip', itemId: 995, amount: 321 });

        expect(firstCityGateway.connect).toHaveBeenCalledTimes(1);
        expect(firstCityGateway.hello).toHaveBeenCalledTimes(1);
        expect(firstCityGateway.close).toHaveBeenCalledTimes(1);
        expect(secondCityGateway.connect).toHaveBeenCalledTimes(1);
        expect(secondCityGateway.hello).toHaveBeenCalledTimes(1);
        expect(secondCityGateway.close).toHaveBeenCalledTimes(1);

        await host.stop();
    });

    it('normalizes resident-prefixed ids when enqueuing external perception events', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const host = new ControllerHost(config(), { ...dependencies(gateway), runtimeFactory: jest.fn(() => runtime) });

        await host.start();
        const event = { kind: 'chat', text: 'Still there?', from: { name: 'hd035-smoke' } };

        expect(host.enqueuePerceptionEvent('resident:res:pip', event)).toBe(true);
        expect(runtime.onEvent).toHaveBeenCalledWith(event);

        await host.stop();
    });

    it('returns false when enqueuing an external event for a missing runtime', async () => {
        const gateway = new FakeGateway();
        const host = new ControllerHost(config(), dependencies(gateway));

        await host.start();

        expect(host.enqueuePerceptionEvent('res:missing', { kind: 'chat', text: 'hello' })).toBe(false);

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

    it('can run only the configured cohort when soul discovery is disabled', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        deps.soulLoader = {
            listResidentNames: jest.fn(() => ['res:newcomer']),
            load: jest.fn((name: string) => soul(name)),
        } as unknown as ControllerHostOptions['soulLoader'];
        const host = new ControllerHost(
            {
                ...config(),
                residents: ['res:pip'],
                souls: { ...config().souls, discoverResidents: false },
            },
            deps,
        );

        await host.start();

        expect(gateway.createResident).toHaveBeenCalledTimes(1);
        expect(gateway.createResident).toHaveBeenCalledWith({
            name: 'res:pip',
            spawnPosition: undefined,
            initialInventory: undefined,
            initialEquipment: undefined,
        });
        expect(gateway.connectResident).toHaveBeenCalledWith({ name: 'res:pip', observe: true, control: true, onDisconnect: 'idle' });
        expect(gateway.createResident).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'res:newcomer' }));
        expect(runtimeCount(host)).toBe(1);

        await host.stop();
    });

    it('keeps a city-born resident desired across reconcile even with soul discovery disabled', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        deps.soulLoader = {
            listResidentNames: jest.fn(() => []),
            load: jest.fn((name: string) => soul(name)),
        } as unknown as ControllerHostOptions['soulLoader'];
        const soulsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-born-souls-'));
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-born-mem-'));
        const host = new ControllerHost(
            { ...config(), residents: ['res:pip'], souls: { dir: soulsDir, discoverResidents: false }, memory: { dir: memoryDir, qmdBin: '' } },
            deps,
        );

        await host.start();
        expect(runtimeCount(host)).toBe(1);

        await host.birthResidentFromCity({
            proposalId: 'proposal-1',
            residentName: 'res:born',
            soulMarkdown: '---\nname: res:born\narchetype: mentor\n---\nborn soul body',
            fundedAttention: 100,
        });
        expect(runtimeCount(host)).toBe(2);

        // A reconcile rebuilds the desired set from the configured cohort (and
        // soul discovery when enabled). A human-funded, city-born resident is in
        // neither, so before the cityBorn fix it was torn down as
        // "no_longer_desired" and orphaned. It must survive reconcile.
        await host.reconcile();
        expect(runtimeCount(host)).toBe(2);

        await host.stop();
    });

    it('re-manages a city-born resident after a controller restart (persisted born manifest)', async () => {
        const soulsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-born-souls-'));
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-born-mem-'));
        const cfg = { ...config(), residents: ['res:pip'], souls: { dir: soulsDir, discoverResidents: false }, memory: { dir: memoryDir, qmdBin: '' } };

        // First controller process: birth a resident, then shut down.
        const host1 = new ControllerHost(cfg, dependencies(new FakeGateway()));
        await host1.start();
        await host1.birthResidentFromCity({
            proposalId: 'proposal-1',
            residentName: 'res:born',
            soulMarkdown: '---\nname: res:born\narchetype: mentor\n---\nborn soul body',
            fundedAttention: 100,
        });
        await host1.stop();

        // Second controller process (restart) sharing the same memory dir: the
        // born resident must be restored from the persisted manifest and managed
        // again, even though it is absent from config.residents and discovery.
        const host2 = new ControllerHost(cfg, dependencies(new FakeGateway()));
        await host2.start();
        expect(residentNames(host2)).toContain('res:born');

        await host2.stop();
    });

    it('isolates a failing resident during reconcile so the rest of the cohort still connects', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        deps.soulLoader = {
            listResidentNames: jest.fn(() => []),
            load: jest.fn((name: string) => {
                if (name === 'res:bad') {
                    throw new Error('missing soul for res:bad');
                }
                return soul(name);
            }),
        } as unknown as ControllerHostOptions['soulLoader'];
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-resil-mem-'));
        // res:bad is iterated first (insertion order); before the per-resident
        // try/catch it would throw and abort the whole reconcile, leaving res:good
        // unmanaged. With isolation, res:good still connects.
        const host = new ControllerHost(
            {
                ...config(),
                residents: ['res:bad', 'res:good'],
                souls: { ...config().souls, discoverResidents: false },
                memory: { dir: memoryDir, qmdBin: '' },
            },
            deps,
        );

        await host.start();

        expect(residentNames(host)).toContain('res:good');
        expect(residentNames(host)).not.toContain('res:bad');

        await host.stop();
    });

    it('prunes a city-born resident on death so it stays dead (no resurrection)', async () => {
        const gateway = new FakeGateway();
        const deps = dependencies(gateway);
        const onDeathByName: Record<string, (name: string, cause: string) => void> = {};
        deps.runtimeFactory = jest.fn((opts: { soul: { frontmatter: { name: string } }; onDeath?: (n: string, c: string) => void }) => {
            if (opts.onDeath) {
                onDeathByName[opts.soul.frontmatter.name] = opts.onDeath;
            }
            return fakeRuntime();
        }) as unknown as ControllerHostOptions['runtimeFactory'];
        const soulsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-death-souls-'));
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-death-mem-'));
        const host = new ControllerHost(
            { ...config(), residents: ['res:pip'], souls: { dir: soulsDir, discoverResidents: false }, memory: { dir: memoryDir, qmdBin: '' } },
            deps,
        );

        await host.start();
        await host.birthResidentFromCity({
            proposalId: 'p1',
            residentName: 'res:born',
            soulMarkdown: '---\nname: res:born\narchetype: mentor\n---\nborn soul body',
            fundedAttention: 100,
        });
        expect(residentNames(host)).toContain('res:born');
        expect(new BornResidentStore(memoryDir).list()).toContain('res:born');

        // The runtime observes the born resident's death and fires onDeath.
        onDeathByName['res:born']?.('res:born', 'attention_exhausted');

        // Pruned from the persisted manifest, and a reconcile must NOT resurrect
        // it (without the prune, refreshDesiredResidents would re-add it and the
        // resident would respawn — death would never stick).
        expect(new BornResidentStore(memoryDir).list()).not.toContain('res:born');
        await host.reconcile();
        expect(residentNames(host)).not.toContain('res:born');

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

    it('derives the thinking watchdog from configured LLM endpoint timeouts', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const runtimeFactory = jest.fn((options: { watchdog?: { thinkingMs?: number } }) => {
            void options;
            return runtime;
        });
        const cfg = {
            ...config(),
            llm: {
                endpoints: {
                    default: { timeoutMs: 60_000 },
                    fast: { timeoutMs: 12_000 },
                },
                profiles: {},
            },
        };
        const host = new ControllerHost(cfg, { ...dependencies(gateway), runtimeFactory });

        await host.start();

        expect(runtimeFactory).toHaveBeenCalledWith(expect.objectContaining({ watchdog: { thinkingMs: 65_000 } }));

        await host.stop();
    });

    it('passes the patron gateway into created runtimes for event reflex wiring', async () => {
        const gateway = new FakeGateway();
        const runtime = fakeRuntime();
        const patronGateway = { witnessAt: jest.fn() };
        const runtimeFactory = jest.fn((options: ConstructorParameters<typeof ResidentRuntime>[0]) => {
            void options;
            return runtime;
        });
        const host = new ControllerHost(config(), {
            ...dependencies(gateway),
            patronGateway: patronGateway as unknown as ControllerHostOptions['patronGateway'],
            runtimeFactory,
        });

        await host.start();

        expect(runtimeFactory.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ patronGateway }));

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

    it('passes a persistent faction stockpile ledger into resident runtimes', async () => {
        const gateway = new FakeGateway();
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-host-stockpile-'));
        const runtime = fakeRuntime();
        const runtimeFactory = jest.fn((options: ConstructorParameters<typeof ResidentRuntime>[0]) => {
            void options;
            return runtime;
        });
        const host = new ControllerHost(
            { ...config(), memory: { dir: memoryDir, qmdBin: '' } },
            { ...dependencies(gateway), runtimeFactory },
        );

        await host.start();

        const runtimeOptions = runtimeFactory.mock.calls[0]?.[0];
        expect(runtimeOptions?.factionStockpile).toBeDefined();
        runtimeOptions?.factionStockpile?.recordAttempt({
            resident: 'res:pip',
            factionId: 'ledger',
            attempt: {
                attemptId: 'attempt-test',
                resident: 'res:pip',
                producer: 'body',
                submittedAt: '2026-05-25T19:20:00.000Z',
                action: { kind: 'move_to', target: { x: 3210, y: 3424, level: 0 }, cause: 'faction_ledger_audit_work' },
                evidence: [],
                finalStatus: 'success',
            },
        });

        expect(fs.existsSync(path.join(memoryDir, 'faction-stockpile.json'))).toBe(true);

        await host.stop();
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

describe('ControllerHost patron wiring (EVENT-D1a)', () => {
    let tmpMemory: string;

    beforeEach(() => {
        tmpMemory = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-host-patron-'));
    });

    afterEach(() => {
        fs.rmSync(tmpMemory, { recursive: true, force: true });
    });

    it('constructs PatronGateway with a LettersStore rooted at memory.dir', () => {
        const gateway = new FakeGateway();
        const cfg = config();
        cfg.memory = { ...cfg.memory, dir: tmpMemory };
        const host = new ControllerHost(cfg, dependencies(gateway));

        expect(host.patronGateway).toBeDefined();

        // The wired lettersStore is what makes tier-crossing letters
        // actually reach disk. Without it, dispatchTierLetter early-returns
        // and every letter the gateway produces lands in /dev/null.
        const wiredStore = lettersStoreOf(host.patronGateway);
        expect(wiredStore).toBeInstanceOf(LettersStore);
    });

    it('constructs PatronGateway with memory.dir so host-side patron asks write Library timeline events', () => {
        const gateway = new FakeGateway();
        const cfg = config();
        cfg.memory = { ...cfg.memory, dir: tmpMemory };
        const host = new ControllerHost(cfg, dependencies(gateway));

        expect(memoryDirOf(host.patronGateway)).toBe(tmpMemory);
    });

    it('round-trips a Letter through the wired LettersStore at the same memory.dir', () => {
        const gateway = new FakeGateway();
        const cfg = config();
        cfg.memory = { ...cfg.memory, dir: tmpMemory };
        const host = new ControllerHost(cfg, dependencies(gateway));

        // Write a synthetic letter via the wired store and read it back via
        // a fresh LettersStore at the same root. This proves the gateway and
        // any external consumer (HTTP inbox endpoint, dashboard) read from
        // the same on-disk location.
        const wiredStore = lettersStoreOf(host.patronGateway);
        expect(wiredStore).toBeDefined();
        wiredStore!.append({
            kind: 'standing_tier_crossed',
            recipient: 'alice@onion',
            senderResident: 'res:fern',
            subject: 'You are now Acquaintance of embassy',
            body: 'alice@onion, welcome. — Embassy Clerk',
            dispatchedAt: '2026-05-23T13:00:00.000Z',
            deliveryChannels: ['web-inbox'],
        });

        const reader = new LettersStore(tmpMemory);
        const inbox = reader.readInbox('alice@onion');
        expect(inbox).toHaveLength(1);
        expect(inbox[0].kind).toBe('standing_tier_crossed');
        expect(inbox[0].recipient).toBe('alice@onion');
    });

    it('refreshes patron ledgers from disk before live MCP offers use them', () => {
        const gateway = new FakeGateway();
        const cfg = config();
        cfg.memory = { ...cfg.memory, dir: tmpMemory };
        const host = new ControllerHost(cfg, dependencies(gateway));
        const store = new PatronStore(tmpMemory);

        const diskCurrency = store.loadCurrency();
        diskCurrency.credit('alice@onion', 20, { reason: 'staff_grant', ts: '2026-05-25T16:00:00.000Z' });
        store.saveCurrency(diskCurrency);

        const diskStanding = store.loadStanding();
        diskStanding.recordSupport('alice@onion', 'embassy', 7, { reason: 'preexisting', ts: '2026-05-25T16:01:00.000Z' });
        store.saveStanding(diskStanding);

        expect(currencyLedgerOf(host.patronGateway)?.balance('alice@onion')).toBe(0);
        expect(standingLedgerOf(host.patronGateway)?.points('alice@onion', 'embassy')).toBe(0);

        host.refreshPatronLedgersFromDisk();

        expect(currencyLedgerOf(host.patronGateway)?.balance('alice@onion')).toBe(20);
        expect(standingLedgerOf(host.patronGateway)?.points('alice@onion', 'embassy')).toBe(7);
    });

    it('preserves dependency-injected PatronGateway when caller provides one', () => {
        const gateway = new FakeGateway();
        const cfg = config();
        cfg.memory = { ...cfg.memory, dir: tmpMemory };
        const custom = { offerTo: jest.fn() } as unknown as ControllerHostOptions['patronGateway'];
        const host = new ControllerHost(cfg, { ...dependencies(gateway), patronGateway: custom });
        expect(host.patronGateway).toBe(custom);
    });
});

// Type-cast helper mirroring the runtimeCount() pattern below — reaches
// into the gateway's private options to verify the wiring we care about.
function lettersStoreOf(gateway: ControllerHost['patronGateway']): LettersStore | undefined {
    return (gateway as unknown as { options: { lettersStore?: LettersStore } }).options.lettersStore;
}

function memoryDirOf(gateway: ControllerHost['patronGateway']): string | undefined {
    return (gateway as unknown as { options: { memoryDir?: string } }).options.memoryDir;
}

function currencyLedgerOf(gateway: ControllerHost['patronGateway']) {
    return (gateway as unknown as { options: { currencyLedger?: { balance: (humanId: string) => number } } }).options.currencyLedger;
}

function standingLedgerOf(gateway: ControllerHost['patronGateway']) {
    return (gateway as unknown as { options: { standingLedger?: { points: (humanId: string, faction: string) => number } } }).options
        .standingLedger;
}

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
        souls: { dir: '/tmp/souls', discoverResidents: true },
        memory: { dir: '/tmp/memory', qmdBin: '' },
        logging: { dir: '/tmp/logs', fullPerceptions: false },
        knowledge: { dir: '/tmp/knowledge', enableSuggestions: true, emitStdout: false, storageMode: 'ephemeral' },
        llm: { endpoints: {}, profiles: {} },
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

function residentNames(host: ControllerHost): string[] {
    return [...(host as unknown as { runtimes: Map<string, unknown> }).runtimes.keys()];
}

async function flushPromises(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}
