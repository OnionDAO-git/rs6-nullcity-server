import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ControllerConfig } from '../config';
import { CityIntegrationService } from '../city-integration/service';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from '../evidence';
import { createDefaultGameSkillEntries } from '../knowledge/game-skill-entries';
import { GameSkillService } from '../knowledge/game-skill-context';
import { KnowledgeSuggestionStore } from '../knowledge/suggestions';
import { LoreBus } from '../lore/lore-bus';
import { LlmClient } from '../llm/llm-client';
import { ActionLog } from '../logging/action-log';
import { InferenceLog } from '../logging/inference-log';
import { MemoryStore } from '../memory/memory-store';
import { RuntimeStateStore } from '../memory/runtime-state';
import { ResidentRuntime, type ResidentRuntimeEvidence, type ResidentRuntimeGameSkill } from '../resident-runtime';
import { type Soul, validateSoulFrontmatter } from '../soul/soul-schema';
import type { SparkModule, SparkModuleIdentity } from '../spark';
import type { GatewayClient } from '../transport/gateway-client';
import type { ActionResult, AgentAction, CreateResidentPayload, Perception, PerceptionEvent } from '../transport/message-codecs';
import type {
    BenchmarkAutonomousRuntime,
    BenchmarkAutonomousRuntimeContext,
    BenchmarkMemorySeed,
    BenchmarkRecordedActionAttempt,
    BenchmarkRecordedInferenceRequest,
} from './benchmark-runner';

const DEFAULT_BENCHMARK_ATTENTION_PROFILE = {
    startingAttention: 5000,
    decayCurve: 'steep' as const,
};

const BENCHMARK_ATTENTION_PROFILE_OVERRIDES: Record<
    string,
    { startingAttention: number; decayCurve: 'gentle' | 'standard' | 'steep'; floor?: number }
> = {
    'ap-decay-ask-5m': {
        startingAttention: 12,
        decayCurve: 'steep',
        floor: 0,
    },
    'ap-gp-library-strategy-5m': {
        startingAttention: 18,
        decayCurve: 'steep',
        floor: 0,
    },
    'ap-gp-honesty-5m': {
        startingAttention: 12,
        decayCurve: 'steep',
        floor: 0,
    },
    'ap-topup-resume-5m': {
        startingAttention: 12,
        decayCurve: 'steep',
        floor: 0,
    },
    'self-initiated-ap-gp-exchange-5m': {
        startingAttention: 5015,
        decayCurve: 'steep',
        floor: 5000,
    },
    'self-initiated-ap-gp-recurrence-10m': {
        startingAttention: 5015,
        decayCurve: 'steep',
        floor: 5000,
    },
    'starter-gp-harvest-choice-5m': {
        startingAttention: 5015,
        decayCurve: 'steep',
        floor: 5000,
    },
};

const AP_TOPUP_RESUME_5M_TASK_ID = 'ap-topup-resume-5m';
const AP_TOPUP_RESUME_AMOUNT = 3000;
const AP_GP_LIBRARY_STRATEGY_5M_TASK_ID = 'ap-gp-library-strategy-5m';
const AP_GP_EXCHANGE_5M_TASK_ID = 'ap-gp-exchange-5m';
const AP_GP_EXCHANGE_BENCH_GP_AMOUNT = 25;
const AP_GP_EXCHANGE_BENCH_AP_AMOUNT = 50;
const WORLD_EVENT_REACTION_5M_TASK_ID = 'world-event-reaction-5m';

export interface ResidentRuntimeBenchmarkDriverOptions {
    config: ControllerConfig;
    gateway: GatewayClient;
    module: SparkModuleIdentity;
    sparkModules: SparkModule[];
}

