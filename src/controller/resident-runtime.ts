import fs from 'fs';
import path from 'path';
import type { LlmClient } from './llm/llm-client';
import { ActionCoordinator, type ActionCoordinatorSubmitInput } from './actions/action-coordinator';
import { PatronConfig, PatronRegistry } from './patron/patron-registry';
import { RoutineCapableRuntime, RoutineContext, RoutinePreemptionReason, RoutineTickOutcome } from './routines/routine-runner';
import {
    buryBonesAction,
    combatTrainingAction,
    firemakingAction,
    firstFoodSlot,
    hasNearbyFire,
    isLowHealth,
    levelOneWoodcuttingAction,
} from './spark/runescape-body-routines';

import { HERO_TIERS } from './residents/hero-tier';
import { canTradeResource, itemMatches } from './actions/hero-actions';

import { type ResidentBody, createGatewayBody } from './body';
import type { BodyActionLogEntry } from './body';
import type { ActionAttempt, ActionEvidence, EffectWaitResult } from './actions/action-attempt';
import { evaluateReceptionGreeting } from './embassy/reception-reflex';
import { canInteract } from './actions/interact-resident';
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
import type { RecordFactionAttemptInput } from './factions/stockpile-ledger';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { MemoryRouter } from './memory/memory-router';
import type { MemoryStore } from './memory/memory-store';
import { type RuntimeState, RuntimeStateStore, addAttention, markDeceased } from './memory/runtime-state';
import { NervousSystem } from './nervous-system';
import { PerceptionCompressor } from './perception/perception-compressor';
import { PerceptionHistory } from './perception/perception-history';
import { type Soul, dominantFaction } from './soul/soul-schema';
import { LettersStore } from './patron/letters-store';
import {
    buildEpitaphDispatchRequests,
    dispatchEpitaphs,
    findLivingSibling,
    loadPreparedEpitaph,
    type DeceasedResidentSummary,
} from './patron/epitaph-dispatcher';
import { produceBroadcastLetter, type Letter } from './patron/letters-producer';
import { loadControllerConfig } from './config';
import type { SparkModule, SparkModuleIdentity, SparkNervousSystem } from './spark/modules';
import { initialAttention, spendAttention } from './spark/attention';
import { explorationGoal, isStandaloneFiremakingGoal } from './spark/runescape-brain-planner';
import { createSparkRuntimeFacets } from './spark/runtime-facets';
import type { ThinkingModule, ThoughtResult } from './thinking';
import type { GatewayClient } from './transport/gateway-client';
import type { AgentAction, Perception, PerceptionEvent, ActionResult } from './transport/message-codecs';
import { LoreBus } from './lore/lore-bus';
import { FireLitReflex } from './lore/fire-lit-reflex';
import { MomentLabeler } from './evidence/moment-labeler';
import { whisperInboxFor, type WhisperInbox } from './lore/whisper';

const MAX_PENDING_EVENTS = 50;
const DEFAULT_THINKING_WATCHDOG_MS = 45_000;
const ACK_ONLY_ACTION_WATCHDOG_MS = 15_000;
const SAY_ACTION_WATCHDOG_MS = 10_000;
const ACTION_EFFECT_WATCHDOG_GRACE_MS = 10_000;
const MOVE_EFFECT_TIMEOUT_MIN_MS = 5_000;
const MOVE_EFFECT_TIMEOUT_PER_TILE_MS = 1_200;
const MOVE_EFFECT_TIMEOUT_BUFFER_MS = 4_000;
const MOVE_EFFECT_TIMEOUT_MAX_MS = 30_000;
const STARTER_FISHING_EFFECT_TIMEOUT_MS = 45_000;
const THINKING_VISIBILITY_DELAY_MS = 1_000;

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

export interface ResidentRuntimeFactionStockpile {
    recordAttempt(input: RecordFactionAttemptInput): unknown;
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
    factionStockpile?: ResidentRuntimeFactionStockpile;
    sparkModules?: SparkModule[];
    evidence?: ResidentRuntimeEvidence;
    patrons?: PatronConfig[];
    patronGateway?: {
        witnessAt(patronHandle: string, landmarkId: 'embassy', residentName: string): Promise<unknown> | unknown;
    };
    watchdog?: {
        thinkingMs?: number;
        actionMs?: number;
    };
    loreBus?: LoreBus;
}

export interface ResidentRuntimeEvidence {
    store: EvidenceStore;
    sessionId: string;
    trajectory: TrajectoryBuilder;
    library?: LibraryUpdater;
}

interface PerceptionArrival {
    perception: Perception;
    preemption?: { preempted: RoutinePreemptionReason };
}

export class ResidentRuntime implements RoutineCapableRuntime {
    readonly name: string;
    _lastHints?: string[];
    activeRoutineId?: string;
    private followSuccessTicks = 0;
    private killsObserved = 0;
    private nextPerceptionResolver?: (arrival: PerceptionArrival) => void;
    private readonly state: RuntimeState;
    private readonly thinking: ThinkingModule;
    private readonly thinkingSparkModule?: SparkModuleIdentity;
    private readonly thinkingSourceModule?: SparkModule;
    private readonly nervousSystem: SparkNervousSystem;
    private readonly nervousSourceModule?: SparkModule;
    private readonly body: ResidentBody;
    private readonly actionCoordinator: ActionCoordinator;
    private readonly patronRegistry: PatronRegistry;
    private readonly history = new PerceptionHistory();
    private readonly memoryRouter = new MemoryRouter();
    private readonly compressor = new PerceptionCompressor();
    private readonly pendingEvents: PerceptionEvent[] = [];
    private readonly evidence?: ResidentRuntimeEvidence;
    private readonly progressTracker = new ProgressTracker();
    private deciding = false;
    private activeTradeResourceDeferred?: {
        resolve: (attempt: ActionAttempt) => void;
        reject: (err: Error) => void;
        attempt: ActionAttempt;
    };
    private readonly loreBus?: LoreBus;
    private readonly fireLitReflex?: FireLitReflex;
    private readonly momentLabeler?: MomentLabeler;
    private readonly whisperInbox?: WhisperInbox;

