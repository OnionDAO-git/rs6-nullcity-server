import type { SparkModuleIdentity } from '../spark';
import type { SubmittedActionAck } from '../transport/gateway-client';
import type { ActionResult, AgentAction, CreateResidentPayload, Perception, PerceptionEvent } from '../transport/message-codecs';
import { type BenchmarkArtifact, type BenchmarkRunStatus, benchmarkArtifactSchema, normalizeBenchmarkArtifact } from './benchmark-artifact';

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
    readonly signal: AbortSignal;
    submitAction(action: AgentAction): Promise<ActionResult>;
    recordInferenceRequest(requestId: string): void;
    recordSummary(summary: string): void;
    latestPerception(): Perception | undefined;
    perceptions(): readonly Perception[];
    events(): readonly PerceptionEvent[];
}

export interface BenchmarkTask {
    id: string;
    version: string;
    timeoutMs: number;
    resident?: Omit<CreateResidentPayload, 'name'>;
    run(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome>;
}

export interface BenchmarkRunnerOptions {
    gateway: BenchmarkGateway;
    task: BenchmarkTask;
    module: SparkModuleIdentity;
    modelProfile: string;
    commits: BenchmarkArtifact['commits'];
    runId?: string;
    residentName?: string;
    now?: () => Date;
}

interface BenchmarkEvidenceBuffer {
    actionAttemptIds: string[];
    inferenceRequestIds: string[];
    perceptionIds: string[];
    summaries: string[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export class BenchmarkRunner {
    private readonly runId: string;
    private readonly resident: string;
    private readonly now: () => Date;

    constructor(private readonly options: BenchmarkRunnerOptions) {
        this.runId = options.runId || benchmarkRunId(options.task.id, options.now?.() || new Date());
        this.resident = options.residentName || benchmarkResidentName(options.task.id, this.runId);
        this.now = options.now || (() => new Date());
    }

    async run(): Promise<BenchmarkArtifact> {
        const startedAt = this.now().toISOString();
        const evidence = createEvidenceBuffer();
        const abortController = new AbortController();
        const listeners = this.bindEvidenceListeners(evidence);
        let created = false;
        let connected = false;
        let outcome: BenchmarkTaskOutcome | undefined;
        const cleanupFailures: string[] = [];

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
            outcome = await this.runTaskWithTimeout(this.createTaskContext(evidence, abortController.signal), abortController);
        } catch (error) {
            outcome = outcomeFromError(error);
        } finally {
            this.unbindEvidenceListeners(listeners);
            if (connected) {
                try {
                    await this.options.gateway.disconnectResident(this.resident);
                } catch (error) {
                    cleanupFailures.push(errorMessage(error));
                }
            }
            if (created) {
                try {
                    await this.options.gateway.deleteResident(this.resident);
                } catch (error) {
                    cleanupFailures.push(errorMessage(error));
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

        const endedAt = this.now().toISOString();
        return benchmarkArtifactSchema.parse(
            normalizeBenchmarkArtifact({
                schemaVersion: 1,
                runId: this.runId,
                task: { id: this.options.task.id, version: this.options.task.version },
                module: this.options.module,
                resident: this.resident,
                modelProfile: this.options.modelProfile,
                commits: this.options.commits,
                startedAt,
                endedAt,
                status: outcome.status,
                score: outcome.score ?? defaultScore(outcome.status),
                metrics: {
                    actionsAttempted: evidence.actionAttemptIds.length,
                    ...outcome.metrics,
                },
                evidence: {
                    actionAttemptIds: evidence.actionAttemptIds,
                    inferenceRequestIds: evidence.inferenceRequestIds,
                    perceptionIds: evidence.perceptionIds,
                    summaries: [...evidence.summaries, ...(outcome.summaries || [])],
                },
                failureReason: outcome.failureReason,
            }),
        );
    }

    private createTaskContext(evidence: BenchmarkEvidenceBuffer, signal: AbortSignal): BenchmarkTaskContext {
        return {
            resident: this.resident,
            signal,
            submitAction: async action => {
                const ack = await this.options.gateway.submitActionWithRequestId(this.resident, action);
                pushUnique(evidence.actionAttemptIds, ack.requestId);
                return ack.ackResult;
            },
            recordInferenceRequest: requestId => {
                evidence.inferenceRequestIds.push(requestId);
            },
            recordSummary: summary => {
                evidence.summaries.push(summary);
            },
            latestPerception: () => evidence.perceptions.at(-1),
            perceptions: () => evidence.perceptions,
            events: () => evidence.events,
        };
    }

    private async runTaskWithTimeout(context: BenchmarkTaskContext, abortController: AbortController): Promise<BenchmarkTaskOutcome> {
        let timeout: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                this.options.task.run(context),
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
        inferenceRequestIds: [],
        perceptionIds: [],
        summaries: [],
        perceptions: [],
        events: [],
    };
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
        .slice(0, 7);
    return `res:bmk_${task || 'task'}_${shortHash(runId)}`.slice(0, 24);
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class BenchmarkTimeoutError extends Error {}