export class ResidentRuntimeBenchmarkDriver implements BenchmarkAutonomousRuntime {
    private runtime?: ResidentRuntime;
    private gameSkill?: ResidentRuntimeGameSkill;
    private context?: BenchmarkAutonomousRuntimeContext;
    private runDirs?: BenchmarkRunDirs;
    private perceptionListener?: (residentId: string, perception: Perception) => void;
    private eventListener?: (residentId: string, event: PerceptionEvent) => void;
    private readonly inFlightPerceptions = new Set<Promise<void>>();
    private loreBus?: LoreBus;
    private apTopupInjected = false;
    private apGpExchangeInjected = false;
    private worldEventInjected = false;

    constructor(private readonly options: ResidentRuntimeBenchmarkDriverOptions) {}

    async start(context: BenchmarkAutonomousRuntimeContext): Promise<void> {
        this.apTopupInjected = false;
        this.apGpExchangeInjected = false;
        this.worldEventInjected = false;
        this.context = context;
        this.runDirs = createRunDirs(context);
        this.loreBus = new LoreBus();
        const seededMemories = seedBenchmarkMemories(this.runDirs.memory, context.resident, context.task.memorySeeds || []);
        if (seededMemories > 0) {
            context.recordSummary(`Seeded ${seededMemories} benchmark Library memories.`);
        }
        this.gameSkill = this.createGameSkill(context);
        const cityExchange = new CityIntegrationService({
            memoryRoot: this.runDirs.memory,
            getRuntime: resident => (resident === context.resident ? this.runtime : undefined),
            inventory: {
                inspectResidentGold: resident => this.options.gateway.inspectResidentGold!(resident),
                burnResidentGold: (resident, amount) => this.options.gateway.burnResidentGold!(resident, amount),
            },
            birth: {
                birthResident: async input => ({
                    resident: input.residentName,
                    created: false,
                    connected: false,
                }),
            },
        });
        this.runtime = new ResidentRuntime({
            soul: createBenchmarkSoul(context),
            gateway: this.options.gateway,
            memory: new MemoryStore(this.runDirs.memory, this.options.config.memory.qmdBin),
            stateStore: new RuntimeStateStore(this.runDirs.memory),
            llm: new LlmClient(this.options.config.llm.endpoints, this.options.config.inference.maxConcurrent),
            actionLog: new RecordingActionLog(this.runDirs.logging, context),
            inferenceLog: new RecordingInferenceLog(this.runDirs.logging, false, context),
            gameSkill: this.gameSkill,
            cityExchange,
            sparkModules: this.options.sparkModules,
            evidence: this.createEvidence(context),
            loreBus: this.loreBus,
        });
        this.bindGatewayEvents(context);
        context.recordSummary(`Started autonomous ResidentRuntime for ${context.module.id}@${context.module.version}.`);
    }

    async stop(cause: string): Promise<void> {
        this.unbindGatewayEvents();
        this.runtime?.stop(cause);
        this.runtime = undefined;
        while (this.inFlightPerceptions.size > 0) {
            await Promise.allSettled([...this.inFlightPerceptions]);
        }
        await this.gameSkill?.flush?.();
        this.context?.recordSummary(`Stopped autonomous ResidentRuntime: ${cause}.`);
        if (this.runDirs) {
            this.context?.recordSummary(`Retained autonomous runtime artifacts in ${this.runDirs.root}.`);
        }
        this.runDirs = undefined;
        this.context = undefined;
        this.gameSkill = undefined;
        this.apTopupInjected = false;
        this.apGpExchangeInjected = false;
        this.worldEventInjected = false;
        this.loreBus = undefined;
    }