    constructor(private readonly options: ResidentRuntimeOptions) {
        this.name = options.soul.frontmatter.name;
        this.evidence = options.evidence;
        const startingAttention = initialAttention(options.soul.frontmatter.attentionProfile);
        this.state = options.stateStore.load(
            this.name,
            startingAttention,
            options.soul.frontmatter.legacy?.kind || options.soul.frontmatter.archetype,
        );
        this.applyRestartRespawnPolicy(startingAttention);
        this.patronRegistry = new PatronRegistry(options.patrons || []);
        if (options.thinking) {
            this.thinking = options.thinking;
            this.nervousSystem = new NervousSystem({
                soul: options.soul,
                state: this.state,
                memory: options.memory,
                patronRegistry: this.patronRegistry,
            });
        } else {
            const facets = createSparkRuntimeFacets({
                soul: options.soul,
                state: this.state,
                memory: options.memory,
                llm: options.llm,
                sparkModules: options.sparkModules,
                moduleTelemetry: entry => options.inferenceLog.append(this.name, { ...entry }),
                patronRegistry: this.patronRegistry,
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
        if (options.loreBus) {
            this.loreBus = options.loreBus;
            this.fireLitReflex = new FireLitReflex({ bus: options.loreBus });
            this.whisperInbox = whisperInboxFor(options.loreBus, this.name);
            this.momentLabeler = options.evidence ? new MomentLabeler({ builder: options.evidence.trajectory }) : undefined;
        }
        this.options.stateStore.save(this.state);
    }

    private applyRestartRespawnPolicy(startingAttention: number): void {
        if (this.options.soul.frontmatter.respawnPolicy !== 'on_restart') {
            return;
        }
        if (this.state.deceased?.cause !== 'attention_exhausted') {
            return;
        }

        this.state.attention = Math.max(this.state.attention, startingAttention);
        this.state.deceased = undefined;
        this.state.stuckSince = undefined;
        if (this.state.cognition?.activeMove) {
            this.state.cognition.activeMove = undefined;
        }

        // HD-028 wire-in (E8/F8a + E12). The runtime-state mutations
        // above bring the resident back, but without a library/timeline
        // beat the Brain's next prompt envelope has no memory line about
        // the continuity break. LibraryUpdater.observeRevival bumps
        // `index.lives`, flips `currentState` back to 'living', and
        // appends a `revival` event so the resident can acknowledge it
        // (e.g. via a "I came back from somewhere quiet..." say). The
        // substrate was shipped at f9968a16; this is the wire-in.
        this.evidence?.library?.observeRevival({
            ts: new Date().toISOString(),
            tick: this.state.tick,
            cause: 'restart_respawn_policy',
        });
    }

    getState(): RuntimeState {
        return this.state;
    }

    getEvidence(): ResidentRuntimeEvidence | undefined {
        return this.evidence;
    }

    incrementAttention(amount: number): void {
        addAttention(this.state, amount);
        this.options.stateStore.save(this.state);
    }

    getPosition(): { x: number; y: number; level: number } | undefined {
        const latest = this.body.getLatestPerception();
        if (!latest) {
            return undefined;
        }
        const pos = perceptionPosition(latest);
        if (!pos) {
            return undefined;
        }
        return {
            x: pos.x,
            y: pos.y,
            level: pos.level ?? 0,
        };
    }

    async onPerception(perception: Perception): Promise<void> {
        return this.withEvidenceTick(perception, () => this.handlePerception(perception));
    }

    private async handlePerception(perception: Perception): Promise<void> {
        if (this.state.activeTradeResource) {
            await this.tickActiveTradeResource(perception);
            return;
        }
        if (this.whisperInbox) {
            const drainedWhispers = this.whisperInbox.drain();
            for (const whisper of drainedWhispers) {
                const fromName = whisper.from;
                const isRes = fromName.startsWith('res:') || fromName.startsWith('resident:');
                const fromKind = isRes ? 'resident' : 'player';
                const fromId = isRes
                    ? `resident:${fromName.replace(/^(res:|resident:)/, '')}`
                    : `player:${fromName.replace(/[^a-z0-9:_-]+/gi, '-')}`;
                this.pendingEvents.push({
                    kind: 'whisper',
                    text: whisper.text,
                    from: {
                        id: fromId,
                        kind: fromKind,
                        name: fromName,
                        position: whisper.position,
                    },
                    to: this.name,
                    ts: whisper.ts,
                } as any);
            }
        }

        this.applyExternalOperatorRevive();

        if (this.fireLitReflex && this.momentLabeler) {
            const fireEvent = this.fireLitReflex.observe(perception as any, this.name);
            if (fireEvent) {
                const payload = fireEvent.payload as { position: { x: number; y: number; level: number } };
                this.momentLabeler.noteFireLit({ position: payload.position });
            }
        }
        // O1: only decay attention while the resident is alive; a deceased
        // resident's attention must not drift further negative across ticks
        // (avoids corrupted revival preconditions and confusing < 0 state).
        if (!this.state.deceased) {
            this.state.attention = spendAttention(
                this.state.attention,
                this.options.soul.frontmatter.attentionProfile?.decayCurve || 'standard',
                1,
                // E30 / HD-008: per-tick decay respects the optional soul floor
                // so heroes never die from idle decay alone.
                this.options.soul.frontmatter.attentionProfile?.floor,
            );
        }

        const attentionExhaustedThisTick = this.state.attention <= 0 && !this.state.deceased;
        if (attentionExhaustedThisTick) {
            markDeceased(this.state, 'attention_exhausted');
        }

        try {
            if (this.state.deceased) {
                if (attentionExhaustedThisTick) {
                    await this.submitAttentionLogout(perception);
                }
                if (this.nextPerceptionResolver) {
                    const resolve = this.nextPerceptionResolver;
                    this.nextPerceptionResolver = undefined;
                    resolve({
                        perception,
                        preemption: { preempted: 'nervous_death' },
                    });
                }
                return;
            }

            if (this.nextPerceptionResolver) {
                const resolve = this.nextPerceptionResolver;
                this.nextPerceptionResolver = undefined;

                const nervousPerception = this.peekWithPendingEvents(perception);
                const reaction = this.nervousSystem.react(nervousPerception);
                if (reaction) {
                    const decisionPerception = this.withPendingEvents(perception);
                    this.history.push(decisionPerception);
                    this.body.observePerception(decisionPerception);

                    const attempt = await this.submitActionWithWatchdog({
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
                    this.observeGameSkillAttempt('nervous-system', decisionPerception, undefined, attempt);

                    resolve({
                        perception,
                        preemption: { preempted: mapNervousRuleId(reaction.rule.id) },
                    });
                    return;
                }

                resolve({ perception });
                return;
            }

            if (this.options.patronGateway && (await this.trySubmitReceptionGreeting(perception))) {
                return;
            }

            const nervousPerception = this.peekWithPendingEvents(perception);
            const reaction = this.nervousSystem.react(nervousPerception);
            if (reaction) {
                if (this.deciding && reaction.interruptThinking) {
                    this.thinking.stop(`nervous:${reaction.rule.id}`);
                }
                const decisionPerception = this.withPendingEvents(perception);
                this.history.push(decisionPerception);
                this.body.observePerception(decisionPerception);

                const attempt = await this.submitActionWithWatchdog({
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
                this.observeGameSkillAttempt('nervous-system', decisionPerception, undefined, attempt);
                if (reaction.suppressThinking) {
                    return;
                }
            }

            if (this.deciding) {
                this.history.push(perception);
                this.body.observePerception(perception);
                const compressed = this.compressor.compress(nervousPerception);
                if (this.thinking.considerInterrupt(nervousPerception)) {
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
            this.history.push(decisionPerception);
            this.body.observePerception(decisionPerception);

            const compressed = this.compressor.compress(decisionPerception);
            const compressedPerception = { ...decisionPerception, compressed: compressed.text };
            const gameSkillContext = this.options.gameSkill?.buildContext({
                resident: this.name,
                tick: this.state.tick,
                activeGoal: this.state.cognition?.activeGoal,
                perception: compressedPerception,
            });
            this.deciding = true;
            const thinkingVisibilityTimer = setTimeout(() => {
                this.options.inferenceLog.append(this.name, {
                    tick: this.state.tick,
                    status: 'deciding',
                    cause: 'thinking_started',
                    perception_tokens: compressed.text.length,
                    sparkModule: this.thinkingSparkModule,
                });
            }, THINKING_VISIBILITY_DELAY_MS);
            thinkingVisibilityTimer.unref?.();
            try {
                const result = await this.thinkWithWatchdog(compressedPerception, gameSkillContext);
                this.recordEvidence(trajectory =>
                    trajectory.recordDecision({
                        cause: result.cause,
                        moduleId: this.thinkingSparkModule?.id,
                        moduleVersion: this.thinkingSparkModule?.version,
                        promptTokens: result.envelopeTokens,
                        actionKinds: result.actions.map(action => action.kind),
                        memoUpdates: result.memoUpdates,
                        planChange: result.planChange,
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
                    const interactReasons = canInteract(this.state, action, compressedPerception, this.options.soul);
                    if (interactReasons.length > 0) {
                        const tick = typeof compressedPerception.tick === 'number' ? compressedPerception.tick : this.state.tick;
                        const requestId = `gate:${tick}:${action.kind}`;
                        this.recordEvidence(trajectory => {
                            const line = trajectory.recordAction(action, requestId);
                            this.evidence?.library?.observeTrajectory(line);
                            trajectory.recordActionResult(requestId, {
                                status: 'failure',
                                reason: interactReasons.join('; '),
                            });
                        });
                        this.options.inferenceLog.append(this.name, {
                            tick: this.state.tick,
                            cause: 'interact_resident_precondition_failed',
                            actionKind: action.kind,
                            reasons: interactReasons.join('; '),
                            sparkModule: this.thinkingSparkModule,
                        });
                        continue;
                    }

                    const attempt = await this.submitActionWithWatchdog({
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
                    this.rememberTargetFailure(attempt);
                    this.rememberCompletedGoal(attempt);
                }
            } finally {
                clearTimeout(thinkingVisibilityTimer);
                this.deciding = false;
            }
        } finally {
            this.advanceRuntimeClock(perception);
            this.checkDeceasedAndDispatchEpitaphs(perception);
            this.options.stateStore.save(this.state);
        }
    }

    private advanceRuntimeClock(perception: Perception): void {
        const perceptionTick = typeof perception.tick === 'number' ? perception.tick : undefined;
        if (perceptionTick === undefined) {
            return;
        }
        this.state.tick = Math.max(this.state.tick, perceptionTick);
    }

    private async trySubmitReceptionGreeting(perception: Perception): Promise<boolean> {
        if (!this.options.patronGateway) {
            return false;
        }

        const preview = this.peekWithPendingEvents(perception);
        const greeting = evaluateReceptionGreeting({
            perception: preview as Record<string, unknown>,
            residentName: this.name,
            registry: this.patronRegistry,
        });
        if (!greeting) {
            return false;
        }

        const tick = typeof preview.tick === 'number' ? preview.tick : this.state.tick;
        const cooldownKey = `embassy-greeting:${greeting.witness.patronHandle.toLowerCase()}`;
        const coolingUntil = this.state.hookCooldowns?.[cooldownKey] || 0;
        if (coolingUntil > tick) {
            return false;
        }

        const decisionPerception = this.withPendingEvents(perception);
        this.history.push(decisionPerception);
        this.body.observePerception(decisionPerception);
        const action: AgentAction = { ...greeting.action };

        const attempt = await this.submitActionWithWatchdog({
            producer: 'nervous-system',
            action,
            metadata: {
                tick: this.state.tick,
                attention_after: this.state.attention,
                source: 'nervous-system',
                ruleId: 'embassy_reception_greeting',
                sparkModule: this.nervousSourceModule
                    ? { id: this.nervousSourceModule.manifest.id, version: this.nervousSourceModule.manifest.version }
                    : undefined,
            },
            waitForEffect: this.effectWaitFor(action),
            ...this.evidenceCallbacks(),
        });
        this.observeGameSkillAttempt('nervous-system', decisionPerception, undefined, attempt);
        if (attempt.finalStatus !== 'success') {
            return true;
        }

        this.state.hookCooldowns = this.state.hookCooldowns || {};
        this.state.hookCooldowns[cooldownKey] = tick + 10;

        try {
            await this.options.patronGateway.witnessAt(
                greeting.witness.patronHandle,
                greeting.witness.landmarkId,
                greeting.witness.residentName,
            );
        } catch (error) {
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                cause: 'embassy_reception_witness_failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return true;
    }

    private applyExternalOperatorRevive(): void {
        if (!this.state.deceased && !this.state.legacy.complete) {
            return;
        }

        const startingAttention = initialAttention(this.options.soul.frontmatter.attentionProfile);
        const external = this.options.stateStore.load(
            this.name,
            startingAttention,
            this.options.soul.frontmatter.legacy?.kind || this.options.soul.frontmatter.archetype,
        );
        if (external.deceased || external.attention <= 0) {
            return;
        }

        if (!this.state.deceased) {
            if (this.state.legacy.complete && !external.legacy.complete) {
                this.state.attention = Math.max(this.state.attention, external.attention);
                this.state.legacy = {
                    kind: external.legacy.kind,
                    complete: external.legacy.complete,
                    progress: { ...external.legacy.progress },
                };
            }
            return;
        }

        this.state.attention = Math.max(this.state.attention, external.attention);
        this.state.legacy = {
            kind: external.legacy.kind,
            complete: external.legacy.complete,
            progress: { ...external.legacy.progress },
        };
        this.state.deceased = undefined;
        this.state.stuckSince = undefined;
        if (this.state.cognition?.activeMove) {
            this.state.cognition.activeMove = undefined;
        }
    }

    private async submitAttentionLogout(perception: Perception): Promise<void> {
        if (this.deciding) {
            this.thinking.stop('attention_exhausted');
        }
        const decisionPerception = this.withPendingEvents(perception);
        this.history.push(decisionPerception);
        this.body.observePerception(decisionPerception);

        const attempt = await this.submitActionWithWatchdog({
            producer: 'nervous-system',
            action: { kind: 'logout', cause: 'attention_exhausted' },
            metadata: {
                tick: this.state.tick,
                attention_after: this.state.attention,
                source: 'nervous-system',
                ruleId: 'attention_exhausted',
            },
            waitForEffect: undefined,
            ...this.evidenceCallbacks(),
        });
        this.observeGameSkillAttempt('nervous-system', decisionPerception, undefined, attempt);
    }

    private async thinkWithWatchdog(perception: Perception, gameSkillContext: GameSkillContext | undefined): Promise<ThoughtResult> {
        const timeoutMs = this.options.watchdog?.thinkingMs ?? DEFAULT_THINKING_WATCHDOG_MS;
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<ThoughtResult>(resolve => {
            timer = setTimeout(() => {
                this.thinking.stop('thinking_watchdog_timeout');
                const fallback = this.thinking.onWatchdogTimeout?.(perception, gameSkillContext);
                this.options.inferenceLog.append(this.name, {
                    tick: this.state.tick,
                    cause: 'thinking_watchdog_timeout',
                    timeoutMs,
                    sparkModule: this.thinkingSparkModule,
                });
                resolve(
                    fallback || {
                        actions: [],
                        syntheticEvents: [],
                        cause: 'thinking_watchdog_timeout',
                        envelopeTokens: 0,
                        nooped: true,
                    },
                );
            }, timeoutMs);
        });
        try {
            return await Promise.race([this.thinking.think(perception, gameSkillContext), timeout]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    private async submitActionWithWatchdog(input: ActionCoordinatorSubmitInput): Promise<ActionAttempt> {
        if (input.action.kind === 'trade_resource') {
            return this.executeTradeResource(input);
        }
        const timeoutMs = this.actionWatchdogTimeoutMs(input.action);
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<ActionAttempt>(resolve => {
            timer = setTimeout(() => {
                const attempt =
                    this.actionCoordinator.cancelCurrent('action_watchdog_timeout') ||
                    fallbackTimedOutAttempt(this.name, input, 'action_watchdog_timeout');
                this.options.inferenceLog.append(this.name, {
                    tick: this.state.tick,
                    cause: 'action_watchdog_timeout',
                    actionKind: input.action.kind,
                    timeoutMs,
                    sparkModule: this.thinkingSparkModule,
                });
                resolve(attempt);
            }, timeoutMs);
        });
        try {
            return await Promise.race([this.actionCoordinator.submit(input), timeout]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    private actionWatchdogTimeoutMs(action: AgentAction): number {
        if (this.options.watchdog?.actionMs !== undefined) {
            return Math.max(1, this.options.watchdog.actionMs);
        }
        if (action.kind === 'say') {
            return SAY_ACTION_WATCHDOG_MS;
        }
        if (action.kind === 'move_to' && isPosition(action.target)) {
            const latestPerception = this.body.getLatestPerception();
            return (
                movementEffectTimeoutMs(latestPerception ? perceptionPosition(latestPerception) : undefined, action.target) +
                ACTION_EFFECT_WATCHDOG_GRACE_MS
            );
        }
        if (waitsForPerceptionEffect(action.kind) && supportsPerceptionEffectWait(this.body)) {
            return actionEffectTimeoutMs(action, this.body.getLatestPerception()) + ACTION_EFFECT_WATCHDOG_GRACE_MS;
        }
        return ACK_ONLY_ACTION_WATCHDOG_MS;
    }

    onEvent(event: PerceptionEvent): void {
        this.history.push(event);
        this.body.observeEvent(event);
        if (this.state.activeTradeResource) {
            const active = this.state.activeTradeResource;
            if (event.kind === 'trade_completed') {
                this.completeActiveTradeResource();
            } else if (event.kind === 'trade_cancelled' || event.kind === 'trade_declined') {
                this.declineActiveTradeResource(event.kind);
            }
        }
        this.pendingEvents.push(event);
        if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
            this.pendingEvents.splice(0, this.pendingEvents.length - MAX_PENDING_EVENTS);
        }
        if (
            (event.kind === 'chat' || event.kind === 'whisper') &&
            typeof event.text === 'string' &&
            event.from &&
            typeof event.from === 'object'
        ) {
            const fromName = 'name' in event.from && typeof event.from.name === 'string' ? event.from.name : undefined;
            if (fromName) {
                const patronKind = this.patronRegistry.getKind(fromName);
                if (patronKind && this.evidence?.library) {
                    this.evidence.library.observePatron({
                        kind: patronKind,
                        ts: typeof event.ts === 'string' ? event.ts : new Date().toISOString(),
                        tick: this.state.tick,
                        patronHandle: fromName,
                        note: event.text,
                    });
                }
            }
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

    private peekWithPendingEvents(perception: Perception): Perception {
        if (this.pendingEvents.length === 0) {
            return perception;
        }
        const events = Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
        return { ...perception, events: [...events, ...this.pendingEvents] };
    }

    private async withEvidenceTick(perception: Perception, run: () => Promise<void>): Promise<void> {
        // HD-019: skip trajectory + progress evidence for already-processed deceased
        // residents. handlePerception still runs so applyExternalOperatorRevive can
        // re-animate them; it just stops polluting the trajectory file with empty
        // begin_tick/end_tick pairs that accumulate indefinitely after death.
        if (this.state.deceased?.processed) {
            await run();
            return;
        }
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
            this.state.lastMeaningfulProgressAt = this.runtimeProgressTick(tick);
            this.state.stuckSince = undefined;
        } else if (delta.stuckSince !== null) {
            this.state.stuckSince = this.runtimeProgressTick(delta.stuckSince);
        } else {
            this.state.stuckSince = undefined;
        }

        this.recordProgressEvidence(tick, delta);
    }

    private runtimeProgressTick(observedTick: number): number {
        return Math.max(this.state.tick, observedTick);
    }

    private recordProgressEvidence(tick: number, delta: { meaningful: boolean; reasons: string[]; stuckSince: number | null }): void {
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
        this.observeFactionStockpileAttempt(attempt);
    }

    private observeFactionStockpileAttempt(attempt: ActionAttempt): void {
        try {
            this.options.factionStockpile?.recordAttempt({
                resident: this.name,
                factionId: this.options.soul.frontmatter.factionId,
                attempt,
            });
        } catch (error) {
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                cause: 'faction_stockpile_observe_failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private rememberTargetFailure(attempt: ActionAttempt): void {
        const keys = actionTargetFailureKeys(attempt.action);
        if (keys.length === 0) {
            return;
        }

        const cognition = (this.state.cognition ||= {});
        if (attempt.finalStatus === 'timeout' || (attempt.finalStatus === 'failure' && attempt.finalReason === 'target_not_found')) {
            const failedAt = Object.fromEntries(keys.map(key => [key, this.state.tick]));
            cognition.targetFailureCooldowns = {
                ...(cognition.targetFailureCooldowns || {}),
                ...failedAt,
            };
            return;
        }

        if (attempt.finalStatus === 'success' && cognition.targetFailureCooldowns) {
            for (const key of keys) {
                delete cognition.targetFailureCooldowns[key];
            }
        }
    }

    private rememberCompletedGoal(attempt: ActionAttempt): void {
        if (attempt.finalStatus !== 'success') {
            return;
        }
        const cognition = this.state.cognition;
        const goal = cognition?.activeGoal;
        if (!goal || !isStandaloneFiremakingGoal(goal) || attempt.action.kind !== 'use_item_on_item') {
            return;
        }

        cognition.activeGoal = explorationGoal(actionAttemptTick(attempt) ?? this.state.tick);
        cognition.activeMove = undefined;
        cognition.lastGoalShareTick = undefined;
        cognition.routineLoopKey = undefined;
        cognition.routineLoopCount = undefined;
    }

    private checkDeceasedAndDispatchEpitaphs(perception: Perception): void {
        if (this.state.deceased && !this.state.deceased.processed) {
            this.state.deceased.processed = true;
            const library = this.evidence?.library;
            const patronHandles = library ? library.getPatronHandles() : [];
            const root = record(perception);
            const residentObj = record(root.resident);
            const bestSkill = findBestSkill(residentObj.skills);
            const summary: DeceasedResidentSummary = {
                residentName: this.name,
                residentArchetype: this.options.soul.frontmatter.archetype,
                residentFaction: dominantFaction(this.options.soul.frontmatter.factionAffinity) || 'unaligned',
                livedTicks: this.state.tick,
                bestSkill,
                causeOfDeath: this.state.deceased.cause,
                deceasedAt: this.state.deceased.date,
                deceasedTick: this.state.deceased.tick,
                preparedEpitaph: loadPreparedEpitaph(this.options.memory, this.name),
            };
            const lettersStoreDir = this.evidence?.store.root;
            if (lettersStoreDir) {
                const store = new LettersStore(lettersStoreDir);
                const senderResident = findLivingSibling(this.options.soul.frontmatter.siblings ?? [], r =>
                    this.options.stateStore.isAlive(r),
                );
                const letters = buildEpitaphDispatchRequests(summary, patronHandles, { senderResident });
                if (letters.length > 0) {
                    dispatchEpitaphs(letters, store);
                }

                const uniquePatrons = new Set<string>();
                const seenPatronsLower = new Set<string>();

                const addPatron = (handle: string) => {
                    const h = handle.trim();
                    if (h.length > 0) {
                        const lower = h.toLowerCase();
                        if (!seenPatronsLower.has(lower)) {
                            seenPatronsLower.add(lower);
                            uniquePatrons.add(h);
                        }
                    }
                };

                const standingPath = path.join(lettersStoreDir, 'patron-standing.json');
                if (fs.existsSync(standingPath)) {
                    try {
                        const raw = fs.readFileSync(standingPath, 'utf8');
                        const snap = JSON.parse(raw);
                        if (snap && snap.points) {
                            for (const key of Object.keys(snap.points)) {
                                const parts = key.split('|');
                                if (parts.length > 0) {
                                    addPatron(parts[0]);
                                }
                            }
                        }
                    } catch {
                        // ignore
                    }
                }

                try {
                    const config = loadControllerConfig();
                    if (config && Array.isArray(config.patrons)) {
                        for (const p of config.patrons) {
                            if (p && p.handle) {
                                addPatron(p.handle);
                            }
                        }
                    }
                } catch {
                    // ignore
                }

                const broadcastLetters: Letter[] = [];
                for (const recipient of uniquePatrons) {
                    const broadcastInput = {
                        recipient,
                        residentName: summary.residentName,
                        faction: summary.residentFaction,
                        livedTicks: summary.livedTicks,
                        causeOfDeath: summary.causeOfDeath || 'unknown causes',
                        ts: summary.deceasedAt,
                    };
                    broadcastLetters.push(produceBroadcastLetter(broadcastInput));
                }

                if (broadcastLetters.length > 0) {
                    dispatchEpitaphs(broadcastLetters, store);
                }
            }
        }
    }

    private effectWaitFor(action: AgentAction): ((signal: AbortSignal) => Promise<EffectWaitResult>) | undefined {
        if (action.kind === 'move_to' && isPosition(action.target)) {
            const target = action.target;
            const range = typeof action.range === 'number' ? Math.max(0, action.range) : 0;
            const afterSeq = this.body.getLatestPerceptionSeq();
            const latestPerception = this.body.getLatestPerception();
            const startPosition = latestPerception ? perceptionPosition(latestPerception) : undefined;
            const timeoutMs = movementEffectTimeoutMs(startPosition, target);
            return async signal => {
                const wait = await this.body.waitForPerception(
                    perception => positionMatches(perceptionPosition(perception), target, range),
                    {
                        afterSeq,
                        timeoutMs,
                        signal,
                    },
                );
                const latestAfterWait = this.body.getLatestPerception();
                return movementWaitToEffect(wait, {
                    target,
                    range,
                    startPosition,
                    finalPosition: latestAfterWait ? perceptionPosition(latestAfterWait) : undefined,
                    timeoutMs,
                });
            };
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
            const timeoutMs = actionEffectTimeoutMs(action, before);
            return async signal =>
                perceptionWaitToEffect(
                    await this.body.waitForPerception(perception => actionEffectObserved(action, before, perception), {
                        afterSeq,
                        timeoutMs,
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
        if (this.whisperInbox) {
            this.whisperInbox.unsubscribe();
        }
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

    async tick(ctx: RoutineContext): Promise<RoutineTickOutcome> {
        this._lastHints = [];

        let abortHandler: (() => void) | undefined;
        const arrivalPromise = new Promise<PerceptionArrival>(resolve => {
            this.nextPerceptionResolver = resolve;

            abortHandler = () => {
                if (this.nextPerceptionResolver === resolve) {
                    this.nextPerceptionResolver = undefined;
                    resolve({
                        perception: {} as any,
                        preemption: { preempted: 'aborted' },
                    });
                }
            };
            ctx.signal.addEventListener('abort', abortHandler);
        });

        const arrival = await arrivalPromise;
        if (abortHandler) {
            ctx.signal.removeEventListener('abort', abortHandler);
        }

        if (arrival.preemption) {
            return arrival.preemption;
        }

        const perception = arrival.perception;

        if (ctx.tickIndex === 0) {
            this.killsObserved = 0;
            this.followSuccessTicks = 0;
        }

        // Determine active routine action via routine dispatch table.
        let action: AgentAction | undefined;
        const activeRoutineId = ctx.routineId || this.activeRoutineId;
        switch (activeRoutineId) {
            case 'make_fire':
                action = firemakingAction(perception);
                if (!action && hasNearbyFire(perception)) {
                    return 'completed';
                }
                break;
            case 'chop_tree': {
                const params = chopTreeParams(ctx.params);
                if (params.targetCoord) {
                    const here = perceptionPosition(perception);
                    if (here) {
                        const dist = chebyshevDistance(here, params.targetCoord);
                        if (dist > 1) {
                            action = {
                                kind: 'move_to',
                                target: { x: params.targetCoord.x, y: params.targetCoord.y, level: params.targetCoord.level ?? 0 },
                                range: 1,
                                cause: 'routine:chop_tree',
                            };
                        }
                    }
                }
                if (!action) {
                    action = levelOneWoodcuttingAction(perception);
                }
                break;
            }
            case 'bury_bones':
                action = buryBonesAction(perception);
                if (!action) {
                    // No bones in inventory means there are none to bury — done.
                    return 'completed';
                }
                break;
            case 'safe_combat': {
                const params = safeCombatParams(ctx.params);
                const resident = record(perception.resident);

                // Check HP limit (stay > 30%)
                const hp = record(resident.hp);
                const currentHp = typeof hp.current === 'number' ? hp.current : undefined;
                const maxHp = typeof hp.max === 'number' ? hp.max : undefined;
                if (currentHp !== undefined && maxHp !== undefined && maxHp > 0) {
                    if (currentHp / maxHp <= 0.3) {
                        this.killsObserved = 0;
                        return { preempted: 'nervous_eat_when_hurt' };
                    }
                }

                // Check kill count completion
                const events = Array.isArray(perception.events) ? perception.events : [];
                for (const event of events) {
                    const text = typeof event.text === 'string' ? event.text.toLowerCase() : '';
                    if (event.kind === 'death' || /defeat|dies/.test(text)) {
                        this.killsObserved += 1;
                    }
                }

                const killCount = params.killCount ?? 1;
                if (this.killsObserved >= killCount) {
                    this.killsObserved = 0;
                    return 'completed';
                }

                // Eat food if low health
                if (isLowHealth(perception)) {
                    const inventory = Array.isArray(resident.inventory) ? resident.inventory : [];
                    const foodSlot = firstFoodSlot(inventory);
                    if (foodSlot !== undefined) {
                        action = { kind: 'eat', slot: foodSlot, cause: 'combat_eat_before_training' };
                    } else {
                        return 'no_progress';
                    }
                }

                if (!action) {
                    const targetNpc = pickSafeCombatTarget(perception, params.target);
                    if (targetNpc) {
                        action = { kind: 'attack', target: targetNpc, cause: 'routine:safe_combat' };
                    } else {
                        action = combatTrainingAction(perception);
                    }
                }
                break;
            }
            case 'follow_player': {
                const params = followPlayerParams(ctx.params);
                const target = pickFollowTarget(perception, params.player);
                if (!target) {
                    this.followSuccessTicks = 0;
                    return 'no_progress';
                }

                const current = perceptionPosition(perception);
                const followDistance = params.distance ?? 3;
                if (current && chebyshevDistance(current, target) <= followDistance) {
                    this.followSuccessTicks += 1;
                    if (this.followSuccessTicks >= 5) {
                        this.followSuccessTicks = 0;
                        return 'completed';
                    }
                    return 'progress';
                } else {
                    this.followSuccessTicks = 0;
                    action = {
                        kind: 'move_to',
                        target: { x: target.x, y: target.y, level: target.level ?? 0 },
                        range: followDistance,
                        cause: 'routine:follow_player',
                    };
                }
                break;
            }
        }

        if (!action) {
            return 'no_progress';
        }

        // Populate hints
        if (action.kind === 'use_item_on_item') {
            this._lastHints.push('tinderbox_used');
        } else if (action.kind === 'interact') {
            this._lastHints.push('interact_target');
        } else if (action.kind === 'attack_npc') {
            this._lastHints.push('attack_target');
        } else if (action.kind === 'item_action') {
            this._lastHints.push(`item_action_${action.option}`);
        }

        // Submit action
        const attempt = await this.actionCoordinator.submit({
            producer: 'active-routine',
            action,
            metadata: {
                tick: this.state.tick,
                attention_after: this.state.attention,
                source: 'routine',
                routineId: activeRoutineId,
            },
            waitForEffect: this.effectWaitFor(action),
            ...this.evidenceCallbacks(),
        });

        if (attempt.finalStatus === 'success') {
            return routineSuccessOutcome(activeRoutineId, action);
        }
        if (attempt.finalStatus === 'accepted') {
            return 'progress';
        }
        if (attempt.finalStatus === 'cancelled_before_submit' || attempt.finalStatus === 'interrupted_after_submit') {
            return { preempted: 'aborted' };
        }
        return 'no_progress';
    }

    private async executeTradeResource(input: ActionCoordinatorSubmitInput): Promise<ActionAttempt> {
        const action = input.action as {
            kind: 'trade_resource';
            target: { humanHandle: string };
            artifact: string;
            quantity: number;
            note?: string;
            cause?: string;
        };
        const tier = this.options.soul.frontmatter.heroProfile?.tier ?? 'background';
        const tierConfig = HERO_TIERS[tier];
        const perception = this.body.getLatestPerception();
        const nearby = record(record(perception).nearby);
        const players = Array.isArray(nearby.players) ? (nearby.players as any[]) : [];
        const targetVisible = players.some(p => p.name?.toLowerCase() === action.target.humanHandle.toLowerCase());
        const resident = record(record(perception).resident);
        const inventory = Array.isArray(resident.inventory) ? (resident.inventory as any[]) : [];

        const check = canTradeResource(this.state, tierConfig, inventory as any, action.artifact, action.quantity, targetVisible);
        if (!check.ok) {
            const failAttempt: ActionAttempt = {
                attemptId: `attempt-trade_resource-fail-${Date.now()}`,
                resident: this.name,
                producer: input.producer,
                action: input.action,
                submittedAt: new Date().toISOString(),
                cause: action.cause,
                evidence: [],
                finalStatus: 'failure',
                finalReason: check.reason || 'precondition_failed',
                metadata: input.metadata,
            };
            this.recordEvidence(trajectory => {
                const line = trajectory.recordAction(action, failAttempt.attemptId);
                this.evidence?.library?.observeTrajectory(line);
                trajectory.recordActionResult(failAttempt.attemptId, {
                    status: 'failure',
                    reason: check.reason || 'precondition_failed',
                });
            });
            return failAttempt;
        }

        const attemptId = `attempt-trade_resource-${Date.now()}`;
        const attempt: ActionAttempt = {
            attemptId,
            resident: this.name,
            producer: input.producer,
            action: input.action,
            submittedAt: new Date().toISOString(),
            cause: action.cause,
            evidence: [],
            finalStatus: 'accepted',
            metadata: input.metadata,
        };

        this.state.activeTradeResource = {
            targetHandle: action.target.humanHandle,
            artifact: action.artifact,
            quantity: action.quantity,
            note: action.note,
            cause: action.cause,
            startTick: this.state.tick,
            status: 'initiating',
            attemptId,
            producer: input.producer,
        };
        this.options.stateStore.save(this.state);

        this.recordEvidence(trajectory => {
            const line = trajectory.recordAction(action, attemptId);
            this.evidence?.library?.observeTrajectory(line);
        });

        const promise = new Promise<ActionAttempt>((resolve, reject) => {
            this.activeTradeResourceDeferred = { resolve, reject, attempt };
        });

        try {
            await this.body.submit(
                {
                    kind: 'trade_request',
                    target: { playerHandle: action.target.humanHandle },
                    cause: action.cause || 'trade_resource_initiate',
                } as any,
                {
                    tick: this.state.tick,
                    attention_after: this.state.attention,
                    source: sourceFromProducer(input.producer),
                },
            );
        } catch (error) {
            this.declineActiveTradeResource('request_submit_failed');
        }

        return promise;
    }

    private async tickActiveTradeResource(perception: Perception): Promise<void> {
        const active = this.state.activeTradeResource;
        if (!active) {
            return;
        }

        const elapsed = this.state.tick - active.startTick;
        if (elapsed >= 100) {
            await this.declineActiveTradeResource('timeout');
            return;
        }

        const resident = record(record(perception).resident);
        const trade = resident.activeTrade ? (resident.activeTrade as any) : undefined;

        if (active.status !== 'initiating' && !trade) {
            await this.declineActiveTradeResource('cancelled');
            return;
        }

        if (trade) {
            if (active.status === 'initiating') {
                if (trade.partner) {
                    const partnerName = trade.partner.name || trade.partner.id;
                    if (partnerName.toLowerCase() !== active.targetHandle.toLowerCase()) {
                        await this.declineActiveTradeResource('partner_mismatch');
                        return;
                    }
                }

                const inventory = Array.isArray(resident.inventory) ? (resident.inventory as any[]) : [];
                const itemIndex = inventory.findIndex(item => item && itemMatches(item, active.artifact));
                if (itemIndex === -1) {
                    await this.declineActiveTradeResource('insufficient_inventory');
                    return;
                }
                const item = inventory[itemIndex];
                if (!item || item.amount < active.quantity) {
                    await this.declineActiveTradeResource('insufficient_inventory');
                    return;
                }

                active.status = 'offering';
                this.options.stateStore.save(this.state);

                try {
                    await this.submitSubAction({
                        kind: 'trade_offer_item',
                        itemId: item.itemId,
                        quantity: active.quantity,
                        slot: itemIndex,
                        cause: active.cause,
                    });
                } catch {
                    // ignore
                }
            } else if (active.status === 'offering') {
                const offered = trade.ours?.find((item: any) => itemMatches(item, active.artifact) && item.amount === active.quantity);
                if (offered) {
                    active.status = 'accepting_stage_1';
                    this.options.stateStore.save(this.state);
                    try {
                        await this.submitSubAction({
                            kind: 'trade_accept_stage_1',
                            cause: active.cause,
                        });
                    } catch {
                        // ignore
                    }
                }
            } else if (active.status === 'accepting_stage_1') {
                if (trade.ourStage === 'accepted_1') {
                    if (trade.theirStage === 'accepted_1' || trade.theirStage === 'accepted_2') {
                        active.status = 'accepting_stage_2';
                        this.options.stateStore.save(this.state);
                        try {
                            await this.submitSubAction({
                                kind: 'trade_accept_stage_2',
                                cause: active.cause,
                            });
                        } catch {
                            // ignore
                        }
                    }
                } else if (!trade.ourStage || trade.ourStage === 'editing') {
                    try {
                        await this.submitSubAction({
                            kind: 'trade_accept_stage_1',
                            cause: active.cause,
                        });
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    private async submitSubAction(action: AgentAction): Promise<ActionResult> {
        const active = this.state.activeTradeResource;
        if (!active) {
            throw new Error('No active trade resource transaction');
        }
        return this.body.submit(action, {
            tick: this.state.tick,
            attention_after: this.state.attention,
            source: sourceFromProducer(active.producer),
        });
    }

    private completeActiveTradeResource(): void {
        const active = this.state.activeTradeResource;
        if (!active) {
            return;
        }

        const deferred = this.activeTradeResourceDeferred;
        this.state.activeTradeResource = undefined;
        this.activeTradeResourceDeferred = undefined;
        this.options.stateStore.save(this.state);

        if (this.evidence?.library) {
            this.evidence.library.observePatron({
                kind: 'patron_gift',
                ts: new Date().toISOString(),
                tick: this.state.tick,
                patronHandle: active.targetHandle,
                artifact: active.artifact,
                amount: active.quantity,
                direction: 'out',
                note: active.note || 'hero_gift',
            });
        }

        if (deferred) {
            deferred.attempt.finalStatus = 'success';
            this.recordEvidence(trajectory => {
                trajectory.recordActionResult(active.attemptId, {
                    status: 'success',
                });
            });
            deferred.resolve(deferred.attempt);
        }
    }

    private declineActiveTradeResource(reason: string): void {
        const active = this.state.activeTradeResource;
        if (!active) {
            return;
        }

        const deferred = this.activeTradeResourceDeferred;
        this.state.activeTradeResource = undefined;
        this.activeTradeResourceDeferred = undefined;
        this.options.stateStore.save(this.state);

        this.body
            .submit(
                {
                    kind: 'trade_decline',
                    cause: 'trade_resource_decline',
                    reason,
                } as any,
                {
                    tick: this.state.tick,
                    attention_after: this.state.attention,
                    source: sourceFromProducer(active.producer),
                },
            )
            .catch(() => {});

        if (deferred) {
            const finalStatus = reason === 'timeout' ? 'timeout' : 'failure';
            deferred.attempt.finalStatus = finalStatus;
            deferred.attempt.finalReason = reason;
            this.recordEvidence(trajectory => {
                trajectory.recordActionResult(active.attemptId, {
                    status: finalStatus,
                    reason,
                });
            });
            deferred.resolve(deferred.attempt);
        }
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

interface FollowPlayerParams {
    player?: string;
    distance?: number;
}

interface RoutineCoord {
    x: number;
    y: number;
    level?: number;
}

interface ChopTreeParams {
    targetCoord?: RoutineCoord;
}

interface SafeCombatParams {
    target?: {
        kind?: 'npc' | 'player';
        name?: string;
        coord?: RoutineCoord;
    };
    killCount?: number;
}

/**
 * Pick the named visible player from the perception payload to follow, or
 * the nearest visible player when the routine was called without a name.
 * Loose typing — perception shapes vary across gateway versions; we read
 * defensively and bail to undefined when nothing usable is found. Used by
 * the `follow_player` routine (RB-MCP-δ).
 */
function pickFollowTarget(perception: unknown, playerName?: string): Position | undefined {
    if (!perception || typeof perception !== 'object') {
        return undefined;
    }
    const nearby = (perception as Record<string, unknown>).nearby;
    if (!nearby || typeof nearby !== 'object') {
        return undefined;
    }
    const players = (nearby as Record<string, unknown>).players;
    if (!Array.isArray(players) || players.length === 0) {
        return undefined;
    }
    const root = perception as Record<string, unknown>;
    const residentPos = perceptionPosition(root as Perception);
    const parsedPlayers: Array<{ name?: string; id?: string; position: Position }> = [];
    for (const player of players) {
        if (player && typeof player === 'object') {
            const playerRecord = player as Record<string, unknown>;
            const position = (player as Record<string, unknown>).position;
            if (position && typeof position === 'object') {
                const pos = position as Record<string, unknown>;
                if (typeof pos.x === 'number' && typeof pos.y === 'number') {
                    parsedPlayers.push({
                        id: typeof playerRecord.id === 'string' ? playerRecord.id : undefined,
                        name: typeof playerRecord.name === 'string' ? playerRecord.name : undefined,
                        position: { x: pos.x, y: pos.y, level: typeof pos.level === 'number' ? pos.level : 0 },
                    });
                }
            }
        }
    }
    const normalizedTarget = normalizeName(playerName);
    if (normalizedTarget) {
        const exact = parsedPlayers.find(
            player => normalizeName(player.name) === normalizedTarget || normalizeName(player.id) === normalizedTarget,
        );
        if (exact) {
            return exact.position;
        }
        const partial = parsedPlayers.find(
            player => normalizeName(player.name)?.includes(normalizedTarget) || normalizeName(player.id)?.includes(normalizedTarget),
        );
        return partial?.position;
    }

    return parsedPlayers
        .sort((a, b) => (residentPos ? chebyshevDistance(a.position, residentPos) - chebyshevDistance(b.position, residentPos) : 0))
        .at(0)?.position;
}

function followPlayerParams(params: unknown): FollowPlayerParams {
    const recordValue = record(params);
    return {
        player: typeof recordValue.player === 'string' ? recordValue.player : undefined,
        distance: typeof recordValue.distance === 'number' ? recordValue.distance : undefined,
    };
}

function chopTreeParams(params: unknown): ChopTreeParams {
    const targetCoord = coordParam(record(params).targetCoord);
    return targetCoord ? { targetCoord } : {};
}

function safeCombatParams(params: unknown): SafeCombatParams {
    const value = record(params);
    const target = record(value.target);
    return {
        target:
            Object.keys(target).length > 0
                ? {
                      kind: target.kind === 'npc' || target.kind === 'player' ? target.kind : undefined,
                      name: typeof target.name === 'string' ? target.name : undefined,
                      coord: coordParam(target.coord),
                  }
                : undefined,
        killCount: typeof value.killCount === 'number' ? value.killCount : undefined,
    };
}

function pickSafeCombatTarget(perception: Perception, target: SafeCombatParams['target']): Record<string, unknown> | undefined {
    if (!target || target.kind === 'player') {
        return undefined;
    }
    const npcs = record(record(perception).nearby).npcs;
    if (!Array.isArray(npcs)) {
        return undefined;
    }
    const targetName = normalizeName(target.name);
    return npcs.find(npc => {
        const actor = record(npc);
        const position = coordParam(actor.position);
        if (targetName) {
            const actorName = normalizeName(actor.name);
            const actorKey = normalizeName(actor.key);
            const actorId = normalizeName(actor.id);
            if (actorName !== targetName && actorKey !== targetName && actorId !== targetName) {
                return false;
            }
        }
        if (target.coord) {
            return position ? sameCoord(position, target.coord) : false;
        }
        return true;
    });
}

function coordParam(value: unknown): RoutineCoord | undefined {
    const recordValue = record(value);
    if (typeof recordValue.x !== 'number' || typeof recordValue.y !== 'number') {
        return undefined;
    }
    return {
        x: recordValue.x,
        y: recordValue.y,
        level: typeof recordValue.level === 'number' ? recordValue.level : undefined,
    };
}

function sameCoord(a: RoutineCoord, b: RoutineCoord): boolean {
    return a.x === b.x && a.y === b.y && (a.level === b.level || a.level === undefined || b.level === undefined);
}

function routineSuccessOutcome(routineId: string | undefined, action: AgentAction): RoutineTickOutcome {
    if (routineId === 'safe_combat') {
        return 'progress';
    }
    if (routineId === 'follow_player') {
        return 'progress';
    }
    if (routineId === 'chop_tree' && action.kind === 'move_to') {
        return 'progress';
    }
    return 'completed';
}

function normalizeName(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
}

function chebyshevDistance(a: Position, b: Position): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
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

function movementWaitToEffect(
    wait: Awaited<ReturnType<ResidentBody['waitForPerception']>>,
    detail: {
        target: Position;
        range: number;
        startPosition?: Position;
        finalPosition?: Position;
        timeoutMs: number;
    },
): EffectWaitResult {
    if (wait.ok) {
        return {
            ok: true,
            evidence: [
                {
                    source: 'perception',
                    detail: { kind: 'position_reached', position: perceptionPosition(wait.observation.value) },
                },
            ],
        };
    }

    const startDistance =
        detail.startPosition && samePlane(detail.startPosition, detail.target)
            ? chebyshevDistance(detail.startPosition, detail.target)
            : undefined;
    const finalDistance =
        detail.finalPosition && samePlane(detail.finalPosition, detail.target)
            ? chebyshevDistance(detail.finalPosition, detail.target)
            : undefined;
    const improved = typeof startDistance === 'number' && typeof finalDistance === 'number' && finalDistance < startDistance;

    if (wait.reason === 'timeout' && improved) {
        return {
            ok: true,
            evidence: [
                {
                    source: 'perception',
                    detail: {
                        kind: 'movement_progress',
                        target: detail.target,
                        range: detail.range,
                        startPosition: detail.startPosition,
                        finalPosition: detail.finalPosition,
                        startDistance,
                        finalDistance,
                        improved,
                        waitOutcome: wait.reason,
                        timeoutMs: detail.timeoutMs,
                    },
                },
            ],
        };
    }

    return {
        ok: false,
        reason: wait.reason,
        evidence: [
            {
                source: detail.finalPosition ? 'perception' : 'derived',
                detail: {
                    kind: wait.reason === 'timeout' ? 'movement_timeout' : 'movement_aborted',
                    target: detail.target,
                    range: detail.range,
                    startPosition: detail.startPosition,
                    finalPosition: detail.finalPosition,
                    startDistance,
                    finalDistance,
                    improved: typeof startDistance === 'number' && typeof finalDistance === 'number' ? improved : undefined,
                    timeoutMs: detail.timeoutMs,
                },
            },
        ],
    };
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

function samePlane(a: Position, b: Position): boolean {
    return b.level === undefined || a.level === b.level || a.level === undefined;
}

function movementEffectTimeoutMs(position: Position | undefined, target: Position): number {
    if (!position) {
        return MOVE_EFFECT_TIMEOUT_MIN_MS;
    }
    const distance = Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y));
    return Math.max(
        MOVE_EFFECT_TIMEOUT_MIN_MS,
        Math.min(MOVE_EFFECT_TIMEOUT_MAX_MS, MOVE_EFFECT_TIMEOUT_BUFFER_MS + distance * MOVE_EFFECT_TIMEOUT_PER_TILE_MS),
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
    if (isFiremakingUseItemOnItemAction(action, before)) {
        return firemakingEffectObserved(after);
    }
    return changedEffectSections(before, after, action).length > 0 || eventSummaries(after, action).length > 0;
}

export function actionEffectTimeoutMs(action: AgentAction, before: Perception | undefined): number {
    if (isFiremakingUseItemOnItemAction(action, before)) {
        return 15000;
    }

    if (isStarterFishingInteractAction(action)) {
        return STARTER_FISHING_EFFECT_TIMEOUT_MS;
    }

    const startPosition = before ? perceptionPosition(before) : undefined;
    const targetPosition = actionTargetPositionForEffect(action);
    if (targetPosition) {
        return Math.min(MOVE_EFFECT_TIMEOUT_MAX_MS, movementEffectTimeoutMs(startPosition, targetPosition) + 5_000);
    }

    return 5000;
}

function isFiremakingUseItemOnItemAction(action: AgentAction, perception: Perception | undefined): boolean {
    if (action.kind !== 'use_item_on_item') {
        return false;
    }
    const actionRecord = record(action);
    if (typeof actionRecord.itemSlot !== 'number' || typeof actionRecord.targetSlot !== 'number') {
        return false;
    }
    const source = inventoryItemAt(perception, actionRecord.itemSlot);
    const target = inventoryItemAt(perception, actionRecord.targetSlot);
    return (isTinderboxItem(source) && isLogItem(target)) || (isLogItem(source) && isTinderboxItem(target));
}

function isStarterFishingInteractAction(action: AgentAction | undefined): boolean {
    if (!action || action.kind !== 'interact') {
        return false;
    }
    const actionRecord = record(action);
    const option = typeof actionRecord.option === 'string' ? actionRecord.option.toLowerCase() : '';
    if (option !== 'net') {
        return false;
    }
    const target = record(actionRecord.target);
    const targetText =
        `${typeof target.key === 'string' ? target.key : ''} ${typeof target.name === 'string' ? target.name : ''}`.toLowerCase();
    return actionRecord.cause === 'starter_fishing_net' || /fishing_spot|fishing spot/.test(targetText);
}

function inventoryItemAt(perception: Perception | undefined, slot: number): Record<string, unknown> | undefined {
    const resident = record(record(perception).resident);
    const inventory = Array.isArray(resident.inventory) ? resident.inventory : [];
    return record(inventory[slot]);
}

function isTinderboxItem(item: Record<string, unknown> | undefined): boolean {
    return item?.itemId === 590 || item?.key === 'rs:tinderbox';
}

function isLogItem(item: Record<string, unknown> | undefined): boolean {
    return item?.itemId === 1511 || (typeof item?.key === 'string' && /(^|:)logs$/.test(item.key));
}

function firemakingEffectObserved(perception: Perception): boolean {
    const nearby = record(record(perception).nearby);
    const objects = Array.isArray(nearby.objects) ? nearby.objects : [];
    if (objects.some(object => record(object).objectId === 2732)) {
        return true;
    }
    const events = Array.isArray(perception.events) ? perception.events : [];
    return events.some(event => {
        const eventRecord = record(event);
        const text = typeof eventRecord.text === 'string' ? eventRecord.text.toLowerCase() : '';
        return eventRecord.kind === 'fire_lit' || /fire catches|logs begin to burn/.test(text);
    });
}

function actionTargetPositionForEffect(action: AgentAction): Position | undefined {
    const actionRecord = record(action);
    const target = actionRecord.target;
    if (!target || typeof target !== 'object') {
        return undefined;
    }

    const directPosition = isPosition(target) ? target : undefined;
    const nestedPosition = record(record(target).position);
    const position = directPosition || nestedPosition;
    if (typeof position.x !== 'number' || typeof position.y !== 'number') {
        return undefined;
    }

    return {
        x: position.x,
        y: position.y,
        level: typeof position.level === 'number' ? position.level : undefined,
    };
}

function effectState(perception: Perception | undefined, action?: AgentAction): Record<string, unknown> {
    const root = record(perception);
    const resident = record(root.resident);
    const nearby = record(root.nearby);
    const state: Record<string, unknown> = {
        hp: resident.hp,
        busy: resident.busy,
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
    if (isStarterFishingInteractAction(action)) {
        return ['busy', 'skills', 'inventory'];
    }

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
    if (isStarterFishingInteractAction(action)) {
        return eventMatchesStarterFishingEffect(event);
    }
    if (eventRecord.kind === 'fire_lit') {
        return true;
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

function eventMatchesStarterFishingEffect(event: unknown): boolean {
    const eventRecord = record(event);
    if (eventRecord.kind === 'item_received') {
        const item = record(eventRecord.item);
        const itemText = `${typeof item.key === 'string' ? item.key : ''} ${typeof item.name === 'string' ? item.name : ''}`.toLowerCase();
        return itemText.length === 0 || /fish|shrimp|anchov/.test(itemText);
    }
    const text = typeof eventRecord.text === 'string' ? eventRecord.text.toLowerCase() : '';
    return /start(?:ed)? fishing|begin(?:s)? fishing|catch(?:es)? (?:some )?(?:raw )?(?:shrimp|anchov|fish)/.test(text);
}

function fallbackTimedOutAttempt(resident: string, input: ActionCoordinatorSubmitInput, reason: string): ActionAttempt {
    return {
        attemptId: `attempt-watchdog-${Date.now()}`,
        resident,
        producer: input.producer,
        action: input.action,
        submittedAt: new Date().toISOString(),
        cause: input.cause,
        goalId: input.goalId,
        routineRunId: input.routineRunId,
        traceId: input.traceId,
        evidence: [],
        finalStatus: 'timeout',
        finalReason: reason,
        metadata: input.metadata,
    };
}

function actionTargetFailureKeys(action: AgentAction): string[] {
    const actionRecord = record(action);
    const target = actionRecord.target;
    if (!target || typeof target !== 'object') {
        return [];
    }
    const targetRecord = record(target);
    const directPosition = isPosition(target) ? target : undefined;
    const nestedPosition = record(targetRecord.position);
    const position = directPosition || nestedPosition;
    const level = typeof position.level === 'number' ? position.level : 0;
    const coordinate =
        typeof position.x === 'number' && typeof position.y === 'number' ? `${position.x},${position.y},${level}` : undefined;
    if (!coordinate) {
        return [];
    }
    const keys: string[] = [];
    if (typeof targetRecord.objectId === 'number') {
        keys.push(`object:${targetRecord.objectId}:${coordinate}`);
    }
    if (typeof targetRecord.itemId === 'number') {
        keys.push(`item:${targetRecord.itemId}:${coordinate}`);
    }
    if (typeof targetRecord.id === 'string') {
        keys.push(`actor:${targetRecord.id}:${coordinate}`);
        if (shouldRememberNpcFamilyFailure(actionRecord, targetRecord)) {
            keys.push(...npcFamilyFailureKeys(targetRecord));
        }
    }
    if (keys.length === 0) {
        keys.push(`target:${coordinate}`);
    }
    return keys;
}

function shouldRememberNpcFamilyFailure(actionRecord: Record<string, unknown>, targetRecord: Record<string, unknown>): boolean {
    if (!isNpcTarget(targetRecord)) {
        return false;
    }
    const option = typeof actionRecord.option === 'string' ? actionRecord.option.toLowerCase() : '';
    const cause = typeof actionRecord.cause === 'string' ? actionRecord.cause.toLowerCase() : '';
    return option === 'talk-to' || cause.includes('explore') || cause.includes('scout') || cause.includes('stuck');
}

function isNpcTarget(targetRecord: Record<string, unknown>): boolean {
    const kind = typeof targetRecord.kind === 'string' ? targetRecord.kind.toLowerCase() : undefined;
    return kind === 'npc' || (typeof targetRecord.id === 'string' && targetRecord.id.startsWith('npc:'));
}

function npcFamilyFailureKeys(targetRecord: Record<string, unknown>): string[] {
    const keys: string[] = [];
    const key = failureKeyFragment(targetRecord.key);
    if (key) {
        keys.push(`actor-key:${key}`);
    }
    const name = failureKeyFragment(targetRecord.name);
    if (name) {
        keys.push(`actor-name:${name}`);
    }
    return keys;
}

function failureKeyFragment(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function actionAttemptTick(attempt: ActionAttempt): number | undefined {
    const tick = record(attempt.metadata).tick;
    return typeof tick === 'number' ? tick : undefined;
}

function mapNervousRuleId(ruleId: string): RoutinePreemptionReason {
    if (ruleId.includes('eat') || ruleId.includes('low-health') || ruleId.includes('hurt')) {
        return 'nervous_eat_when_hurt';
    }
    if (ruleId.includes('flee') || ruleId.includes('outmatched') || ruleId.includes('runaway')) {
        return 'nervous_flee_when_outmatched';
    }
    if (ruleId.includes('death') || ruleId.includes('dead')) {
        return 'nervous_death';
    }
    if (ruleId.includes('help')) {
        return 'nervous_help_request';
    }
    return 'aborted';
}

function xpToLevel(xp: number): number {
    const xpTable: number[] = [0, 0];
    let points = 0;
    for (let lvl = 1; lvl < 120; lvl++) {
        points += Math.floor(lvl + 300 * 2 ** (lvl / 7));
        xpTable.push(Math.floor(points / 4));
    }
    let level = 1;
    for (let lvl = 1; lvl < xpTable.length; lvl++) {
        if (xp >= xpTable[lvl]) {
            level = lvl;
        } else {
            break;
        }
    }
    return level;
}

function findBestSkill(skillsValue: unknown): { name: string; level: number } | undefined {
    const xpMap = xpBySkill(skillsValue);
    let bestSkill: { name: string; level: number } | undefined;
    for (const [skillName, xp] of Object.entries(xpMap)) {
        const level = xpToLevel(xp);
        if (!bestSkill || level > bestSkill.level) {
            bestSkill = { name: skillName, level };
        }
    }
    return bestSkill;
}

function sourceFromProducer(producer: string): 'thinking' | 'nervous-system' | 'body' {
    if (producer === 'nervous-system') return 'nervous-system';
    if (producer === 'body' || producer === 'active-routine') return 'body';
    return 'thinking';
}
