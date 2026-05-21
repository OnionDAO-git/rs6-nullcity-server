import type { LlmClient } from './llm/llm-client';
import { ActionCoordinator } from './actions/action-coordinator';
import { type ResidentBody, createGatewayBody } from './body';
import type { BodyActionLogEntry } from './body';
import type { ActionAttempt, ActionEvidence, EffectWaitResult } from './actions/action-attempt';
import {
    EVIDENCE_SCHEMA_VERSION,
    ProgressTracker,
    type EvidenceStore,
    type LibraryUpdater,
    type ProgressLine,
    type ProgressSnapshot,
    type TrajectoryBuilder,
} from './evidence';
import type { GameSkillContext, GameSkillContextInput } from './knowledge/game-skill-context';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { MemoryRouter } from './memory/memory-router';
import type { MemoryStore } from './memory/memory-store';
import { type RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import { NervousSystem } from './nervous-system';
import { PerceptionCompressor } from './perception/perception-compressor';
import { PerceptionHistory } from './perception/perception-history';
import type { Soul } from './soul/soul-schema';
import type { SparkModule, SparkModuleIdentity, SparkNervousSystem } from './spark/modules';
import { initialAttention } from './spark/attention';
import { createSparkRuntimeFacets } from './spark/runtime-facets';
import type { ThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';
import type { AgentAction, Perception, PerceptionEvent } from './transport/message-codecs';

const MAX_PENDING_EVENTS = 50;

export interface ResidentRuntimeGameSkill {
    buildContext(input: GameSkillContextInput): GameSkillContext;
    observeAttempt(event: {
        resident: string;
        producer: 'nervous-system' | 'body';
        perception: Perception;
        context?: GameSkillContext;
        attempt: ActionAttempt;
    }): void;
    flush?(): Promise<void>;
}

export interface ResidentRuntimeOptions {
    soul: Soul;
    gateway: GatewayClient;
    memory: MemoryStore;
    stateStore: RuntimeStateStore;
    llm: LlmClient;
    actionLog: ActionLog;
    inferenceLog: InferenceLog;
    thinking?: ThinkingModule;
    body?: ResidentBody;
    actionCoordinator?: ActionCoordinator;
    gameSkill?: ResidentRuntimeGameSkill;
    sparkModules?: SparkModule[];
    evidence?: ResidentRuntimeEvidence;
}

export interface ResidentRuntimeEvidence {
    store: EvidenceStore;
    sessionId: string;
    trajectory: TrajectoryBuilder;
    library?: LibraryUpdater;
}

export class ResidentRuntime {
    readonly name: string;
    private readonly state: RuntimeState;
    private readonly thinking: ThinkingModule;
    private readonly thinkingSparkModule?: SparkModuleIdentity;
    private readonly thinkingSourceModule?: SparkModule;
    private readonly nervousSystem: SparkNervousSystem;
    private readonly nervousSourceModule?: SparkModule;
    private readonly body: ResidentBody;
    private readonly actionCoordinator: ActionCoordinator;
    private readonly history = new PerceptionHistory();
    private readonly memoryRouter = new MemoryRouter();
    private readonly compressor = new PerceptionCompressor();
    private readonly pendingEvents: PerceptionEvent[] = [];
    private readonly evidence?: ResidentRuntimeEvidence;
    private readonly progressTracker = new ProgressTracker();
    private deciding = false;

    constructor(private readonly options: ResidentRuntimeOptions) {
        this.name = options.soul.frontmatter.name;
        this.evidence = options.evidence;
        this.state = options.stateStore.load(
            this.name,
            initialAttention(options.soul.frontmatter.attentionProfile),
            options.soul.frontmatter.legacy?.kind || options.soul.frontmatter.archetype,
        );
        if (options.thinking) {
            this.thinking = options.thinking;
            this.nervousSystem = new NervousSystem({ soul: options.soul, state: this.state, memory: options.memory });
        } else {
            const facets = createSparkRuntimeFacets({
                soul: options.soul,
                state: this.state,
                memory: options.memory,
                llm: options.llm,
                sparkModules: options.sparkModules,
                moduleTelemetry: entry => options.inferenceLog.append(this.name, { ...entry }),
            });
            this.thinking = facets.thinking;
            this.thinkingSparkModule = facets.thinkingSparkModule;
            this.thinkingSourceModule = facets.thinkingSourceModule;
            this.nervousSystem = facets.nervousSystem;
            this.nervousSourceModule = facets.nervousSourceModule;
        }
        this.body = options.body || createGatewayBody(this.name, options.gateway, options.actionLog);
        this.actionCoordinator =
            options.actionCoordinator ||
            new ActionCoordinator({
                resident: this.name,
                submitter: {
                    submit: (action, metadata) => this.body.submit(action, metadata as Omit<BodyActionLogEntry, 'action' | 'result'>),
                },
            });
    }

    async onPerception(perception: Perception): Promise<void> {
        return this.withEvidenceTick(perception, () => this.handlePerception(perception));
    }

    private async handlePerception(perception: Perception): Promise<void> {
        this.history.push(perception);
        this.body.observePerception(perception);
        const reaction = this.nervousSystem.react(perception);
        if (reaction) {
            if (this.deciding && reaction.interruptThinking) {
                this.thinking.stop(`nervous:${reaction.rule.id}`);
            }
            const attempt = await this.actionCoordinator.submit({
                producer: 'nervous-system',
                action: reaction.action,
                metadata: {
                    tick: this.state.tick,
                    attention_after: this.state.attention,
                    source: 'nervous-system',
                    ruleId: reaction.rule.id,
                    sparkModule: reaction.sparkModule,
                },
                waitForEffect: this.effectWaitFor(reaction.action),
                ...this.evidenceCallbacks(),
            });
            this.observeGameSkillAttempt('nervous-system', perception, undefined, attempt);
            this.options.stateStore.save(this.state);
            if (reaction.suppressThinking) {
                return;
            }
        }

        if (this.deciding) {
            const compressed = this.compressor.compress(perception);
            if (this.thinking.considerInterrupt(perception)) {
                this.options.inferenceLog.append(this.name, {
                    tick: this.state.tick,
                    cause: 'urgent_interrupt',
                    perception_tokens: compressed.text.length,
                    sparkModule: this.thinkingSparkModule,
                });
            }
            return;
        }

        const decisionPerception = this.withPendingEvents(perception);
        const compressed = this.compressor.compress(decisionPerception);
        const compressedPerception = { ...decisionPerception, compressed: compressed.text };
        const gameSkillContext = this.options.gameSkill?.buildContext({
            resident: this.name,
            tick: this.state.tick,
            activeGoal: this.state.cognition?.activeGoal,
            perception: compressedPerception,
        });
        this.deciding = true;
        try {
            const result = await this.thinking.think(compressedPerception, gameSkillContext);
            this.recordEvidence(trajectory =>
                trajectory.recordDecision({
                    cause: result.cause,
                    moduleId: this.thinkingSparkModule?.id,
                    moduleVersion: this.thinkingSparkModule?.version,
                    promptTokens: result.envelopeTokens,
                    actionKinds: result.actions.map(action => action.kind),
                }),
            );
            for (const event of result.syntheticEvents || []) {
                this.history.push(event);
            }
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                envelope_tokens: result.envelopeTokens || 0,
                actions_emitted: result.actions.length,
                synthetic_events: result.syntheticEvents?.length || 0,
                parse_ok: true,
                cause: result.cause,
                nooped: result.nooped,
                sparkModule: this.thinkingSparkModule,
            });

            for (const action of result.actions) {
                const attempt = await this.actionCoordinator.submit({
                    producer: 'body',
                    action,
                    metadata: {
                        tick: this.state.tick,
                        attention_after: this.state.attention,
                        source: 'thinking',
                        sparkModule: this.thinkingSparkModule,
                    },
                    waitForEffect: this.effectWaitFor(action),
                    ...this.evidenceCallbacks(),
                });
                this.observeGameSkillAttempt('body', compressedPerception, gameSkillContext, attempt);
            }
        } finally {
            this.options.stateStore.save(this.state);
            this.deciding = false;
        }
    }

    onEvent(event: PerceptionEvent): void {
        this.history.push(event);
        this.body.observeEvent(event);
        this.pendingEvents.push(event);
        if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
            this.pendingEvents.splice(0, this.pendingEvents.length - MAX_PENDING_EVENTS);
        }
        const routed = this.memoryRouter.routeEvent(this.name, event);
        if (routed) {
            this.options.memory.write(this.name, routed.path, routed.content);
        }
    }

    private withPendingEvents(perception: Perception): Perception {
        if (this.pendingEvents.length === 0) {
            return perception;
        }

        const pending = this.pendingEvents.splice(0);
        const events = Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
        return { ...perception, events: [...events, ...pending] };
    }

    private async withEvidenceTick(perception: Perception, run: () => Promise<void>): Promise<void> {
        const tick = typeof perception.tick === 'number' ? perception.tick : this.state.tick;
        const began = this.recordEvidence(trajectory => trajectory.beginTick(tick, perception));
        this.observeRuntimeProgress(tick, perception);
        try {
            await run();
        } finally {
            if (began) {
                this.recordEvidence(trajectory => trajectory.endTick('tick_complete'));
            }
        }
    }

    private evidenceCallbacks(): ResidentRuntimeActionCallbacks {
        return {
            onAckReady: attempt => {
                const requestId = attempt.requestId || attempt.attemptId;
                this.recordEvidence(trajectory => {
                    const line = trajectory.recordAction(attempt.action, requestId);
                    this.evidence?.library?.observeTrajectory(line);
                });
            },
            onEffectResolved: attempt => {
                const requestId = attempt.requestId || attempt.attemptId;
                this.recordEvidence(trajectory =>
                    trajectory.recordActionResult(requestId, {
                        status: attempt.finalStatus,
                        reason: attempt.finalReason || stringReason(attempt.ackResult?.reason),
                        evidence: attempt.evidence,
                    }),
                );
            },
        };
    }

    private observeRuntimeProgress(tick: number, perception: Perception): void {
        const delta = this.progressTracker.observe(progressSnapshotFromPerception(tick, perception));
        if (delta.meaningful) {
            this.state.lastMeaningfulProgressAt = tick;
            this.state.stuckSince = undefined;
        } else if (delta.stuckSince !== null) {
            this.state.stuckSince = delta.stuckSince;
        } else {
            this.state.stuckSince = undefined;
        }

        this.recordProgressEvidence(tick, delta);
    }

    private recordProgressEvidence(
        tick: number,
        delta: { meaningful: boolean; reasons: string[]; stuckSince: number | null },
    ): void {
        if (!this.evidence) {
            return;
        }
        try {
            const line: ProgressLine = {
                schemaVersion: EVIDENCE_SCHEMA_VERSION,
                ts: new Date().toISOString(),
                tick,
                sessionId: this.evidence.sessionId,
                kind: 'progress',
                meaningful: delta.meaningful,
                reasons: delta.reasons,
                stuckSince: delta.stuckSince,
            };
            this.evidence.store.appendProgress(line);
            this.evidence.library?.observeProgress(line);
        } catch (error) {
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                cause: 'evidence_progress_record_failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private recordEvidence(write: (trajectory: TrajectoryBuilder) => void): boolean {
        if (!this.evidence) {
            return false;
        }
        try {
            write(this.evidence.trajectory);
            return true;
        } catch (error) {
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                cause: 'evidence_record_failed',
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    private observeGameSkillAttempt(
        producer: 'nervous-system' | 'body',
        perception: Perception,
        context: GameSkillContext | undefined,
        attempt: ActionAttempt,
    ): void {
        try {
            this.options.gameSkill?.observeAttempt({ resident: this.name, producer, perception, context, attempt });
        } catch (error) {
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                cause: 'game_skill_observe_failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private effectWaitFor(action: AgentAction): ((signal: AbortSignal) => Promise<EffectWaitResult>) | undefined {
        if (action.kind === 'move_to' && isPosition(action.target)) {
            const target = action.target;
            const range = typeof action.range === 'number' ? Math.max(0, action.range) : 0;
            const afterSeq = this.body.getLatestPerceptionSeq();
            return async signal =>
                perceptionWaitToEffect(
                    await this.body.waitForPerception(perception => positionMatches(perceptionPosition(perception), target, range), {
                        afterSeq,
                        timeoutMs: 5000,
                        signal,
                    }),
                    perception => ({
                        source: 'perception',
                        detail: { kind: 'position_reached', position: perceptionPosition(perception) },
                    }),
                );
        }

        if (action.kind === 'say' && typeof action.text === 'string') {
            const text = action.text;
            const afterSeq = this.body.getLatestEventSeq();
            return async signal =>
                eventWaitToEffect(
                    await this.body.waitForEvent(event => event.kind === 'chat' && event.text === text, {
                        afterSeq,
                        timeoutMs: 3000,
                        signal,
                    }),
                    event => ({
                        source: 'event',
                        detail: { kind: 'chat_observed', text: event.text },
                    }),
                );
        }

        if (waitsForPerceptionEffect(action.kind) && supportsPerceptionEffectWait(this.body)) {
            const before = this.body.getLatestPerception();
            const afterSeq = this.body.getLatestPerceptionSeq();
            return async signal =>
                perceptionWaitToEffect(
                    await this.body.waitForPerception(perception => actionEffectObserved(action, before, perception), {
                        afterSeq,
                        timeoutMs: 5000,
                        signal,
                    }),
                    perception => ({
                        source: 'perception',
                        detail: {
                            kind: 'action_effect_observed',
                            actionKind: action.kind,
                            changed: changedEffectSections(before, perception, action),
                            events: eventSummaries(perception, action),
                        },
                    }),
                );
        }

        return undefined;
    }

    stop(cause = 'runtime_stopped'): void {
        this.thinking.stop(cause);
        this.recordEvidence(() => this.evidence?.store.endSession(this.evidence.sessionId, 'shutdown'));
        const sourceModules = new Set(
            [this.thinkingSourceModule, this.nervousSourceModule].filter((module): module is SparkModule => Boolean(module)),
        );
        for (const module of sourceModules) {
            module.stop?.(cause);
        }
        this.options.stateStore.save(this.state);
    }
}

interface ResidentRuntimeActionCallbacks {
    onAckReady?: (attempt: ActionAttempt) => void;
    onEffectResolved?: (attempt: ActionAttempt) => void;
}

interface Position {
    x: number;
    y: number;
    level?: number;
}

function perceptionWaitToEffect(
    wait: Awaited<ReturnType<ResidentBody['waitForPerception']>>,
    evidence: (perception: Perception) => ActionEvidence,
): EffectWaitResult {
    if (!wait.ok) {
        return { ok: false, reason: wait.reason };
    }
    return { ok: true, evidence: [evidence(wait.observation.value)] };
}

function eventWaitToEffect(
    wait: Awaited<ReturnType<ResidentBody['waitForEvent']>>,
    evidence: (event: PerceptionEvent) => ActionEvidence,
): EffectWaitResult {
    if (!wait.ok) {
        return { ok: false, reason: wait.reason };
    }
    return { ok: true, evidence: [evidence(wait.observation.value)] };
}

function perceptionPosition(perception: Perception): Position | undefined {
    const resident = record(perception.resident);
    const position = record(resident.position);
    if (typeof position.x !== 'number' || typeof position.y !== 'number') {
        return undefined;
    }
    return {
        x: position.x,
        y: position.y,
        level: typeof position.level === 'number' ? position.level : undefined,
    };
}

function positionMatches(position: Position | undefined, target: Position, range = 0): boolean {
    if (!position || (target.level !== undefined && position.level !== target.level && position.level !== undefined)) {
        return false;
    }
    const distance = Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y));
    if (range > 0) {
        return distance <= range;
    }
    return (
        position.x === target.x &&
        position.y === target.y &&
        (target.level === undefined || position.level === target.level || position.level === undefined)
    );
}

function isPosition(value: unknown): value is Position {
    const recordValue = record(value);
    return typeof recordValue.x === 'number' && typeof recordValue.y === 'number';
}

function progressSnapshotFromPerception(tick: number, perception: Perception): ProgressSnapshot {
    const root = record(perception);
    const resident = record(root.resident);
    return {
        tick,
        xpBySkill: xpBySkill(resident.skills),
        inventoryCount: inventoryCount(resident.inventory),
        positionHash: positionHash(resident.position),
        hp: currentHp(resident),
    };
}

function xpBySkill(value: unknown): Record<string, number> {
    return Object.fromEntries(
        Object.entries(record(value)).map(([skill, skillValue]) => {
            if (typeof skillValue === 'number') {
                return [skill, skillValue];
            }
            const skillRecord = record(skillValue);
            return [skill, numberField(skillRecord.xp) ?? numberField(skillRecord.experience) ?? 0];
        }),
    );
}

function inventoryCount(value: unknown): number {
    if (!Array.isArray(value)) {
        return 0;
    }
    return value.filter(item => Object.keys(record(item)).length > 0).length;
}

function positionHash(value: unknown): string {
    const position = record(value);
    const x = numberField(position.x);
    const y = numberField(position.y);
    if (x === undefined || y === undefined) {
        return 'unknown';
    }
    return `${x},${y},${numberField(position.level) ?? 0}`;
}

function currentHp(resident: Record<string, unknown>): number {
    const hp = record(resident.hp);
    const hitpoints = record(resident.hitpoints);
    return numberField(hp.current) ?? numberField(hitpoints.current) ?? numberField(resident.hp) ?? 0;
}

function numberField(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

function waitsForPerceptionEffect(kind: string): boolean {
    return ['interact', 'use_item_on', 'use_item_on_item', 'attack', 'item_action', 'equip', 'drop', 'eat'].includes(kind);
}

function supportsPerceptionEffectWait(body: ResidentBody): boolean {
    return (
        typeof body.getLatestPerception === 'function' &&
        typeof body.getLatestPerceptionSeq === 'function' &&
        typeof body.waitForPerception === 'function'
    );
}

function stringReason(reason: unknown): string | undefined {
    return typeof reason === 'string' ? reason : undefined;
}

function actionEffectObserved(action: AgentAction, before: Perception | undefined, after: Perception): boolean {
    return changedEffectSections(before, after, action).length > 0 || eventSummaries(after, action).length > 0;
}

function effectState(perception: Perception | undefined, action?: AgentAction): Record<string, unknown> {
    const root = record(perception);
    const resident = record(root.resident);
    const nearby = record(root.nearby);
    const state: Record<string, unknown> = {
        hp: resident.hp,
        skills: resident.skills,
        inCombat: resident.inCombat,
        combatTarget: resident.combatTarget,
        inventory: resident.inventory,
        equipment: resident.equipment,
        activeTrade: resident.activeTrade,
        nearbyWorldItems: nearby.worldItems,
        nearbyObjects: nearby.objects,
    };
    const allowed = effectStateSections(action);
    return Object.fromEntries(Object.entries(state).filter(([key]) => allowed.includes(key)));
}

function changedEffectSections(before: Perception | undefined, after: Perception, action?: AgentAction): string[] {
    const beforeState = effectState(before, action);
    const afterState = effectState(after, action);
    return Object.keys(afterState).filter(key => JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key]));
}