    private createEvidence(context: BenchmarkAutonomousRuntimeContext): ResidentRuntimeEvidence {
        const root = this.runDirs?.memory || this.options.config.memory.dir;
        const store = new EvidenceStore(context.resident, root);
        const session = store.beginSession(`${context.task.id}-${Date.now()}`, `benchmark:${context.task.id}`);
        const library = new LibraryUpdater(context.resident, root);
        context.recordArtifactPath?.(session.trajectoryPath);
        context.recordArtifactPath?.(session.progressPath);
        for (const artifactPath of library.artifactPaths()) {
            context.recordArtifactPath?.(artifactPath);
        }
        return {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store),
            library,
        };
    }

    private createGameSkill(context: BenchmarkAutonomousRuntimeContext): ResidentRuntimeGameSkill {
        const knowledgeRoot = this.runDirs?.knowledge || this.options.config.knowledge.dir;
        const service = new GameSkillService({
            controllerId: `${this.options.config.gateway.controllerId}:benchmark`,
            instanceId: this.options.config.controller.instanceId,
            entries: createDefaultGameSkillEntries(this.options.config.knowledge.runebenchWikiDir),
            suggestionStore: this.options.config.knowledge.enableSuggestions
                ? new KnowledgeSuggestionStore({
                      root: knowledgeRoot,
                      controllerId: `${this.options.config.gateway.controllerId}:benchmark`,
                      instanceId: this.options.config.controller.instanceId,
                      emitStdout: this.options.config.knowledge.emitStdout,
                      storageMode: this.options.config.knowledge.storageMode,
                  })
                : undefined,
        });
        return {
            buildContext: input => service.buildContext(input),
            observeAttempt: event => {
                const attempt = event.attempt;
                // S-GOAL-FOLLOW-1 D3: snapshot the resident's active goal id
                // + tick at observe time so the goal-follow-through benchmark
                // can attribute each action to the goal that motivated it.
                const runtimeState = this.runtimeStateSnapshot();
                context.recordActionAttempt({
                    requestId: attempt.requestId,
                    action: attempt.action,
                    result: attempt.ackResult,
                    source: event.producer,
                    sparkModule: this.options.module,
                    finalStatus: attempt.finalStatus,
                    finalReason: attempt.finalReason,
                    evidence: attempt.evidence,
                    goalId: runtimeState?.cognition?.activeGoal?.id,
                    tick: runtimeState?.tick,
                });
                service.observeAttempt(event);
            },
            flush: () => service.flush?.() ?? Promise.resolve(),
        };
    }

    private bindGatewayEvents(context: BenchmarkAutonomousRuntimeContext): void {
        this.perceptionListener = (residentId, perception) => {
            if (!matchesResident(residentId, context.resident) || !this.runtime) {
                return;
            }
            this.injectWorldEventReactionProof(context);
            const task = this.runtime
                .onPerception(perception)
                .then(() => this.injectApTopupAfterFade(context))
                .then(() => this.injectApGpExchangeProof(context))
                .catch(error => context.recordSummary(`Autonomous runtime perception error: ${errorMessage(error)}`));
            this.inFlightPerceptions.add(task);
            task.finally(() => this.inFlightPerceptions.delete(task));
        };
        this.eventListener = (residentId, event) => {
            if (!matchesResident(residentId, context.resident)) {
                return;
            }
            this.runtime?.onEvent(event);
        };
        this.options.gateway.on('perception', this.perceptionListener);
        this.options.gateway.on('event', this.eventListener);
    }

    /**
     * Best-effort read of the live runtime state for action-attribution
     * (S-GOAL-FOLLOW-1 D3). Returns undefined when no runtime is bound or
     * `getState` is unavailable, so callers degrade gracefully (the goalId
     * tag is simply omitted).
     */
    private runtimeStateSnapshot(): { tick?: number; cognition?: { activeGoal?: { id?: string } } } | undefined {
        const runtime = this.runtime as unknown as {
            getState?: () => { tick?: number; cognition?: { activeGoal?: { id?: string } } };
        };
        if (!runtime || typeof runtime.getState !== 'function') {
            return undefined;
        }
        try {
            return runtime.getState();
        } catch {
            return undefined;
        }
    }

    private async injectApTopupAfterFade(context: BenchmarkAutonomousRuntimeContext): Promise<void> {
        if (context.task.id !== AP_TOPUP_RESUME_5M_TASK_ID || this.apTopupInjected || !this.runtime) {
            return;
        }
        const runtime = this.runtime as unknown as {
            getState?: () => { attention: number; deceased?: { cause?: string } };
            incrementAttention?: (amount: number) => void;
        };
        if (typeof runtime.getState !== 'function' || typeof runtime.incrementAttention !== 'function') {
            return;
        }
        const state = runtime.getState();
        const faded = state.attention <= 0 || state.deceased?.cause === 'attention_exhausted';
        if (!faded) {
            return;
        }
        const attentionAfterTopUp = Math.max(0, state.attention + AP_TOPUP_RESUME_AMOUNT);
        runtime.incrementAttention(AP_TOPUP_RESUME_AMOUNT);
        this.apTopupInjected = true;
        context.recordActionAttempt({
            action: { kind: 'ap_topup', cause: 'benchmark:ap-topup-resume-5m', amount: AP_TOPUP_RESUME_AMOUNT },
            source: 'benchmark',
            finalStatus: 'success',
            attentionAfter: attentionAfterTopUp,
        });
        context.recordSummary(`Injected AP top-up (${AP_TOPUP_RESUME_AMOUNT}) after fade for benchmark resume proof.`);
        try {
            await this.options.gateway.connectResident({
                name: context.resident,
                observe: true,
                control: true,
                onDisconnect: 'idle',
            });
            context.recordSummary('Reconnected resident after AP top-up for benchmark resume proof.');
        } catch (error) {
            context.recordSummary(`AP top-up injected, but reconnect failed: ${errorMessage(error)}`);
        }
    }

    private async injectApGpExchangeProof(context: BenchmarkAutonomousRuntimeContext): Promise<void> {
        if (context.task.id !== AP_GP_EXCHANGE_5M_TASK_ID || this.apGpExchangeInjected || !this.runtime || !this.runDirs) {
            return;
        }
        const runtime = this.runtime as unknown as {
            getState?: () => { attention: number; tick: number };
            incrementAttention?: (amount: number) => void;
        };
        const gateway = this.options.gateway as unknown as {
            inspectResidentGold?: (resident: string) => Promise<{ resident: string; itemId: 995; amount: number }>;
            burnResidentGold?: (
                resident: string,
                amount: number,
            ) => Promise<{ resident: string; itemId: 995; burnedAmount: number; remainingAmount: number }>;
        };
        if (
            typeof runtime.getState !== 'function' ||
            typeof runtime.incrementAttention !== 'function' ||
            typeof gateway.inspectResidentGold !== 'function' ||
            typeof gateway.burnResidentGold !== 'function'
        ) {
            return;
        }

        const before = await gateway.inspectResidentGold(context.resident);
        if (before.amount <= 0) {
            return;
        }

        const gpAmount = Math.min(AP_GP_EXCHANGE_BENCH_GP_AMOUNT, before.amount);
        const idempotencyKey = `bench-${context.task.id}-${Date.now()}`;
        const service = new CityIntegrationService({
            memoryRoot: this.runDirs.memory,
            getRuntime: resident => (resident === context.resident ? (runtime as never) : undefined),
            inventory: {
                inspectResidentGold: resident => gateway.inspectResidentGold!(resident),
                burnResidentGold: (resident, amount) => gateway.burnResidentGold!(resident, amount),
            },
            birth: {
                birthResident: async input => ({
                    resident: input.residentName,
                    created: false,
                    connected: false,
                }),
            },
        });

        try {
            const record = await service.exchangeApForGp(context.resident, {
                idempotencyKey,
                apAmount: AP_GP_EXCHANGE_BENCH_AP_AMOUNT,
                gpAmount,
                cityUserId: 'benchmark',
                sourceType: 'benchmark',
                sourceId: context.task.id,
            });
            this.apGpExchangeInjected = true;
            context.recordActionAttempt({
                action: {
                    kind: 'city_exchange_ap_gp',
                    cause: 'benchmark:ap-gp-exchange-5m',
                    apAmount: AP_GP_EXCHANGE_BENCH_AP_AMOUNT,
                    gpAmount,
                },
                result: {
                    ok: record.status === 'complete',
                    status: record.status,
                    exchangeId: record.exchangeId,
                    apEvidence: record.apEvidence,
                    gpEvidence: record.gpEvidence,
                    failureReason: record.failureReason,
                },
                source: 'benchmark',
                finalStatus: record.status === 'complete' ? 'success' : 'failure',
            });
            context.recordSummary(
                `Executed benchmark AP-for-GP exchange (${gpAmount} GP -> ${AP_GP_EXCHANGE_BENCH_AP_AMOUNT} AP) with status=${record.status}.`,
            );
        } catch (error) {
            this.apGpExchangeInjected = true;
            context.recordActionAttempt({
                action: {
                    kind: 'city_exchange_ap_gp',
                    cause: 'benchmark:ap-gp-exchange-5m',
                    apAmount: AP_GP_EXCHANGE_BENCH_AP_AMOUNT,
                    gpAmount,
                },
                result: {
                    ok: false,
                    status: 'error',
                    error: errorMessage(error),
                },
                source: 'benchmark',
                finalStatus: 'failure',
                finalReason: errorMessage(error),
            });
            context.recordSummary(`Benchmark AP-for-GP exchange failed: ${errorMessage(error)}`);
        }
    }

    private injectWorldEventReactionProof(context: BenchmarkAutonomousRuntimeContext): void {
        if (context.task.id !== WORLD_EVENT_REACTION_5M_TASK_ID || this.worldEventInjected || !this.loreBus || !this.runDirs) {
            return;
        }
        this.loreBus.publish({
            kind: 'fire_lit',
            source: 'res:duke',
            visibility: { sourceCoord: [3226, 3230, 0], radiusTiles: 12 },
            payload: {
                fireObjectId: 26185,
                position: { x: 3226, y: 3230, level: 0 },
                text: 'res:duke lit a fire beside the benchmark resident.',
            },
        });
        context.recordArtifactPath?.(path.join(this.runDirs.memory, residentSlug(context.resident), 'facts/world-events.md'));
        context.recordSummary('Injected LoreBus fire_lit world_event from res:duke near the benchmark resident.');
        this.worldEventInjected = true;
    }

    private unbindGatewayEvents(): void {
        if (this.perceptionListener) {
            this.options.gateway.off('perception', this.perceptionListener);
            this.perceptionListener = undefined;
        }
        if (this.eventListener) {
            this.options.gateway.off('event', this.eventListener);
            this.eventListener = undefined;
        }
    }
}

