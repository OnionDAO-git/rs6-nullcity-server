import fs from 'fs';
import type { ActionEvidence, ActionFinalStatus } from '../actions/action-attempt';
import type { SparkModuleIdentity } from '../spark';
import type { SubmittedActionAck } from '../transport/gateway-client';
import type { ActionResult, AgentAction, CreateResidentPayload, Perception, PerceptionEvent } from '../transport/message-codecs';
import {
    type BenchmarkArtifact,
    type BenchmarkRunMode,
    type BenchmarkRunStatus,
    benchmarkArtifactSchema,
    normalizeBenchmarkArtifact,
} from './benchmark-artifact';

export interface BenchmarkGateway {
    createResident(payload: CreateResidentPayload): Promise<unknown>;
    connectResident(payload: { name: string; observe: boolean; control: boolean; onDisconnect: 'idle' }): Promise<unknown>;
    submitActionWithRequestId(name: string, action: AgentAction): Promise<SubmittedActionAck>;
    disconnectResident(name: string): Promise<void>;
    deleteResident(name: string): Promise<void>;
    on?(event: 'perception', listener: (residentId: string, perception: Perception) => void): unknown;
    on?(event: 'event', listener: (residentId: string, event: PerceptionEvent) => void): unknown;
    on?(event: 'actionResult', listener: (residentId: string, requestId: string | undefined, result: ActionResult) => void): unknown;
    off?(event: string, listener: (...args: unknown[]) => void): unknown;
    removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface BenchmarkTaskOutcome {
    status: BenchmarkRunStatus;
    score?: number;
    metrics?: Record<string, number>;
    failureReason?: string;
    summaries?: string[];
}

export interface BenchmarkTaskContext {
    readonly resident: string;
    readonly module: SparkModuleIdentity;
    readonly signal: AbortSignal;
    submitAction(action: AgentAction): Promise<ActionResult>;
    peerResident(id: string): string | undefined;
    submitPeerAction(id: string, action: AgentAction): Promise<ActionResult>;
    recordActionAttempt(attempt: BenchmarkRecordedActionAttempt): void;
    recordInferenceRequest(request: string | BenchmarkRecordedInferenceRequest): void;
    recordArtifactPath?(path: string): void;
    recordSummary(summary: string): void;
    actionAttempts(): readonly BenchmarkRecordedActionAttempt[];
    latestPerception(): Perception | undefined;
    perceptions(): readonly Perception[];
    events(): readonly PerceptionEvent[];
}

export interface BenchmarkTaskPeer extends Omit<CreateResidentPayload, 'name'> {
    id: string;
}

export interface BenchmarkMemorySeed {
    kind: 'library_timeline';
    event: Record<string, unknown>;
}

export interface BenchmarkTask {
    id: string;
    version: string;
    timeoutMs: number;
    autonomousRequiresSelectedModuleAction?: boolean;
    resident?: Omit<CreateResidentPayload, 'name'>;
    peers?: BenchmarkTaskPeer[];
    memorySeeds?: BenchmarkMemorySeed[];
    setup?(context: BenchmarkTaskContext): Promise<void>;
    run(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome>;
    runAutonomous?(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome>;
}

export interface BenchmarkRecordedActionAttempt {
    requestId?: string;
    action: AgentAction;
    result?: ActionResult;
    source?: string;
    sparkModule?: SparkModuleIdentity;
    finalStatus?: ActionFinalStatus;
    finalReason?: string;
    evidence?: ActionEvidence[];
    attentionAfter?: number;
}

export interface BenchmarkRecordedInferenceRequest {
    requestId?: string;
    cause?: string;
    sparkModule?: SparkModuleIdentity;
}

export interface BenchmarkAutonomousRuntimeContext {
    readonly resident: string;
    readonly task: BenchmarkTask;
    readonly module: SparkModuleIdentity;
    readonly signal: AbortSignal;
    recordActionAttempt(attempt: BenchmarkRecordedActionAttempt): void;
    recordInferenceRequest(request: string | BenchmarkRecordedInferenceRequest): void;
    recordArtifactPath?(path: string): void;
    recordSummary(summary: string): void;
}

export interface BenchmarkAutonomousRuntime {
    start(context: BenchmarkAutonomousRuntimeContext): Promise<void>;
    stop(cause: string): Promise<void>;
}

export interface BenchmarkRunnerOptions {
    gateway: BenchmarkGateway;
    task: BenchmarkTask;
    module: SparkModuleIdentity;
    mode?: BenchmarkRunMode;
    autonomousRuntime?: BenchmarkAutonomousRuntime;
    modelProfile: string;
    inference?: BenchmarkArtifact['inference'];
    commits: BenchmarkArtifact['commits'];
    runId?: string;
    residentName?: string;
    now?: () => Date;
}

interface BenchmarkEvidenceBuffer {
    actionAttemptIds: string[];
    actionAttempts: BenchmarkRecordedActionAttempt[];
    inferenceRequestIds: string[];
    inferenceRequests: BenchmarkRecordedInferenceRequest[];
    artifactPaths: string[];
    perceptionIds: string[];
    summaries: string[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export class BenchmarkRunner {
    private readonly runId: string;
    private readonly resident: string;
    private readonly now: () => Date;
    private readonly peerResidents: Map<string, string>;

    constructor(private readonly options: BenchmarkRunnerOptions) {
        this.runId = options.runId || benchmarkRunId(options.task.id, options.now?.() || new Date());
        this.resident = options.residentName || benchmarkResidentName(options.task.id, this.runId);
        this.now = options.now || (() => new Date());
        this.peerResidents = new Map((options.task.peers || []).map(peer => [peer.id, benchmarkPeerResidentName(peer.id, this.runId)]));
    }

    async run(): Promise<BenchmarkArtifact> {
        const startedAt = this.now().toISOString();
        const evidence = createEvidenceBuffer();
        const abortController = new AbortController();
        const listeners = this.bindEvidenceListeners(evidence);
        const mode = this.options.mode || 'scripted';
        const peers = benchmarkPeerStates(this.options.task, this.peerResidents);
        let autonomousStarted = false;
        let created = false;
        let connected = false;
        let outcome: BenchmarkTaskOutcome | undefined;
        const cleanupFailures: string[] = [];
        const cleanupSkips: string[] = [];

        try {
            await this.options.gateway.createResident({ name: this.resident, ...this.options.task.resident });
            created = true;
            await this.options.gateway.connectResident({
                name: this.resident,
                observe: true,
                control: true,
                onDisconnect: 'idle',
            });
            connected = true;
            for (const peer of peers) {
                await this.options.gateway.createResident({ name: peer.resident, ...peerCreatePayload(peer.definition) });
                peer.created = true;
                await this.options.gateway.connectResident({
                    name: peer.resident,
                    observe: false,
                    control: true,
                    onDisconnect: 'idle',
                });
                peer.connected = true;
            }
            const taskContext = this.createTaskContext(evidence, abortController.signal);
            if (this.options.task.setup) {
                await this.options.task.setup(taskContext);
            }
            if (mode === 'autonomous') {
                const autonomousRuntime = this.options.autonomousRuntime;
                const runAutonomous = this.options.task.runAutonomous;
                if (!autonomousRuntime) {
                    throw new Error('Autonomous benchmark mode requires an autonomous runtime');
                }
                if (!runAutonomous) {
                    throw new Error(`Benchmark task ${this.options.task.id} does not support autonomous mode`);
                }
                await autonomousRuntime.start(this.createAutonomousRuntimeContext(evidence, abortController.signal));
                autonomousStarted = true;
                outcome = await this.runTaskWithTimeout(taskContext, abortController, runAutonomous);
            } else {
                outcome = await this.runTaskWithTimeout(taskContext, abortController, this.options.task.run);
            }
        } catch (error) {
            outcome = outcomeFromError(error);
        } finally {
            if (autonomousStarted && this.options.autonomousRuntime) {
                try {
                    await this.options.autonomousRuntime.stop(
                        outcome?.status === 'passed' ? 'benchmark_complete' : `benchmark_${outcome?.status || 'stopped'}`,
                    );
                } catch (error) {
                    recordCleanupProblem(error, cleanupFailures, cleanupSkips);
                }
            }
            this.unbindEvidenceListeners(listeners);
            for (const peer of [...peers].reverse()) {
                if (!peer.connected) {
                    continue;
                }
                try {
                    await this.options.gateway.disconnectResident(peer.resident);
                } catch (error) {
                    recordCleanupProblem(error, cleanupFailures, cleanupSkips);
                }
            }
            for (const peer of [...peers].reverse()) {
                if (!peer.created) {
                    continue;
                }
                try {
                    await this.options.gateway.deleteResident(peer.resident);
                } catch (error) {
                    recordCleanupProblem(error, cleanupFailures, cleanupSkips);
                }
            }
            if (connected) {
                try {
                    await this.options.gateway.disconnectResident(this.resident);
                } catch (error) {
                    recordCleanupProblem(error, cleanupFailures, cleanupSkips);
                }
            }
            if (created) {
                try {
                    await this.options.gateway.deleteResident(this.resident);
                } catch (error) {
                    recordCleanupProblem(error, cleanupFailures, cleanupSkips);
                }
            }
        }

        if (cleanupFailures.length > 0) {
            const cleanupSummary = `cleanup failed: ${cleanupFailures.join('; ')}`;
            if (outcome.status === 'passed') {
                outcome = {
                    ...outcome,
                    metrics: {
                        ...outcome.metrics,
                        cleanupFailures: cleanupFailures.length,
                    },
                    summaries: [...(outcome.summaries || []), cleanupSummary],
                };
            } else {
                outcome = {
                    ...outcome,
                    failureReason: [outcome.failureReason, cleanupSummary].filter(Boolean).join('; '),
                    metrics: {
                        ...outcome.metrics,
                        cleanupFailures: cleanupFailures.length,
                    },
                    summaries: [...(outcome.summaries || []), cleanupSummary],
                };
            }
        }
        if (cleanupSkips.length > 0) {
            outcome = {
                ...outcome,
                metrics: {
                    ...outcome.metrics,
                    cleanupSkipped: cleanupSkips.length,
                },
                summaries: [...(outcome.summaries || []), cleanupSkippedSummary(cleanupSkips.length)],
            };
        }

        if (mode === 'autonomous') {
            outcome = enforceAutonomousModuleEvidence(this.options.task, outcome, evidence, this.options.module);
        }

        const endedAt = this.now().toISOString();
        return benchmarkArtifactSchema.parse(
            normalizeBenchmarkArtifact({
                schemaVersion: 1,
                runId: this.runId,
                task: { id: this.options.task.id, version: this.options.task.version },
                module: this.options.module,
                mode,
                resident: this.resident,
                modelProfile: this.options.modelProfile,
                inference: this.options.inference,
                commits: this.options.commits,
                startedAt,
                endedAt,
                status: outcome.status,
                score: outcome.score ?? defaultScore(outcome.status),
                metrics: {
                    ...outcome.metrics,
                    ...moduleEvidenceMetrics(mode, evidence, this.options.module),
                    ...evidenceArtifactMetrics(evidence.artifactPaths),
                    actionsAttempted: Math.max(evidence.actionAttemptIds.length, evidence.actionAttempts.length),
                },
                evidence: {
                    actionAttemptIds: evidence.actionAttemptIds,
                    actionAttempts: evidence.actionAttempts.map(actionAttemptEvidence),
                    inferenceRequestIds: evidence.inferenceRequestIds,
                    inferenceRequests: evidence.inferenceRequests,
                    perceptionIds: evidence.perceptionIds,
                    summaries: [...evidence.summaries, ...(outcome.summaries || [])],
                    artifactPaths: evidence.artifactPaths,
                },
                failureReason: outcome.failureReason,
            }),
        );
    }

    private createTaskContext(evidence: BenchmarkEvidenceBuffer, signal: AbortSignal): BenchmarkTaskContext {
        return {
            resident: this.resident,
            module: this.options.module,
            signal,
            submitAction: async action => {
                const ack = await this.options.gateway.submitActionWithRequestId(this.resident, action);
                recordActionAttempt(evidence, { requestId: ack.requestId, action, result: ack.ackResult });
                return ack.ackResult;
            },
            peerResident: id => this.peerResidents.get(id),
            submitPeerAction: async (id, action) => {
                const peerResident = this.peerResidents.get(id);
                if (!peerResident) {
                    throw new Error(`Unknown benchmark peer ${id}`);
                }
                const ack = await this.options.gateway.submitActionWithRequestId(peerResident, action);
                return ack.ackResult;
            },
            recordActionAttempt: attempt => {
                recordActionAttempt(evidence, attempt);
            },
            recordInferenceRequest: request => {
                recordInferenceRequest(evidence, request);
            },
            recordArtifactPath: artifactPath => {
                pushUnique(evidence.artifactPaths, artifactPath);
            },
            recordSummary: summary => {
                evidence.summaries.push(summary);
            },
            actionAttempts: () => evidence.actionAttempts,
            latestPerception: () => evidence.perceptions.at(-1),
            perceptions: () => evidence.perceptions,
            events: () => evidence.events,
        };
    }

    private createAutonomousRuntimeContext(evidence: BenchmarkEvidenceBuffer, signal: AbortSignal): BenchmarkAutonomousRuntimeContext {
        return {
            resident: this.resident,
            task: this.options.task,
            module: this.options.module,
            signal,
            recordActionAttempt: attempt => {
                recordActionAttempt(evidence, attempt);
            },
            recordInferenceRequest: request => {
                recordInferenceRequest(evidence, request);
            },
            recordArtifactPath: artifactPath => {
                pushUnique(evidence.artifactPaths, artifactPath);
            },
            recordSummary: summary => {
                evidence.summaries.push(summary);
            },
        };
    }

    private async runTaskWithTimeout(
        context: BenchmarkTaskContext,
        abortController: AbortController,
        run: (context: BenchmarkTaskContext) => Promise<BenchmarkTaskOutcome>,
    ): Promise<BenchmarkTaskOutcome> {
        let timeout: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                run(context),
                new Promise<BenchmarkTaskOutcome>((_, reject) => {
                    timeout = setTimeout(() => {
                        abortController.abort();
                        reject(
                            new BenchmarkTimeoutError(
                                `benchmark task ${this.options.task.id} timed out after ${this.options.task.timeoutMs}ms`,
                            ),
                        );
                    }, this.options.task.timeoutMs);
                }),
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    private bindEvidenceListeners(evidence: BenchmarkEvidenceBuffer): Array<{ event: string; listener: (...args: unknown[]) => void }> {
        if (!this.options.gateway.on) {
            return [];
        }

        const listeners = [
            {
                event: 'perception',
                listener: (residentId: unknown, perception: unknown) => {
                    if (!matchesResident(residentId, this.resident) || !isRecord(perception)) {
                        return;
                    }
                    evidence.perceptions.push(perception);
                    const id = perceptionId(perception);
                    if (id) {
                        evidence.perceptionIds.push(id);
                    }
                },
            },
            {
                event: 'event',
                listener: (residentId: unknown, event: unknown) => {
                    if (!matchesResident(residentId, this.resident) || !isRecord(event)) {
                        return;
                    }
                    evidence.events.push(event);
                },
            },
            {
                event: 'actionResult',
                listener: (residentId: unknown, requestId: unknown) => {
                    if (!matchesResident(residentId, this.resident) || typeof requestId !== 'string') {
                        return;
                    }
                    pushUnique(evidence.actionAttemptIds, requestId);
                },
            },
        ];

        for (const { event, listener } of listeners) {
            this.options.gateway.on(event as never, listener as never);
        }
        return listeners;
    }

    private unbindEvidenceListeners(listeners: Array<{ event: string; listener: (...args: unknown[]) => void }>): void {
        for (const { event, listener } of listeners) {
            if (this.options.gateway.off) {
                this.options.gateway.off(event, listener);
            } else {
                this.options.gateway.removeListener?.(event, listener);
            }
        }
    }
}

function createEvidenceBuffer(): BenchmarkEvidenceBuffer {
    return {
        actionAttemptIds: [],
        actionAttempts: [],
        inferenceRequestIds: [],
        inferenceRequests: [],
        artifactPaths: [],
        perceptionIds: [],
        summaries: [],
        perceptions: [],
        events: [],
    };
}

interface BenchmarkPeerState {
    definition: BenchmarkTaskPeer;
    resident: string;
    created: boolean;
    connected: boolean;
}

function benchmarkPeerStates(task: BenchmarkTask, names: Map<string, string>): BenchmarkPeerState[] {
    return (task.peers || []).map(peer => ({
        definition: peer,
        resident: names.get(peer.id) || benchmarkPeerResidentName(peer.id, task.id),
        created: false,
        connected: false,
    }));
}

function peerCreatePayload(peer: BenchmarkTaskPeer): Omit<CreateResidentPayload, 'name'> {
    const payload: Omit<CreateResidentPayload, 'name'> = {};
    if (peer.spawnPosition !== undefined) {
        payload.spawnPosition = peer.spawnPosition;
    }
    if (peer.initialInventory !== undefined) {
        payload.initialInventory = peer.initialInventory;
    }
    if (peer.initialEquipment !== undefined) {
        payload.initialEquipment = peer.initialEquipment;
    }
    if (peer.initialSkills !== undefined) {
        payload.initialSkills = peer.initialSkills;
    }
    return payload;
}

function recordActionAttempt(evidence: BenchmarkEvidenceBuffer, attempt: BenchmarkRecordedActionAttempt): void {
    evidence.actionAttempts.push(attempt);
    if (attempt.requestId) {
        pushUnique(evidence.actionAttemptIds, attempt.requestId);
    }
    const resultRequestId = requestIdFromResult(attempt.result);
    if (resultRequestId) {
        pushUnique(evidence.actionAttemptIds, resultRequestId);
    }
}

function recordInferenceRequest(evidence: BenchmarkEvidenceBuffer, request: string | BenchmarkRecordedInferenceRequest): void {
    const inference = typeof request === 'string' ? { requestId: request } : request;
    evidence.inferenceRequests.push(inference);
    if (inference.requestId) {
        pushUnique(evidence.inferenceRequestIds, inference.requestId);
    }
}

function actionAttemptEvidence(
    attempt: BenchmarkRecordedActionAttempt,
): NonNullable<BenchmarkArtifact['evidence']['actionAttempts']>[number] {
    const requestId = attempt.requestId || requestIdFromResult(attempt.result);
    return {
        requestId,
        actionKind: attempt.action.kind,
        source: attempt.source,
        cause: actionCause(attempt.action),
        ok: typeof attempt.result?.ok === 'boolean' ? attempt.result.ok : undefined,
        finalStatus: attempt.finalStatus,
        finalReason: attempt.finalReason,
        evidenceCount: attempt.evidence?.length,
        effectEvidenceCount: actionEffectEvidenceCount(attempt.evidence),
        attentionAfter: attempt.attentionAfter,
        sparkModule: attempt.sparkModule,
    };
}

function actionEffectEvidenceCount(evidence: ActionEvidence[] | undefined): number | undefined {
    if (!evidence) {
        return undefined;
    }
    return evidence.filter(item => {
        const detail = isRecord(item.detail) ? item.detail : {};
        return detail.kind === 'action_effect_observed';
    }).length;
}

function requestIdFromResult(result: ActionResult | undefined): string | undefined {
    if (!result || typeof result !== 'object') {
        return undefined;
    }
    const value = (result as Record<string, unknown>).requestId;
    return typeof value === 'string' ? value : undefined;
}

function actionCause(action: AgentAction): string | undefined {
    const value = (action as Record<string, unknown>).cause;
    return typeof value === 'string' ? value : undefined;
}

function enforceAutonomousModuleEvidence(
    task: BenchmarkTask,
    outcome: BenchmarkTaskOutcome,
    evidence: BenchmarkEvidenceBuffer,
    module: SparkModuleIdentity,
): BenchmarkTaskOutcome {
    if (outcome.status !== 'passed') {
        return outcome;
    }
    if (task.autonomousRequiresSelectedModuleAction === false) {
        return {
            ...outcome,
            summaries: [
                ...(outcome.summaries || []),
                `Autonomous benchmark ${task.id} uses benchmark-side evidence and does not require selected module action evidence.`,
            ],
        };
    }
    if (selectedModuleActionCount(evidence, module) > 0) {
        return outcome;
    }
    return {
        ...outcome,
        status: 'failed',
        score: 0,
        failureReason: `Autonomous benchmark passed task verifier without selected module action evidence for ${module.id}@${module.version}`,
        summaries: [
            ...(outcome.summaries || []),
            `Autonomous benchmark requires selected module action evidence for ${module.id}@${module.version}.`,
        ],
    };
}

function moduleEvidenceMetrics(
    mode: BenchmarkRunMode,
    evidence: BenchmarkEvidenceBuffer,
    module: SparkModuleIdentity,
): Record<string, number> {
    if (mode !== 'autonomous') {
        return {};
    }
    return {
        selectedModuleActions: selectedModuleActionCount(evidence, module),
        selectedModuleInferences: selectedModuleInferenceCount(evidence, module),
        untaggedActions: evidence.actionAttempts.filter(attempt => !attempt.sparkModule).length,
    };
}

function evidenceArtifactMetrics(paths: string[]): Record<string, number> {
    if (paths.length === 0) {
        return {};
    }
    const metrics = {
        trajectoryLines: 0,
        trajectoryActions: 0,
        trajectorySays: 0,
        progressLines: 0,
        meaningfulProgressTicks: 0,
        stuckProgressTicks: 0,
    };
    for (const artifactPath of paths) {
        for (const line of readJsonlRecords(artifactPath)) {
            if (line.kind === 'progress') {
                metrics.progressLines += 1;
                if (line.meaningful === true) {
                    metrics.meaningfulProgressTicks += 1;
                }
                if (typeof line.stuckSince === 'number') {
                    metrics.stuckProgressTicks += 1;
                }
                continue;
            }
            if (typeof line.kind === 'string') {
                metrics.trajectoryLines += 1;
                if (line.kind === 'action' || line.kind === 'say') {
                    metrics.trajectoryActions += 1;
                }
                if (line.kind === 'say') {
                    metrics.trajectorySays += 1;
                }
            }
        }
    }
    return metrics;
}

function readJsonlRecords(filePath: string): Array<Record<string, unknown>> {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    return fs
        .readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => safeJsonRecord(line))
        .filter((line): line is Record<string, unknown> => Boolean(line));
}

function safeJsonRecord(line: string): Record<string, unknown> | undefined {
    try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function selectedModuleActionCount(evidence: BenchmarkEvidenceBuffer, module: SparkModuleIdentity): number {
    return evidence.actionAttempts.filter(attempt => sameModule(attempt.sparkModule, module)).length;
}

function selectedModuleInferenceCount(evidence: BenchmarkEvidenceBuffer, module: SparkModuleIdentity): number {
    return evidence.inferenceRequests.filter(request => sameModule(request.sparkModule, module) && request.cause !== 'thinking_started')
        .length;
}

function sameModule(candidate: SparkModuleIdentity | undefined, expected: SparkModuleIdentity): boolean {
    return candidate?.id === expected.id && candidate.version === expected.version;
}

function pushUnique(values: string[], value: string): void {
    if (!values.includes(value)) {
        values.push(value);
    }
}

function outcomeFromError(error: unknown): BenchmarkTaskOutcome {
    if (error instanceof BenchmarkTimeoutError) {
        return { status: 'timeout', score: 0, failureReason: error.message };
    }
    return { status: 'error', score: 0, failureReason: errorMessage(error) };
}

function defaultScore(status: BenchmarkRunStatus): number {
    return status === 'passed' ? 1 : 0;
}

function benchmarkRunId(taskId: string, now: Date): string {
    const stamp = now
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14);
    return `bench_${stamp}_${taskId.replace(/[^a-z0-9]+/gi, '_')}`;
}

function benchmarkResidentName(taskId: string, runId: string): string {
    const task = taskId
        .replace(/^make-/, '')
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 7)
        .replace(/_+$/g, '');
    return `res:bmk_${task || 'task'}_${shortHash(runId)}`.slice(0, 24);
}

function benchmarkPeerResidentName(peerId: string, runId: string): string {
    const peer = peerId
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 7)
        .replace(/_+$/g, '');
    return `res:bmk_${peer || 'peer'}_${shortHash(`${runId}:${peerId}`)}`.slice(0, 24);
}

function shortHash(value: string): string {
    let hash = 5381;
    for (const char of value) {
        hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
    }
    return hash.toString(36).padStart(8, '0').slice(0, 8);
}

function matchesResident(residentId: unknown, resident: string): boolean {
    if (residentId === resident) {
        return true;
    }
    return residentId === `resident:${resident}`;
}

function perceptionId(perception: Record<string, unknown>): string | undefined {
    if (typeof perception.id === 'string') {
        return perception.id;
    }
    if (typeof perception.tick === 'number') {
        return `tick:${perception.tick}`;
    }
    return undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function recordCleanupProblem(error: unknown, failures: string[], skips: string[]): void {
    const message = errorMessage(error);
    if (isDeleteDisabledError(message)) {
        skips.push(message);
        return;
    }
    failures.push(message);
}

function isDeleteDisabledError(message: string): boolean {
    return message === 'EDELETE_DISABLED' || message === 'EDELETE_DISABLED: EDELETE_DISABLED';
}

function cleanupSkippedSummary(count: number): string {
    return `cleanup skipped: delete disabled for ${count} disposable resident${count === 1 ? '' : 's'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class BenchmarkTimeoutError extends Error {}
