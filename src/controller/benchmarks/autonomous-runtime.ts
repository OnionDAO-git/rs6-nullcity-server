import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ControllerConfig } from '../config';
import { createDefaultGameSkillEntries } from '../knowledge/game-skill-entries';
import { GameSkillService } from '../knowledge/game-skill-context';
import { KnowledgeSuggestionStore } from '../knowledge/suggestions';
import { LlmClient } from '../llm/llm-client';
import { ActionLog } from '../logging/action-log';
import { InferenceLog } from '../logging/inference-log';
import { MemoryStore } from '../memory/memory-store';
import { RuntimeStateStore } from '../memory/runtime-state';
import { ResidentRuntime, type ResidentRuntimeGameSkill } from '../resident-runtime';
import { type Soul, validateSoulFrontmatter } from '../soul/soul-schema';
import type { SparkModule, SparkModuleIdentity } from '../spark';
import type { GatewayClient } from '../transport/gateway-client';
import type { ActionResult, AgentAction, CreateResidentPayload, Perception, PerceptionEvent } from '../transport/message-codecs';
import type {
    BenchmarkAutonomousRuntime,
    BenchmarkAutonomousRuntimeContext,
    BenchmarkRecordedActionAttempt,
    BenchmarkRecordedInferenceRequest,
} from './benchmark-runner';

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

    constructor(private readonly options: ResidentRuntimeBenchmarkDriverOptions) {}

    async start(context: BenchmarkAutonomousRuntimeContext): Promise<void> {
        this.context = context;
        this.runDirs = createRunDirs(context);
        this.gameSkill = this.createGameSkill();
        this.runtime = new ResidentRuntime({
            soul: createBenchmarkSoul(context),
            gateway: this.options.gateway,
            memory: new MemoryStore(this.runDirs.memory, this.options.config.memory.qmdBin),
            stateStore: new RuntimeStateStore(this.runDirs.memory),
            llm: new LlmClient(this.options.config.llm.endpoints, this.options.config.inference.maxConcurrent),
            actionLog: new RecordingActionLog(this.runDirs.logging, context),
            inferenceLog: new RecordingInferenceLog(this.runDirs.logging, false, context),
            gameSkill: this.gameSkill,
            sparkModules: this.options.sparkModules,
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
            fs.rmSync(this.runDirs.root, { recursive: true, force: true });
            this.runDirs = undefined;
        }
        this.context = undefined;
        this.gameSkill = undefined;
    }

    private createGameSkill(): ResidentRuntimeGameSkill {
        const knowledgeRoot = this.runDirs?.knowledge || this.options.config.knowledge.dir;
        return new GameSkillService({
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
    }

    private bindGatewayEvents(context: BenchmarkAutonomousRuntimeContext): void {
        this.perceptionListener = (residentId, perception) => {
            if (!matchesResident(residentId, context.resident) || !this.runtime) {
                return;
            }
            const task = this.runtime
                .onPerception(perception)
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
                attentionProfile: {
                    startingAttention: 5000,
                    decayCurve: 'steep',
                },
                legacy: {
                    kind: 'endurer',
                    parameters: {
                        benchmarkTask: context.task.id,
                    },
                },
                modules: [{ id: context.module.id, enabled: true }],
                behavior: {
                    kind: 'hybrid-agent',
                    commandPrefix: 'agent',
                    brainEveryTicks: 180,
                    bodyEveryTicks: 8,
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