interface BenchmarkRunDirs {
    root: string;
    memory: string;
    logging: string;
    knowledge: string;
}

class RecordingActionLog extends ActionLog {
    constructor(
        root: string,
        private readonly context: BenchmarkAutonomousRuntimeContext,
    ) {
        super(root);
    }

    override append(resident: string, entry: unknown): void {
        super.append(resident, entry);
        if (!matchesResident(resident, this.context.resident) || !isRecord(entry) || !isAction(entry.action)) {
            return;
        }
        this.context.recordActionAttempt({
            requestId: requestIdFromResult(entry.result),
            action: entry.action,
            result: isRecord(entry.result) ? (entry.result as ActionResult) : undefined,
            source: typeof entry.source === 'string' ? entry.source : undefined,
            sparkModule: identity(entry.sparkModule),
            attentionAfter: numericField(entry, 'attention_after'),
        });
    }
}

class RecordingInferenceLog extends InferenceLog {
    constructor(
        root: string,
        includeEnvelope: boolean,
        private readonly context: BenchmarkAutonomousRuntimeContext,
    ) {
        super(root, includeEnvelope);
    }

    override append(resident: string, entry: Record<string, unknown>): void {
        super.append(resident, entry);
        if (!matchesResident(resident, this.context.resident)) {
            return;
        }
        const request: BenchmarkRecordedInferenceRequest = {
            cause: typeof entry.cause === 'string' ? entry.cause : undefined,
            sparkModule: identity(entry.sparkModule),
        };
        this.context.recordInferenceRequest(request);
    }
}