function effectStateSections(action?: AgentAction): string[] {
    switch (action?.kind) {
        case 'eat':
            return ['hp', 'inventory'];
        case 'drop':
            return ['inventory', 'nearbyWorldItems'];
        case 'equip':
        case 'unequip':
            return ['inventory', 'equipment'];
        case 'attack':
            return ['hp', 'skills', 'inCombat', 'combatTarget'];
        default:
            return [
                'hp',
                'skills',
                'inCombat',
                'combatTarget',
                'inventory',
                'equipment',
                'activeTrade',
                'nearbyWorldItems',
                'nearbyObjects',
            ];
    }
}

function eventSummaries(perception: Perception, action?: AgentAction): Array<Record<string, unknown>> {
    const events = Array.isArray(perception.events) ? perception.events : [];
    return events
        .filter(event => eventMatchesActionEffect(event, action))
        .slice(0, 5)
        .map(event => {
            const eventRecord = record(event);
            return {
                kind: eventRecord.kind,
                text: typeof eventRecord.text === 'string' ? eventRecord.text.slice(0, 160) : undefined,
            };
        });
}

function eventMatchesActionEffect(event: unknown, action?: AgentAction): boolean {
    const eventRecord = record(event);
    if (eventRecord.kind === 'chat') {
        return false;
    }
    const text = typeof eventRecord.text === 'string' ? eventRecord.text.toLowerCase() : '';
    switch (action?.kind) {
        case 'eat':
            return /eat|heal/.test(text);
        case 'attack':
            return /attack|hit|damage|dead|dies|defeat|combat/.test(text);
        case 'drop':
            return /drop|dropped/.test(text);
        case 'equip':
        case 'unequip':
            return /wear|wield|equip|remove/.test(text);
        default:
            return eventRecord.kind === 'message' || text.length > 0;
    }
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