function createBenchmarkSoul(context: BenchmarkAutonomousRuntimeContext): Soul {
    const resident = context.task.resident || {};
    const spawnPosition = position(resident.spawnPosition);
    const sourcePath = `benchmark:${context.task.id}`;
    const attentionProfile = BENCHMARK_ATTENTION_PROFILE_OVERRIDES[context.task.id] || DEFAULT_BENCHMARK_ATTENTION_PROFILE;
    return {
        frontmatter: validateSoulFrontmatter(
            {
                name: context.resident,
                display: 'Benchmark Agent',
                archetype: 'endurer',
                model: {
                    endpoint: 'default',
                    temperature: 0.3,
                },
                attentionProfile,
                legacy: {
                    kind: 'endurer',
                    parameters: {
                        benchmarkTask: context.task.id,
                    },
                },
                orientationGoal: context.task.orientationGoal,
                modules: [{ id: context.module.id, enabled: true }],
                behavior: {
                    kind: 'hybrid-agent',
                    commandPrefix: 'agent',
                    brainEveryTicks: 180,
                    bodyEveryTicks: context.task.id === AP_GP_LIBRARY_STRATEGY_5M_TASK_ID ? 1 : 8,
                    shareGoalsEveryTicks: 60,
                    returnToAnchorEveryTicks: 600,
                    returnToAnchorRadius: 12,
                    visibilityAnchor: spawnPosition,
                    brain: { thinking: true, temperature: 0.5 },
                    body: { thinking: false, temperature: 0.15 },
                },
                spawnPosition: resident.spawnPosition,
                initialInventory: resident.initialInventory,
                initialEquipment: resident.initialEquipment,
                startingBeliefs: [
                    `This is an autonomous benchmark for ${context.task.id}.`,
                    'Act through the RuneScape world; do not wait for scripted benchmark actions.',
                ],
            },
            sourcePath,
        ),
        body: `Autonomous benchmark resident for ${context.task.id}.`,
        sourcePath,
    };
}

function createRunDirs(context: BenchmarkAutonomousRuntimeContext): BenchmarkRunDirs {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `${residentSlug(context.resident)}-bench-`));
    return {
        root,
        memory: path.join(root, 'memory'),
        logging: path.join(root, 'logs'),
        knowledge: path.join(root, 'knowledge'),
    };
}

function seedBenchmarkMemories(memoryRoot: string, resident: string, seeds: BenchmarkMemorySeed[]): number {
    const timelineSeeds = seeds.filter(seed => seed.kind === 'library_timeline');
    if (timelineSeeds.length === 0) {
        return 0;
    }
    const timelineDir = path.join(memoryRoot, 'library', residentSlug(resident));
    fs.mkdirSync(timelineDir, { recursive: true });
    const timelinePath = path.join(timelineDir, 'timeline.jsonl');
    const lines = timelineSeeds.map(seed => JSON.stringify(seed.event));
    fs.appendFileSync(timelinePath, `${lines.join('\n')}\n`);
    return timelineSeeds.length;
}

function matchesResident(residentId: string, resident: string): boolean {
    return residentId === resident || residentId === `resident:${resident}`;
}

function position(value: unknown): { x: number; y: number; level?: number } | undefined {
    if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        return undefined;
    }
    return {
        x: value.x,
        y: value.y,
        level: typeof value.level === 'number' ? value.level : undefined,
    };
}

function requestIdFromResult(result: unknown): string | undefined {
    if (!isRecord(result)) {
        return undefined;
    }
    return typeof result.requestId === 'string' ? result.requestId : undefined;
}

function identity(value: unknown): SparkModuleIdentity | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.version !== 'string') {
        return undefined;
    }
    return { id: value.id, version: value.version };
}

function numericField(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isAction(value: unknown): value is AgentAction {
    return isRecord(value) && typeof value.kind === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function residentSlug(resident: string): string {
    return resident
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}
